import type { Plugin } from "@opencode-ai/plugin";
import { createGitButlerPlugin } from "./plugin.js";
import { createAutoUpdateHook } from "./auto-update.js";
import { loadConfig } from "./config.js";

export type { GitButlerPluginConfig } from "./config.js";
export { DEFAULT_CONFIG, loadConfig, stripJsonComments } from "./config.js";

const DUPLICATE_GUARD_KEY = "__opencode_gitbutler_loaded__";
const PACKAGE_VERSION = "0.1.0";

async function loadSkillContent(): Promise<string | null> {
  try {
    const skillPath = new URL("../SKILL.md", import.meta.url);
    const file = Bun.file(skillPath);
    if (!(await file.exists())) return null;
    const content = await file.text();
    return content.trim() || null;
  } catch {
    return null;
  }
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

  const skillContent = await loadSkillContent();
  if (skillContent) {
    hooks.config = async (config) => {
      if (!config.instructions) {
        config.instructions = [];
      }
      config.instructions.push(skillContent);
    };
  }

  return hooks;
};

export default GitButlerPlugin;
export { GitButlerPlugin };
