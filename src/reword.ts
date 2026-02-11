import type { Logger } from "./logger.js";
import type { Cli, ButStatusFull } from "./cli.js";
import type { BranchOwnership } from "./state.js";
import type { NotificationManager } from "./notify.js";
import type { GitButlerPluginConfig } from "./config.js";

export type RewordDeps = {
  cwd: string;
  log: Logger;
  cli: Cli;
  config: GitButlerPluginConfig;
  defaultBranchPattern: RegExp;
  addNotification: NotificationManager["addNotification"];
  resolveSessionRoot: (sessionID: string | undefined) => string;
  conversationsWithEdits: Set<string>;
  rewordedBranches: Set<string>;
  branchOwnership: Map<string, BranchOwnership>;
  editedFilesPerConversation: Map<string, Set<string>>;
  savePluginState: (
    conversations: Set<string>,
    reworded: Set<string>,
    ownership: Map<string, BranchOwnership>,
  ) => Promise<void>;
  internalSessionIds: Set<string>;
  reapStaleLocks: () => void;
  client: {
    session: {
      messages: (opts: {
        path: { id: string };
        query: { limit: number };
      }) => Promise<{
        data?: Array<{
          info: { role: string };
          parts: Array<{ type: string; text?: string }>;
        }>;
      }>;
      create: (opts: {
        body: { title: string };
      }) => Promise<{ data?: { id: string } }>;
      prompt: (opts: {
        path: { id: string };
        body: {
          model: { providerID: string; modelID: string };
          system: string;
          tools: Record<string, never>;
          parts: Array<{ type: "text"; text: string }>;
        };
      }) => Promise<{
        data?: {
          parts: Array<{ type: string; text?: string }>;
        };
      }>;
      delete: (opts: {
        path: { id: string };
      }) => Promise<unknown>;
      update: (opts: {
        path: { id: string };
        body: { title: string };
      }) => Promise<unknown>;
    };
  };
};

export const COMMIT_PREFIX_PATTERNS: Array<{
  pattern: RegExp;
  prefix: string;
}> = [
  {
    pattern: /\b(fix|bug|broken|repair|patch)\b/i,
    prefix: "fix",
  },
  {
    pattern: /\b(add|create|implement|new|feature)\b/i,
    prefix: "feat",
  },
  {
    pattern:
      /\b(refactor|clean|restructure|reorganize)\b/i,
    prefix: "refactor",
  },
  {
    pattern: /\b(test|spec|coverage)\b/i,
    prefix: "test",
  },
  {
    pattern: /\b(doc|readme|documentation)\b/i,
    prefix: "docs",
  },
  {
    pattern: /\b(style|css|design|ui|layout)\b/i,
    prefix: "style",
  },
  {
    pattern: /\b(perf|performance|optimize|speed)\b/i,
    prefix: "perf",
  },
];

export function detectCommitPrefix(text: string): string {
  for (const {
    pattern,
    prefix,
  } of COMMIT_PREFIX_PATTERNS) {
    if (pattern.test(text)) return prefix;
  }
  return "chore";
}

export function toCommitMessage(prompt: string): string {
  const firstLine = prompt.split("\n")[0]?.trim() ?? "";
  if (!firstLine)
    return "chore: OpenCode session changes";
  const prefix = detectCommitPrefix(firstLine);
  const description = firstLine
    .replace(
      /^(fix|feat|refactor|test|docs|style|perf|chore)(\(.+?\))?:\s*/i,
      "",
    )
    .trim();
  const maxLen = 72 - prefix.length - 2;
  const truncated =
    description.length > maxLen
      ? description.slice(0, maxLen - 3) + "..."
      : description;
  return `${prefix}: ${truncated || "OpenCode session changes"}`;
}

export function toBranchSlug(prompt: string, maxLength: number): string {
  const cleaned = prompt
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .slice(0, 6)
    .join("-");
  return cleaned.slice(0, maxLength) || "opencode-session";
}

export type RewordManager = {
  fetchUserPrompt: (sessionID: string) => Promise<string | null>;
  generateLLMCommitMessage: (commitId: string, userPrompt: string) => Promise<string | null>;
  postStopProcessing: (sessionID: string | undefined, conversationId: string, stopFailed?: boolean) => Promise<void>;
};

