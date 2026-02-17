#!/usr/bin/env bun

import { Command } from "@effect/cli";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Effect } from "effect";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config.js";

type Pkg = { version?: string };

function resolveVersion(): string {
  try {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf-8");
    const pkg = JSON.parse(raw) as Pkg;
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const configCommand = Command.make("config", {}, () =>
  Effect.tryPromise({
    try: async () => {
      const cwd = process.cwd();
      const cfg = await loadConfig(cwd);
      const configPath = join(cwd, ".opencode", "gitbutler.json");

      console.log("\n[opencode-gitbutler] Config\n");
      console.log(`Path: ${configPath}`);
      console.log(`log_enabled: ${cfg.log_enabled}`);
      console.log(
        `commit_message: ${cfg.commit_message_provider}/${cfg.commit_message_model}`
      );
      console.log(`auto_update: ${cfg.auto_update}`);
      console.log("");
    },
    catch: (err: unknown) =>
      err instanceof Error ? err : new Error(String(err)),
  })
).pipe(Command.withDescription("Show resolved GitButler plugin config for cwd"));

const doctorCommand = Command.make("doctor", {}, () =>
  Effect.sync(() => {
    const probe = spawnSync("gitbutler", ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf-8",
    });

    if (probe.status === 0) {
      const version = (probe.stdout || "").trim() || "unknown";
      console.log(`[opencode-gitbutler] gitbutler detected: ${version}`);
      return;
    }

    console.log("[opencode-gitbutler] gitbutler CLI not found in PATH");
    console.log("Install with: brew install gitbutler");
    process.exitCode = 1;
  })
).pipe(Command.withDescription("Check whether gitbutler CLI is available"));

const root = Command.make("opencode-gitbutler", {}).pipe(
  Command.withDescription("Utility CLI for opencode-gitbutler"),
  Command.withSubcommands([configCommand, doctorCommand])
);

const cli = Command.run(root, {
  name: "opencode-gitbutler",
  version: resolveVersion(),
});

cli(process.argv).pipe(Effect.provide(NodeContext.layer), NodeRuntime.runMain);
