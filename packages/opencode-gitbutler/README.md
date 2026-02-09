# opencode-gitbutler

OpenCode plugin for seamless GitButler integration. Automatically manages branches, generates commit messages via LLM, and provides real-time workspace state notifications.

## Installation

```bash
bun add opencode-gitbutler
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
