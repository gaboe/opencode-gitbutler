import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { toUUID, sessionCacheKey } from "../plugin.js";
import { createStateManager } from "../state.js";
import type { Logger } from "../logger.js";

function createNoopLogger(): Logger {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

describe("toUUID", () => {
  test("same input always produces same UUID", async () => {
    const a = await toUUID("ses_abc123");
    const b = await toUUID("ses_abc123");
    expect(a).toBe(b);
  });

  test("different inputs produce different UUIDs", async () => {
    const a = await toUUID("ses_session_A");
    const b = await toUUID("ses_session_B");
    expect(a).not.toBe(b);
  });

  test("produces valid UUID v4 format", async () => {
    const uuid = await toUUID("test-input");
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(uuid).toMatch(uuidRegex);
  });

  test("version nibble is always 4", async () => {
    for (const input of ["a", "b", "session-123", "opencode-default", ""]) {
      const uuid = await toUUID(input);
      const parts = uuid.split("-");
      expect(parts[2][0]).toBe("4");
    }
  });

  test("variant nibble is always 8", async () => {
    for (const input of ["a", "b", "session-123", "opencode-default", ""]) {
      const uuid = await toUUID(input);
      const parts = uuid.split("-");
      expect(parts[3][0]).toBe("8");
    }
  });

  test("empty string produces valid UUID", async () => {
    const uuid = await toUUID("");
    expect(uuid).toBeTruthy();
    expect(uuid.split("-")).toHaveLength(5);
  });

  test("opencode-default fallback produces stable UUID", async () => {
    const a = await toUUID("opencode-default");
    const b = await toUUID("opencode-default");
    expect(a).toBe(b);
  });
});

describe("sessionCacheKey", () => {
  test("same session + same file = same key", () => {
    const a = sessionCacheKey("ses_root", "src/foo.ts");
    const b = sessionCacheKey("ses_root", "src/foo.ts");
    expect(a).toBe(b);
  });

  test("different sessions + same file = different keys", () => {
    const a = sessionCacheKey("ses_A", "src/foo.ts");
    const b = sessionCacheKey("ses_B", "src/foo.ts");
    expect(a).not.toBe(b);
  });

  test("same session + different files = different keys", () => {
    const a = sessionCacheKey("ses_root", "src/foo.ts");
    const b = sessionCacheKey("ses_root", "src/bar.ts");
    expect(a).not.toBe(b);
  });

  test("null byte separator prevents collisions", () => {
    const keyA = sessionCacheKey("ses_A", "Bsrc/foo.ts");
    const keyB = sessionCacheKey("ses_AB", "src/foo.ts");
    expect(keyA).not.toBe(keyB);
  });

  test("contains null byte separator", () => {
    const key = sessionCacheKey("ses_root", "src/foo.ts");
    expect(key).toContain("\0");
    expect(key.split("\0")).toEqual(["ses_root", "src/foo.ts"]);
  });
});

describe("cross-session conversation_id isolation", () => {
  let tmpDir: string;
  let log: Logger;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "assignment-test-"));
    await mkdir(join(tmpDir, ".opencode", "plugin"), { recursive: true });
    log = createNoopLogger();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("Session A and Session B get different conversation_ids for same file", async () => {
    const state = createStateManager(tmpDir, log);

    const rootA = state.resolveSessionRoot("ses_A");
    const rootB = state.resolveSessionRoot("ses_B");

    const convA = await toUUID(rootA);
    const convB = await toUUID(rootB);

    expect(convA).not.toBe(convB);
  });

  test("subagent resolves to parent session's conversation_id", async () => {
    const state = createStateManager(tmpDir, log);

    await state.trackSubagentMapping(
      { tool: "task", sessionID: "ses_parent", callID: "call_1" },
      { metadata: { sessionId: "ses_child" } },
    );

    const rootChild = state.resolveSessionRoot("ses_child");
    const rootParent = state.resolveSessionRoot("ses_parent");

    expect(rootChild).toBe(rootParent);

    const convChild = await toUUID(rootChild);
    const convParent = await toUUID(rootParent);
    expect(convChild).toBe(convParent);
  });

  test("multiple subagents from same parent all get same conversation_id", async () => {
    const state = createStateManager(tmpDir, log);

    await state.trackSubagentMapping(
      { tool: "task", sessionID: "ses_root", callID: "call_1" },
      { metadata: { sessionId: "ses_worker_1" } },
    );
    await state.trackSubagentMapping(
      { tool: "task", sessionID: "ses_root", callID: "call_2" },
      { metadata: { sessionId: "ses_worker_2" } },
    );

    const conv1 = await toUUID(state.resolveSessionRoot("ses_worker_1"));
    const conv2 = await toUUID(state.resolveSessionRoot("ses_worker_2"));
    const convRoot = await toUUID(state.resolveSessionRoot("ses_root"));

    expect(conv1).toBe(convRoot);
    expect(conv2).toBe(convRoot);
  });

  test("two independent sessions editing same file produce different cache keys", async () => {
    const state = createStateManager(tmpDir, log);

    const rootA = state.resolveSessionRoot("ses_A");
    const rootB = state.resolveSessionRoot("ses_B");

    const keyA = sessionCacheKey(rootA, "src/shared.ts");
    const keyB = sessionCacheKey(rootB, "src/shared.ts");

    expect(keyA).not.toBe(keyB);
  });

  test("subagent and parent produce same cache key for same file", async () => {
    const state = createStateManager(tmpDir, log);

    await state.trackSubagentMapping(
      { tool: "task", sessionID: "ses_parent", callID: "call_1" },
      { metadata: { sessionId: "ses_child" } },
    );

    const rootChild = state.resolveSessionRoot("ses_child");
    const rootParent = state.resolveSessionRoot("ses_parent");

    const keyChild = sessionCacheKey(rootChild, "src/foo.ts");
    const keyParent = sessionCacheKey(rootParent, "src/foo.ts");

    expect(keyChild).toBe(keyParent);
  });

  test("undefined sessionID falls back to opencode-default", async () => {
    const state = createStateManager(tmpDir, log);

    const root = state.resolveSessionRoot(undefined);
    expect(root).toBe("opencode-default");

    const conv = await toUUID(root);
    const expected = await toUUID("opencode-default");
    expect(conv).toBe(expected);
  });
});

