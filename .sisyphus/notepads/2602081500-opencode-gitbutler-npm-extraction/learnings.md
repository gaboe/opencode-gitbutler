# Learnings - OpenCode GitButler NPM Extraction

## Task 1: Scaffold Package Structure - COMPLETED

### Key Findings

1. **Plugin Type is a Function**: The `@opencode-ai/plugin` exports `Plugin` as a function type `(input: PluginInput) => Promise<Hooks>`, not an object. Initial implementation attempted object literal which failed TypeScript checks.

2. **Module Resolution**: tsconfig.json required `moduleResolution: "bundler"` instead of `"node"` to properly resolve the `@opencode-ai/plugin` package types.

3. **Postinstall Script Required**: The package.json postinstall script must exist before `bun install` runs. Created minimal postinstall.mjs that checks for GitButler CLI with warn-only behavior.

4. **Build Pipeline Works**: Bun build + TypeScript declaration generation works cleanly:
   - `bun build` bundles to ESM format
   - `tsc --emitDeclarationOnly` generates .d.ts files
   - Both dist/index.js and dist/index.d.ts generated successfully

### Scaffold Structure Created

```
packages/opencode-gitbutler/
├── package.json (name: opencode-gitbutler, version: 0.1.0)
├── tsconfig.json (ES2020, bundler resolution)
├── postinstall.mjs (GitButler CLI check)
├── src/
│   ├── index.ts (Plugin function placeholder)
│   └── __tests__/ (empty, ready for tests)
└── dist/ (generated)
    ├── index.js
    ├── index.d.ts
    └── index.d.ts.map
```

### Dependencies

- `@opencode-ai/plugin: ^1.1.0` (dependency + peerDependency)
- `typescript: ^5.3.0` (devDependency)

### Verification Status

✓ Directory structure created
✓ package.json with correct metadata
✓ tsconfig.json with proper settings
✓ src/index.ts compiles without errors
✓ bun install succeeds (exit 0)
✓ bun run build succeeds
✓ dist files generated (index.js, index.d.ts)
✓ No TypeScript diagnostics

## Task 2: Plugin Extraction + Duplicate Guard - COMPLETED

### Key Findings

1. **Bun Types Required**: The source plugin uses `Bun.file()`, `Bun.write()`, `Bun.spawn()`, `Bun.spawnSync()`, `Bun.sleep()` extensively. TypeScript declaration generation (`tsc --emitDeclarationOnly`) fails without `@types/bun` devDependency since `lib: ["ES2020"]` doesn't include Bun globals, node:path/fs types, or web APIs (crypto, Blob, Response, TextEncoder, setTimeout, console).

2. **Bundler Resolves Imports**: `bun build src/index.ts` with a single entry point automatically bundles `./plugin.js` import — no need for multiple entry points. Output is a single 26KB `dist/index.js`.

3. **Duplicate Guard Pattern**: Uses `globalThis` with a string key `__opencode_gitbutler_loaded__` to prevent double registration. Returns empty hooks object `{}` on duplicate load, which is compatible with the `Hooks` return type.

4. **Export Naming**: Source exported `GitButlerPlugin` directly. Extraction splits into:
   - `src/plugin.ts`: exports `createGitButlerPlugin` (the factory)
   - `src/index.ts`: exports `GitButlerPlugin` (with guard wrapping) as default + named

### Files Modified
- `src/plugin.ts` (new): 1:1 extraction from source, export renamed to `createGitButlerPlugin`
- `src/index.ts` (modified): duplicate guard + re-export as `GitButlerPlugin`
- `package.json` (modified via bun add): added `@types/bun` devDependency

## Task 3: Verify Build System and Output Artifacts - COMPLETED

### Key Findings

1. **Build Pipeline Verified**: `bun run build` executes successfully with no errors:
   - `bun build src/index.ts --outdir dist --target bun --format esm` bundles to 26.0 KB
   - `tsc --emitDeclarationOnly` generates type declarations
   - Total execution time: ~4ms

