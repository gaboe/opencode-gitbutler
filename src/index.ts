import type { Plugin } from "@opencode-ai/plugin";
import { createGitButlerPlugin } from "./plugin.js";
import { createAutoUpdateHook } from "./auto-update.js";
import { loadConfig } from "./config.js";



const DUPLICATE_GUARD_KEY = "__opencode_gitbutler_loaded__";
const pkg = await Bun.file(new URL("../package.json", import.meta.url)).json();
const PACKAGE_VERSION: string = pkg.version;

type FrontmatterValue = string | number | boolean;
type CommandDefinition = {
  template: string;
  description?: string;
  agent?: string;
  model?: string;
  subtask?: boolean;
};
type ExtendedConfig = {
  skills?: {
    paths?: string[];
  };
  command?: Record<string, CommandDefinition>;
};

const COMMAND_FILES = ["b-branch", "b-branch-commit", "b-branch-pr", "b-branch-gc"] as const;

function parseFrontmatter(content: string): {
  fields: Record<string, FrontmatterValue>;
  template: string;
} {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return { fields: {}, template: content };
  }

  let frontmatterEnd = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i]?.trim() === "---") {
      frontmatterEnd = i;
      break;
    }
  }

  if (frontmatterEnd === -1) {
    return { fields: {}, template: content };
  }

  const fields: Record<string, FrontmatterValue> = {};
  for (const line of lines.slice(1, frontmatterEnd)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    if (!key) continue;
    if (!key) continue;

    const isQuoted =
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"));

    let parsedValue: FrontmatterValue;
    if (isQuoted) {
      parsedValue = rawValue.slice(1, -1);
    } else if (rawValue === "true" || rawValue === "false") {
      parsedValue = rawValue === "true";
    } else if (/^-?\d+(?:\.\d+)?$/.test(rawValue)) {
      parsedValue = Number(rawValue);
    } else {
      parsedValue = rawValue;
    }

    fields[key] = parsedValue;
  }

  return {
    fields,
    template: lines.slice(frontmatterEnd + 1).join("\n"),
  };
}

async function loadCommands(): Promise<Record<string, CommandDefinition>> {
  const commands: Record<string, CommandDefinition> = {};

  for (const commandName of COMMAND_FILES) {
    try {
      const commandPath = new URL(`../command/${commandName}.md`, import.meta.url);
      const file = Bun.file(commandPath);
      if (!(await file.exists())) {
        continue;
      }

      const source = await file.text();
      const { fields, template } = parseFrontmatter(source);
      const command: CommandDefinition = {
        template,
      };

      if (typeof fields.description === "string") {
        command.description = fields.description;
      }
      if (typeof fields.agent === "string") {
        command.agent = fields.agent;
      }
      if (typeof fields.model === "string") {
        command.model = fields.model;
      }
      if (typeof fields.subtask === "boolean") {
        command.subtask = fields.subtask;
      }

      commands[commandName] = command;
    } catch {
      // Skip unreadable command files — don't break plugin init
      continue;
    }
  }

  return commands;
}

const GitButlerPlugin: Plugin = async (input) => {
  const g = globalThis as Record<string, unknown>;
  if (g[DUPLICATE_GUARD_KEY]) {
    console.warn(
      "[opencode-gitbutler] Plugin already loaded — skipping duplicate registration."
    );
    return {};
  }
  g[DUPLICATE_GUARD_KEY] = true;

  const cwd = input.worktree ?? input.directory;
  const config = await loadConfig(cwd);

  const hooks = await createGitButlerPlugin(config)(input);
  const autoUpdate = createAutoUpdateHook({
    currentVersion: PACKAGE_VERSION,
    auto_update: config.auto_update,
  });
  const skillDir = new URL("../skill", import.meta.url).pathname;
  const commandDefinitions = await loadCommands();

  const originalEvent = hooks.event as
    | ((payload: { event: Record<string, unknown> }) => Promise<void>)
    | undefined;

  hooks.event = async (payload: {
    event: Record<string, unknown> & {
      type?: string;
      properties?: Record<string, unknown>;
    };
  }) => {
    if (originalEvent) {
      await originalEvent(payload);
    }

    if (payload.event?.type === "session.created") {
      const props = payload.event.properties;
      const hasParent =
        typeof props?.parentSessionID === "string" ||
        typeof props?.parent_session_id === "string";
      if (!hasParent) {
        const msg = await autoUpdate.onSessionCreated();
        if (msg) {
          console.warn(`[opencode-gitbutler] ${msg}`);
        }
      }
    }
  };

  const originalConfig = hooks.config;
  hooks.config = async (config) => {
    if (originalConfig) {
      await originalConfig(config);
    }

    const extendedConfig = config as typeof config & ExtendedConfig;

    if (!extendedConfig.skills) extendedConfig.skills = {};
    if (!extendedConfig.skills.paths) extendedConfig.skills.paths = [];
    if (!extendedConfig.skills.paths.includes(skillDir)) {
      extendedConfig.skills.paths.push(skillDir);
    }

    if (!extendedConfig.command) {
      extendedConfig.command = {};
    }

    for (const [name, definition] of Object.entries(commandDefinitions)) {
      extendedConfig.command[name] = definition;
    }
  };

  return hooks;
};

export default GitButlerPlugin;
export { GitButlerPlugin };
