import { describe, test, expect } from "bun:test";
import {
  detectCommitPrefix,
  toCommitMessage,
  toBranchSlug,
  classifyRewordFailure,
  rewordTrackingKey,
  COMMIT_PREFIX_PATTERNS,
  createRewordManager,
} from "../reword.js";
import type { Cli, FileBranchResult } from "../cli.js";
import type { Logger } from "../logger.js";
import { DEFAULT_CONFIG } from "../config.js";

describe("detectCommitPrefix", () => {
  test("detects fix-related words", () => {
    expect(detectCommitPrefix("fix the login bug")).toBe("fix");
    expect(detectCommitPrefix("repair broken auth")).toBe("fix");
    expect(detectCommitPrefix("patch the config")).toBe("fix");
  });

  test("detects feat-related words", () => {
    expect(detectCommitPrefix("add dark mode toggle")).toBe("feat");
    expect(detectCommitPrefix("create new API endpoint")).toBe("feat");
    expect(detectCommitPrefix("implement retry logic")).toBe("feat");
  });

  test("detects refactor-related words", () => {
    expect(detectCommitPrefix("refactor the auth module")).toBe("refactor");
    expect(detectCommitPrefix("clean up dead code")).toBe("refactor");
    expect(detectCommitPrefix("restructure project layout")).toBe("refactor");
  });

  test("detects test-related words", () => {
    expect(detectCommitPrefix("test the login flow")).toBe("test");
    expect(detectCommitPrefix("run spec suite")).toBe("test");
    expect(detectCommitPrefix("increase coverage")).toBe("test");
  });

  test("detects docs-related words", () => {
    expect(detectCommitPrefix("update documentation")).toBe("docs");
    expect(detectCommitPrefix("write readme")).toBe("docs");
  });

  test("detects style-related words", () => {
    expect(detectCommitPrefix("update css layout")).toBe("style");
    expect(detectCommitPrefix("change ui color scheme")).toBe("style");
  });

  test("detects perf-related words", () => {
    expect(detectCommitPrefix("optimize query performance")).toBe("perf");
    expect(detectCommitPrefix("speed up build")).toBe("perf");
  });

  test("falls back to chore for unknown", () => {
    expect(detectCommitPrefix("update dependencies")).toBe("chore");
    expect(detectCommitPrefix("bump version")).toBe("chore");
    expect(detectCommitPrefix("")).toBe("chore");
  });

  test("first matching pattern wins (priority order)", () => {
    expect(detectCommitPrefix("fix the feature")).toBe("fix");
    expect(detectCommitPrefix("add spec for auth")).toBe("feat");
    expect(detectCommitPrefix("fix ui alignment")).toBe("fix");
  });

  test("case insensitive", () => {
    expect(detectCommitPrefix("FIX the bug")).toBe("fix");
    expect(detectCommitPrefix("ADD new feature")).toBe("feat");
    expect(detectCommitPrefix("REFACTOR code")).toBe("refactor");
  });

  test("all patterns have valid regex", () => {
    for (const { pattern } of COMMIT_PREFIX_PATTERNS) {
      expect(() => new RegExp(pattern)).not.toThrow();
    }
  });
});

describe("toCommitMessage", () => {
  test("generates prefixed message from prompt", () => {
    expect(toCommitMessage("fix the login bug")).toBe("fix: fix the login bug");
    expect(toCommitMessage("add dark mode toggle")).toBe("feat: add dark mode toggle");
  });

  test("strips existing conventional prefix from prompt", () => {
    expect(toCommitMessage("fix: the login bug")).toBe("fix: the login bug");
    expect(toCommitMessage("feat(auth): add login")).toBe("feat: add login");
  });

  test("truncates to 72 chars total", () => {
    const longPrompt = "add " + "x".repeat(100);
    const result = toCommitMessage(longPrompt);
    expect(result.length).toBeLessThanOrEqual(72);
    expect(result).toEndWith("...");
  });

  test("uses first line only", () => {
    expect(toCommitMessage("fix the bug\nsecond line\nthird")).toBe("fix: fix the bug");
  });

  test("handles empty prompt", () => {
    expect(toCommitMessage("")).toBe("chore: OpenCode session changes");
  });

  test("handles whitespace-only prompt", () => {
    expect(toCommitMessage("   ")).toBe("chore: OpenCode session changes");
  });

  test("handles prompt with only a prefix", () => {
    expect(toCommitMessage("fix:")).toBe("fix: OpenCode session changes");
  });
});