2. **Dist Artifacts Generated**:
   - `dist/index.js` (26 KB, 750 lines): Bundled ESM module with full plugin implementation
   - `dist/index.d.ts` (185 bytes): Type declaration file with Plugin type reference
   - `dist/index.d.ts.map` (238 bytes): Source map for declarations
   - `dist/plugin.d.ts` (941 bytes): Plugin factory type declarations
   - `dist/plugin.d.ts.map` (220 bytes): Plugin source map

3. **Type References Correct**: `dist/index.d.ts` properly imports and exports Plugin type:
   ```typescript
   import type { Plugin } from "@opencode-ai/plugin";
   declare const GitButlerPlugin: Plugin;
   export default GitButlerPlugin;
   export { GitButlerPlugin };
   ```

4. **No TypeScript Diagnostics**: LSP diagnostics clean on both `src/index.ts` and `src/plugin.ts`

### Verification Status

✓ `bun run build` succeeds (exit 0)
✓ `dist/index.js` exists and is non-empty (26 KB)
✓ `dist/index.d.ts` exists and references Plugin type
✓ All dist artifacts generated correctly
✓ No TypeScript errors or warnings
✓ Build is reproducible and consistent

## Task 4: Add postinstall.mjs CLI Check - COMPLETED

### Key Findings

1. **Postinstall Already Exists**: Task 1 created a minimal postinstall.mjs that already satisfies Task 4 requirements. No modifications needed.

2. **Warn-Only Behavior Verified**: 
   - When GitButler CLI (`but`) is found: prints "✓ GitButler CLI found" and exits 0
   - When GitButler CLI is missing: prints warning "⚠ GitButler CLI not found. Install with: brew install gitbutler" and exits 0
   - Script never calls `process.exit(1)` — install always succeeds

3. **Implementation Details**:
   - Uses `child_process.execSync("but --version", { stdio: "pipe" })` to check CLI
   - Catches exception silently on missing CLI
   - Provides clear installation guidance in warning message
   - Script is idempotent and safe for repeated runs

### Verification Status

✓ File exists: `packages/opencode-gitbutler/postinstall.mjs`
✓ Behavior: CLI found → success message, exit 0
✓ Behavior: CLI missing → warning only, exit 0
✓ No `process.exit(1)` calls
✓ `node postinstall.mjs` exits 0 in both scenarios
✓ Uses Node-compatible APIs
✓ Clear install guidance provided
✓ Script is idempotent and non-fatal

### No Changes Required

The postinstall.mjs created in Task 1 fully satisfies Task 4 requirements. Task 4 is complete.

## Task 6: Auto-Update Check Module - COMPLETED

### Key Findings

1. **No semver dependency needed**: Custom `parseVersion`/`compareVersions` handles major.minor.patch + prerelease comparison. Prerelease sorting is lexicographic (sufficient for our use case).

2. **Eager check, lazy delivery**: `createAutoUpdateHook` starts the npm fetch immediately at plugin init (non-blocking Promise). The `onSessionCreated()` callback awaits the result only on first root session creation, so the network latency is hidden behind user's initial interaction.

3. **Wiring via event handler composition**: Instead of modifying `plugin.ts` (which Task 5 may also touch), the auto-update is wired in `index.ts` by wrapping the `event` hook returned from `createGitButlerPlugin`. This is merge-friendly — only `index.ts` gains a few lines.

4. **Notification via console.warn**: Since `addNotification` is internal to plugin.ts and the auto-update lives in index.ts, the update message goes through `console.warn` (stderr). This is visible to the user without injecting into the chat message flow.

5. **PACKAGE_VERSION constant**: The current version (`0.1.0`) is a constant in index.ts. Future tasks should consider reading it from package.json at build time or via import assertion. Keeping it simple for now per "local/simple" constraint.

### Files Created/Modified
- `src/auto-update.ts` (new): `checkForUpdate()`, `createAutoUpdateHook()`, types
- `src/index.ts` (modified): imports auto-update, wraps event handler for session.created

### Verification Status

