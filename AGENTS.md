# AGENTS.md

Instructions for AI coding agents working with this codebase.

<!-- opensrc:start -->

## Source Code Reference

Source code for dependencies is available in `opensrc/` for deeper understanding of implementation details.

See `opensrc/sources.json` for the list of available packages and their versions.

Use this source code when you need to understand how a package works internally, not just its types/interface.

### Fetching Additional Source Code

To fetch source code for a package or repository you need to understand, run:

```bash
npx opensrc <package>           # npm package (e.g., npx opensrc zod)
npx opensrc pypi:<package>      # Python package (e.g., npx opensrc pypi:requests)
npx opensrc crates:<package>    # Rust crate (e.g., npx opensrc crates:serde)
npx opensrc <owner>/<repo>      # GitHub repo (e.g., npx opensrc vercel/ai)
```

<!-- opensrc:end -->

## Available Upstream Sources

These repos are pre-fetched for deeper debugging and implementation reference:

| Source | Path | Purpose |
|--------|------|---------|
| `gitbutlerapp/gitbutler` | `opensrc/repos/github.com/gitbutlerapp/gitbutler/` | GitButler CLI/action crates (`but cursor`, `but rub`, `but reword`, `but-action`) |
| `anomalyco/opencode` | `opensrc/repos/github.com/anomalyco/opencode/` | OpenCode host runtime and plugin SDK internals |

Key GitButler paths for debugging plugin behavior:
- `opensrc/.../gitbutler/crates/but-cursor/src/lib.rs` -- `but cursor after-edit` / `stop` handlers
- `opensrc/.../gitbutler/crates/but-action/src/` -- shared commit, reword, rename logic
- `opensrc/.../gitbutler/crates/but/src/command/` -- CLI command implementations (`rub`, `reword`, `status`)

## Build & Test

Runtime: **Bun** (not Node). All commands use `bun`.

```bash
# Install dependencies
bun install

# Type-check (no emit)
bunx tsc --noEmit

# Build (ESM bundle + declaration files)
bun run build

# Run all tests
bun test

# Run a single test file
bun test src/__tests__/config.test.ts

# Run tests matching a pattern
bun test --grep "stripJsonComments"
```

The build produces `dist/index.js` (ESM) and `dist/index.d.ts` (declarations).

## Project Structure

```
src/
  index.ts          -- Entry point, public exports, command loader, plugin wrapper
  plugin.ts         -- Core plugin: hooks, branch mgmt, reword, cleanup, context injection
  config.ts         -- Config loading from .opencode/gitbutler.json (JSONC)
  auto-update.ts    -- npm registry version check (best-effort, never throws)
  __tests__/        -- bun:test test files
skill/              -- GitButler skill files bundled with the package
command/            -- Slash-command markdown templates (b-branch, b-branch-commit, b-branch-pr)
docs/               -- Architecture docs (gitbutler-integration.md)
```

## Public API (Do Not Break)

These exports from `src/index.ts` are the public surface -- do not rename, remove, or change signatures:

```typescript
export default GitButlerPlugin;          // Plugin function (default export)
export { GitButlerPlugin };              // Named re-export
// Re-exported from config.ts:
export { DEFAULT_CONFIG, loadConfig, stripJsonComments };
export type { GitButlerPluginConfig };
```

## Code Style

### TypeScript
- Target: ES2020, module: ESNext, strict mode enabled
- Module resolution: `bundler` -- use `.js` extensions in imports (`"./config.js"`)
- No `as any`, `@ts-ignore`, or `@ts-expect-error` -- fix the type properly
- Prefer `type` imports for type-only usage (`import type { ... }`)
- Empty catch blocks must have a comment explaining why (e.g., `// best-effort, ignore failure`)

### Formatting
- 2-space indentation
- Double quotes for strings
- Semicolons required
- Trailing commas in multiline constructs

### Naming
- `camelCase` for variables, functions, parameters
- `PascalCase` for types, interfaces, classes
- `UPPER_SNAKE_CASE` for constants and config keys in code
- `snake_case` for config field names in `GitButlerPluginConfig` (matches JSON)
- Prefix private/internal helpers with descriptive verbs: `findFileBranch`, `toRelativePath`, `extractEdits`

### Error Handling
- Functions that call external processes (`Bun.spawnSync`, `Bun.spawn`) must wrap in try/catch
- Return `null` or `false` on failure -- never throw from helper functions
- The plugin must never crash the host. All hooks must be fault-tolerant.
- Log errors via the structured logger (`log.error(category, data)`)
- Use bounded retries with exponential backoff for transient failures (see `butCursor`)

### Logging
- All runtime events go through the structured NDJSON logger (`createLogger`)
- Each log entry is `{ ts, level, cat, ...data }` -- one JSON object per line
- Use standardized category names: `cursor-ok`, `cursor-error`, `rub-ok`, `reword`, `lock-acquired`, etc.
- Never log secrets, tokens, or full file contents

### Testing
- Test framework: `bun:test` (built into Bun)
- Tests live in `src/__tests__/*.test.ts`
- Use `describe`/`test` blocks, `expect` assertions
- Mock external dependencies (e.g., `globalThis.fetch`) in tests, restore in `afterEach`
- Use temp directories (`mkdtemp`) for filesystem tests, clean up in `afterEach`

### Dependencies
- Do not add runtime dependencies beyond `@opencode-ai/plugin`
- `@types/bun` and `typescript` are dev-only
- No version bumps in `package.json` without explicit request

## Architecture Notes

This plugin bridges OpenCode to GitButler by impersonating Cursor via `but cursor` CLI.
See `docs/gitbutler-integration.md` for the full architecture, feature comparison, and known issues.

Key flows:
1. **Edit** -- `tool.execute.after` -> lock check -> `findFileBranch` -> `but cursor after-edit` or `but rub`
2. **Stop** -- `session.idle` event -> `but cursor stop` -> `postStopProcessing` (reword + rename + cleanup)
3. **Context** -- `experimental.chat.messages.transform` -> inject `<system-reminder>` with accumulated notifications
