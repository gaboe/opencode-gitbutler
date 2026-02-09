// @bun
// src/plugin.ts
import { resolve as resolve2, relative } from "path";
import { appendFile } from "fs/promises";

// src/config.ts
import { resolve } from "path";
var DEFAULT_CONFIG = {
  log_enabled: true,
  commit_message_model: "claude-haiku-4-5",
  commit_message_provider: "anthropic",
  llm_timeout_ms: 15000,
  max_diff_chars: 4000,
  branch_slug_max_length: 50,
  auto_update: true,
  default_branch_pattern: "^ge-branch-\\d+$"
};
var CONFIG_FILE_NAME = ".opencode/gitbutler.json";
function stripJsonComments(input) {
  let result = "";
  let i = 0;
  const len = input.length;
  while (i < len) {
    const ch = input[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < len) {
        if (input[j] === "\\") {
          j += 2;
          continue;
        }
        if (input[j] === '"') {
          j++;
          break;
        }
        j++;
      }
      result += input.slice(i, j);
      i = j;
      continue;
    }
    if (ch === "/" && input[i + 1] === "/") {
      i += 2;
      while (i < len && input[i] !== `
`)
        i++;
      continue;
    }
    if (ch === "/" && input[i + 1] === "*") {
      i += 2;
      while (i < len && !(input[i] === "*" && input[i + 1] === "/"))
        i++;
      i += 2;
      continue;
    }
    result += ch;
    i++;
  }
  result = result.replace(/,\s*([\]}])/g, "$1");
  return result;
}
function isValidRegex(pattern) {
  if (typeof pattern !== "string")
    return false;
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}
async function loadConfig(cwd) {
  const configPath = resolve(cwd, CONFIG_FILE_NAME);
  try {
    const file = Bun.file(configPath);
    if (!await file.exists()) {
      return { ...DEFAULT_CONFIG };
    }
    const raw = await file.text();
    const cleaned = stripJsonComments(raw);
    const parsed = JSON.parse(cleaned);
    return {
      log_enabled: typeof parsed.log_enabled === "boolean" ? parsed.log_enabled : DEFAULT_CONFIG.log_enabled,
      commit_message_model: typeof parsed.commit_message_model === "string" ? parsed.commit_message_model : DEFAULT_CONFIG.commit_message_model,
      commit_message_provider: typeof parsed.commit_message_provider === "string" ? parsed.commit_message_provider : DEFAULT_CONFIG.commit_message_provider,
      llm_timeout_ms: typeof parsed.llm_timeout_ms === "number" && parsed.llm_timeout_ms > 0 ? parsed.llm_timeout_ms : DEFAULT_CONFIG.llm_timeout_ms,
      max_diff_chars: typeof parsed.max_diff_chars === "number" && parsed.max_diff_chars > 0 ? parsed.max_diff_chars : DEFAULT_CONFIG.max_diff_chars,
      branch_slug_max_length: typeof parsed.branch_slug_max_length === "number" && parsed.branch_slug_max_length > 0 ? parsed.branch_slug_max_length : DEFAULT_CONFIG.branch_slug_max_length,
      auto_update: typeof parsed.auto_update === "boolean" ? parsed.auto_update : DEFAULT_CONFIG.auto_update,
      default_branch_pattern: isValidRegex(parsed.default_branch_pattern) ? parsed.default_branch_pattern : DEFAULT_CONFIG.default_branch_pattern
    };
  } catch (err) {
    console.warn(`[opencode-gitbutler] Failed to parse config at ${configPath}: ${err instanceof Error ? err.message : String(err)}. Using defaults.`);
    return { ...DEFAULT_CONFIG };
  }
}

