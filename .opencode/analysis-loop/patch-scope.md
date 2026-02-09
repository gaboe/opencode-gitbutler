# Patch Scope & Protected Surface

> Defines what the analysis loop may modify and what it must never touch.
> Referenced by `.opencode/command/analyze-plugin-loop.md` (task 3).

---

## Patch Allowlist

Only the files below may be modified by analysis-loop iterations.
Any patch targeting a path **not** in this list MUST be rejected.

### Source files (implementation)

| Path | Notes |
|------|-------|
| `packages/opencode-gitbutler/src/plugin.ts` | Core hook logic — primary hardening target |
| `packages/opencode-gitbutler/src/config.ts` | Config loading & validation |
| `packages/opencode-gitbutler/src/auto-update.ts` | Update checker — isolated, low-risk |
| `packages/opencode-gitbutler/src/index.ts` | Entry point / wiring — touch only if plugin.ts changes require it |

### Test files

| Path | Notes |
|------|-------|
| `packages/opencode-gitbutler/src/__tests__/config.test.ts` | Config unit tests |
| `packages/opencode-gitbutler/src/__tests__/auto-update.test.ts` | Auto-update unit tests |
| `packages/opencode-gitbutler/src/__tests__/*.test.ts` | Any new test files created by the loop |

### Analysis-loop runtime artifacts (write-only, never committed)

| Path | Notes |
|------|-------|
| `.opencode/analysis-loop/patch-ledger.json` | Patch tracking state |
| `.opencode/analysis-loop/checkpoint-*.patch` | Per-iteration recovery |
| `.opencode/analysis-loop/report.md` | Final analysis output |
| `.opencode/analysis-loop/*.log` | Debug/iteration logs |

---

## Protected Surface (Read-Only)

These files/paths are **strictly read-only**. The loop may read them for context
but MUST NOT modify them under any circumstances.

### Public API contract

| Path | Reason |
|------|--------|
| `packages/opencode-gitbutler/package.json` | Version, exports, dependencies — consumer contract |
| `packages/opencode-gitbutler/tsconfig.json` | Build configuration |
| `packages/opencode-gitbutler/postinstall.mjs` | npm lifecycle script |
| `packages/opencode-gitbutler/SKILL.md` | Injected into agent context — user-facing |
| `packages/opencode-gitbutler/README.md` | Documentation — user-facing |

### Type exports (public API surface)

The following **exported symbols** in `src/index.ts` constitute the public API.
Patches MUST NOT change their names, type signatures, or remove them:

- `default export` — `GitButlerPlugin` (the `Plugin` function)
- `export { GitButlerPlugin }` — named re-export
- `export type { GitButlerPluginConfig }` — config type
- `export { DEFAULT_CONFIG, loadConfig, stripJsonComments }` — config utilities

### Infrastructure / repo root

| Path | Reason |
|------|--------|
| `.git/**` | Git internals |
| `.opencode/analysis-loop/.gitignore` | Artifact policy — set in task 1 |
| `.opencode/analysis-loop/report-template.md` | Template — set in task 4 |
| `.opencode/command/**` | Command definitions — separate tasks |
| `.sisyphus/**` | Plan/notepad infrastructure |
| `packages/opencode-gitbutler/node_modules/**` | Dependencies |
| `packages/opencode-gitbutler/dist/**` | Build output |
| `packages/opencode-gitbutler/bun.lock` | Lock file |

---

## Hard Rejection Rules

The analysis loop command MUST enforce these rules **before** applying any patch:

1. **Path check**: Every file in the patch diff MUST appear in the Patch Allowlist above.
   If any path is outside the allowlist → **reject entire patch**.

2. **Export signature check**: After applying a patch to `src/index.ts`, verify that all
   public API exports listed in "Type exports" still exist with identical names.
   If any are missing or renamed → **revert patch, log rejection**.

3. **No version bumps**: Patches MUST NOT modify `version` in `package.json`.

4. **No dependency changes**: Patches MUST NOT add, remove, or modify entries in
   `dependencies`, `peerDependencies`, or `devDependencies`.

5. **No git operations**: The loop MUST NOT run `git add`, `git commit`, `git push`,
   or any other state-mutating git command.

6. **No new files outside allowlist**: Creating files is permitted ONLY under
   `packages/opencode-gitbutler/src/__tests__/` (new tests) and
   `.opencode/analysis-loop/` (runtime artifacts).

7. **Patch ledger overlap**: If a patch touches the same file region (±5 lines) as a
   previous iteration's patch in `patch-ledger.json` → **reject to prevent oscillation**.

---

## Enforcement Notes for Command/Task Implementation

### Pre-patch validation (task 3 must implement)

```
for each file in proposed_patch:
  if file not in ALLOWLIST → reject("path outside allowlist: {file}")
  if file == "package.json" → reject("package.json is protected")
  if file in node_modules/ or dist/ → reject("generated path: {file}")
```

### Post-patch validation (task 3 must implement)

```
if "src/index.ts" was patched:
  verify exports: GitButlerPlugin, DEFAULT_CONFIG, loadConfig, stripJsonComments, GitButlerPluginConfig
  if any missing → revert patch, log failure
run: bun build (type-check)
  if build fails → revert patch, log failure
run: bun test
  if tests fail → revert patch, log failure
```

### Patch ledger entry format (consumed by task 3)

Each applied patch is recorded in `patch-ledger.json` as:

```json
{
  "iteration": 1,
  "timestamp": "2026-02-09T10:00:00Z",
  "files": ["packages/opencode-gitbutler/src/plugin.ts"],
  "regions": [{ "file": "src/plugin.ts", "startLine": 42, "endLine": 58 }],
  "status": "applied",
  "description": "Added null check in extractFilePath"
}
```

---

## Rationale

- **Allowlist-not-blocklist**: Safer default. New files require explicit opt-in.
- **Public API freeze**: Consumers depend on `GitButlerPlugin`, `DEFAULT_CONFIG`, `loadConfig`, `stripJsonComments`, `GitButlerPluginConfig`. Breaking these in an automated loop is unacceptable.
- **Package-only repo**: This repo contains a single npm package. There are no app-level files, CI configs, or workspace manifests to worry about. Scope is naturally narrow.
- **Oscillation guard**: The ±5 line overlap rule prevents the loop from repeatedly patching and reverting the same region across iterations.
- **Build + test gate**: Every patch must pass build and test before being recorded. This is the minimum quality bar for automated changes.
