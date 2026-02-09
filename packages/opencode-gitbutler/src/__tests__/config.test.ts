import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  DEFAULT_CONFIG,
  loadConfig,
  stripJsonComments,
} from "../config.js";

describe("stripJsonComments", () => {
  test("strips single-line comments", () => {
    const input = `{
  // this is a comment
  "key": "value"
}`;
    const result = stripJsonComments(input);
    expect(JSON.parse(result)).toEqual({ key: "value" });
  });

  test("strips block comments", () => {
    const input = `{
  /* block comment */
  "key": "value"
}`;
    const result = stripJsonComments(input);
    expect(JSON.parse(result)).toEqual({ key: "value" });
  });

  test("strips trailing commas", () => {
    const input = `{
  "a": 1,
  "b": 2,
}`;
    const result = stripJsonComments(input);
    expect(JSON.parse(result)).toEqual({ a: 1, b: 2 });
  });

  test("preserves comment-like strings inside quotes", () => {
    const input = `{
  "url": "https://example.com/path",
  "note": "use // for comments"
}`;
    const result = stripJsonComments(input);
    const parsed = JSON.parse(result);
    expect(parsed.url).toBe("https://example.com/path");
    expect(parsed.note).toBe("use // for comments");
  });

  test("handles complex JSONC with all comment types and trailing commas", () => {
    const input = `{
  // line comment
  "a": 1, /* inline block */
  "b": "hello",
  /* multi
     line
     comment */
  "c": true,
}`;
    const result = stripJsonComments(input);
    expect(JSON.parse(result)).toEqual({ a: 1, b: "hello", c: true });
  });
});

describe("loadConfig", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "config-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("returns DEFAULT_CONFIG when config file is missing", async () => {
    const config = await loadConfig(tempDir);
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  test("merges partial config with defaults", async () => {
    const configDir = join(tempDir, ".opencode");
    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, "gitbutler.json"),
      JSON.stringify({ log_enabled: false, llm_timeout_ms: 30000 })
    );

    const config = await loadConfig(tempDir);
    expect(config.log_enabled).toBe(false);
    expect(config.llm_timeout_ms).toBe(30000);
    expect(config.commit_message_model).toBe(DEFAULT_CONFIG.commit_message_model);
    expect(config.auto_update).toBe(DEFAULT_CONFIG.auto_update);
    expect(config.max_diff_chars).toBe(DEFAULT_CONFIG.max_diff_chars);
    expect(config.branch_slug_max_length).toBe(DEFAULT_CONFIG.branch_slug_max_length);
  });

  test("parses JSONC config with comments and trailing commas", async () => {
    const configDir = join(tempDir, ".opencode");
    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, "gitbutler.json"),
      `{
  // Override model
  "commit_message_model": "gpt-4o",
  "max_diff_chars": 8000,
}`
    );

    const config = await loadConfig(tempDir);
    expect(config.commit_message_model).toBe("gpt-4o");
    expect(config.max_diff_chars).toBe(8000);
    expect(config.log_enabled).toBe(DEFAULT_CONFIG.log_enabled);
  });

  test("falls back to defaults on malformed JSON", async () => {
    const configDir = join(tempDir, ".opencode");
    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, "gitbutler.json"),
      "{ this is not valid json at all }"
    );

    const config = await loadConfig(tempDir);
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  test("ignores config fields with wrong types and uses defaults for them", async () => {
    const configDir = join(tempDir, ".opencode");
    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, "gitbutler.json"),
      JSON.stringify({
        log_enabled: "yes",
        llm_timeout_ms: "fast",
        commit_message_model: 123,
        auto_update: true,
      })
    );

    const config = await loadConfig(tempDir);
    expect(config.log_enabled).toBe(DEFAULT_CONFIG.log_enabled);
    expect(config.llm_timeout_ms).toBe(DEFAULT_CONFIG.llm_timeout_ms);
    expect(config.commit_message_model).toBe(DEFAULT_CONFIG.commit_message_model);
    expect(config.auto_update).toBe(true);
  });

  test("returns a fresh copy (not a reference to DEFAULT_CONFIG) when file missing", async () => {
    const config1 = await loadConfig(tempDir);
    const config2 = await loadConfig(tempDir);
    expect(config1).toEqual(config2);
    expect(config1).not.toBe(config2);
  });
});
