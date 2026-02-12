/**
 * OpenCode plugin: GitButler integration via Cursor hook facade.
 *
 * Bridges OpenCode's plugin hooks to GitButler's `but cursor` CLI:
 * - tool.execute.after (edit/write)                  -> but cursor after-edit
 * - session.idle                                     -> but cursor stop
 * - experimental.chat.messages.transform             -> inject pending state notifications
 *
 * This enables automatic branch creation, file-to-branch assignment,
 * and auto-commit when using GitButler workspace mode with OpenCode.
 *
 * Uses Cursor hook format because it has simpler stdin JSON requirements
 * than Claude Code hooks (no transcript_path needed).
 *
 * Multi-agent support: Each OpenCode session gets its own branch via
 * conversation_id isolation in GitButler's session tracking.
 */

import type { Plugin } from "@opencode-ai/plugin";
import type { GitButlerPluginConfig } from "./config.js";
import { DEFAULT_CONFIG } from "./config.js";
import { createLogger } from "./logger.js";
import { createCli } from "./cli.js";
import type { HookOutput } from "./cli.js";
import { createStateManager } from "./state.js";
import type { HookInput, HookOutput as StateHookOutput, EventPayload, BranchOwnership } from "./state.js";
import { createNotificationManager } from "./notify.js";
import { createRewordManager } from "./reword.js";

