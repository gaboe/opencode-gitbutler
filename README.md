# opencode-gitbutler

[![npm version](https://img.shields.io/npm/v/opencode-gitbutler)](https://www.npmjs.com/package/opencode-gitbutler)

Stop managing git branches manually and let your AI agents do the heavy lifting with GitButler.

## Why This Plugin?

AI agents generate code at a pace that manual version control can't match. Without automation, you end up with massive commits, messy branch organization, and generic messages that make code review a nightmare.

This plugin bridges the gap by bringing GitButler's virtual branch power directly into your OpenCode agent sessions.

### Comparison Table

| Tool | Auto Branch Creation | LLM Commit Messages | File-to-Branch Assignment | Agent Context Injection | Zero Config |
|------|---------------------|--------------------|--------------------------|-----------------------|-------------|
| **opencode-gitbutler** | Yes | Yes (Claude Haiku) | Yes (`but rub`) | Yes (SKILL.md) | Yes |
| GitButler Native Hooks | No | No | No | No | No (manual hook setup) |
| GitButler MCP Server | No (agent must call tools) | No | No | No | No (MCP config) |
| GitButler Code Agent | Yes (GUI only) | No | Yes (GUI) | No | No (requires Desktop app) |
| oh-my-opencode | No | No | No | No | N/A (different purpose) |
| GitKraken AI | No | Yes | No | No | No (commercial GUI) |
| Manual git workflow | No | No | No | No | N/A |

### What This Plugin Does Differently

- Only tool that combines automatic branch creation, LLM commits, file assignment, and context injection.
- Zero-config setup. Just run `bun add` and add it to your plugins.
- Works with GitButler virtual branches to avoid worktree overhead.
- Impersonates Cursor for full GitButler CLI compatibility.
- Unique multi-agent session mapping.
- Hunk-level rub guard to skip multi-stack files.

## Installation

Install the package from npm:

```bash
bun add opencode-gitbutler
```

Or add it to your plugins array in `.opencode/config.json`:

```json
{
  "plugins": ["opencode-gitbutler"]
}
```

## Prerequisites

- **GitButler CLI** (`but`) — [Install via Homebrew](https://docs.gitbutler.com/installation)
- **OpenCode** — v1.1.0 or later
- **Bun** — v1.0.0 or later (plugin runtime)

The postinstall script checks for the GitButler CLI and warns if missing (install never fails).

## Quick Start

Add to your OpenCode config (`.opencode/config.json`):

```json
{
  "plugins": ["opencode-gitbutler"]
}
```

The plugin automatically:
- Creates and renames branches based on your prompts
- Generates commit messages using Claude Haiku
- Injects workspace state into agent context via `SKILL.md`
- Checks for updates on session creation

## Configuration

Create `.opencode/gitbutler.json` in your workspace root to override defaults:

```json
{
  // Enable debug logging to .opencode/plugin/debug.log
  "log_enabled": true,

  // LLM provider and model for commit message generation
  "commit_message_provider": "anthropic",
  "commit_message_model": "claude-haiku-4-5",

  // Timeout for LLM requests (milliseconds)
  "llm_timeout_ms": 15000,

  // Maximum diff size to send to LLM (characters)
  "max_diff_chars": 4000,

  // Maximum length of auto-generated branch slugs
  "branch_slug_max_length": 50,

  // Enable automatic version update checks
  "auto_update": true,

  // Regex pattern for default branch detection
  "default_branch_pattern": "^ge-branch-\\d+$"
}
```

### Configuration Reference

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `log_enabled` | boolean | `true` | Write debug logs to `.opencode/plugin/debug.log` |
| `commit_message_provider` | string | `"anthropic"` | LLM provider ID |
| `commit_message_model` | string | `"claude-haiku-4-5"` | Model ID for commit generation |
| `llm_timeout_ms` | number | `15000` | Request timeout in milliseconds |
| `max_diff_chars` | number | `4000` | Max diff size sent to LLM |
| `branch_slug_max_length` | number | `50` | Max auto-generated branch name length |
| `auto_update` | boolean | `true` | Check npm for newer versions |
| `default_branch_pattern` | string | `"^ge-branch-\\d+$"` | Regex for default branch detection |

All fields are optional. Missing fields use defaults.

## Feature Parity vs Native Integrations

How this plugin compares to GitButler's built-in Cursor and Claude Code integrations:

| Feature | Cursor | Claude Code | This Plugin | Status |
|---------|--------|-------------|-------------|--------|
| Post-edit hook | `after-edit` | PostToolUse | `tool.execute.after` | Equal |
| Stop/idle hook | `stop` | Stop | `session.idle` | Equal |
| Branch creation | `get_or_create_session` | `get_or_create_session` | via `conversation_id` | Equal |
| Auto-assign to existing branch | — | — | `but rub` via `findFileBranch()` | **Better** |
| Branch auto-rename (LLM) | From Cursor DB | From transcript | `but reword` + user prompt | Equal |
| Auto-commit on stop | `handle_changes()` | `handle_changes()` | via `but cursor stop` | Equal |
| Commit message (LLM) | OpenAI gpt-4-mini | OpenAI gpt-4-mini | Claude Haiku via OpenCode SDK | Equal |
| Multi-agent session mapping | — | — | `resolveSessionRoot()` | **Unique** |
| File locking (concurrent) | — | 60s wait + retry | 60s poll + stale cleanup | Equal |
| Agent state notifications | — | — | `chat.messages.transform` | **Unique** |
| Hunk-level rub guard | — | — | Skip multi-stack files | **Better** |

**Score**: 7 Equal, 4 Better/Unique

For the full architecture breakdown, gap analysis, and known issues, see [`docs/gitbutler-integration.md`](docs/gitbutler-integration.md).

## Troubleshooting

### GitButler CLI not found

**Error:** `⚠ GitButler CLI not found. Install with: brew install gitbutler`

**Solution:** Install GitButler via Homebrew:
```bash
brew install gitbutler
```

The plugin will work without it, but workspace commands will fail at runtime.

### Config file not found

If `.opencode/gitbutler.json` is missing, the plugin uses all defaults. No error is raised.

### Debug logging

Enable `log_enabled: true` in config to write detailed logs to `.opencode/plugin/debug.log`. Useful for diagnosing branch creation, commit message generation, and state injection issues.

### LLM timeout

If commit message generation times out, increase `llm_timeout_ms` in config:
```json
{
  "llm_timeout_ms": 30000
}
```

### Large diffs

If diffs are truncated, increase `max_diff_chars`:
```json
{
  "max_diff_chars": 8000
}
```

## Workspace Guide

See `SKILL.md` bundled with this package for detailed GitButler workspace commands, multi-agent safety rules, and known issues.

## License

MIT
