import { appendFile } from "node:fs/promises";

const LOG_PATH_SUFFIX = ".opencode/plugin/debug.log";

export type LogLevel = "info" | "warn" | "error";

export type Logger = {
  info: (cat: string, data?: Record<string, unknown>) => void;
  warn: (cat: string, data?: Record<string, unknown>) => void;
  error: (cat: string, data?: Record<string, unknown>) => void;
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
export function createLogger(logEnabled: boolean, cwd: string): Logger {
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
    appendFile(
      `${cwd}/${LOG_PATH_SUFFIX}`,
      JSON.stringify(entry) + "\n",
    ).catch(() => {});
  }

  return {
    info: (cat, data) => write("info", cat, data ?? {}),
    warn: (cat, data) => write("warn", cat, data ?? {}),
    error: (cat, data) => write("error", cat, data ?? {}),
  };
}