export function createGitButlerPlugin(
  config: GitButlerPluginConfig = { ...DEFAULT_CONFIG },
): Plugin {
  return async ({ client, directory, worktree }) => {
  const cwd = worktree ?? directory;
  const log = createLogger(config.log_enabled, cwd);
  const cli = createCli(cwd, log);
  const state = createStateManager(cwd, log);

  // Hydrate session map from disk
  const diskSessionMap = await state.loadSessionMap();
  for (const [k, v] of diskSessionMap) {
    state.parentSessionByTaskSession.set(k, v);
  }

  const branchOwnership = new Map<string, BranchOwnership>();

  const persistedState = await state.loadPluginState();
  const conversationsWithEdits = new Set<string>(
    persistedState.conversationsWithEdits,
  );
  const rewordedBranches = new Set<string>(
    persistedState.rewordedBranches,
  );
  for (const [convId, ownership] of Object.entries(persistedState.branchOwnership ?? {})) {
    branchOwnership.set(convId, ownership);
  }
  log.info("state-loaded", {
    conversations: conversationsWithEdits.size,
    reworded: rewordedBranches.size,
    logEnabled: config.log_enabled,
    autoUpdate: config.auto_update,
    commitModel: config.commit_message_model,
  });
  log.info("plugin-init", {
    workspaceMode: cli.isWorkspaceMode(),
    sessionMapSize: state.parentSessionByTaskSession.size,
  });

  // Guard set: session IDs created internally for LLM commit message generation.
  // Hooks must skip these to prevent recursive triggering.
  const internalSessionIds = new Set<string>();

  // Guard set: conversationIds currently being processed by postStopProcessing.
  // Prevents duplicate session.idle events from triggering concurrent processing.
  const activeStopProcessing = new Set<string>();

  // Main session tracking for context injection fallback
  let mainSessionID: string | undefined;

  const notify = createNotificationManager(log, state.resolveSessionRoot);

  let DEFAULT_BRANCH_PATTERN: RegExp;
  try {
    DEFAULT_BRANCH_PATTERN = new RegExp(config.default_branch_pattern);
  } catch {
    DEFAULT_BRANCH_PATTERN = new RegExp(DEFAULT_CONFIG.default_branch_pattern);
  }

  type FileLock = {
    sessionID: string;
    timestamp: number;
    operation: string;
  };

  const fileLocks = new Map<string, FileLock>();

  const LOCK_TIMEOUT_MS = 60_000;
  const LOCK_POLL_MS = 1_000;
  const STALE_LOCK_MS = 5 * 60_000;

  function reapStaleLocks(): void {
    const now = Date.now();
    const staleCutoff = config.stale_lock_ms ?? STALE_LOCK_MS;
    for (const [filePath, lock] of fileLocks.entries()) {
      if (now - lock.timestamp > staleCutoff) {
        fileLocks.delete(filePath);
        log.info("lock-reaped", {
          file: filePath,
          owner: lock.sessionID,
          ageMs: now - lock.timestamp,
          operation: lock.operation,
        });
      }
    }
  }

  const editedFilesPerConversation = new Map<string, Set<string>>();

  const reword = createRewordManager({
    cwd,
    log,
    cli,
    config,
    defaultBranchPattern: DEFAULT_BRANCH_PATTERN,
    addNotification: notify.addNotification,
    resolveSessionRoot: state.resolveSessionRoot,
    conversationsWithEdits,
    rewordedBranches,
    branchOwnership,
    editedFilesPerConversation,
    savePluginState: state.savePluginState,
    internalSessionIds,
    reapStaleLocks,
    client,
  });

  type AssignmentCacheEntry = {
    branchCliId: string;
    conversationId: string;
    timestamp: number;
  };
  const assignmentCache = new Map<string, AssignmentCacheEntry>();
  const ASSIGNMENT_CACHE_TTL_MS = 30_000;

  // Cached workspace status for system prompt injection (avoids per-call Bun.spawnSync)
  let cachedStatus: { data: ReturnType<typeof cli.getFullStatus>; timestamp: number } | null = null;
  const STATUS_CACHE_TTL_MS = 10_000; // 10 seconds

  function getCachedStatus(): ReturnType<typeof cli.getFullStatus> {
    if (cachedStatus && Date.now() - cachedStatus.timestamp < STATUS_CACHE_TTL_MS) {
      return cachedStatus.data;
    }
    const fresh = cli.getFullStatus();
    cachedStatus = { data: fresh, timestamp: Date.now() };
    return fresh;
  }

  async function toUUID(input: string): Promise<string> {
    const data = new TextEncoder().encode(input);
    const hash = await crypto.subtle.digest(
      "SHA-256",
      data,
    );
    const hex = [...new Uint8Array(hash)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      `4${hex.slice(12, 15)}`,
      `8${hex.slice(15, 18)}`,
      hex.slice(18, 30),
    ].join("-");
  }

  type BeforeHookInput = {
    tool?: string;
    sessionID?: string;
    callID?: string;
  };

  type BeforeHookOutput = {
    args?: Record<string, unknown>;
  };

  function extractFilePathFromArgs(
    args: Record<string, unknown>,
  ): string | undefined {
    const raw =
      (args.filePath as string | undefined) ??
      (args.file_path as string | undefined) ??
      (args.path as string | undefined);
    return raw ? cli.toRelativePath(raw) : undefined;
  }

  return {
    "tool.execute.before": async (
      input: BeforeHookInput,
      output: BeforeHookOutput,
    ) => {
      if (internalSessionIds.has(input.sessionID ?? ""))
        return;
      if (input.tool !== "edit" && input.tool !== "write")
        return;
      if (!output.args) return;

      const filePath = extractFilePathFromArgs(output.args);
      if (!filePath) return;

      const sessionID = input.sessionID ?? "unknown";
      const existing = fileLocks.get(filePath);

      if (existing) {
        const isStale =
          Date.now() - existing.timestamp > STALE_LOCK_MS;
        if (isStale) {
          log.warn("lock-stale", {
            file: filePath,
            owner: existing.sessionID,
            ageMs: Date.now() - existing.timestamp,
            ownerOperation: existing.operation,
          });
        } else if (existing.sessionID !== sessionID) {
          log.info("lock-contention", {
            file: filePath,
            owner: existing.sessionID,
            ownerOperation: existing.operation,
            ownerAgeMs: Date.now() - existing.timestamp,
            waiter: sessionID,
            waiterOperation: input.tool,
          });
          const deadline = Date.now() + LOCK_TIMEOUT_MS;
          while (Date.now() < deadline) {
            await Bun.sleep(LOCK_POLL_MS);
            const current = fileLocks.get(filePath);
            if (
              !current ||
              current.sessionID === sessionID ||
              Date.now() - current.timestamp > STALE_LOCK_MS
            )
              break;
          }
          const stillLocked = fileLocks.get(filePath);
          if (
            stillLocked &&
            stillLocked.sessionID !== sessionID &&
            Date.now() - stillLocked.timestamp <=
              STALE_LOCK_MS
          ) {
            log.error("lock-timeout", {
              file: filePath,
              owner: stillLocked.sessionID,
              ownerOperation: stillLocked.operation,
              ownerAgeMs: Date.now() - stillLocked.timestamp,
              waiter: sessionID,
              waiterOperation: input.tool,
            });
          }
        }
      }

      const previousLock = fileLocks.get(filePath);
      fileLocks.set(filePath, {
        sessionID,
        timestamp: Date.now(),
        operation: input.tool ?? "unknown",
      });
      log.info("lock-acquired", {
        file: filePath,
        session: sessionID,
        operation: input.tool,
        ...(previousLock ? { previousAgeMs: Date.now() - previousLock.timestamp } : {}),
      });
    },

    "tool.execute.after": async (
      input: HookInput,
      output: HookOutput,
    ) => {
      if (internalSessionIds.has(input.sessionID ?? ""))
        return;

      await state.trackSubagentMapping(input, output as StateHookOutput);

      if (input.tool !== "edit" && input.tool !== "write")
        return;

      if (!cli.isWorkspaceMode()) return;

      const filePath = cli.extractFilePath(output);
      if (!filePath) {
        // Release any locks held by this session to prevent leaks
        // when file path extraction from output fails
        const sessionID = input.sessionID ?? "unknown";
        let releasedCount = 0;
        for (const [
          lockedPath,
          lock,
        ] of fileLocks.entries()) {
          if (lock.sessionID === sessionID) {
            fileLocks.delete(lockedPath);
            releasedCount++;
          }
        }
        log.info("after-edit-no-filepath", {
          sessionID,
          tool: input.tool,
          locksReleased: releasedCount,
        });
        return;
      }

      const relativePath = cli.toRelativePath(filePath);
      try {
        const cached = assignmentCache.get(relativePath);
        const cacheHit = cached && Date.now() - cached.timestamp < ASSIGNMENT_CACHE_TTL_MS;

        if (!cacheHit) {
          const branchInfo = cli.findFileBranch(relativePath);
          if (branchInfo.inBranch) {
            if (
              branchInfo.unassignedCliId &&
              branchInfo.branchCliId
            ) {
              if (cli.hasMultiBranchHunks(relativePath)) {
                log.warn("rub-skip-multi-branch", {
                  file: relativePath,
                });
              } else {
                log.info("rub-check", {
                  file: relativePath,
                  multiBranch: false,
                  source: branchInfo.unassignedCliId,
                  dest: branchInfo.branchCliId,
                });
                const rubOk = cli.butRub(
                  branchInfo.unassignedCliId,
                  branchInfo.branchCliId,
                );
                if (rubOk) {
                  log.info("rub-ok", {
                    source: branchInfo.unassignedCliId,
                    dest: branchInfo.branchCliId,
                    file: relativePath,
                  });
                } else {
                  log.error("rub-failed", {
                    source: branchInfo.unassignedCliId,
                    dest: branchInfo.branchCliId,
                    file: relativePath,
                  });
                }
              }
            } else {
              log.info("after-edit-already-assigned", {
                file: relativePath,
                sessionID: input.sessionID,
                branch: branchInfo.branchName,
              });
            }
            return;
          }
        } else {
          log.info("assignment-cache-hit", {
            file: relativePath,
            branchCliId: cached.branchCliId,
            ageMs: Date.now() - cached.timestamp,
          });
        }

        const branchSeed = config.branch_target ?? state.resolveSessionRoot(input.sessionID);
        const conversationId = cacheHit
          ? cached.conversationId
          : await toUUID(branchSeed);

        log.info("after-edit", {
          file: relativePath,
          sessionID: input.sessionID,
          conversationId,
        });

        try {
          await cli.butCursor("after-edit", {
            conversation_id: conversationId,
            generation_id: crypto.randomUUID(),
            file_path: relativePath,
            edits: cli.extractEdits(output),
            hook_event_name: "afterFileEdit",
            workspace_roots: [cwd],
          });

          assignmentCache.set(relativePath, {
            branchCliId: conversationId,
            conversationId,
            timestamp: Date.now(),
          });
        } catch (err) {
          log.error("cursor-after-edit-error", {
            file: relativePath,
            error: err instanceof Error ? err.message : String(err),
          });
        }

        conversationsWithEdits.add(conversationId);

        if (!editedFilesPerConversation.has(conversationId)) {
          editedFilesPerConversation.set(conversationId, new Set());
        }
        editedFilesPerConversation.get(conversationId)!.add(relativePath);

        const rootSessionID = state.resolveSessionRoot(input.sessionID);
        const existingOwner = branchOwnership.get(conversationId);
        if (existingOwner && existingOwner.rootSessionID !== rootSessionID) {
          log.error("branch-collision", {
            conversationId,
            existingOwner: existingOwner.rootSessionID,
            newOwner: rootSessionID,
            existingBranch: existingOwner.branchName,
          });
        } else if (!existingOwner) {
          branchOwnership.set(conversationId, {
            rootSessionID,
            branchName: `conversation-${conversationId.slice(0, 8)}`,
            firstSeen: Date.now(),
          });
        }

        state.savePluginState(
          conversationsWithEdits,
          rewordedBranches,
          branchOwnership,
        ).catch(() => {});
      } finally {
        const releasedLock = fileLocks.get(relativePath);
        fileLocks.delete(relativePath);
        log.info("lock-released", {
          file: relativePath,
          session: input.sessionID,
          ...(releasedLock ? { heldMs: Date.now() - releasedLock.timestamp } : {}),
        });
      }
    },

    event: async ({ event }: { event: EventPayload }) => {
      if (!event?.type) return;

      const eventProps = event.properties as
        | { sessionID?: string }
        | undefined;
      if (
        internalSessionIds.has(eventProps?.sessionID ?? "")
      )
        return;

      await state.trackSessionCreatedMapping(event);

      if (event.type === "session.created") {
        const crProps = event.properties as
          | Record<string, unknown>
          | undefined;
        const sessId =
          typeof crProps?.id === "string"
            ? crProps.id
            : undefined;
        const parentId =
          typeof crProps?.parentSessionID === "string"
            ? crProps.parentSessionID
            : typeof crProps?.parent_session_id === "string"
              ? crProps.parent_session_id
              : undefined;
        if (sessId && !parentId) {
          mainSessionID = sessId;
        }
      }

      const props = event.properties as
        | {
            status?: { type?: string };
            sessionID?: string;
          }
        | undefined;
      const isIdle =
        event.type === "session.idle" ||
        (event.type === "session.status" &&
          props?.status?.type === "idle");

      if (!isIdle) return;
      if (!cli.isWorkspaceMode()) return;

      const branchSeed = config.branch_target ?? state.resolveSessionRoot(props?.sessionID);
      const conversationId = await toUUID(branchSeed);

      if (!conversationsWithEdits.has(conversationId))
        return;

      if (activeStopProcessing.has(conversationId)) return;
      activeStopProcessing.add(conversationId);

      try {
        log.info("session-stop", {
          sessionID: props?.sessionID,
          conversationId,
        });

        let stopFailed = false;
        try {
          await cli.butCursor("stop", {
            conversation_id: conversationId,
            generation_id: crypto.randomUUID(),
            status: "completed",
            hook_event_name: "stop",
            workspace_roots: [cwd],
          });
        } catch (err) {
          stopFailed = true;
          log.error("cursor-stop-error", {
            conversationId,
            error: err instanceof Error ? err.message : String(err),
          });
        }

        await reword.postStopProcessing(props?.sessionID, conversationId, stopFailed);

        assignmentCache.clear();
        cachedStatus = null;
      } finally {
        activeStopProcessing.delete(conversationId);
      }
    },

    "experimental.chat.messages.transform": async (
      _input: Record<string, never>,
      output: {
        messages: Array<{
          info: Record<string, unknown>;
          parts: Array<Record<string, unknown>>;
        }>;
      },
    ) => {
      const { messages } = output;
      if (messages.length === 0) return;

      let lastUserMsgIdx = -1;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i]!.info.role === "user") {
          lastUserMsgIdx = i;
          break;
        }
      }
      if (lastUserMsgIdx === -1) return;

      const lastUserMessage = messages[lastUserMsgIdx]!;
      const messageSessionID = lastUserMessage.info
        .sessionID as string | undefined;
      const sessionID = messageSessionID ?? mainSessionID;
      if (!sessionID) return;

      const notification = notify.consumeNotifications(sessionID);
      if (!notification) return;

      const textPartIndex = lastUserMessage.parts.findIndex(
        (p) => p.type === "text" && p.text,
      );
      if (textPartIndex === -1) return;

      const syntheticPart = {
        id: `gitbutler_ctx_${Date.now()}`,
        messageID: lastUserMessage.info.id as string,
        sessionID: sessionID,
        type: "text" as const,
        text: notification,
        synthetic: true,
      };

      lastUserMessage.parts.splice(
        textPartIndex,
        0,
        syntheticPart,
      );

      log.info("context-injected", {
        sessionID,
        contentLength: notification.length,
      });
    },

    "experimental.session.compacting": async (
      input: { sessionID: string },
      output: { context: string[]; prompt?: string },
    ) => {
      try {
        const rootSessionID = state.resolveSessionRoot(input.sessionID);
        const conversationId = await toUUID(rootSessionID);

        const contextParts: string[] = [];

        const status = getCachedStatus();
        if (status?.stacks) {
          const stacks = status.stacks;
          const activeBranches = stacks
            .flatMap((s) => s.branches ?? [])
            .filter((b) => b.commits.length > 0 || (stacks.find((s) => (s.branches ?? []).includes(b))?.assignedChanges?.length ?? 0) > 0);

          if (activeBranches.length > 0) {
            const branchList = activeBranches
              .map((b) => `- \`${b.name}\` (${b.commits.length} commits)`)
              .join("\n");
            contextParts.push(`Active GitButler branches:\n${branchList}`);
          }
        }

        if (rewordedBranches.size > 0) {
          contextParts.push(`Reworded branches (commit messages updated): ${rewordedBranches.size} branches`);
        }

        if (conversationsWithEdits.has(conversationId)) {
          contextParts.push(`This session has active edits tracked in GitButler (conversation: ${conversationId.slice(0, 8)})`);
        }

        const ownership = branchOwnership.get(conversationId);
        if (ownership) {
          contextParts.push(`Session branch ownership: root=${ownership.rootSessionID.slice(0, 8)}, branch=${ownership.branchName}`);
        }

        if (contextParts.length > 0) {
          output.context.push(
            "<gitbutler-state>\n" +
            contextParts.join("\n\n") +
            "\n</gitbutler-state>",
          );
          log.info("compacting-context-injected", {
            sessionID: input.sessionID,
            contextItems: contextParts.length,
          });
        }
      } catch {
        // Best-effort — never block compaction
      }
    },

    "experimental.chat.system.transform": async (
      _input: { sessionID?: string; model: Record<string, unknown> },
      output: { system: string[] },
    ) => {
      if (!cli.isWorkspaceMode()) return;

      try {
        const status = getCachedStatus();
        if (!status?.stacks) return;

        const activeBranches = status.stacks
          .flatMap((s) => s.branches ?? [])
          .filter((b) => b.commits.length > 0);
        const unassignedCount = status.unassignedChanges?.length ?? 0;

        if (activeBranches.length === 0 && unassignedCount === 0) return;

        const branchNames = activeBranches.map((b) => b.name).join(", ");
        output.system.push(
          `[GitButler] Workspace mode active. ` +
          `${activeBranches.length} branch(es): ${branchNames}. ` +
          `${unassignedCount} unassigned change(s).`,
        );
      } catch {
        // Best-effort — never block LLM calls
      }
    },
  };
  };
}