describe("toBranchSlug", () => {
  test("converts prompt to kebab-case slug", () => {
    expect(toBranchSlug("add dark mode toggle", 50)).toBe("add-dark-mode-toggle");
  });

  test("removes special characters", () => {
    expect(toBranchSlug("fix: the login bug!", 50)).toBe("fix-the-login-bug");
  });

  test("limits to max 6 words", () => {
    expect(toBranchSlug("one two three four five six seven eight", 50)).toBe("one-two-three-four-five-six");
  });

  test("respects maxLength", () => {
    const result = toBranchSlug("add dark mode toggle to the application", 15);
    expect(result.length).toBeLessThanOrEqual(15);
  });

  test("handles empty input", () => {
    expect(toBranchSlug("", 50)).toBe("opencode-session");
  });

  test("handles special-chars-only input", () => {
    expect(toBranchSlug("!@#$%^&*()", 50)).toBe("opencode-session");
  });

  test("lowercases everything", () => {
    expect(toBranchSlug("Fix The LOGIN Bug", 50)).toBe("fix-the-login-bug");
  });
});

describe("classifyRewordFailure", () => {
  test("classifies locked errors", () => {
    expect(classifyRewordFailure("database is locked")).toBe("locked");
    expect(classifyRewordFailure("SQLITE_BUSY")).toBe("locked");
  });

  test("classifies not-found errors", () => {
    expect(classifyRewordFailure("Branch not found in workspace")).toBe("not-found");
    expect(classifyRewordFailure("commit not found")).toBe("not-found");
  });

  test("classifies reference-mismatch errors", () => {
    expect(classifyRewordFailure("workspace reference mismatch")).toBe("reference-mismatch");
    expect(classifyRewordFailure("reference mismatch on branch")).toBe("reference-mismatch");
  });

  test("classifies not-workspace errors", () => {
    expect(classifyRewordFailure("not in workspace mode")).toBe("not-workspace");
    expect(classifyRewordFailure("gitbutler not initialized")).toBe("not-workspace");
  });

  test("returns unknown for unrecognized errors", () => {
    expect(classifyRewordFailure("something else went wrong")).toBe("unknown");
    expect(classifyRewordFailure("")).toBe("unknown");
  });

  test("first matching pattern wins", () => {
    expect(classifyRewordFailure("locked and not found")).toBe("locked");
  });
});

describe("rewordTrackingKey", () => {
  test("creates unique keys per branch+commit", () => {
    const a = rewordTrackingKey("br-1", "sha-1");
    const b = rewordTrackingKey("br-1", "sha-2");
    const c = rewordTrackingKey("br-2", "sha-1");

    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(a).toContain("\0");
  });
});

