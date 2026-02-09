/**
 * OpenCode plugin: GitButler integration via Cursor hook facade.
 *
 * Bridges OpenCode's plugin hooks to GitButler's `but cursor` CLI:
 * - tool.execute.after (edit/write)                  → but cursor after-edit
 * - session.idle                                     → but cursor stop
 * - experimental.chat.messages.transform             → inject pending state notifications
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

import { resolve, relative } from "node:path";
import { appendFile } from "node:fs/promises";
import type { Plugin } from "@opencode-ai/plugin";
import type { GitButlerPluginConfig } from "./config.js";
import { DEFAULT_CONFIG } from "./config.js";

const LOG_PATH_SUFFIX = ".opencode/plugin/debug.log";

function createDebugLog(logEnabled: boolean) {
  return async function debugLog(
    cwd: string,
    category: string,
    data: Record<string, unknown>
  ): Promise<void> {
    if (!logEnabled) return;
    try {
      const line = `${new Date().toISOString()} [${category}] ${JSON.stringify(data)}\n`;
      const logPath = `${cwd}/${LOG_PATH_SUFFIX}`;
      await appendFile(logPath, line);
    } catch {
      /* fire-and-forget */
    }
  };
}

type HookInput = {
  tool?: string;
  sessionID?: string;
  callID?: string;
};