✓ `src/auto-update.ts` created with exported `checkForUpdate` and `createAutoUpdateHook`
✓ Queries npm dist-tags endpoint for opencode-gitbutler
✓ Returns null on fetch failures (never throws)
✓ Respects `config.auto_update === false`
✓ Notification format: "update available: current → latest. Run `bun add ...` to update."
✓ Wired into `src/index.ts` via event handler composition
✓ `bun run build` passes (29.16 KB bundle)
✓ LSP diagnostics clean on both files
✓ Non-blocking: auto-update errors never break plugin init

## Task 7: Bundled SKILL.md + Config Hook Injection - COMPLETED

### Key Findings

1. **Config hook mutates input**: The `Hooks.config` signature is `(input: Config) => Promise<void>` — it mutates the Config object in-place. `Config.instructions` is `Array<string>` which gets instruction content injected into the agent's system context.

2. **`new URL("../SKILL.md", import.meta.url)` resolution**: Bun's bundler preserves `import.meta.url` in the output (`dist/index.js`), so `../SKILL.md` correctly resolves relative to the dist directory back to the package root where SKILL.md lives. This works both in development (src/) and after bundling (dist/).

3. **SKILL.md content is standalone**: Stripped all references to `references/` subdirectories, `but skill install`, and Claude-specific paths from the source SKILL.md. The packaged version covers: session workflow, critical rules, essential commands, multi-agent safety, known issues — everything a user needs without external dependencies.

4. **package.json files already included SKILL.md**: Task 2 or a prior task already added `"SKILL.md"` to the `files` array. No modification needed.

5. **Graceful fallback**: `loadSkillContent()` returns `null` on any failure (file missing, read error, empty content). The config hook is only registered when content is available — no empty instructions injected.

6. **Merge-friendly with Task 5/6**: Added the config hook after the auto-update wiring in index.ts. Both additions are independent blocks that compose cleanly.

7. **Pre-existing plugin.ts issues**: `debugLog` at module scope references `config` from `createGitButlerPlugin` scope — TS reports `Cannot find name 'config'`. This was introduced by Task 5's config extraction refactor. Build succeeds because Bun's bundler doesn't enforce TS semantics (only `tsc --noEmit` catches it). Not blocking Task 7.

### Files Created/Modified
- `SKILL.md` (new): 85-line standalone GitButler workspace guide
- `src/index.ts` (modified): added `loadSkillContent()` function + config hook registration

### Verification Status

✓ `SKILL.md` created with standalone GitButler guidance
✓ `package.json` files array includes SKILL.md
✓ `src/index.ts` reads SKILL.md via `new URL("../SKILL.md", import.meta.url)`
✓ Config hook pushes content to `config.instructions` array
✓ Graceful fallback: returns `{}` (no config hook) if SKILL.md missing/empty
✓ `bun run build` passes (34.44 KB bundle)
✓ LSP diagnostics clean on `src/index.ts`
✓ SKILL.md content present in bundled `dist/index.js`

## Task 5: Add Config Module - COMPLETED

### Key Findings

1. **Factory Pattern Required**: `createGitButlerPlugin` changed from `Plugin` type to `(config) => Plugin` factory. Config loaded in `index.ts` with `cwd`, then `createGitButlerPlugin(config)(input)`.

2. **debugLog Scope Fix**: Was module-level but needed `config.log_enabled`. Fixed with `createDebugLog(logEnabled)` factory instantiated inside `createGitButlerPlugin`. This also fixes the TS error noted in Task 7.

3. **JSONC Support**: `stripJsonComments` — character-by-character parser handling `//`, `/* */`, trailing commas, with string-quote-awareness. No external deps.

4. **Type-safe Merge**: Per-field `typeof` validation, falling back to `DEFAULT_CONFIG` individually.

### Replaced Hardcoded Values
- `LOG_ENABLED` → `config.log_enabled`
- `LLM_TIMEOUT_MS` / `MAX_DIFF_CHARS` → `config.llm_timeout_ms` / `config.max_diff_chars`
- `DEFAULT_BRANCH_PATTERN` → `new RegExp(config.default_branch_pattern)`
- Branch slug `.slice(0, 50)` → `.slice(0, config.branch_slug_max_length)`
- `providerID/modelID` → `config.commit_message_provider/model`
- `auto_update` passed to `createAutoUpdateHook`