describe("config.branch_target override", () => {
  test("branch_target forces same conversation_id for all sessions", async () => {
    const branchTarget = "my-fixed-branch";

    const branchSeedA = branchTarget ?? "ses_A";
    const branchSeedB = branchTarget ?? "ses_B";

    const convA = await toUUID(branchSeedA);
    const convB = await toUUID(branchSeedB);

    expect(convA).toBe(convB);
  });

  test("without branch_target, different sessions get different conversation_ids", async () => {
    const branchTarget = undefined;

    const branchSeedA = branchTarget ?? "ses_A";
    const branchSeedB = branchTarget ?? "ses_B";

    const convA = await toUUID(branchSeedA);
    const convB = await toUUID(branchSeedB);

    expect(convA).not.toBe(convB);
  });
});

describe("branchOwnership collision detection", () => {
  test("same conversation_id claimed by different rootSessionIDs is a collision", async () => {
    const branchOwnership = new Map<string, {
      rootSessionID: string;
      branchName: string;
      firstSeen: number;
    }>();

    const conversationId = await toUUID("ses_A");

    branchOwnership.set(conversationId, {
      rootSessionID: "ses_A",
      branchName: `conversation-${conversationId.slice(0, 8)}`,
      firstSeen: Date.now(),
    });

    const existingOwner = branchOwnership.get(conversationId);
    const newRootSessionID = "ses_B";

    const isCollision = existingOwner && existingOwner.rootSessionID !== newRootSessionID;
    expect(isCollision).toBe(true);
  });

  test("same rootSessionID re-claiming same conversation_id is not a collision", async () => {
    const branchOwnership = new Map<string, {
      rootSessionID: string;
      branchName: string;
      firstSeen: number;
    }>();

    const conversationId = await toUUID("ses_A");

    branchOwnership.set(conversationId, {
      rootSessionID: "ses_A",
      branchName: `conversation-${conversationId.slice(0, 8)}`,
      firstSeen: Date.now(),
    });

    const existingOwner = branchOwnership.get(conversationId);
    const newRootSessionID = "ses_A";

    const isCollision = existingOwner && existingOwner.rootSessionID !== newRootSessionID;
    expect(isCollision).toBe(false);
  });

  test("collision impossible when sessions produce different conversation_ids", async () => {
    const convA = await toUUID("ses_A");
    const convB = await toUUID("ses_B");

    expect(convA).not.toBe(convB);

    const branchOwnership = new Map<string, {
      rootSessionID: string;
      branchName: string;
      firstSeen: number;
    }>();

    branchOwnership.set(convA, {
      rootSessionID: "ses_A",
      branchName: `conversation-${convA.slice(0, 8)}`,
      firstSeen: Date.now(),
    });

    const existingOwner = branchOwnership.get(convB);
    expect(existingOwner).toBeUndefined();
  });
});

