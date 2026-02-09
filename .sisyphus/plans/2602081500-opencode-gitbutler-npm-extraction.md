# OpenCode GitButler Plugin - NPM Package Extraction

## TL;DR

- Extract local plugin implementation into npm package `opencode-gitbutler` inside this repo.
- Keep behavior parity first, then add config, auto-update, SKILL.md delivery, tests, and docs.
- Bun-only runtime.

## Objective

- Build `packages/opencode-gitbutler/` as installable OpenCode plugin package.
- Final usage target: `"plugin": ["opencode-gitbutler"]` in OpenCode config.

## Constraints

- No refactor during extraction (1:1 copy first).
- No Node compatibility layer.
- No destructive git operations.

## Tasks

- [ ] 1. Scaffold package structure
  - Create `packages/opencode-gitbutler/package.json`
  - Create `packages/opencode-gitbutler/tsconfig.json`
  - Create `packages/opencode-gitbutler/src/index.ts`
  - Create `packages/opencode-gitbutler/src/__tests__/`
  - Run `bun install`

- [ ] 2. Extract plugin 1:1 to `src/plugin.ts` and add duplicate guard
  - Copy existing local plugin implementation into `src/plugin.ts`
  - Export `createGitButlerPlugin`
  - Update `src/index.ts` with `globalThis.__opencode_gitbutler_loaded__` guard

- [ ] 3. Verify build pipeline
  - Ensure `bun run build` succeeds
  - Ensure `dist/index.js` and `dist/index.d.ts` are generated

- [ ] 4. Add `postinstall.mjs` CLI check
  - Check `but --version`
  - Warn-only behavior on missing CLI (never fail install)

- [ ] 5. Add config module `src/config.ts`
  - Add `GitButlerPluginConfig`, defaults, `loadConfig(cwd)`
  - Support JSONC comments/trailing commas
  - Replace hardcoded values in plugin logic via config

- [ ] 6. Add auto-update hook `src/auto-update.ts`
  - Check npm dist-tags endpoint for newer version
  - Non-blocking behavior, notify only

- [ ] 7. Bundle SKILL.md and inject via config hook
  - Add package root `SKILL.md`
  - `config` hook returns `{ instructions: [content] }`

- [ ] 8. Add unit tests
  - `src/__tests__/config.test.ts`
  - `src/__tests__/auto-update.test.ts`
  - At least 8 test cases total

- [ ] 9. Add README
  - Install, prerequisites, config table, troubleshooting

- [ ] 10. Migration step
  - Replace local plugin usage with npm package usage
  - Remove legacy local plugin file once parity is verified

## Verification Gate (after each task)

- `lsp_diagnostics` clean on changed files
- `bun run build` passes
- `bun test` passes (or expected no-test state before Task 8)
- Read changed files and confirm scope

## Execution Order

- Wave 1: Task 1
- Wave 2 (parallel): Tasks 2, 3, 4
- Wave 3 (parallel): Tasks 5, 6, 7
- Wave 4: Tasks 8, 9, 10