// src/plugin.ts
var LOG_PATH_SUFFIX = ".opencode/plugin/debug.log";
function createDebugLog(logEnabled) {
  return async function debugLog(cwd, category, data) {
    if (!logEnabled)
      return;
    try {
      const line = `${new Date().toISOString()} [${category}] ${JSON.stringify(data)}
`;
      const logPath = `${cwd}/${LOG_PATH_SUFFIX}`;
      await appendFile(logPath, line);
    } catch {}
  };
}
var SUBAGENT_TOOLS = new Set([
  "agent",
  "task",
  "delegate_task"
]);
function createGitButlerPlugin(config = { ...DEFAULT_CONFIG }) {
  const debugLog = createDebugLog(config.log_enabled);
  return async ({ client, directory, worktree }) => {
    const cwd = worktree ?? directory;
    const SESSION_MAP_PATH = `${cwd}/.opencode/plugin/session-map.json`;
    const PLUGIN_STATE_PATH = `${cwd}/.opencode/plugin/plugin-state.json`;
    async function loadPluginState() {
      try {
        const file = Bun.file(PLUGIN_STATE_PATH);
        if (!await file.exists())
          return {
            conversationsWithEdits: [],
            rewordedBranches: []
          };
        return await file.json();
      } catch {
        return {
          conversationsWithEdits: [],
          rewordedBranches: []
        };
      }
    }
    async function savePluginState(conversations, reworded) {
      const state = {
        conversationsWithEdits: [...conversations],
        rewordedBranches: [...reworded]
      };
      await Bun.write(PLUGIN_STATE_PATH, JSON.stringify(state, null, 2) + `
`);
    }
    async function loadSessionMap() {
      try {
        const file = Bun.file(SESSION_MAP_PATH);
        if (!await file.exists())
          return new Map;
        const data = await file.json();
        return new Map(Object.entries(data));
      } catch {
        return new Map;
      }
    }
    async function saveSessionMap(map) {
      await Bun.write(SESSION_MAP_PATH, JSON.stringify(Object.fromEntries(map), null, 2) + `
`);
    }
    function isWorkspaceMode() {
      try {
        const proc = Bun.spawnSync(["git", "symbolic-ref", "--short", "HEAD"], { cwd, stdout: "pipe", stderr: "pipe" });
        if (proc.exitCode !== 0)
          return false;
        return proc.stdout.toString().trim() === "gitbutler/workspace";
      } catch {
        return false;
      }
    }
    const parentSessionByTaskSession = await loadSessionMap();
    const persistedState = await loadPluginState();
    const conversationsWithEdits = new Set(persistedState.conversationsWithEdits);
    const rewordedBranches = new Set(persistedState.rewordedBranches);
    debugLog(cwd, "state-loaded", {
      conversations: conversationsWithEdits.size,
      reworded: rewordedBranches.size
    }).catch(() => {});
    const internalSessionIds = new Set;
    const activeStopProcessing = new Set;
    let mainSessionID;
    const pendingNotifications = new Map;
    function addNotification(sessionID, message) {
      const rootID = resolveSessionRoot(sessionID);
      const existing = pendingNotifications.get(rootID) ?? [];
      existing.push({
        message,
        timestamp: Date.now()
      });
      pendingNotifications.set(rootID, existing);
      debugLog(cwd, "notification-queued", {
        rootID,
        message
      }).catch(() => {});
    }
    function consumeNotifications(sessionID) {
      const rootID = resolveSessionRoot(sessionID);
      const notifications = pendingNotifications.get(rootID);
      if (!notifications || notifications.length === 0)
        return null;
      pendingNotifications.delete(rootID);
      const lines = notifications.map((n) => `- ${n.message}`).join(`
`);
      return [
        "<system-reminder>",
        "[GITBUTLER STATE UPDATE]",
        "The following happened automatically since your last response:",
        "",
        lines,
        "",
        "This is informational \u2014 no action needed unless relevant to your current task.",
        "</system-reminder>"
      ].join(`
`);
    }
    const resolvedCwd = resolve2(cwd);
    function findFileBranch(filePath) {
      try {
        const proc = Bun.spawnSync(["but", "status", "--json", "-f"], { cwd, stdout: "pipe", stderr: "pipe" });
        if (proc.exitCode !== 0)
          return { inBranch: false };
        const data = JSON.parse(proc.stdout.toString());
        const normalized = toRelativePath(filePath);
        const unassigned = data.unassignedChanges?.find((ch) => ch.filePath === normalized);
        for (const stack of data.stacks ?? []) {
          if (stack.assignedChanges?.some((ch) => ch.filePath === normalized)) {
            return { inBranch: true };
          }
          for (const branch of stack.branches ?? []) {
            for (const commit of branch.commits ?? []) {
              if (commit.changes?.some((ch) => ch.filePath === normalized)) {
                return {
                  inBranch: true,
                  branchCliId: branch.cliId,
                  branchName: branch.name,
                  unassignedCliId: unassigned?.cliId
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
    function butRub(source, dest) {
      try {
        const proc = Bun.spawnSync(["but", "rub", source, dest], { cwd, stdout: "pipe", stderr: "pipe" });
        return proc.exitCode === 0;
      } catch {
        return false;
      }
    }
    function butUnapply(branchCliId) {
      try {
        const proc = Bun.spawnSync(["but", "unapply", branchCliId], { cwd, stdout: "pipe", stderr: "pipe" });
        return proc.exitCode === 0;
      } catch {
        return false;
      }
    }
    function toRelativePath(absPath) {
      const resolved = resolve2(absPath);
      const rel = relative(resolvedCwd, resolved);
      if (rel.startsWith(".."))
        return absPath;
      return rel;
    }
    let DEFAULT_BRANCH_PATTERN;
    try {
      DEFAULT_BRANCH_PATTERN = new RegExp(config.default_branch_pattern);
    } catch {
      DEFAULT_BRANCH_PATTERN = new RegExp(DEFAULT_CONFIG.default_branch_pattern);
    }
    async function fetchUserPrompt(sessionID) {
      try {
        const res = await client.session.messages({
          path: { id: sessionID },
          query: { limit: 5 }
        });
        if (!res.data)
          return null;
        for (const msg of res.data) {
          if (msg.info.role !== "user")
            continue;
          const textPart = msg.parts.find((p) => p.type === "text");
          if (textPart?.text)
            return textPart.text;
        }
        return null;
      } catch {
        return null;
      }
    }
    function toBranchSlug(prompt) {
      const cleaned = prompt.replace(/[^a-zA-Z0-9\s-]/g, "").trim().toLowerCase().split(/\s+/).slice(0, 6).join("-");
      return cleaned.slice(0, config.branch_slug_max_length) || "opencode-session";
    }
    const COMMIT_PREFIX_PATTERNS = [
      {
        pattern: /\b(fix|bug|broken|repair|patch)\b/i,
        prefix: "fix"
      },
      {
        pattern: /\b(add|create|implement|new|feature)\b/i,
        prefix: "feat"
      },
      {
        pattern: /\b(refactor|clean|restructure|reorganize)\b/i,
        prefix: "refactor"
      },
      {
        pattern: /\b(test|spec|coverage)\b/i,
        prefix: "test"
      },
      {
        pattern: /\b(doc|readme|documentation)\b/i,
        prefix: "docs"
      },
      {
        pattern: /\b(style|css|design|ui|layout)\b/i,
        prefix: "style"
      },
      {
        pattern: /\b(perf|performance|optimize|speed)\b/i,
        prefix: "perf"
      }
    ];
    function detectCommitPrefix(text) {
      for (const {
        pattern,
        prefix
      } of COMMIT_PREFIX_PATTERNS) {
        if (pattern.test(text))
          return prefix;
      }
      return "chore";
    }
    function toCommitMessage(prompt) {
      const firstLine = prompt.split(`
`)[0]?.trim() ?? "";
      if (!firstLine)
        return "chore: OpenCode session changes";
      const prefix = detectCommitPrefix(firstLine);
      const description = firstLine.replace(/^(fix|feat|refactor|test|docs|style|perf|chore)(\(.+?\))?:\s*/i, "").trim();
      const maxLen = 72 - prefix.length - 2;
      const truncated = description.length > maxLen ? description.slice(0, maxLen - 3) + "..." : description;
      return `${prefix}: ${truncated || "OpenCode session changes"}`;
    }
    const LLM_TIMEOUT_MS = config.llm_timeout_ms;
    const MAX_DIFF_CHARS = config.max_diff_chars;
    async function generateLLMCommitMessage(commitId, userPrompt) {
      try {
        const diffProc = Bun.spawnSync([
          "git",
          "show",
          commitId,
          "--format=",
          "--no-color"
        ], { cwd, stdout: "pipe", stderr: "pipe" });
        if (diffProc.exitCode !== 0)
          return null;
        const diff = diffProc.stdout.toString().trim();
        if (!diff)
          return null;
        const truncatedDiff = diff.length > MAX_DIFF_CHARS ? diff.slice(0, MAX_DIFF_CHARS) + `
... (truncated)` : diff;
        const sessionRes = await client.session.create({
          body: { title: "commit-msg-gen" }
        });
        if (!sessionRes.data)
          return null;
        const tempSessionId = sessionRes.data.id;
        internalSessionIds.add(tempSessionId);
        try {
          const promptText = [
            "Generate a one-line conventional commit message for this diff.",
            "Format: type: description (max 72 chars total).",
            "Types: feat, fix, refactor, test, docs, style, perf, chore.",
            `User intent: "${userPrompt.split(`
`)[0]?.trim().slice(0, 200) ?? ""}"`,
            "",
            "Diff:",
            truncatedDiff,
            "",
            "Reply with ONLY the commit message, nothing else."
          ].join(`
`);
          const timeoutPromise = new Promise((resolve3) => setTimeout(() => resolve3(null), LLM_TIMEOUT_MS));
          const llmPromise = client.session.prompt({
            path: { id: tempSessionId },
            body: {
              model: {
                providerID: config.commit_message_provider,
                modelID: config.commit_message_model
              },
              system: "You are a commit message generator. Output ONLY a single-line conventional commit message. No explanation, no markdown, no quotes, no code fences.",
              tools: {},
              parts: [
                { type: "text", text: promptText }
              ]
            }
          });
          const response = await Promise.race([
            llmPromise,
            timeoutPromise
          ]);
          if (!response || !("data" in response) || !response.data)
            return null;
          const textPart = response.data.parts.find((p) => p.type === "text");
          if (!textPart?.text)
            return null;
          const message = textPart.text.trim().replace(/^["'`]+|["'`]+$/g, "").split(`
`)[0]?.trim();
          if (!message)
            return null;
          const validPrefix = /^(feat|fix|refactor|test|docs|style|perf|chore|ci|build)(\(.+?\))?:\s/;
          if (!validPrefix.test(message))
            return null;
          if (message.length > 72)
            return message.slice(0, 69) + "...";
          return message;
        } finally {
          internalSessionIds.delete(tempSessionId);
          client.session.delete({ path: { id: tempSessionId } }).catch(() => {});
        }
      } catch {
        return null;
      }
    }
    function getFullStatus() {
      try {
        const proc = Bun.spawnSync(["but", "status", "--json", "-f"], { cwd, stdout: "pipe", stderr: "pipe" });
        if (proc.exitCode !== 0)
          return null;
        return JSON.parse(proc.stdout.toString());
      } catch {
        return null;
      }
    }
    function butReword(target, message) {
      try {
        const proc = Bun.spawnSync(["but", "reword", target, "-m", message], { cwd, stdout: "pipe", stderr: "pipe" });
        return proc.exitCode === 0;
      } catch {
        return false;
      }
    }
    async function postStopProcessing(sessionID) {
      if (!sessionID)
        return;
      const rootSessionID = resolveSessionRoot(sessionID);
      const prompt = await fetchUserPrompt(rootSessionID);
      if (!prompt)
        return;
      const status = getFullStatus();
      if (!status?.stacks)
        return;
      let latestBranchName = null;
      for (const stack of status.stacks) {
        for (const branch of stack.branches ?? []) {
          if (branch.branchStatus !== "completelyUnpushed")
            continue;
          if (branch.commits.length === 0)
            continue;
          if (rewordedBranches.has(branch.cliId))
            continue;
          const commit = branch.commits[0];
          if (!commit)
            continue;
          const llmMessage = await generateLLMCommitMessage(commit.commitId, prompt);
          const commitMsg = llmMessage ?? toCommitMessage(prompt);
          butReword(commit.cliId, commitMsg);
          rewordedBranches.add(branch.cliId);
          savePluginState(conversationsWithEdits, rewordedBranches).catch(() => {});
          addNotification(sessionID, `Commit on branch \`${branch.name}\` reworded to: "${commitMsg}"`);
          debugLog(cwd, "reword", {
            branch: branch.name,
            commit: commit.cliId,
            message: commitMsg,
            source: llmMessage ? "llm" : "deterministic",
            multi: branch.commits.length > 1
          }).catch(() => {});
          if (DEFAULT_BRANCH_PATTERN.test(branch.name)) {
            latestBranchName = toBranchSlug(prompt);
            butReword(branch.cliId, latestBranchName);
            addNotification(sessionID, `Branch renamed from \`${branch.name}\` to \`${latestBranchName}\``);
          } else {
            latestBranchName = branch.name;
          }
        }
      }
      if (!latestBranchName) {
        const existing = status.stacks.flatMap((s) => s.branches ?? []).filter((b) => b.commits.length > 0 && !DEFAULT_BRANCH_PATTERN.test(b.name));
        if (existing.length > 0) {
          latestBranchName = existing[existing.length - 1].name;
        }
      }
      if (latestBranchName) {
        client.session.update({
          path: { id: rootSessionID },
          body: { title: latestBranchName }
        }).catch(() => {});
        addNotification(sessionID, `Session title updated to \`${latestBranchName}\``);
      }
      for (const stack of status.stacks) {
        for (const branch of stack.branches ?? []) {
          if (branch.commits.length === 0 && (stack.assignedChanges?.length ?? 0) === 0 && DEFAULT_BRANCH_PATTERN.test(branch.name)) {
            const ok = butUnapply(branch.cliId);
            if (ok) {
              addNotification(sessionID, `Empty branch \`${branch.name}\` cleaned up`);
            }
            debugLog(cwd, ok ? "cleanup-ok" : "cleanup-failed", {
              branch: branch.name
            }).catch(() => {});
          }
        }
      }
    }
    async function toUUID(input) {
      const data = new TextEncoder().encode(input);
      const hash = await crypto.subtle.digest("SHA-256", data);
      const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
      return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        `4${hex.slice(12, 15)}`,
        `8${hex.slice(15, 18)}`,
        hex.slice(18, 30)
      ].join("-");
    }
    const CURSOR_MAX_RETRIES = 3;
    const CURSOR_RETRY_BASE_MS = 200;
    async function butCursor(subcommand, payload) {
      const json = JSON.stringify(payload);
      for (let attempt = 0;attempt <= CURSOR_MAX_RETRIES; attempt++) {
        const proc = Bun.spawn(["but", "cursor", subcommand], {
          cwd,
          stdout: "pipe",
          stderr: "pipe",
          stdin: new Blob([json])
        });
        const exitCode = await proc.exited;
        if (exitCode === 0) {
          debugLog(cwd, "cursor-ok", {
            subcommand,
            conversationId: payload.conversation_id,
            ...attempt > 0 ? { retries: attempt } : {}
          }).catch(() => {});
          return;
        }
        const stderr = await new Response(proc.stderr).text();
        const isExpectedError = stderr.includes("not in workspace mode") || stderr.includes("not initialized") || stderr.includes("No such file or directory") || stderr.includes("No hunk headers") || stderr.includes("no changes") || stderr.includes("checkout gitbutler/workspace");
        if (isExpectedError)
          return;
        const isRetryable = stderr.includes("database is locked") || stderr.includes("SQLITE_BUSY") || stderr.includes("failed to lock file");
        if (isRetryable && attempt < CURSOR_MAX_RETRIES) {
          const delay = CURSOR_RETRY_BASE_MS * 2 ** attempt;
          await Bun.sleep(delay);
          continue;
        }
        debugLog(cwd, "cursor-error", {
          subcommand,
          exitCode,
          stderr: stderr.trim(),
          attempt
        }).catch(() => {});
        throw new Error(`but cursor ${subcommand} failed (exit ${exitCode}): ${stderr.trim()}`);
      }
    }
    function extractFilePath(output) {
      return output.metadata?.filediff?.file ?? output.metadata?.filepath ?? undefined;
    }
    function extractEdits(output) {
      const fd = output.metadata?.filediff;
      if (fd?.before != null && fd?.after != null) {
        return [
          { old_string: fd.before, new_string: fd.after }
        ];
      }
      return [];
    }
    async function trackSubagentMapping(input) {
      const tool = input.tool;
      const parentSessionID = input.sessionID;
      const taskSessionID = input.callID;
      if (!tool || !SUBAGENT_TOOLS.has(tool))
        return;
      if (!parentSessionID || !taskSessionID)
        return;
      parentSessionByTaskSession.set(taskSessionID, parentSessionID);
      await saveSessionMap(parentSessionByTaskSession);
    }
    async function trackSessionCreatedMapping(event) {
      if (event.type !== "session.created")
        return;
      const properties = event.properties;
      if (!properties)
        return;
      const sessionID = typeof properties.id === "string" ? properties.id : undefined;
      const parentSessionID = typeof properties.parentSessionID === "string" ? properties.parentSessionID : typeof properties.parent_session_id === "string" ? properties.parent_session_id : undefined;
      if (!sessionID || !parentSessionID)
        return;
      parentSessionByTaskSession.set(sessionID, parentSessionID);
      await saveSessionMap(parentSessionByTaskSession);
    }
    function resolveSessionRoot(sessionID) {
      if (!sessionID)
        return "opencode-default";
      const seen = new Set;
      let current = sessionID;
      while (true) {
        if (seen.has(current))
          return current;
        seen.add(current);
        const parent = parentSessionByTaskSession.get(current);
        if (!parent)
          return current;
        current = parent;
      }
    }
    function hasMultiBranchHunks(filePath) {
      try {
        const proc = Bun.spawnSync(["but", "status", "--json", "-f"], { cwd, stdout: "pipe", stderr: "pipe" });
        if (proc.exitCode !== 0)
          return false;
        const data = JSON.parse(proc.stdout.toString());
        let branchCount = 0;
        for (const stack of data.stacks ?? []) {
          const hasInAssigned = stack.assignedChanges?.some((ch) => ch.filePath === filePath);
          if (hasInAssigned)
            branchCount++;
          if (branchCount > 1)
            return true;
        }
        return false;
      } catch {
        return false;
      }
    }
    const fileLocks = new Map;
    const LOCK_TIMEOUT_MS = 60000;
    const LOCK_POLL_MS = 1000;
    const STALE_LOCK_MS = 5 * 60000;
    function extractFilePathFromArgs(args) {
      const raw = args.filePath ?? args.file_path ?? args.path;
      return raw ? toRelativePath(raw) : undefined;
    }
    return {
      "tool.execute.before": async (input, output) => {
        if (internalSessionIds.has(input.sessionID ?? ""))
          return;
        if (input.tool !== "edit" && input.tool !== "write")
          return;
        if (!output.args)
          return;
        const filePath = extractFilePathFromArgs(output.args);
        if (!filePath)
          return;
        const sessionID = input.sessionID ?? "unknown";
        const existing = fileLocks.get(filePath);
        if (existing) {
          const isStale = Date.now() - existing.timestamp > STALE_LOCK_MS;
          if (isStale) {
            debugLog(cwd, "lock-stale", {
              file: filePath,
              owner: existing.sessionID
            }).catch(() => {});
          } else if (existing.sessionID !== sessionID) {
            const deadline = Date.now() + LOCK_TIMEOUT_MS;
            while (Date.now() < deadline) {
              await Bun.sleep(LOCK_POLL_MS);
              const current = fileLocks.get(filePath);
              if (!current || current.sessionID === sessionID || Date.now() - current.timestamp > STALE_LOCK_MS)
                break;
            }
            const stillLocked = fileLocks.get(filePath);
            if (stillLocked && stillLocked.sessionID !== sessionID && Date.now() - stillLocked.timestamp <= STALE_LOCK_MS) {
              debugLog(cwd, "lock-timeout", {
                file: filePath,
                owner: stillLocked.sessionID,
                waiter: sessionID
              }).catch(() => {});
            }
          }
        }
        fileLocks.set(filePath, {
          sessionID,
          timestamp: Date.now()
        });
        debugLog(cwd, "lock-acquired", {
          file: filePath,
          session: sessionID
        }).catch(() => {});
      },
      "tool.execute.after": async (input, output) => {
        if (internalSessionIds.has(input.sessionID ?? ""))
          return;
        await trackSubagentMapping(input);
        if (input.tool !== "edit" && input.tool !== "write")
          return;
        if (!isWorkspaceMode())
          return;
        const filePath = extractFilePath(output);
        if (!filePath) {
          const sessionID = input.sessionID ?? "unknown";
          for (const [
            lockedPath,
            lock
          ] of fileLocks.entries()) {
            if (lock.sessionID === sessionID) {
              fileLocks.delete(lockedPath);
              debugLog(cwd, "lock-released-fallback", {
                file: lockedPath,
                session: sessionID
              }).catch(() => {});
            }
          }
          return;
        }
        const relativePath = toRelativePath(filePath);
        try {
          const branchInfo = findFileBranch(relativePath);
          if (branchInfo.inBranch) {
            if (branchInfo.unassignedCliId && branchInfo.branchCliId) {
              if (hasMultiBranchHunks(relativePath)) {
                debugLog(cwd, "rub-skip-multi-branch", {
                  file: relativePath
                }).catch(() => {});
              } else {
                const rubOk = butRub(branchInfo.unassignedCliId, branchInfo.branchCliId);
                debugLog(cwd, rubOk ? "rub-ok" : "rub-failed", {
                  source: branchInfo.unassignedCliId,
                  dest: branchInfo.branchCliId,
                  file: relativePath
                }).catch(() => {});
              }
            }
            return;
          }
          const conversationId = await toUUID(resolveSessionRoot(input.sessionID));
          debugLog(cwd, "after-edit", {
            file: relativePath,
            sessionID: input.sessionID,
            conversationId
          }).catch(() => {});
          await butCursor("after-edit", {
            conversation_id: conversationId,
            generation_id: crypto.randomUUID(),
            file_path: relativePath,
            edits: extractEdits(output),
            hook_event_name: "afterFileEdit",
            workspace_roots: [cwd]
          });
          conversationsWithEdits.add(conversationId);
          savePluginState(conversationsWithEdits, rewordedBranches).catch(() => {});
        } finally {
          fileLocks.delete(relativePath);
        }
      },
      event: async ({ event }) => {
        if (!event?.type)
          return;
        const eventProps = event.properties;
        if (internalSessionIds.has(eventProps?.sessionID ?? ""))
          return;
        await trackSessionCreatedMapping(event);
        if (event.type === "session.created") {
          const crProps = event.properties;
          const sessId = typeof crProps?.id === "string" ? crProps.id : undefined;
          const parentId = typeof crProps?.parentSessionID === "string" ? crProps.parentSessionID : typeof crProps?.parent_session_id === "string" ? crProps.parent_session_id : undefined;
          if (sessId && !parentId) {
            mainSessionID = sessId;
          }
        }
        const props = event.properties;
        const isIdle = event.type === "session.idle" || event.type === "session.status" && props?.status?.type === "idle";
        if (!isIdle)
          return;
        if (!isWorkspaceMode())
          return;
        const conversationId = await toUUID(resolveSessionRoot(props?.sessionID));
        if (!conversationsWithEdits.has(conversationId))
          return;
        if (activeStopProcessing.has(conversationId))
          return;
        activeStopProcessing.add(conversationId);
        try {
          debugLog(cwd, "session-stop", {
            sessionID: props?.sessionID,
            conversationId
          }).catch(() => {});
          await butCursor("stop", {
            conversation_id: conversationId,
            generation_id: crypto.randomUUID(),
            status: "completed",
            hook_event_name: "stop",
            workspace_roots: [cwd]
          });
          await postStopProcessing(props?.sessionID);
        } finally {
          activeStopProcessing.delete(conversationId);
        }
      },
      "experimental.chat.messages.transform": async (_input, output) => {
        const { messages } = output;
        if (messages.length === 0)
          return;
        let lastUserMsgIdx = -1;
        for (let i = messages.length - 1;i >= 0; i--) {
          if (messages[i].info.role === "user") {
            lastUserMsgIdx = i;
            break;
          }
        }
        if (lastUserMsgIdx === -1)
          return;
        const lastUserMessage = messages[lastUserMsgIdx];
        const messageSessionID = lastUserMessage.info.sessionID;
        const sessionID = messageSessionID ?? mainSessionID;
        if (!sessionID)
          return;
        const notification = consumeNotifications(sessionID);
        if (!notification)
          return;
        const textPartIndex = lastUserMessage.parts.findIndex((p) => p.type === "text" && p.text);
        if (textPartIndex === -1)
          return;
        const syntheticPart = {
          id: `gitbutler_ctx_${Date.now()}`,
          messageID: lastUserMessage.info.id,
          sessionID,
          type: "text",
          text: notification,
          synthetic: true
        };
        lastUserMessage.parts.splice(textPartIndex, 0, syntheticPart);
        debugLog(cwd, "context-injected", {
          sessionID,
          contentLength: notification.length
        }).catch(() => {});
      }
    };
  };
}

// src/auto-update.ts
var NPM_DIST_TAGS_URL = "https://registry.npmjs.org/-/package/opencode-gitbutler/dist-tags";
var FETCH_TIMEOUT_MS = 5000;
function parseVersion(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
  if (!match)
    return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? ""
  };
}
function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb)
    return 0;
  for (const field of ["major", "minor", "patch"]) {
    if (pa[field] > pb[field])
      return 1;
    if (pa[field] < pb[field])
      return -1;
  }
  if (!pa.prerelease && pb.prerelease)
    return 1;
  if (pa.prerelease && !pb.prerelease)
    return -1;
  if (pa.prerelease < pb.prerelease)
    return -1;
  if (pa.prerelease > pb.prerelease)
    return 1;
  return 0;
}
async function checkForUpdate(currentVersion) {
  const controller = new AbortController;
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(NPM_DIST_TAGS_URL, {
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });
    if (!response.ok)
      return null;
    const data = await response.json();
    const latest = data.latest;
    if (!latest || typeof latest !== "string")
      return null;
    return {
      current: currentVersion,
      latest,
      updateAvailable: compareVersions(latest, currentVersion) > 0
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
function formatUpdateMessage(info) {
  return `opencode-gitbutler update available: ${info.current} \u2192 ${info.latest}. ` + `Run \`bun add opencode-gitbutler@latest\` to update.`;
}
function createAutoUpdateHook(config) {
  if (config.auto_update === false) {
    return { onSessionCreated: async () => null };
  }
  let checked = false;
  let pendingMessage = null;
  let checkPromise = null;
  checkPromise = checkForUpdate(config.currentVersion).then((info) => {
    if (info?.updateAvailable) {
      pendingMessage = formatUpdateMessage(info);
    }
  }).catch(() => {}).finally(() => {
    checkPromise = null;
  });
  return {
    onSessionCreated: async () => {
      if (checked)
        return null;
      checked = true;
      if (checkPromise) {
        await checkPromise;
      }
      const msg = pendingMessage;
      pendingMessage = null;
      return msg;
    }
  };
}

// src/index.ts
var DUPLICATE_GUARD_KEY = "__opencode_gitbutler_loaded__";
var PACKAGE_VERSION = "0.1.0";
var COMMAND_FILES = ["b-branch", "b-branch-commit", "b-branch-pr"];
function parseFrontmatter(content) {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return { fields: {}, template: content };
  }
  let frontmatterEnd = -1;
  for (let i = 1;i < lines.length; i += 1) {
    if (lines[i]?.trim() === "---") {
      frontmatterEnd = i;
      break;
    }
  }
  if (frontmatterEnd === -1) {
    return { fields: {}, template: content };
  }
  const fields = {};
  for (const line of lines.slice(1, frontmatterEnd)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#"))
      continue;
    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex === -1)
      continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    if (!key)
      continue;
    const isQuoted = rawValue.startsWith('"') && rawValue.endsWith('"') || rawValue.startsWith("'") && rawValue.endsWith("'");
    let parsedValue;
    if (isQuoted) {
      parsedValue = rawValue.slice(1, -1);
    } else if (rawValue === "true" || rawValue === "false") {
      parsedValue = rawValue === "true";
    } else if (/^-?\d+(?:\.\d+)?$/.test(rawValue)) {
      parsedValue = Number(rawValue);
    } else {
      parsedValue = rawValue;
    }
    fields[key] = parsedValue;
  }
  return {
    fields,
    template: lines.slice(frontmatterEnd + 1).join(`
`)
  };
}
async function loadCommands() {
  const commands = {};
  for (const commandName of COMMAND_FILES) {
    const commandPath = new URL(`../command/${commandName}.md`, import.meta.url);
    const file = Bun.file(commandPath);
    if (!await file.exists()) {
      continue;
    }
    const source = await file.text();
    const { fields, template } = parseFrontmatter(source);
    const command = {
      template
    };
    if (typeof fields.description === "string") {
      command.description = fields.description;
    }
    if (typeof fields.agent === "string") {
      command.agent = fields.agent;
    }
    if (typeof fields.model === "string") {
      command.model = fields.model;
    }
    if (typeof fields.subtask === "boolean") {
      command.subtask = fields.subtask;
    }
    commands[commandName] = command;
  }
  return commands;
}
var GitButlerPlugin = async (input) => {
  const g = globalThis;
  if (g[DUPLICATE_GUARD_KEY]) {
    console.warn("[opencode-gitbutler] Plugin already loaded \u2014 skipping duplicate registration.");
    return {};
  }
  g[DUPLICATE_GUARD_KEY] = true;
  const cwd = input.worktree ?? input.directory;
  const config = await loadConfig(cwd);
  const hooks = await createGitButlerPlugin(config)(input);
  const autoUpdate = createAutoUpdateHook({
    currentVersion: PACKAGE_VERSION,
    auto_update: config.auto_update
  });
  const skillDir = new URL("../skill", import.meta.url).pathname;
  const commandDefinitions = await loadCommands();
  const originalEvent = hooks.event;
  hooks.event = async (payload) => {
    if (originalEvent) {
      await originalEvent(payload);
    }
    if (payload.event?.type === "session.created") {
      const props = payload.event.properties;
      const hasParent = typeof props?.parentSessionID === "string" || typeof props?.parent_session_id === "string";
      if (!hasParent) {
        const msg = await autoUpdate.onSessionCreated();
        if (msg) {
          console.warn(`[opencode-gitbutler] ${msg}`);
        }
      }
    }
  };
  const originalConfig = hooks.config;
  hooks.config = async (config2) => {
    if (originalConfig) {
      await originalConfig(config2);
    }
    const extendedConfig = config2;
    if (!extendedConfig.skills)
      extendedConfig.skills = {};
    if (!extendedConfig.skills.paths)
      extendedConfig.skills.paths = [];
    if (!extendedConfig.skills.paths.includes(skillDir)) {
      extendedConfig.skills.paths.push(skillDir);
    }
    if (!extendedConfig.command) {
      extendedConfig.command = {};
    }
    for (const [name, definition] of Object.entries(commandDefinitions)) {
      extendedConfig.command[name] = definition;
    }
  };
  return hooks;
};
var src_default = GitButlerPlugin;
export {
  src_default as default,
  GitButlerPlugin
};
