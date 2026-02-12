import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createStateManager } from "../state.js";
import type { Logger } from "../logger.js";

function createNoopLogger(): Logger {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

describe("createStateManager", () => {
  let tmpDir: string;
  let log: Logger;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "state-test-"));
    await mkdir(join(tmpDir, ".opencode", "plugin"), { recursive: true });
    log = createNoopLogger();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("resolveSessionRoot", () => {
    test("returns opencode-default for undefined", () => {
      const state = createStateManager(tmpDir, log);
      expect(state.resolveSessionRoot(undefined)).toBe("opencode-default");
    });

    test("returns session itself when no parent mapping exists", () => {
      const state = createStateManager(tmpDir, log);
      expect(state.resolveSessionRoot("ses_abc123")).toBe("ses_abc123");
    });

    test("walks single parent link", () => {
      const state = createStateManager(tmpDir, log);
      state.parentSessionByTaskSession.set("ses_child", "ses_parent");
      expect(state.resolveSessionRoot("ses_child")).toBe("ses_parent");
    });

    test("walks multi-level parent chain", () => {
      const state = createStateManager(tmpDir, log);
      state.parentSessionByTaskSession.set("ses_grandchild", "ses_child");
      state.parentSessionByTaskSession.set("ses_child", "ses_root");
      expect(state.resolveSessionRoot("ses_grandchild")).toBe("ses_root");
    });

    test("handles circular references", () => {
      const state = createStateManager(tmpDir, log);
      state.parentSessionByTaskSession.set("ses_a", "ses_b");
      state.parentSessionByTaskSession.set("ses_b", "ses_a");
      const result = state.resolveSessionRoot("ses_a");
      expect(["ses_a", "ses_b"]).toContain(result);
    });
  });

  describe("trackSubagentMapping", () => {
    test("maps callID to parent session", async () => {
      const state = createStateManager(tmpDir, log);
      await state.trackSubagentMapping(
        { tool: "task", sessionID: "ses_parent", callID: "call_abc" },
      );
      expect(state.parentSessionByTaskSession.get("call_abc")).toBe("ses_parent");
    });

    test("maps execution sessionId from output metadata", async () => {
      const state = createStateManager(tmpDir, log);
      await state.trackSubagentMapping(
        { tool: "task", sessionID: "ses_parent", callID: "call_abc" },
        { metadata: { sessionId: "ses_execution" } },
      );
      expect(state.parentSessionByTaskSession.get("call_abc")).toBe("ses_parent");
      expect(state.parentSessionByTaskSession.get("ses_execution")).toBe("ses_parent");
    });

    test("resolves execution session to root through parent chain", async () => {
      const state = createStateManager(tmpDir, log);
      await state.trackSubagentMapping(
        { tool: "task", sessionID: "ses_parent", callID: "call_abc" },
        { metadata: { sessionId: "ses_execution" } },
      );
      expect(state.resolveSessionRoot("ses_execution")).toBe("ses_parent");
    });

    test("skips non-subagent tools", async () => {
      const state = createStateManager(tmpDir, log);
      await state.trackSubagentMapping(
        { tool: "edit", sessionID: "ses_parent", callID: "call_abc" },
        { metadata: { sessionId: "ses_execution" } },
      );
      expect(state.parentSessionByTaskSession.size).toBe(0);
    });

    test("handles metadata with session_id (snake_case)", async () => {
      const state = createStateManager(tmpDir, log);
      await state.trackSubagentMapping(
        { tool: "task", sessionID: "ses_parent", callID: "call_abc" },
        { metadata: { session_id: "ses_execution" } },
      );
      expect(state.parentSessionByTaskSession.get("ses_execution")).toBe("ses_parent");
    });

    test("skips when execution session equals parent", async () => {
      const state = createStateManager(tmpDir, log);
      await state.trackSubagentMapping(
        { tool: "task", sessionID: "ses_parent", callID: "call_abc" },
        { metadata: { sessionId: "ses_parent" } },
      );
      expect(state.parentSessionByTaskSession.has("ses_parent")).toBe(false);
      expect(state.parentSessionByTaskSession.get("call_abc")).toBe("ses_parent");
    });

    test("handles output without metadata", async () => {
      const state = createStateManager(tmpDir, log);
      await state.trackSubagentMapping(
        { tool: "task", sessionID: "ses_parent", callID: "call_abc" },
        { title: "some task" },
      );
      expect(state.parentSessionByTaskSession.get("call_abc")).toBe("ses_parent");
      expect(state.parentSessionByTaskSession.size).toBe(1);
    });
  });

  describe("trackSessionCreatedMapping", () => {
    test("maps session from OpenCode SDK shape (info.id, info.parentID)", async () => {
      const state = createStateManager(tmpDir, log);
      await state.trackSessionCreatedMapping({
        type: "session.created",
        properties: {
          info: { id: "ses_child", parentID: "ses_parent" },
        },
      });
      expect(state.parentSessionByTaskSession.get("ses_child")).toBe("ses_parent");
    });

    test("resolves session created via event to root", async () => {
      const state = createStateManager(tmpDir, log);
      await state.trackSessionCreatedMapping({
        type: "session.created",
        properties: {
          info: { id: "ses_child", parentID: "ses_parent" },
        },
      });
      expect(state.resolveSessionRoot("ses_child")).toBe("ses_parent");
    });

    test("skips root sessions (no parentID)", async () => {
      const state = createStateManager(tmpDir, log);
      await state.trackSessionCreatedMapping({
        type: "session.created",
        properties: {
          info: { id: "ses_root" },
        },
      });
      expect(state.parentSessionByTaskSession.size).toBe(0);
    });

    test("falls back to legacy field names", async () => {
      const state = createStateManager(tmpDir, log);
      await state.trackSessionCreatedMapping({
        type: "session.created",
        properties: {
          id: "ses_child",
          parentSessionID: "ses_parent",
        },
      });
      expect(state.parentSessionByTaskSession.get("ses_child")).toBe("ses_parent");
    });

    test("prefers info fields over legacy fields", async () => {
      const state = createStateManager(tmpDir, log);
      await state.trackSessionCreatedMapping({
        type: "session.created",
        properties: {
          id: "ses_legacy",
          parentSessionID: "ses_legacy_parent",
          info: { id: "ses_correct", parentID: "ses_correct_parent" },
        },
      });
      expect(state.parentSessionByTaskSession.get("ses_correct")).toBe("ses_correct_parent");
      expect(state.parentSessionByTaskSession.has("ses_legacy")).toBe(false);
    });

    test("ignores non-session.created events", async () => {
      const state = createStateManager(tmpDir, log);
      await state.trackSessionCreatedMapping({
        type: "session.updated",
        properties: {
          info: { id: "ses_child", parentID: "ses_parent" },
        },
      });
      expect(state.parentSessionByTaskSession.size).toBe(0);
    });
  });

  describe("end-to-end: subagent branch resolution", () => {
    test("execution session resolves to root through both mapping paths", async () => {
      const state = createStateManager(tmpDir, log);

      // Path 1: session.created event maps child → parent
      await state.trackSessionCreatedMapping({
        type: "session.created",
        properties: {
          info: { id: "ses_execution", parentID: "ses_root" },
        },
      });

      // All edits from ses_execution should resolve to ses_root
      expect(state.resolveSessionRoot("ses_execution")).toBe("ses_root");
    });

    test("execution session resolves via task metadata path", async () => {
      const state = createStateManager(tmpDir, log);

      // Path 2: task tool output contains execution sessionId
      await state.trackSubagentMapping(
        { tool: "task", sessionID: "ses_root", callID: "call_xyz" },
        { metadata: { sessionId: "ses_execution" } },
      );

      expect(state.resolveSessionRoot("ses_execution")).toBe("ses_root");
    });

    test("multiple subagents from same parent all resolve to same root", async () => {
      const state = createStateManager(tmpDir, log);

      // Simulate 3 parallel subagent tasks from same parent
      await state.trackSubagentMapping(
        { tool: "task", sessionID: "ses_root", callID: "call_1" },
        { metadata: { sessionId: "ses_worker_1" } },
      );
      await state.trackSubagentMapping(
        { tool: "task", sessionID: "ses_root", callID: "call_2" },
        { metadata: { sessionId: "ses_worker_2" } },
      );
      await state.trackSubagentMapping(
        { tool: "task", sessionID: "ses_root", callID: "call_3" },
        { metadata: { sessionId: "ses_worker_3" } },
      );

      expect(state.resolveSessionRoot("ses_worker_1")).toBe("ses_root");
      expect(state.resolveSessionRoot("ses_worker_2")).toBe("ses_root");
      expect(state.resolveSessionRoot("ses_worker_3")).toBe("ses_root");
    });
  });
});
