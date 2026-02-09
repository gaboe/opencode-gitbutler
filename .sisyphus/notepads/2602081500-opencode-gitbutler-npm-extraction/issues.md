# Issues - OpenCode GitButler NPM Extraction

## Task 1: Scaffold Package Structure

### Resolved Issues

1. **Plugin Type Mismatch** (RESOLVED)
   - Issue: Initial implementation used object literal `{ name, version, hooks }` for Plugin type
   - Root Cause: Misunderstood Plugin type as object interface instead of function type
   - Solution: Changed to `const gitbutlerPlugin: Plugin = async () => ({})` 
   - Status: ✓ Fixed

2. **Module Resolution Error** (RESOLVED)
   - Issue: TypeScript couldn't find `@opencode-ai/plugin` types
   - Error: "Cannot find module '@opencode-ai/plugin' or its corresponding type declarations"
   - Root Cause: tsconfig.json used `moduleResolution: "node"` which doesn't work with bundled packages
   - Solution: Changed to `moduleResolution: "bundler"`
   - Status: ✓ Fixed

3. **Missing postinstall.mjs** (RESOLVED)
   - Issue: `bun install` failed because postinstall.mjs referenced in package.json didn't exist
   - Root Cause: Script defined in package.json but file not created
   - Solution: Created postinstall.mjs with GitButler CLI check (warn-only)
   - Status: ✓ Fixed

### No Outstanding Issues

All issues encountered during Task 1 have been resolved. Scaffold is complete and functional.

## Task 2: Plugin Extraction + Duplicate Guard

### Resolved Issues

1. **Missing Bun Type Definitions** (RESOLVED)
   - Issue: `tsc --emitDeclarationOnly` produced 25 errors: `Cannot find name 'Bun'`, missing `node:path`, `node:fs/promises`, `console`, `crypto`, `Blob`, `Response`, `TextEncoder`, `setTimeout`
   - Root Cause: tsconfig `lib: ["ES2020"]` lacks Bun globals and web API types; source plugin relies heavily on Bun runtime APIs
   - Solution: `bun add -d @types/bun` — provides all Bun, Node, and web global types
   - Note: `bun build` (bundler) succeeded without types; only `tsc` declaration generation needed them
   - Status: Fixed

### No Outstanding Issues

All issues encountered during Task 2 have been resolved.

## Task 3: Verify Build System and Output Artifacts

### No Outstanding Issues

Build system verification completed successfully with no errors or warnings:
- Build command executes cleanly
- All expected artifacts generated
- Type declarations properly reference Plugin type
- No TypeScript diagnostics
- No outstanding issues

## Task 4: Add postinstall.mjs CLI Check

### No Outstanding Issues

Task 4 requirements were already satisfied by the postinstall.mjs created in Task 1. No issues encountered.

## Task 6: Auto-Update Check Module

### No Outstanding Issues

Implementation was straightforward. No issues encountered.

### Design Notes
- `PACKAGE_VERSION` is hardcoded as `"0.1.0"` in `index.ts`. Must be kept in sync with `package.json` version. Consider automating this in a future task (e.g., build-time injection or dynamic import of package.json).
- Auto-update notification uses `console.warn` (stderr) rather than the plugin's internal `addNotification` system. This avoids coupling to plugin.ts internals and keeps the wiring merge-friendly with Task 5.

## Task 7: Bundled SKILL.md + Config Hook

### No Outstanding Issues

Implementation was straightforward.

### Notes
- Pre-existing issue in `plugin.ts`: `debugLog` at module scope references `config` from `createGitButlerPlugin` function scope. `tsc --noEmit` reports `TS2304: Cannot find name 'config'` but Bun bundler ignores this. This was introduced by Task 5's config extraction and should be fixed in a subsequent task (move `debugLog` inside `createGitButlerPlugin` or make `config` module-scoped).
- The `config` hook on `Hooks` interface mutates the input — it does NOT return a new config. The `instructions` field is `Array<string>` on the Config type from `@opencode-ai/sdk`.

## Task 5: Add Config Module

### Resolved Issues

1. **debugLog scope error** (RESOLVED): Task 7 noted `debugLog` at module scope referencing `config` from function scope (TS2304). Fixed by refactoring to `createDebugLog(logEnabled)` factory pattern, instantiated inside `createGitButlerPlugin`.

## Task 9: Add README

### No Outstanding Issues

README created with all required sections. No issues encountered.

## Task 8: Tests for Config and Auto-Update

### No Outstanding Issues

22 tests pass cleanly. No issues encountered.

## Task 10: Migration Step

### No Outstanding Issues

Migration is N/A for this package-only repository. No legacy local plugin files exist to migrate. Package integrity verified:
- Build passes
- Tests pass (22/22)
- No TypeScript diagnostics
