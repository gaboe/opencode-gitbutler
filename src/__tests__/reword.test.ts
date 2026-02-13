import { describe, test, expect } from "bun:test";
import {
  detectCommitPrefix,
  toCommitMessage,
  toBranchSlug,
  classifyRewordFailure,
  COMMIT_PREFIX_PATTERNS,
} from "../reword.js";

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