type HookOutput = {
  title?: string;
  output?: string;
  metadata?: {
    /** edit tool: file diff with before/after content */
    filediff?: {
      file?: string;
      before?: string;
      after?: string;
    };
    /** write tool: absolute file path */
    filepath?: string;
    diff?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type EventPayload = Record<string, unknown> & {
  type?: string;
  properties?: Record<string, unknown>;
};

const SUBAGENT_TOOLS = new Set([
  "agent",
  "task",
  "delegate_task",
]);

export function createGitButlerPlugin(
  config: GitButlerPluginConfig = { ...DEFAULT_CONFIG }
): Plugin {
  const debugLog = createDebugLog(config.log_enabled);

  return async ({ client, directory, worktree }) => {
  const cwd = worktree ?? directory;
  const SESSION_MAP_PATH = `${cwd}/.opencode/plugin/session-map.json`;
  const PLUGIN_STATE_PATH = `${cwd}/.opencode/plugin/plugin-state.json`;

  type PluginState = {
    conversationsWithEdits: string[];
    rewordedBranches: string[];
  };

  async function loadPluginState(): Promise<PluginState> {
    try {
      const file = Bun.file(PLUGIN_STATE_PATH);
      if (!(await file.exists()))
        return {
          conversationsWithEdits: [],
          rewordedBranches: [],
        };
      return (await file.json()) as PluginState;
    } catch {
      return {
        conversationsWithEdits: [],
        rewordedBranches: [],
      };
    }
  }

  async function savePluginState(
    conversations: Set<string>,
    reworded: Set<string>
  ): Promise<void> {
    const state: PluginState = {
      conversationsWithEdits: [...conversations],
      rewordedBranches: [...reworded],
    };
    await Bun.write(
      PLUGIN_STATE_PATH,
      JSON.stringify(state, null, 2) + "\n"
    );
  }

  async function loadSessionMap(): Promise<
    Map<string, string>
  > {
    try {
      const file = Bun.file(SESSION_MAP_PATH);
      if (!(await file.exists())) return new Map();
      const data = (await file.json()) as Record<
        string,
        string
      >;
      return new Map(Object.entries(data));
    } catch {
      return new Map();
    }
  }

  async function saveSessionMap(
    map: Map<string, string>
  ): Promise<void> {
    await Bun.write(
      SESSION_MAP_PATH,
      JSON.stringify(Object.fromEntries(map), null, 2) +
        "\n"
    );
  }

  function isWorkspaceMode(): boolean {
    const proc = Bun.spawnSync(
      ["git", "symbolic-ref", "--short", "HEAD"],
      { cwd, stdout: "pipe", stderr: "pipe" }
    );
    if (proc.exitCode !== 0) return false;
    return (
      proc.stdout.toString().trim() ===
      "gitbutler/workspace"
    );
  }

  const parentSessionByTaskSession = await loadSessionMap();

  const persistedState = await loadPluginState();
  const conversationsWithEdits = new Set<string>(
    persistedState.conversationsWithEdits
  );
  const rewordedBranches = new Set<string>(
    persistedState.rewordedBranches
  );
  debugLog(cwd, "state-loaded", {
    conversations: conversationsWithEdits.size,
    reworded: rewordedBranches.size,
  }).catch(() => {});

  // Guard set: session IDs created internally for LLM commit message generation.
  // Hooks must skip these to prevent recursive triggering.
  const internalSessionIds = new Set<string>();

  // Guard set: conversationIds currently being processed by postStopProcessing.
  // Prevents duplicate session.idle events from triggering concurrent processing.
  const activeStopProcessing = new Set<string>();

  // Main session tracking for context injection fallback
  let mainSessionID: string | undefined;

  // --- Pending context notifications ---
  // Accumulated during plugin operations (reword, rename, cleanup).
  // Injected into the agent's next user message via
  // experimental.chat.messages.transform hook.
  type ContextNotification = {
    message: string;
    timestamp: number;
  };

  const pendingNotifications = new Map<
    string,
    ContextNotification[]
  >();

  function addNotification(
    sessionID: string | undefined,
    message: string
  ): void {
    const rootID = resolveSessionRoot(sessionID);
    if (!pendingNotifications.has(rootID)) {
      pendingNotifications.set(rootID, []);
    }
    pendingNotifications.get(rootID)!.push({
      message,
      timestamp: Date.now(),
    });
    debugLog(cwd, "notification-queued", {
      rootID,
      message,
    }).catch(() => {});
  }

  function consumeNotifications(
    sessionID: string
  ): string | null {
    const rootID = resolveSessionRoot(sessionID);
    const notifications = pendingNotifications.get(rootID);
    if (!notifications || notifications.length === 0)
      return null;
    pendingNotifications.delete(rootID);

    const lines = notifications
      .map((n) => `- ${n.message}`)
      .join("\n");
    return [
      "<system-reminder>",
      "[GITBUTLER STATE UPDATE]",
      "The following happened automatically since your last response:",
      "",
      lines,
      "",
      "This is informational — no action needed unless relevant to your current task.",
      "</system-reminder>",
    ].join("\n");
  }

  const resolvedCwd = resolve(cwd);

  type ButStatusChange = {
    cliId?: string;
    filePath?: string;
  };
  type ButStatusCommit = {
    changes?: ButStatusChange[];
  };
  type ButStatusJson = {
    unassignedChanges?: ButStatusChange[];
    stacks?: Array<{
      assignedChanges?: ButStatusChange[];
      branches?: Array<{
        cliId?: string;
        name?: string;
        commits?: ButStatusCommit[];
      }>;
    }>;
  };

  type FileBranchResult = {
    inBranch: boolean;
    branchCliId?: string;
    branchName?: string;
    unassignedCliId?: string;
  };

  function findFileBranch(
    filePath: string
  ): FileBranchResult {
    const proc = Bun.spawnSync(
      ["but", "status", "--json", "-f"],
      { cwd, stdout: "pipe", stderr: "pipe" }
    );
    if (proc.exitCode !== 0) return { inBranch: false };

    try {
      const data = JSON.parse(
        proc.stdout.toString()
      ) as ButStatusJson;

      const normalized = toRelativePath(filePath);

      const unassigned = data.unassignedChanges?.find(
        (ch) => ch.filePath === normalized
      );

      for (const stack of data.stacks ?? []) {
        if (
          stack.assignedChanges?.some(
            (ch) => ch.filePath === normalized
          )
        ) {
          return { inBranch: true };
        }

        for (const branch of stack.branches ?? []) {
          for (const commit of branch.commits ?? []) {
            if (
              commit.changes?.some(
                (ch) => ch.filePath === normalized
              )
            ) {
              return {
                inBranch: true,
                branchCliId: branch.cliId,
                branchName: branch.name,
                unassignedCliId: unassigned?.cliId,
              };
            }
          }
        }
      }

      return { inBranch: false };
    } catch {
      return { inBranch: false };
    }
  }

  function butRub(source: string, dest: string): boolean {
    const proc = Bun.spawnSync(
      ["but", "rub", source, dest],
      { cwd, stdout: "pipe", stderr: "pipe" }
    );
    return proc.exitCode === 0;
  }

  function butUnapply(branchCliId: string): boolean {
    const proc = Bun.spawnSync(
      ["but", "unapply", branchCliId],
      { cwd, stdout: "pipe", stderr: "pipe" }
    );
    return proc.exitCode === 0;
  }

  function toRelativePath(absPath: string): string {
    const resolved = resolve(absPath);
    const rel = relative(resolvedCwd, resolved);
    if (rel.startsWith("..")) return absPath;
    return rel;
  }

  type ButStatusBranch = {
    cliId: string;
    name: string;
    branchStatus: string;
    commits: Array<{
      cliId: string;
      commitId: string;
      message: string;
    }>;
  };

  type ButStatusFull = {
    unassignedChanges?: ButStatusChange[];
    stacks?: Array<{
      assignedChanges?: ButStatusChange[];
      branches?: ButStatusBranch[];
    }>;
  };

  const DEFAULT_BRANCH_PATTERN = new RegExp(config.default_branch_pattern);

  async function fetchUserPrompt(
    sessionID: string
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
          (p: { type: string }) => p.type === "text"
        ) as { type: "text"; text: string } | undefined;
        if (textPart?.text) return textPart.text;
      }
      return null;
    } catch {
      return null;
    }
  }

  function toBranchSlug(prompt: string): string {
    const cleaned = prompt
      .replace(/[^a-zA-Z0-9\s-]/g, "")
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .slice(0, 6)
      .join("-");
    return cleaned.slice(0, config.branch_slug_max_length) || "opencode-session";
  }

  const COMMIT_PREFIX_PATTERNS: Array<{
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

  function detectCommitPrefix(text: string): string {
    for (const {
      pattern,
      prefix,
    } of COMMIT_PREFIX_PATTERNS) {
      if (pattern.test(text)) return prefix;
    }
    return "chore";
  }

  function toCommitMessage(prompt: string): string {
    const firstLine = prompt.split("\n")[0]?.trim() ?? "";
    if (!firstLine)
      return "chore: OpenCode session changes";
    const prefix = detectCommitPrefix(firstLine);
    const description = firstLine
      .replace(
        /^(fix|feat|refactor|test|docs|style|perf|chore)(\(.+?\))?:\s*/i,
        ""
      )
      .trim();
    const maxLen = 72 - prefix.length - 2;
    const truncated =
      description.length > maxLen
        ? description.slice(0, maxLen - 3) + "..."
        : description;
    return `${prefix}: ${truncated || "OpenCode session changes"}`;
  }

  const LLM_TIMEOUT_MS = config.llm_timeout_ms;
  const MAX_DIFF_CHARS = config.max_diff_chars;

  async function generateLLMCommitMessage(
    commitId: string,
    userPrompt: string
  ): Promise<string | null> {
    try {
      const diffProc = Bun.spawnSync(
        [
          "git",
          "show",
          commitId,
          "--format=",
          "--no-color",
        ],
        { cwd, stdout: "pipe", stderr: "pipe" }
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
            setTimeout(() => resolve(null), LLM_TIMEOUT_MS)
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
        )
          return null;

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
        if (!validPrefix.test(message)) return null;

        if (message.length > 72)
          return message.slice(0, 69) + "...";

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

  function getFullStatus(): ButStatusFull | null {
    const proc = Bun.spawnSync(
      ["but", "status", "--json", "-f"],
      { cwd, stdout: "pipe", stderr: "pipe" }
    );
    if (proc.exitCode !== 0) return null;
    try {
      return JSON.parse(
        proc.stdout.toString()
      ) as ButStatusFull;
    } catch {
      return null;
    }
  }

  function butReword(
    target: string,
    message: string
  ): boolean {
    const proc = Bun.spawnSync(
      ["but", "reword", target, "-m", message],
      { cwd, stdout: "pipe", stderr: "pipe" }
    );
    return proc.exitCode === 0;
  }

  async function postStopProcessing(
    sessionID: string | undefined
  ): Promise<void> {
    if (!sessionID) return;

    const rootSessionID = resolveSessionRoot(sessionID);
    const prompt = await fetchUserPrompt(rootSessionID);
    if (!prompt) return;

    const status = getFullStatus();
    if (!status?.stacks) return;

    let latestBranchName: string | null = null;

    for (const stack of status.stacks) {
      for (const branch of stack.branches ?? []) {
        if (branch.branchStatus !== "completelyUnpushed")
          continue;
        if (branch.commits.length === 0) continue;
        if (rewordedBranches.has(branch.cliId)) continue;

        const commit = branch.commits[0];
        if (!commit) continue;

        const llmMessage = await generateLLMCommitMessage(
          commit.commitId,
          prompt
        );
        const commitMsg =
          llmMessage ?? toCommitMessage(prompt);
        butReword(commit.cliId, commitMsg);
        rewordedBranches.add(branch.cliId);
        savePluginState(
          conversationsWithEdits,
          rewordedBranches
        ).catch(() => {});

        addNotification(
          sessionID,
          `Commit on branch \`${branch.name}\` reworded to: "${commitMsg}"`
        );

        debugLog(cwd, "reword", {
          branch: branch.name,
          commit: commit.cliId,
          message: commitMsg,
          source: llmMessage ? "llm" : "deterministic",
          multi: branch.commits.length > 1,
        }).catch(() => {});

        if (DEFAULT_BRANCH_PATTERN.test(branch.name)) {
          latestBranchName = toBranchSlug(prompt);
          butReword(branch.cliId, latestBranchName);
          addNotification(
            sessionID,
            `Branch renamed from \`${branch.name}\` to \`${latestBranchName}\``
          );
        } else {
          latestBranchName = branch.name;
        }
      }
    }

    if (!latestBranchName) {
      const existing = status.stacks
        .flatMap((s) => s.branches ?? [])
        .filter(
          (b) =>
            b.commits.length > 0 &&
            !DEFAULT_BRANCH_PATTERN.test(b.name)
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
        `Session title updated to \`${latestBranchName}\``
      );
    }

    for (const stack of status.stacks) {
      for (const branch of stack.branches ?? []) {
        if (
          branch.commits.length === 0 &&
          (stack.assignedChanges?.length ?? 0) === 0 &&
          DEFAULT_BRANCH_PATTERN.test(branch.name)
        ) {
          const ok = butUnapply(branch.cliId);
          if (ok) {
            addNotification(
              sessionID,
              `Empty branch \`${branch.name}\` cleaned up`
            );
          }
          debugLog(
            cwd,
            ok ? "cleanup-ok" : "cleanup-failed",
            {
              branch: branch.name,
            }
          ).catch(() => {});
        }
      }
    }
  }

  async function toUUID(input: string): Promise<string> {
    const data = new TextEncoder().encode(input);
    const hash = await crypto.subtle.digest(
      "SHA-256",
      data
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

  const CURSOR_MAX_RETRIES = 3;
  const CURSOR_RETRY_BASE_MS = 200;

  async function butCursor(
    subcommand: string,
    payload: Record<string, unknown>
  ) {
    const json = JSON.stringify(payload);

    for (
      let attempt = 0;
      attempt <= CURSOR_MAX_RETRIES;
      attempt++
    ) {
      const proc = Bun.spawn(
        ["but", "cursor", subcommand],
        {
          cwd,
          stdout: "pipe",
          stderr: "pipe",
          stdin: new Blob([json]),
        }
      );
      const exitCode = await proc.exited;

      if (exitCode === 0) {
        debugLog(cwd, "cursor-ok", {
          subcommand,
          conversationId: payload.conversation_id,
          ...(attempt > 0 ? { retries: attempt } : {}),
        }).catch(() => {});
        return;
      }

      const stderr = await new Response(proc.stderr).text();
      const isExpectedError =
        stderr.includes("not in workspace mode") ||
        stderr.includes("not initialized") ||
        stderr.includes("No such file or directory") ||
        stderr.includes("No hunk headers") ||
        stderr.includes("no changes") ||
        stderr.includes("checkout gitbutler/workspace");
      if (isExpectedError) return;

      const isRetryable =
        stderr.includes("database is locked") ||
        stderr.includes("SQLITE_BUSY") ||
        stderr.includes("failed to lock file");
      if (isRetryable && attempt < CURSOR_MAX_RETRIES) {
        const delay = CURSOR_RETRY_BASE_MS * 2 ** attempt;
        await Bun.sleep(delay);
        continue;
      }

      debugLog(cwd, "cursor-error", {
        subcommand,
        exitCode,
        stderr: stderr.trim(),
        attempt,
      }).catch(() => {});
      throw new Error(
        `but cursor ${subcommand} failed (exit ${exitCode}): ${stderr.trim()}`
      );
    }
  }

  function extractFilePath(
    output: HookOutput
  ): string | undefined {
    return (
      output.metadata?.filediff?.file ??
      output.metadata?.filepath ??
      undefined
    );
  }

  function extractEdits(
    output: HookOutput
  ): Array<{ old_string: string; new_string: string }> {
    const fd = output.metadata?.filediff;
    if (fd?.before != null && fd?.after != null) {
      return [
        { old_string: fd.before, new_string: fd.after },
      ];
    }
    return [];
  }

  async function trackSubagentMapping(
    input: HookInput
  ): Promise<void> {
    const tool = input.tool;
    const parentSessionID = input.sessionID;
    const taskSessionID = input.callID;

    if (!tool || !SUBAGENT_TOOLS.has(tool)) return;
    if (!parentSessionID || !taskSessionID) return;

    parentSessionByTaskSession.set(
      taskSessionID,
      parentSessionID
    );
    await saveSessionMap(parentSessionByTaskSession);
  }

  async function trackSessionCreatedMapping(
    event: EventPayload
  ): Promise<void> {
    if (event.type !== "session.created") return;

    const properties = event.properties;
    if (!properties) return;

    const sessionID =
      typeof properties.id === "string"
        ? properties.id
        : undefined;
    const parentSessionID =
      typeof properties.parentSessionID === "string"
        ? properties.parentSessionID
        : typeof properties.parent_session_id === "string"
          ? properties.parent_session_id
          : undefined;

    if (!sessionID || !parentSessionID) return;

    parentSessionByTaskSession.set(
      sessionID,
      parentSessionID
    );
    await saveSessionMap(parentSessionByTaskSession);
  }

  function resolveSessionRoot(
    sessionID: string | undefined
  ): string {
    if (!sessionID) return "opencode-default";

    const seen = new Set<string>();
    let current = sessionID;

    while (true) {
      if (seen.has(current)) return current;
      seen.add(current);

      const parent =
        parentSessionByTaskSession.get(current);
      if (!parent) return current;

      current = parent;
    }
  }

  function hasMultiBranchHunks(filePath: string): boolean {
    try {
      const proc = Bun.spawnSync(
        ["but", "status", "--json", "-f"],
        { cwd, stdout: "pipe", stderr: "pipe" }
      );
      if (proc.exitCode !== 0) return false;

      const data = JSON.parse(
        proc.stdout.toString()
      ) as ButStatusJson;

      let branchCount = 0;
      for (const stack of data.stacks ?? []) {
        const hasInAssigned = stack.assignedChanges?.some(
          (ch) => ch.filePath === filePath
        );
        if (hasInAssigned) branchCount++;
        if (branchCount > 1) return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  type FileLock = {
    sessionID: string;
    timestamp: number;
  };

  const fileLocks = new Map<string, FileLock>();
  const LOCK_TIMEOUT_MS = 60_000;
  const LOCK_POLL_MS = 1_000;
  const STALE_LOCK_MS = 5 * 60_000;

  type BeforeHookInput = {
    tool?: string;
    sessionID?: string;
    callID?: string;
  };

  type BeforeHookOutput = {
    args?: Record<string, unknown>;
  };

  function extractFilePathFromArgs(
    args: Record<string, unknown>
  ): string | undefined {
    const raw =
      (args.filePath as string | undefined) ??
      (args.file_path as string | undefined) ??
      (args.path as string | undefined);
    return raw ? toRelativePath(raw) : undefined;
  }

  return {
    "tool.execute.before": async (
      input: BeforeHookInput,
      output: BeforeHookOutput
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
          debugLog(cwd, "lock-stale", {
            file: filePath,
            owner: existing.sessionID,
          }).catch(() => {});
        } else if (existing.sessionID !== sessionID) {
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
            debugLog(cwd, "lock-timeout", {
              file: filePath,
              owner: stillLocked.sessionID,
              waiter: sessionID,
            }).catch(() => {});
          }
        }
      }

      fileLocks.set(filePath, {
        sessionID,
        timestamp: Date.now(),
      });
      debugLog(cwd, "lock-acquired", {
        file: filePath,
        session: sessionID,
      }).catch(() => {});
    },

    "tool.execute.after": async (
      input: HookInput,
      output: HookOutput
    ) => {
      if (internalSessionIds.has(input.sessionID ?? ""))
        return;

      await trackSubagentMapping(input);

      if (input.tool !== "edit" && input.tool !== "write")
        return;

      if (!isWorkspaceMode()) return;

      const filePath = extractFilePath(output);
      if (!filePath) {
        // Release any locks held by this session to prevent leaks
        // when file path extraction from output fails
        const sessionID = input.sessionID ?? "unknown";
        for (const [
          lockedPath,
          lock,
        ] of fileLocks.entries()) {
          if (lock.sessionID === sessionID) {
            fileLocks.delete(lockedPath);
            debugLog(cwd, "lock-released-fallback", {
              file: lockedPath,
              session: sessionID,
            }).catch(() => {});
          }
        }
        return;
      }

      const relativePath = toRelativePath(filePath);
      try {
        const branchInfo = findFileBranch(relativePath);
        if (branchInfo.inBranch) {
          if (
            branchInfo.unassignedCliId &&
            branchInfo.branchCliId
          ) {
            if (hasMultiBranchHunks(relativePath)) {
              debugLog(cwd, "rub-skip-multi-branch", {
                file: relativePath,
              }).catch(() => {});
            } else {
              const rubOk = butRub(
                branchInfo.unassignedCliId,
                branchInfo.branchCliId
              );
              debugLog(
                cwd,
                rubOk ? "rub-ok" : "rub-failed",
                {
                  source: branchInfo.unassignedCliId,
                  dest: branchInfo.branchCliId,
                  file: relativePath,
                }
              ).catch(() => {});
            }
          }
          return;
        }

        const conversationId = await toUUID(
          resolveSessionRoot(input.sessionID)
        );

        debugLog(cwd, "after-edit", {
          file: relativePath,
          sessionID: input.sessionID,
          conversationId,
        }).catch(() => {});

        await butCursor("after-edit", {
          conversation_id: conversationId,
          generation_id: crypto.randomUUID(),
          file_path: relativePath,
          edits: extractEdits(output),
          hook_event_name: "afterFileEdit",
          workspace_roots: [cwd],
        });

        conversationsWithEdits.add(conversationId);
        savePluginState(
          conversationsWithEdits,
          rewordedBranches
        ).catch(() => {});
      } finally {
        fileLocks.delete(relativePath);
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

      await trackSessionCreatedMapping(event);

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
      if (!isWorkspaceMode()) return;

      const conversationId = await toUUID(
        resolveSessionRoot(props?.sessionID)
      );

      if (!conversationsWithEdits.has(conversationId))
        return;

      if (activeStopProcessing.has(conversationId)) return;
      activeStopProcessing.add(conversationId);

      try {
        debugLog(cwd, "session-stop", {
          sessionID: props?.sessionID,
          conversationId,
        }).catch(() => {});

        await butCursor("stop", {
          conversation_id: conversationId,
          generation_id: crypto.randomUUID(),
          status: "completed",
          hook_event_name: "stop",
          workspace_roots: [cwd],
        });

        await postStopProcessing(props?.sessionID);
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
      }
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

      const notification = consumeNotifications(sessionID);
      if (!notification) return;

      const textPartIndex = lastUserMessage.parts.findIndex(
        (p) => p.type === "text" && p.text
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
        syntheticPart
      );

      debugLog(cwd, "context-injected", {
        sessionID,
        contentLength: notification.length,
      }).catch(() => {});
    },
  };
  };
}
