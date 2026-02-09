import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import { checkForUpdate, createAutoUpdateHook } from "../auto-update.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("checkForUpdate", () => {
  test("returns updateAvailable=true when latest > current", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ latest: "1.2.0" }), { status: 200 })
      )
    ) as typeof fetch;

    const result = await checkForUpdate("1.0.0");
    expect(result).not.toBeNull();
    expect(result!.updateAvailable).toBe(true);
    expect(result!.current).toBe("1.0.0");
    expect(result!.latest).toBe("1.2.0");
  });

  test("returns updateAvailable=false when latest === current", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ latest: "1.0.0" }), { status: 200 })
      )
    ) as typeof fetch;

    const result = await checkForUpdate("1.0.0");
    expect(result).not.toBeNull();
    expect(result!.updateAvailable).toBe(false);
  });

  test("returns updateAvailable=false when current > latest", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ latest: "0.9.0" }), { status: 200 })
      )
    ) as typeof fetch;

    const result = await checkForUpdate("1.0.0");
    expect(result).not.toBeNull();
    expect(result!.updateAvailable).toBe(false);
  });

  test("returns null on fetch error", async () => {
    globalThis.fetch = mock(() =>
      Promise.reject(new Error("network failure"))
    ) as typeof fetch;

    const result = await checkForUpdate("1.0.0");
    expect(result).toBeNull();
  });

  test("returns null on non-ok response", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("Not Found", { status: 404 }))
    ) as typeof fetch;

    const result = await checkForUpdate("1.0.0");
    expect(result).toBeNull();
  });

  test("returns null when latest field is missing from response", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ beta: "2.0.0-beta.1" }), { status: 200 })
      )
    ) as typeof fetch;

    const result = await checkForUpdate("1.0.0");
    expect(result).toBeNull();
  });
});

describe("createAutoUpdateHook", () => {
  test("returns null immediately when auto_update is false", async () => {
    const hook = createAutoUpdateHook({
      currentVersion: "1.0.0",
      auto_update: false,
    });

    const msg = await hook.onSessionCreated();
    expect(msg).toBeNull();
  });

  test("returns update message on first session when update available", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ latest: "2.0.0" }), { status: 200 })
      )
    ) as typeof fetch;

    const hook = createAutoUpdateHook({ currentVersion: "1.0.0" });
    const msg = await hook.onSessionCreated();

    expect(msg).toContain("update available");
    expect(msg).toContain("1.0.0");
    expect(msg).toContain("2.0.0");
  });

  test("returns null on second call (fires only once)", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ latest: "2.0.0" }), { status: 200 })
      )
    ) as typeof fetch;

    const hook = createAutoUpdateHook({ currentVersion: "1.0.0" });
    await hook.onSessionCreated();
    const secondCall = await hook.onSessionCreated();
    expect(secondCall).toBeNull();
  });

  test("returns null when no update available", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ latest: "1.0.0" }), { status: 200 })
      )
    ) as typeof fetch;

    const hook = createAutoUpdateHook({ currentVersion: "1.0.0" });
    const msg = await hook.onSessionCreated();
    expect(msg).toBeNull();
  });

  test("returns null when fetch fails (never throws)", async () => {
    globalThis.fetch = mock(() =>
      Promise.reject(new Error("timeout"))
    ) as typeof fetch;

    const hook = createAutoUpdateHook({ currentVersion: "1.0.0" });
    const msg = await hook.onSessionCreated();
    expect(msg).toBeNull();
  });
});
