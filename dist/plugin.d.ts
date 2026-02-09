/**
 * OpenCode plugin: GitButler integration via Cursor hook facade.
 *
 * Bridges OpenCode's plugin hooks to GitButler's `but cursor` CLI:
 * - tool.execute.after (edit/write)                  → but cursor after-edit
 * - session.idle                                     → but cursor stop
 * - experimental.chat.messages.transform             → inject pending state notifications
 *
 * This enables automatic branch creation, file-to-branch assignment,
 * and auto-commit when using GitButler workspace mode with OpenCode.
 *
 * Uses Cursor hook format because it has simpler stdin JSON requirements
 * than Claude Code hooks (no transcript_path needed).
 *
 * Multi-agent support: Each OpenCode session gets its own branch via
 * conversation_id isolation in GitButler's session tracking.
 */
import type { Plugin } from "@opencode-ai/plugin";
import type { GitButlerPluginConfig } from "./config.js";
export declare function createGitButlerPlugin(config?: GitButlerPluginConfig): Plugin;
//# sourceMappingURL=plugin.d.ts.map