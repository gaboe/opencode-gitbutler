import {
  appendFile,
  mkdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { dirname } from "node:path";

const LOG_PATH_SUFFIX = ".opencode/plugin/debug.log";
const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024;

export type LogLevel = "info" | "warn" | "error";

export type LoggerOptions = {
  maxFileBytes?: number;
};

export type Logger = {
  info: (cat: string, data?: Record<string, unknown>) => void;
  warn: (cat: string, data?: Record<string, unknown>) => void;
  error: (cat: string, data?: Record<string, unknown>) => void;
  flush?: () => Promise<void>;
};

/**
 * Structured NDJSON logger with explicit levels.
 *
 * Each line is a self-contained JSON object:
 *   {"ts":"...","level":"info","cat":"cursor-ok","subcommand":"after-edit",...}
 *
 * Reserved keys: ts, level, cat. All data fields are spread at top level.
 * Parseable with: jq, grep, or any NDJSON-aware tool.
 * Filter examples:
 *   jq 'select(.level == "error")'
 *   jq 'select(.cat == "cursor-ok")'
 *   grep '"cat":"llm-' debug.log | jq .
 */
export function createLogger(
  logEnabled: boolean,
  cwd: string,
  options: LoggerOptions = {},
): Logger {
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const logPath = `${cwd}/${LOG_PATH_SUFFIX}`;
  const logDir = dirname(logPath);
  const rotatedPath = `${logPath}.1`;
  const warned = new Set<string>();
  let writeQueue: Promise<void> = Promise.resolve();

  function toErrorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
  }

  function warnOnce(key: string, message: string, err?: unknown): void {
    if (warned.has(key)) return;
    warned.add(key);
    const suffix = err ? `: ${toErrorMessage(err)}` : "";
    console.warn(`[opencode-gitbutler] ${message}${suffix}`);
  }

  function getErrCode(err: unknown): string | undefined {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      typeof (err as { code?: unknown }).code === "string"
    ) {
      return (err as { code: string }).code;
    }
    return undefined;
  }

  async function ensureLogDirectory(): Promise<boolean> {
    try {
      await mkdir(logDir, { recursive: true });
      return true;
    } catch (err) {
      warnOnce(
        "mkdir",
        `Logger failed to create log directory at ${logDir}`,
        err,
      );
      return false;
    }
  }

  async function rotateIfNeeded(): Promise<void> {
    if (maxFileBytes <= 0) return;

    let fileSize = 0;
    try {
      const fileInfo = await stat(logPath);
      fileSize = fileInfo.size;
    } catch (err) {
      if (getErrCode(err) === "ENOENT") return;
      warnOnce(
        "rotate-stat",
        `Logger failed to read log file size at ${logPath}`,
        err,
      );
      return;
    }

    if (fileSize < maxFileBytes) return;

    try {
      await rm(rotatedPath, { force: true });
      await rename(logPath, rotatedPath);
    } catch (err) {
      if (getErrCode(err) === "ENOENT") return;
      warnOnce(
        "rotate",
        `Logger failed to rotate log file at ${logPath}`,
        err,
      );
    }
  }

  function enqueue(line: string): void {
    writeQueue = writeQueue
      .then(async () => {
        const ready = await ensureLogDirectory();
        if (!ready) return;

        await rotateIfNeeded();

        try {
          await appendFile(logPath, line);
        } catch (err) {
          warnOnce(
            "write",
            `Logger failed to append to ${logPath}`,
            err,
          );
        }
      })
      .catch((err) => {
        warnOnce("pipeline", "Logger pipeline failure", err);
      });
  }

  function write(
    level: LogLevel,
    cat: string,
    data: Record<string, unknown> = {},
  ): void {
    if (!logEnabled) return;
    const entry = {
      ts: new Date().toISOString(),
      level,
      cat,
      ...data,
    };
    enqueue(JSON.stringify(entry) + "\n");
  }

  return {
    info: (cat, data) => write("info", cat, data ?? {}),
    warn: (cat, data) => write("warn", cat, data ?? {}),
    error: (cat, data) => write("error", cat, data ?? {}),
    flush: () => writeQueue,
  };
}
