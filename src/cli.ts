import { resolve, relative } from "node:path";
import type { Logger } from "./logger.js";

export type ButStatusChange = {
  cliId?: string;
  filePath?: string;
};

export type ButStatusCommit = {
  changes?: ButStatusChange[];
};

export type ButStatusJson = {
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

export type FileBranchResult = {
  inBranch: boolean;
  branchCliId?: string;
  branchName?: string;
  unassignedCliId?: string;
  confidence?: BranchInferenceConfidence;
};

export type BranchInferenceConfidence =
  | "high"
  | "medium"
  | "ambiguous";

export type ButStatusBranch = {
  cliId: string;
  name: string;
  branchStatus: string;
  commits: Array<{
    cliId: string;
    commitId: string;
    message: string;
    changes?: ButStatusChange[];
  }>;
};

export type ButStatusFull = {
  unassignedChanges?: ButStatusChange[];
  stacks?: Array<{
    assignedChanges?: ButStatusChange[];
    branches?: ButStatusBranch[];
  }>;
};

export type HookOutput = {
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

export type Cli = {
  isWorkspaceMode: () => boolean;
  findFileBranch: (filePath: string, statusData?: ButStatusFull | null) => FileBranchResult;
  butRub: (source: string, dest: string) => boolean;
  butUnapply: (branchCliId: string) => { ok: boolean; stderr: string };
  butUnapplyWithRetry: (branchCliId: string, branchName: string, maxRetries?: number) => Promise<boolean>;
  getFullStatus: () => ButStatusFull | null;
  butReword: (target: string, message: string) => { ok: boolean; stderr: string };
  butCursor: (subcommand: string, payload: Record<string, unknown>) => Promise<void>;
  extractFilePath: (output: HookOutput) => string | undefined;
  extractEdits: (output: HookOutput) => Array<{ old_string: string; new_string: string }>;
  hasMultiBranchHunks: (filePath: string, statusData?: ButStatusFull | null) => boolean;
  toRelativePath: (absPath: string) => string;
};

export type CliOptions = {
  inferenceEnabled?: boolean;
};

const CURSOR_RETRY_PARAMS: Record<string, { maxRetries: number; baseMs: number }> = {
  stop: { maxRetries: 5, baseMs: 500 },
  default: { maxRetries: 3, baseMs: 200 },
};

export function createCli(
  cwd: string,
  log: Logger,
  options: CliOptions = {},
): Cli {
  const resolvedCwd = resolve(cwd);
  const inferenceEnabled = options.inferenceEnabled ?? true;

  function toPathSegments(filePath: string): string[] {
    return filePath
      .replace(/\\/g, "/")
      .split("/")
      .filter(Boolean);
  }

  function sharedPrefixDepth(a: string[], b: string[]): number {
    const limit = Math.min(a.length, b.length);
    let depth = 0;
    while (depth < limit && a[depth] === b[depth]) {
      depth++;
    }
    return depth;
  }

  function scoreBranchByDirectoryPrefix(
    filePath: string,
    branch: ButStatusBranch,
  ): number {
    const targetSegments = toPathSegments(filePath);
    let maxScore = 0;
    for (const commit of branch.commits ?? []) {
      for (const change of commit.changes ?? []) {
        if (!change.filePath) continue;
        const candidateSegments = toPathSegments(change.filePath);
        const score = sharedPrefixDepth(
          targetSegments,
          candidateSegments,
        );
        if (score > maxScore) {
          maxScore = score;
        }
      }
    }
    return maxScore;
  }

  function inferAssignedBranch(
    filePath: string,
    stackBranches: ButStatusBranch[],
    unassignedCliId?: string,
  ): FileBranchResult {
    if (!inferenceEnabled) {
      log.info("inference-disabled", {
        file: filePath,
        branchCount: stackBranches.length,
      });
      return {
        inBranch: true,
        unassignedCliId,
        confidence: "ambiguous",
      };
    }

    if (stackBranches.length === 0) {
      log.warn("inference-no-branches", {
        file: filePath,
      });
      return {
        inBranch: true,
        unassignedCliId,
        confidence: "ambiguous",
      };
    }

    if (stackBranches.length === 1) {
      const [branch] = stackBranches;
      if (!branch) {
        return {
          inBranch: true,
          unassignedCliId,
          confidence: "ambiguous",
        };
      }
      log.info("inference-single-branch", {
        file: filePath,
        branchCliId: branch.cliId,
        branchName: branch.name,
      });
      return {
        inBranch: true,
        branchCliId: branch.cliId,
        branchName: branch.name,
        unassignedCliId,
        confidence: "high",
      };
    }

    const scoredBranches = stackBranches
      .map((branch) => ({
        branch,
        score: scoreBranchByDirectoryPrefix(filePath, branch),
      }))
      .sort((a, b) => b.score - a.score);

    const best = scoredBranches[0];
    const second = scoredBranches[1];
    if (
      best?.branch &&
      second &&
      best.score >= 2 &&
      best.score > second.score
    ) {
      log.info("inference-directory-match", {
        file: filePath,
        branchCliId: best.branch.cliId,
        branchName: best.branch.name,
        score: best.score,
        margin: best.score - second.score,
        branchCount: stackBranches.length,
      });
      return {
        inBranch: true,
        branchCliId: best.branch.cliId,
        branchName: best.branch.name,
        unassignedCliId,
        confidence: "medium",
      };
    }

    log.warn("inference-ambiguous", {
      file: filePath,
      branchCount: stackBranches.length,
      scores: scoredBranches.map((entry) => ({
        branchCliId: entry.branch.cliId,
        score: entry.score,
      })),
    });
    return {
      inBranch: true,
      unassignedCliId,
      confidence: "ambiguous",
    };
  }

  function toRelativePath(absPath: string): string {
    const resolved = resolve(absPath);
    const rel = relative(resolvedCwd, resolved);
    if (rel.startsWith("..")) return absPath;
    return rel;
  }

  function isWorkspaceMode(): boolean {
    try {
      const proc = Bun.spawnSync(
        ["git", "symbolic-ref", "--short", "HEAD"],
        { cwd, stdout: "pipe", stderr: "pipe" },
      );
      if (proc.exitCode !== 0) return false;
      return (
        proc.stdout.toString().trim() ===
        "gitbutler/workspace"
      );
    } catch {
      return false;
    }
  }

  function findFileBranch(
    filePath: string,
    statusData?: ButStatusFull | null,
  ): FileBranchResult {
    try {
      let data: ButStatusFull;
      if (statusData) {
        data = statusData;
      } else {
        const proc = Bun.spawnSync(
          ["but", "status", "--json", "-f"],
          { cwd, stdout: "pipe", stderr: "pipe" },
        );
        if (proc.exitCode !== 0) return { inBranch: false };
        data = JSON.parse(proc.stdout.toString()) as ButStatusFull;
      }

      const normalized = toRelativePath(filePath);

      const unassigned = data.unassignedChanges?.find(
        (ch) => ch.filePath === normalized,
      );

      const assignedStacks: NonNullable<
        ButStatusFull["stacks"]
      > = [];

      for (const stack of data.stacks ?? []) {
        if (
          stack.assignedChanges?.some(
            (ch) => ch.filePath === normalized,
          )
        ) {
          assignedStacks.push(stack);
        }

        for (const branch of stack.branches ?? []) {
          for (const commit of branch.commits ?? []) {
            if (
              commit.changes?.some(
                (ch) => ch.filePath === normalized,
              )
            ) {
              return {
                inBranch: true,
                branchCliId: branch.cliId,
                branchName: branch.name,
                unassignedCliId: unassigned?.cliId,
                confidence: "high",
              };
            }
          }
        }
      }

      if (assignedStacks.length === 1) {
        const [stack] = assignedStacks;
        if (stack) {
          return inferAssignedBranch(
            normalized,
            stack.branches ?? [],
            unassigned?.cliId,
          );
        }
      }

      if (assignedStacks.length > 1) {
        const uniqueBranches = new Set<string>();
        for (const stack of assignedStacks) {
          for (const branch of stack.branches ?? []) {
            if (branch.cliId) {
              uniqueBranches.add(branch.cliId);
            }
          }
        }
        log.warn("inference-ambiguous", {
          file: normalized,
          reason: "multiple-assigned-stacks",
          stackCount: assignedStacks.length,
          branchCount: uniqueBranches.size,
        });
        return {
          inBranch: true,
          unassignedCliId: unassigned?.cliId,
          confidence: "ambiguous",
        };
      }

      return { inBranch: false };
    } catch {
      return { inBranch: false };
    }
  }

  function butRub(source: string, dest: string): boolean {
    try {
      const proc = Bun.spawnSync(
        ["but", "rub", source, dest],
        { cwd, stdout: "pipe", stderr: "pipe" },
      );
      return proc.exitCode === 0;
    } catch {
      return false;
    }
  }

  function butUnapply(branchCliId: string): { ok: boolean; stderr: string } {
    try {
      const proc = Bun.spawnSync(
        ["but", "unapply", branchCliId],
        { cwd, stdout: "pipe", stderr: "pipe" },
      );
      return {
        ok: proc.exitCode === 0,
        stderr: proc.stderr?.toString().trim() ?? "",
      };
    } catch (err) {
      return {
        ok: false,
        stderr: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async function butUnapplyWithRetry(
    branchCliId: string,
    branchName: string,
    maxRetries = 4,
  ): Promise<boolean> {
    let lastStderr = "";
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        const status = getFullStatus();
        if (status?.stacks) {
          const branch = status.stacks
            .flatMap((s) => s.branches ?? [])
            .find((b) => b.cliId === branchCliId);
          if (!branch) {
            log.info("cleanup-ok", {
              branch: branchName,
              retries: attempt,
              reason: "branch-gone",
            });
            return true;
          }
          if (branch.commits.length > 0) {
            log.info("cleanup-skipped", {
              branch: branchName,
              retries: attempt,
              reason: "branch-has-commits",
              commitCount: branch.commits.length,
            });
            return true;
          }
        }
      }

      const result = butUnapply(branchCliId);
      if (result.ok) {
        log.info("cleanup-ok", {
          branch: branchName,
          ...(attempt > 0 ? { retries: attempt } : {}),
        });
        return true;
      }

      lastStderr = result.stderr;
      const isLocked = lastStderr.includes("locked") ||
        lastStderr.includes("SQLITE_BUSY") ||
        lastStderr.includes("database is locked");
      const isNotFound = lastStderr.includes("not found") ||
        lastStderr.includes("Branch not found");

      if (isNotFound) {
        log.info("cleanup-ok", {
          branch: branchName,
          retries: attempt,
          reason: "not-found",
        });
        return true;
      }

      if (attempt < maxRetries) {
        const delay = 500 * 2 ** attempt;
        log.info("cleanup-retry", {
          branch: branchName,
          attempt: attempt + 1,
          delayMs: delay,
          reason: isLocked ? "locked" : "unknown",
          stderr: lastStderr.slice(0, 200),
        });
        await Bun.sleep(delay);
      }
    }
    log.error("cleanup-failed", {
      branch: branchName,
      attempts: maxRetries + 1,
      stderr: lastStderr.slice(0, 500),
      reason: lastStderr.includes("locked") ? "locked" : "unknown",
    });
    return false;
  }

  function getFullStatus(): ButStatusFull | null {
    try {
      const proc = Bun.spawnSync(
        ["but", "status", "--json", "-f"],
        { cwd, stdout: "pipe", stderr: "pipe" },
      );
      if (proc.exitCode !== 0) return null;
      return JSON.parse(
        proc.stdout.toString(),
      ) as ButStatusFull;
    } catch {
      return null;
    }
  }

  function butReword(
    target: string,
    message: string,
  ): { ok: boolean; stderr: string } {
    try {
      const proc = Bun.spawnSync(
        ["but", "reword", target, "-m", message],
        { cwd, stdout: "pipe", stderr: "pipe" },
      );
      return {
        ok: proc.exitCode === 0,
        stderr: proc.stderr?.toString().trim() ?? "",
      };
    } catch (err) {
      return {
        ok: false,
        stderr: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async function butCursor(
    subcommand: string,
    payload: Record<string, unknown>,
  ) {
    const json = JSON.stringify(payload);
    const retryParams = CURSOR_RETRY_PARAMS[subcommand] ?? CURSOR_RETRY_PARAMS.default;

    for (
      let attempt = 0;
      attempt <= retryParams.maxRetries;
      attempt++
    ) {
      const proc = Bun.spawn(
        ["but", "cursor", subcommand],
        {
          cwd,
          stdout: "ignore",
          stderr: "pipe",
          stdin: new Blob([json]),
        },
      );
      const exitCode = await proc.exited;

      if (exitCode === 0) {
        log.info("cursor-ok", {
          subcommand,
          conversationId: payload.conversation_id,
          ...(attempt > 0 ? { retries: attempt } : {}),
        });
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

      const isRecoverableRace =
        stderr.includes("Stack not found") ||
        stderr.includes("reference mismatch") ||
        stderr.includes("Branch not found") ||
        stderr.includes("workspace reference");
      if (isRecoverableRace) {
        log.warn("cursor-race", {
          subcommand,
          exitCode,
          stderr: stderr.trim(),
          attempt,
          conversationId: payload.conversation_id,
        });
        return;
      }

      const isRetryable =
        stderr.includes("database is locked") ||
        stderr.includes("SQLITE_BUSY") ||
        stderr.includes("failed to lock file");
      if (isRetryable && attempt < retryParams.maxRetries) {
        const delay = retryParams.baseMs * 2 ** attempt;
        await Bun.sleep(delay);
        continue;
      }

      log.error("cursor-error", {
        subcommand,
        exitCode,
        stderr: stderr.trim(),
        attempt,
      });
      throw new Error(
        `but cursor ${subcommand} failed (exit ${exitCode}): ${stderr.trim()}`,
      );
    }
  }

  function extractFilePath(
    output: HookOutput,
  ): string | undefined {
    return (
      output.metadata?.filediff?.file ??
      output.metadata?.filepath ??
      undefined
    );
  }

  function extractEdits(
    output: HookOutput,
  ): Array<{ old_string: string; new_string: string }> {
    const fd = output.metadata?.filediff;
    if (fd?.before != null && fd?.after != null) {
      return [
        { old_string: fd.before, new_string: fd.after },
      ];
    }
    return [];
  }

  function hasMultiBranchHunks(
    filePath: string,
    statusData?: ButStatusFull | null,
  ): boolean {
    try {
      let data: ButStatusFull;
      if (statusData) {
        data = statusData;
      } else {
        const proc = Bun.spawnSync(
          ["but", "status", "--json", "-f"],
          { cwd, stdout: "pipe", stderr: "pipe" },
        );
        if (proc.exitCode !== 0) return false;
        data = JSON.parse(proc.stdout.toString()) as ButStatusFull;
      }

      let branchCount = 0;
      for (const stack of data.stacks ?? []) {
        for (const branch of stack.branches ?? []) {
          const hasInBranch = branch.commits?.some(
            (c) => c.changes?.some((ch) => ch.filePath === filePath),
          );
          if (hasInBranch) branchCount++;
          if (branchCount > 1) return true;
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  return {
    isWorkspaceMode,
    findFileBranch,
    butRub,
    butUnapply,
    butUnapplyWithRetry,
    getFullStatus,
    butReword,
    butCursor,
    extractFilePath,
    extractEdits,
    hasMultiBranchHunks,
    toRelativePath,
  };
}