describe("postStopProcessing inference metrics", () => {
  function makeLogger(entries: Array<{ cat: string; data?: Record<string, unknown> }>): Logger {
    return {
      info: (cat, data) => entries.push({ cat, data }),
      warn: (cat, data) => entries.push({ cat, data }),
      error: (cat, data) => entries.push({ cat, data }),
    };
  }

  function makeCli(
    findFileBranch: (filePath: string) => FileBranchResult,
    statusOverride?: ReturnType<Cli["getFullStatus"]>,
  ): Cli {
    return {
      isWorkspaceMode: () => true,
      findFileBranch: (filePath) => findFileBranch(filePath),
      butRub: () => false,
      butUnapply: () => ({ ok: true, stderr: "" }),
      butUnapplyWithRetry: async () => true,
      getFullStatus: () =>
        statusOverride ?? {
          stacks: [],
          unassignedChanges: [],
        },
      butReword: () => ({ ok: true, stderr: "" }),
      butCursor: async () => {},
      extractFilePath: () => undefined,
      extractEdits: () => [],
      hasMultiBranchHunks: () => false,
      toRelativePath: (absPath) => absPath,
    };
  }

  test("logs sweep summary even when no files are rubbed", async () => {
    const entries: Array<{ cat: string; data?: Record<string, unknown> }> = [];
    const manager = createRewordManager({
      cwd: "/tmp",
      log: makeLogger(entries),
      cli: makeCli(() => ({ inBranch: true, confidence: "ambiguous" })),
      config: DEFAULT_CONFIG,
      defaultBranchPattern: new RegExp(DEFAULT_CONFIG.default_branch_pattern),
      addNotification: () => {},
      resolveSessionRoot: (sessionID) => sessionID ?? "root",
      conversationsWithEdits: new Set(["conv-1"]),
      rewordedBranches: new Set(),
      branchOwnership: new Map(),
      editedFilesPerConversation: new Map([
        ["conv-1", new Set(["src/example.ts"] as const)],
      ]),
      savePluginState: async () => {},
      internalSessionIds: new Set(),
      reapStaleLocks: () => {},
      client: {
        session: {
          messages: async () => ({ data: [] }),
          create: async () => ({ data: { id: "tmp" } }),
          prompt: async () => ({ data: { parts: [] } }),
          delete: async () => ({}),
          update: async () => ({}),
        },
      },
    });

    await manager.postStopProcessing("session-1", "conv-1", false);

    const summary = entries.find((entry) => entry.cat === "post-stop-sweep-summary");
    expect(summary?.data).toMatchObject({
      conversationId: "conv-1",
      filesChecked: 1,
      rubbed: 0,
      skippedAmbiguous: 1,
    });
  });

  test("logs candidate confidence and ambiguous skips", async () => {
    const entries: Array<{ cat: string; data?: Record<string, unknown> }> = [];
    const status = {
      stacks: [
        {
          assignedChanges: [],
          branches: [
            {
              cliId: "br-1",
              name: "feature/test",
              branchStatus: "pushed",
              commits: [
                {
                  cliId: "c1",
                  commitId: "abc123",
                  message: "feat: test",
                  changes: [{ filePath: "src/a.ts" }],
                },
              ],
            },
          ],
        },
      ],
      unassignedChanges: [],
    };

    const manager = createRewordManager({
      cwd: "/tmp",
      log: makeLogger(entries),
      cli: makeCli((filePath) => {
        if (filePath === "src/a.ts") {
          return {
            inBranch: true,
            branchCliId: "br-1",
            branchName: "feature/test",
            confidence: "high",
          };
        }
        return {
          inBranch: true,
          confidence: "ambiguous",
        };
      }, status),
      config: DEFAULT_CONFIG,
      defaultBranchPattern: new RegExp(DEFAULT_CONFIG.default_branch_pattern),
      addNotification: () => {},
      resolveSessionRoot: (sessionID) => sessionID ?? "root",
      conversationsWithEdits: new Set(["conv-2"]),
      rewordedBranches: new Set(),
      branchOwnership: new Map(),
      editedFilesPerConversation: new Map([
        ["conv-2", new Set(["src/a.ts", "src/b.ts"] as const)],
      ]),
      savePluginState: async () => {},
      internalSessionIds: new Set(),
      reapStaleLocks: () => {},
      client: {
        session: {
          messages: async () => ({
            data: [
              {
                info: { role: "user" },
                parts: [{ type: "text", text: "fix assignment" }],
              },
            ],
          }),
          create: async () => ({ data: { id: "tmp" } }),
          prompt: async () => ({ data: { parts: [] } }),
          delete: async () => ({}),
          update: async () => ({}),
        },
      },
    });

    await manager.postStopProcessing("session-2", "conv-2", false);

    const candidateLog = entries.find(
      (entry) => entry.cat === "post-stop-candidate-confidence",
    );
    expect(candidateLog?.data).toMatchObject({
      conversationId: "conv-2",
      skippedAmbiguous: 1,
    });

    const candidateRows = (candidateLog?.data?.candidates as Array<Record<string, unknown>>) ?? [];
    expect(candidateRows).toContainEqual(
      expect.objectContaining({
        branchCliId: "br-1",
        confidence: "high",
        fileCount: 1,
      }),
    );
  });

  test("updates branch ownership to resolved branch name", async () => {
    const entries: Array<{ cat: string; data?: Record<string, unknown> }> = [];
    const conversationId = "conv-owner";
    const branchOwnership = new Map([
      [
        conversationId,
        {
          rootSessionID: "session-owner",
          branchName: "conversation-12345678",
          firstSeen: 1,
        },
      ],
    ]);

    const status = {
      stacks: [
        {
          assignedChanges: [{ filePath: "src/a.ts" }],
          branches: [
            {
              cliId: "br-owner",
              name: "feature/owner",
              branchStatus: "completelyUnpushed",
              commits: [
                {
                  cliId: "c-owner",
                  commitId: "sha-owner",
                  message: "session changes",
                  changes: [{ filePath: "src/a.ts" }],
                },
              ],
            },
          ],
        },
      ],
      unassignedChanges: [],
    };

    const manager = createRewordManager({
      cwd: "/tmp",
      log: makeLogger(entries),
      cli: {
        ...makeCli(() => ({
          inBranch: true,
          branchCliId: "br-owner",
          branchName: "feature/owner",
          confidence: "high",
        }), status),
        butReword: () => ({ ok: true, stderr: "" }),
      },
      config: DEFAULT_CONFIG,
      defaultBranchPattern: new RegExp(DEFAULT_CONFIG.default_branch_pattern),
      addNotification: () => {},
      resolveSessionRoot: (sessionID) => sessionID ?? "root",
      conversationsWithEdits: new Set([conversationId]),
      rewordedBranches: new Set(),
      branchOwnership,
      editedFilesPerConversation: new Map([
        [conversationId, new Set(["src/a.ts"] as const)],
      ]),
      savePluginState: async () => {},
      internalSessionIds: new Set(),
      reapStaleLocks: () => {},
      client: {
        session: {
          messages: async () => ({
            data: [
              {
                info: { role: "user" },
                parts: [{ type: "text", text: "fix owner mapping" }],
              },
            ],
          }),
          create: async () => ({ data: { id: "tmp" } }),
          prompt: async () => ({ data: { parts: [] } }),
          delete: async () => ({}),
          update: async () => ({}),
        },
      },
    });

    await manager.postStopProcessing("session-owner", conversationId, false);

    expect(branchOwnership.get(conversationId)).toMatchObject({
      rootSessionID: "session-owner",
      branchName: "feature/owner",
      firstSeen: 1,
    });
  });

  test("rewords new commits on same branch across idle cycles", async () => {
    const entries: Array<{ cat: string; data?: Record<string, unknown> }> = [];
    const conversationId = "conv-repeat";
    const rewordedBranches = new Set<string>();
    const commitTargets: string[] = [];

    const status = {
      stacks: [
        {
          assignedChanges: [{ filePath: "src/a.ts" }],
          branches: [
            {
              cliId: "br-repeat",
              name: "feature/repeat",
              branchStatus: "completelyUnpushed",
              commits: [
                {
                  cliId: "c-1",
                  commitId: "sha-1",
                  message: "session changes",
                  changes: [{ filePath: "src/a.ts" }],
                },
              ],
            },
          ],
        },
      ],
      unassignedChanges: [],
    };

    const manager = createRewordManager({
      cwd: "/tmp",
      log: makeLogger(entries),
      cli: {
        ...makeCli(() => ({
          inBranch: true,
          branchCliId: "br-repeat",
          branchName: "feature/repeat",
          confidence: "high",
        }), status),
        butReword: (target) => {
          if (target.startsWith("c-")) {
            commitTargets.push(target);
          }
          return { ok: true, stderr: "" };
        },
      },
      config: DEFAULT_CONFIG,
      defaultBranchPattern: new RegExp(DEFAULT_CONFIG.default_branch_pattern),
      addNotification: () => {},
      resolveSessionRoot: (sessionID) => sessionID ?? "root",
      conversationsWithEdits: new Set([conversationId]),
      rewordedBranches,
      branchOwnership: new Map(),
      editedFilesPerConversation: new Map([
        [conversationId, new Set(["src/a.ts"] as const)],
      ]),
      savePluginState: async () => {},
      internalSessionIds: new Set(),
      reapStaleLocks: () => {},
      client: {
        session: {
          messages: async () => ({
            data: [
              {
                info: { role: "user" },
                parts: [{ type: "text", text: "fix repeat behavior" }],
              },
            ],
          }),
          create: async () => ({ data: { id: "tmp" } }),
          prompt: async () => ({ data: { parts: [] } }),
          delete: async () => ({}),
          update: async () => ({}),
        },
      },
    });

    await manager.postStopProcessing("session-repeat", conversationId, false);

    status.stacks[0]!.branches![0]!.commits = [
      {
        cliId: "c-2",
        commitId: "sha-2",
        message: "session changes",
        changes: [{ filePath: "src/a.ts" }],
      },
    ];

    await manager.postStopProcessing("session-repeat", conversationId, false);

    expect(commitTargets).toEqual(["c-1", "c-2"]);
    expect(rewordedBranches).toContain(
      rewordTrackingKey("br-repeat", "sha-1"),
    );
    expect(rewordedBranches).toContain(
      rewordTrackingKey("br-repeat", "sha-2"),
    );
  });
});