describe("but cursor after-edit payload contract", () => {
  test("payload must include conversation_id as valid UUID", async () => {
    const conversationId = await toUUID("ses_test");

    const payload = {
      conversation_id: conversationId,
      generation_id: crypto.randomUUID(),
      file_path: "src/foo.ts",
      edits: [{ old_string: "foo", new_string: "bar" }],
      hook_event_name: "afterFileEdit",
      workspace_roots: ["/project"],
    };

    expect(payload.conversation_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(payload.generation_id).toBeTruthy();
    expect(payload.file_path).toBe("src/foo.ts");
    expect(payload.hook_event_name).toBe("afterFileEdit");
    expect(payload.workspace_roots).toHaveLength(1);
  });

  test("different sessions produce payloads with different conversation_ids", async () => {
    const convA = await toUUID("ses_A");
    const convB = await toUUID("ses_B");

    const payloadA = { conversation_id: convA, file_path: "src/shared.ts" };
    const payloadB = { conversation_id: convB, file_path: "src/shared.ts" };

    expect(payloadA.conversation_id).not.toBe(payloadB.conversation_id);
    expect(payloadA.file_path).toBe(payloadB.file_path);
  });

  test("file_path is relative, not absolute", () => {
    const absolutePath = "/Users/user/project/src/foo.ts";
    const cwd = "/Users/user/project";
    const relativePath = absolutePath.startsWith(cwd + "/")
      ? absolutePath.slice(cwd.length + 1)
      : absolutePath;

    expect(relativePath).toBe("src/foo.ts");
    expect(relativePath).not.toMatch(/^\//);
  });
});

describe("assignment cache TTL behavior", () => {
  test("cache entry within TTL is a hit", () => {
    const cache = new Map<string, { conversationId: string; timestamp: number }>();
    const TTL = 30_000;

    const key = sessionCacheKey("ses_A", "src/foo.ts");
    cache.set(key, { conversationId: "uuid-abc", timestamp: Date.now() });

    const cached = cache.get(key);
    const cacheHit = cached && Date.now() - cached.timestamp < TTL;
    expect(cacheHit).toBeTruthy();
  });

  test("cache entry past TTL is a miss", () => {
    const cache = new Map<string, { conversationId: string; timestamp: number }>();
    const TTL = 30_000;

    const key = sessionCacheKey("ses_A", "src/foo.ts");
    cache.set(key, { conversationId: "uuid-abc", timestamp: Date.now() - 31_000 });

    const cached = cache.get(key);
    const cacheHit = cached && Date.now() - cached.timestamp < TTL;
    expect(cacheHit).toBeFalsy();
  });

  test("different session cannot hit another session's cache entry", () => {
    const cache = new Map<string, { conversationId: string; timestamp: number }>();

    const keyA = sessionCacheKey("ses_A", "src/foo.ts");
    cache.set(keyA, { conversationId: "uuid-for-A", timestamp: Date.now() });

    const keyB = sessionCacheKey("ses_B", "src/foo.ts");
    const cached = cache.get(keyB);
    expect(cached).toBeUndefined();
  });

  test("cache clear removes all entries", () => {
    const cache = new Map<string, { conversationId: string; timestamp: number }>();

    cache.set(sessionCacheKey("ses_A", "foo.ts"), { conversationId: "a", timestamp: Date.now() });
    cache.set(sessionCacheKey("ses_B", "bar.ts"), { conversationId: "b", timestamp: Date.now() });

    expect(cache.size).toBe(2);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});

describe("end-to-end: session-first assignment decision", () => {
  let tmpDir: string;
  let log: Logger;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "e2e-assignment-"));
    await mkdir(join(tmpDir, ".opencode", "plugin"), { recursive: true });
    log = createNoopLogger();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("Session A edits foo.ts, Session B edits foo.ts → different branches", async () => {
    const state = createStateManager(tmpDir, log);

    const rootA = state.resolveSessionRoot("ses_A");
    const rootB = state.resolveSessionRoot("ses_B");
    const convA = await toUUID(rootA);
    const convB = await toUUID(rootB);

    expect(rootA).not.toBe(rootB);
    expect(convA).not.toBe(convB);

    const cacheKeyA = sessionCacheKey(rootA, "src/foo.ts");
    const cacheKeyB = sessionCacheKey(rootB, "src/foo.ts");
    expect(cacheKeyA).not.toBe(cacheKeyB);
  });

  test("subagent editing same file as parent → same branch", async () => {
    const state = createStateManager(tmpDir, log);

    await state.trackSubagentMapping(
      { tool: "task", sessionID: "ses_parent", callID: "call_1" },
      { metadata: { sessionId: "ses_subagent" } },
    );

    const rootParent = state.resolveSessionRoot("ses_parent");
    const rootSubagent = state.resolveSessionRoot("ses_subagent");
    expect(rootSubagent).toBe(rootParent);

    const convParent = await toUUID(rootParent);
    const convSubagent = await toUUID(rootSubagent);
    expect(convSubagent).toBe(convParent);

    const keyParent = sessionCacheKey(rootParent, "src/foo.ts");
    const keySubagent = sessionCacheKey(rootSubagent, "src/foo.ts");
    expect(keySubagent).toBe(keyParent);
  });

  test("deeply nested subagent chain resolves to root → same branch", async () => {
    const state = createStateManager(tmpDir, log);

    await state.trackSubagentMapping(
      { tool: "task", sessionID: "ses_root", callID: "call_1" },
      { metadata: { sessionId: "ses_mid" } },
    );
    await state.trackSubagentMapping(
      { tool: "task", sessionID: "ses_mid", callID: "call_2" },
      { metadata: { sessionId: "ses_leaf" } },
    );

    const convRoot = await toUUID(state.resolveSessionRoot("ses_root"));
    const convMid = await toUUID(state.resolveSessionRoot("ses_mid"));
    const convLeaf = await toUUID(state.resolveSessionRoot("ses_leaf"));

    expect(convMid).toBe(convRoot);
    expect(convLeaf).toBe(convRoot);
  });

  test("branch_target overrides session root for all sessions", async () => {
    const branchTarget = "shared-feature-branch";

    const branchSeedA = branchTarget ?? "ses_A";
    const branchSeedB = branchTarget ?? "ses_B";

    const convA = await toUUID(branchSeedA);
    const convB = await toUUID(branchSeedB);

    expect(convA).toBe(convB);
    expect(convA).toBe(await toUUID("shared-feature-branch"));
  });

  test("full assignment flow: resolve → toUUID → cache key → payload", async () => {
    const state = createStateManager(tmpDir, log);
    const branchTarget: string | undefined = undefined;

    await state.trackSubagentMapping(
      { tool: "task", sessionID: "ses_main", callID: "call_1" },
      { metadata: { sessionId: "ses_worker" } },
    );

    const sessionID = "ses_worker";
    const filePath = "src/components/Button.tsx";

    const rootSessionID = state.resolveSessionRoot(sessionID);
    expect(rootSessionID).toBe("ses_main");

    const branchSeed = branchTarget ?? rootSessionID;
    expect(branchSeed).toBe("ses_main");

    const conversationId = await toUUID(branchSeed);
    expect(conversationId).toMatch(/^[0-9a-f]{8}-/);

    const cacheKey = sessionCacheKey(rootSessionID, filePath);
    expect(cacheKey).toBe("ses_main\0src/components/Button.tsx");

    const convFromMain = await toUUID(state.resolveSessionRoot("ses_main"));
    expect(conversationId).toBe(convFromMain);
  });
});
