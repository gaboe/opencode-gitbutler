import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "../logger.js";

describe("createLogger", () => {
  let tempDir: string;
  const originalWarn = console.warn;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "logger-test-"));
  });

  afterEach(async () => {
    console.warn = originalWarn;
    await rm(tempDir, { recursive: true, force: true });
  });

  test("creates log directory and writes NDJSON entries", async () => {
    const logger = createLogger(true, tempDir);

    logger.info("cursor-ok", { conversationId: "conv-1" });
    await logger.flush?.();

    const logPath = join(tempDir, ".opencode", "plugin", "debug.log");
    const content = await readFile(logPath, "utf8");
    const lines = content.trim().split("\n");

    expect(lines).toHaveLength(1);

    const entry = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(entry.level).toBe("info");
    expect(entry.cat).toBe("cursor-ok");
    expect(entry.conversationId).toBe("conv-1");
    expect(typeof entry.ts).toBe("string");
  });

  test("does not write logs when disabled", async () => {
    const logger = createLogger(false, tempDir);

    logger.error("cursor-error", { reason: "disabled" });
    await logger.flush?.();

    const logFile = Bun.file(join(tempDir, ".opencode", "plugin", "debug.log"));
    expect(await logFile.exists()).toBe(false);
  });

  test("rotates oversized log file and keeps latest entry in debug.log", async () => {
    const logDir = join(tempDir, ".opencode", "plugin");
    const logPath = join(logDir, "debug.log");
    await mkdir(logDir, { recursive: true });
    await writeFile(logPath, "x".repeat(256));

    const logger = createLogger(true, tempDir, {
      maxFileBytes: 64,
    });

    logger.info("after-edit", { file: "src/a.ts" });
    await logger.flush?.();

    const rotatedContent = await readFile(`${logPath}.1`, "utf8");
    expect(rotatedContent).toHaveLength(256);

    const newContent = await readFile(logPath, "utf8");
    const entry = JSON.parse(newContent.trim()) as Record<string, unknown>;
    expect(entry.cat).toBe("after-edit");
  });

  test("warns once when log directory cannot be created", async () => {
    await writeFile(join(tempDir, ".opencode"), "not-a-directory");
    const warnMock = mock((..._args: unknown[]) => {});
    console.warn = warnMock as typeof console.warn;

    const logger = createLogger(true, tempDir);
    logger.info("one");
    logger.info("two");
    await logger.flush?.();

    expect(warnMock).toHaveBeenCalledTimes(1);
    const [firstCall] = warnMock.mock.calls;
    const firstWarn = firstCall?.[0];
    expect(String(firstWarn)).toContain("failed to create log directory");
  });

  test("warns once when append fails", async () => {
    const logDir = join(tempDir, ".opencode", "plugin");
    await mkdir(join(logDir, "debug.log"), { recursive: true });
    const warnMock = mock((..._args: unknown[]) => {});
    console.warn = warnMock as typeof console.warn;

    const logger = createLogger(true, tempDir, {
      maxFileBytes: 0,
    });
    logger.info("one");
    logger.info("two");
    await logger.flush?.();

    expect(warnMock).toHaveBeenCalledTimes(1);
    const [firstCall] = warnMock.mock.calls;
    const firstWarn = firstCall?.[0];
    expect(String(firstWarn)).toContain("failed to append");
  });
});