### Exports Added to index.ts
- `GitButlerPluginConfig` (type), `DEFAULT_CONFIG`, `loadConfig`, `stripJsonComments`

## Task 9: Add README - COMPLETED

### Key Findings

1. **User-Focused Structure**: README organized for quick onboarding — installation, prerequisites, quick start, then configuration details. Troubleshooting section addresses common issues (missing CLI, config not found, debug logging, timeouts, large diffs).

2. **Configuration Table**: All 8 config keys from `src/config.ts` documented with type, default value, and description. Includes JSON example with comments for clarity.

3. **SKILL.md Reference**: README mentions bundled `SKILL.md` for detailed workspace commands, multi-agent safety rules, and known issues. Avoids duplication by pointing users to the guide.

4. **Practical Examples**: Includes JSON config snippets for common scenarios (enabling debug logging, adjusting timeouts, increasing diff limits).

5. **Line Count**: 125 lines — well within 80-200 target. No placeholders (TODO/TBD/FIXME).

### Files Created
- `packages/opencode-gitbutler/README.md` (125 lines)

### Content Coverage
✓ Installation (bun add command)
✓ Prerequisites (GitButler CLI, OpenCode, Bun)
✓ Quick start (config snippet)
✓ Configuration table (8 keys with defaults)
✓ Troubleshooting (5 common issues)
✓ License (MIT)
✓ No placeholders
✓ Concise and practical tone

## Task 8: Tests for Config and Auto-Update - COMPLETED

### Key Findings

1. **Bun test works out of the box**: `bun test` discovers `src/__tests__/*.test.ts` with zero config. No bunfig.toml needed. tsconfig already excludes `**/*.test.ts` from compilation.

2. **Mocking global fetch**: Bun's `mock()` + `globalThis.fetch` reassignment works cleanly for network mocking. Restore original fetch in `afterEach` to prevent test pollution.

3. **Temp dirs for filesystem tests**: `loadConfig` uses `Bun.file()` internally, which works fine with real temp directories created via `node:fs/promises.mkdtemp`. No need to mock the filesystem.

4. **createAutoUpdateHook eager fetch**: The hook starts fetching immediately on construction (not on first `onSessionCreated` call). Tests must account for this — the mock must be set *before* calling `createAutoUpdateHook`.

### Test Coverage Summary

- **config.test.ts** (11 tests): stripJsonComments (5) + loadConfig (6)
- **auto-update.test.ts** (11 tests): checkForUpdate (6) + createAutoUpdateHook (5)
- Total: 22 tests, all passing

## Task 10: Migration Step - COMPLETED (N/A for Package-Only Repo)

### Key Findings

1. **Repository Type**: This is a **package-only repository** (`packages/opencode-gitbutler/`). It contains the npm package implementation, not an application that consumes the plugin.

2. **Migration Files Not Present**:
   - ✗ `opencode.jsonc` — Does not exist (no application-level config)
   - ✗ `.opencode/plugin/gitbutler.ts` — Does not exist (no legacy local plugin)

3. **Why Migration is N/A**:
   - The package itself IS the migration target. Tasks 1-9 extracted and packaged the plugin.
   - There is no "local plugin usage" to replace in this repo — the plugin was extracted FROM another repo and packaged here.
   - This repo's purpose is to provide the npm package for consumption by other OpenCode installations.

4. **Package Integrity Verified**:
   - ✓ `bun run build` succeeds (34.44 KB bundle, 9 dist files generated)
   - ✓ `bun test` passes (22 tests, all passing)
   - ✓ LSP diagnostics clean on `src/index.ts`
   - ✓ All dist artifacts present: `index.js`, `index.d.ts`, `plugin.d.ts`, `auto-update.d.ts`, `config.d.ts`

### Verification Status

✓ Confirmed no `opencode.jsonc` in repository
✓ Confirmed no `.opencode/plugin/gitbutler.ts` in repository
✓ Documented migration as N/A (package-only repo)
✓ Package builds successfully
✓ All tests pass
✓ No TypeScript diagnostics