export function createRewordManager(deps: RewordDeps): RewordManager {
  const {
    cwd,
    log,
    cli,
    config,
    defaultBranchPattern,
    addNotification,
    resolveSessionRoot,
    conversationsWithEdits,
    rewordedBranches,
    branchOwnership,
    editedFilesPerConversation,
    savePluginState,
    internalSessionIds,
    reapStaleLocks,
    client,
  } = deps;

  const LLM_TIMEOUT_MS = config.llm_timeout_ms;
  const MAX_DIFF_CHARS = config.max_diff_chars;

  async function fetchUserPrompt(
    sessionID: string,
  ): Promise<string | null> {
    try {
      const res = await client.session.messages({
        path: { id: sessionID },
        query: { limit: 5 },
      });
      if (!res.data) return null;
      for (const msg of res.data) {
        if (msg.info.role !== "user") continue;
        const textPart = msg.parts.find(
          (p: { type: string }) => p.type === "text",
        ) as { type: "text"; text: string } | undefined;
        if (textPart?.text) return textPart.text;
      }
      return null;
    } catch {
      return null;
    }
  }

  async function generateLLMCommitMessage(
    commitId: string,
    userPrompt: string,
  ): Promise<string | null> {
    try {
      log.info("llm-start", {
        commitId,
        promptLength: userPrompt.length,
      });

      const diffProc = Bun.spawnSync(
        [
          "git",
          "show",
          commitId,
          "--format=",
          "--no-color",
        ],
        { cwd, stdout: "pipe", stderr: "pipe" },
      );
      if (diffProc.exitCode !== 0) return null;
      const diff = diffProc.stdout.toString().trim();
      if (!diff) return null;

      const truncatedDiff =
        diff.length > MAX_DIFF_CHARS
          ? diff.slice(0, MAX_DIFF_CHARS) +
            "\n... (truncated)"
          : diff;

      const sessionRes = await client.session.create({
        body: { title: "commit-msg-gen" },
      });
      if (!sessionRes.data) return null;
      const tempSessionId = sessionRes.data.id;
      internalSessionIds.add(tempSessionId);

      try {
        const promptText = [
          "Generate a one-line conventional commit message for this diff.",
          "Format: type: description (max 72 chars total).",
          "Types: feat, fix, refactor, test, docs, style, perf, chore.",
          `User intent: "${userPrompt.split("\n")[0]?.trim().slice(0, 200) ?? ""}"`,
          "",
          "Diff:",
          truncatedDiff,
          "",
          "Reply with ONLY the commit message, nothing else.",
        ].join("\n");

        const timeoutPromise = new Promise<null>(
          (resolve) =>
            setTimeout(() => resolve(null), LLM_TIMEOUT_MS),
        );

        const llmPromise = client.session.prompt({
          path: { id: tempSessionId },
          body: {
            model: {
              providerID: config.commit_message_provider,
              modelID: config.commit_message_model,
            },
            system:
              "You are a commit message generator. Output ONLY a single-line conventional commit message. No explanation, no markdown, no quotes, no code fences.",
            tools: {},
            parts: [
              { type: "text" as const, text: promptText },
            ],
          },
        });

        const response = await Promise.race([
          llmPromise,
          timeoutPromise,
        ]);
        if (
          !response ||
          !("data" in response) ||
          !response.data
        ) {
          log.warn("llm-timeout-or-empty", {
            commitId,
          });
          return null;
        }

        const textPart = (
          response.data as {
            parts: Array<{ type: string; text?: string }>;
          }
        ).parts.find((p) => p.type === "text");
        if (!textPart?.text) return null;

        const message = textPart.text
          .trim()
          .replace(/^["'`]+|["'`]+$/g, "")
          .split("\n")[0]
          ?.trim();
        if (!message) return null;

        const validPrefix =
          /^(feat|fix|refactor|test|docs|style|perf|chore|ci|build)(\(.+?\))?:\s/;
        if (!validPrefix.test(message)) {
          log.warn("llm-invalid-format", {
            commitId,
            message,
          });
          return null;
        }

        if (message.length > 72)
          return message.slice(0, 69) + "...";

        log.info("llm-success", {
          commitId,
          message,
        });
        return message;
      } finally {
        internalSessionIds.delete(tempSessionId);
        client.session
          .delete({ path: { id: tempSessionId } })
          .catch(() => {});
      }
    } catch {
      return null;
    }
  }

  async function postStopProcessing(
    sessionID: string | undefined,
    conversationId: string,
    stopFailed = false,
  ): Promise<void> {
    if (!sessionID) return;

    const rootSessionID = resolveSessionRoot(sessionID);
    log.info("post-stop-start", {
      sessionID,
      rootSessionID,
    });

    if (stopFailed) {
      log.warn("post-stop-degraded", {
        sessionID,
        rootSessionID,
        reason: "stop command failed, attempting recovery",
      });
    }

    reapStaleLocks();

    const editedFiles = editedFilesPerConversation.get(conversationId);
    let sweepRubCount = 0;
    if (editedFiles && editedFiles.size > 0) {
      for (const filePath of editedFiles) {
        try {
          const branchInfo = cli.findFileBranch(filePath);
          if (branchInfo.unassignedCliId && branchInfo.branchCliId) {
            if (!cli.hasMultiBranchHunks(filePath)) {
              const rubOk = cli.butRub(branchInfo.unassignedCliId, branchInfo.branchCliId);
              if (rubOk) {
                sweepRubCount++;
                log.info("post-stop-sweep-rub", {
                  file: filePath,
                  source: branchInfo.unassignedCliId,
                  dest: branchInfo.branchCliId,
                });
              }
            }
          }
        } catch {
          // best-effort per file
        }
      }
      if (sweepRubCount > 0) {
        log.info("post-stop-sweep-summary", {
          conversationId,
          filesChecked: editedFiles.size,
          rubbed: sweepRubCount,
        });
      }
    }

    const prompt = await fetchUserPrompt(rootSessionID);
    if (!prompt) return;

    const status = cli.getFullStatus();
    if (!status?.stacks) return;

    let rewordCount = 0;
    let renameCount = 0;
    let cleanupCount = 0;
    let failCount = 0;
    let latestBranchName: string | null = null;

    for (const stack of status.stacks) {
      for (const branch of stack.branches ?? []) {
        if (branch.branchStatus !== "completelyUnpushed")
          continue;
        if (branch.commits.length === 0) continue;
        if (rewordedBranches.has(branch.cliId)) continue;

        const commit = branch.commits[0];
        if (!commit) continue;

        try {
          // Skip if GitButler's Rust-side LLM already reworded (avoids double API cost)
          const VALID_CONVENTIONAL = /^(feat|fix|refactor|test|docs|style|perf|chore|ci|build)(\(.+?\))?:\s/;
          const DEFAULT_PLACEHOLDERS = [
            "session changes",
            "opencode session changes",
            "cursor session changes",
          ];
          const existingMsg = commit.message?.trim() ?? "";
          const isAlreadyReworded =
            VALID_CONVENTIONAL.test(existingMsg) &&
            !DEFAULT_PLACEHOLDERS.some((p) => existingMsg.toLowerCase().includes(p));

          if (isAlreadyReworded) {
            log.info("reword-skipped-existing", {
              branch: branch.name,
              commit: commit.cliId,
              existingMessage: existingMsg,
            });
            rewordedBranches.add(branch.cliId);
            rewordCount++;
          } else {
            const llmMessage = await generateLLMCommitMessage(
              commit.commitId,
              prompt,
            );
            const commitMsg =
              llmMessage ?? toCommitMessage(prompt);
            const rewordOk = cli.butReword(commit.cliId, commitMsg);
            if (!rewordOk) {
              log.warn("reword-failed", {
                branch: branch.name,
                commit: commit.cliId,
                message: commitMsg,
              });
              failCount++;
              continue;
            }
            rewordedBranches.add(branch.cliId);
            savePluginState(
              conversationsWithEdits,
              rewordedBranches,
              branchOwnership,
            ).catch(() => {});

            addNotification(
              sessionID,
              `Commit on branch \`${branch.name}\` reworded to: "${commitMsg}"`,
            );

            log.info("reword", {
              branch: branch.name,
              commit: commit.cliId,
              message: commitMsg,
              source: llmMessage ? "llm" : "deterministic",
              multi: branch.commits.length > 1,
            });
            rewordCount++;
          }

          if (defaultBranchPattern.test(branch.name)) {
            latestBranchName = toBranchSlug(prompt, config.branch_slug_max_length);
            const renameOk = cli.butReword(branch.cliId, latestBranchName);
            if (renameOk) {
              log.info("branch-rename", {
                status: "ok",
                from: branch.name,
                to: latestBranchName,
              });
              addNotification(
                sessionID,
                `Branch renamed from \`${branch.name}\` to \`${latestBranchName}\``,
              );
              renameCount++;
            } else {
              log.warn("branch-rename", {
                status: "failed",
                from: branch.name,
                to: latestBranchName,
              });
              latestBranchName = branch.name;
              failCount++;
            }
          } else {
            log.info("branch-rename", {
              status: "skipped",
              branch: branch.name,
              reason: "user-named",
            });
            latestBranchName = branch.name;
          }
        } catch (err) {
          log.error("reword-error", {
            branch: branch.name,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    if (!latestBranchName) {
      const existing = status.stacks
        .flatMap((s) => s.branches ?? [])
        .filter(
          (b) =>
            b.commits.length > 0 &&
            !defaultBranchPattern.test(b.name),
        );
      if (existing.length > 0) {
        latestBranchName =
          existing[existing.length - 1]!.name;
      }
    }

    if (latestBranchName) {
      client.session
        .update({
          path: { id: rootSessionID },
          body: { title: latestBranchName },
        })
        .catch(() => {});
      addNotification(
        sessionID,
        `Session title updated to \`${latestBranchName}\``,
      );
    }

    for (const stack of status.stacks) {
      for (const branch of stack.branches ?? []) {
        if (
          branch.commits.length === 0 &&
          (stack.assignedChanges?.length ?? 0) === 0 &&
          defaultBranchPattern.test(branch.name)
        ) {
          const ok = await cli.butUnapplyWithRetry(branch.cliId, branch.name);
          if (ok) {
            addNotification(
              sessionID,
              `Empty branch \`${branch.name}\` cleaned up`,
            );
            cleanupCount++;
          }
        }
      }
    }

    log.info("post-stop-summary", {
      sessionID,
      rootSessionID,
      reworded: rewordCount,
      renamed: renameCount,
      cleanedUp: cleanupCount,
      failed: failCount,
      stopFailed,
    });
  }

  return {
    fetchUserPrompt,
    generateLLMCommitMessage,
    postStopProcessing,
  };
}
