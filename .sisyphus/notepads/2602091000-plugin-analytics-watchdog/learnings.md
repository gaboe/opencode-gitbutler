# Learnings - Plugin Analytics Watchdog

## Task 1: Runtime Directory Setup

### Completed
- Created `.opencode/analysis-loop/` directory at repo root
- Added `.gitignore` with explicit runtime artifact policy
- Policy ignores: `checkpoint-*.patch`, `patch-ledger.json`, `*.log`, `*.tmp`
- Policy preserves: `report.md`, `report-template.md` (tracked files)

### Key Decisions
- Checkpoint patches use glob pattern `checkpoint-*.patch` for per-iteration recovery
- Patch ledger (`patch-ledger.json`) is ephemeral, not committed
- Explicit comments in `.gitignore` document the artifact policy rationale
- Kept directory structure minimal - only bootstrap files, no implementation yet

### Next Steps
- Task 2 will define patch scope and protected surface (allowlist)
- Task 3 will create the command definition file
- Task 4 will add report template

## Task 2: Define Patch Scope and Protected Surface

### Completed
- Created `.opencode/analysis-loop/patch-scope.md`
- Document defines 4 source files + 2 test files as patchable allowlist
- Public API surface frozen: `GitButlerPlugin`, `DEFAULT_CONFIG`, `loadConfig`, `stripJsonComments`, `GitButlerPluginConfig`
- 7 hard rejection rules defined (path check, export signature, no version bumps, no deps, no git ops, no new files outside allowlist, overlap guard)
- Enforcement pseudocode provided for pre-patch and post-patch validation
- Patch ledger entry format specified for task 3 consumption

### Key Decisions
- Allowlist-not-blocklist approach: safer default, new files need explicit opt-in
- ±5 line overlap rule to prevent patch oscillation across iterations
- `src/index.ts` gets special treatment: patches require export signature verification
- Test file creation allowed under `src/__tests__/` only (glob pattern `*.test.ts`)
- Package.json, tsconfig, SKILL.md, README.md all marked strictly read-only
- Patch ledger entry format includes `regions` array with line ranges for overlap detection

### Repo Structure Observations
- Repo has exactly 4 source files: `index.ts`, `plugin.ts`, `config.ts`, `auto-update.ts`
- 2 test files: `config.test.ts`, `auto-update.test.ts` (no plugin.test.ts yet)
- `plugin.ts` is 1240 lines — the primary hardening target
- No monorepo workspace config, single `packages/opencode-gitbutler/` package

## Task 3: Create analyze-plugin-loop.md Command

### Completed
- Created `.opencode/command/analyze-plugin-loop.md` with full 3-phase structure (setup/loop/teardown)
- Created `.opencode/command/` directory (did not exist prior)
- Command references `patch-scope.md` as single source of truth for allowlist/protected surface
- All 7 hard rejection rules from patch-scope.md incorporated into pre/post-patch validation steps
- 4 data sources defined with graceful degradation (each optional, abort only if all 4 unavailable)

### Key Decisions
- `scripts/search-opencode-history.ts` confirmed missing in this repo — command logs warning and skips session history source
- `but` CLI availability checked at runtime — not assumed present
- Max 3 patches per iteration to limit blast radius
- 5-second pause between iterations to prevent tight-loop resource consumption
- Checkpoint patches created via read-only `git diff` (not `git stash` or other mutating commands)
- Report template loading is optional — command uses inline minimal format if template doesn't exist yet (task 4)
- Patch ledger format matches spec from `patch-scope.md` exactly (iteration, timestamp, files, regions, status, description)

### Structural Notes
- Command is a markdown instruction file, not executable code — designed for agent consumption
- Each phase has explicit abort/continue logic so an executing agent knows exactly when to stop
- Stop conditions table duplicated in both inline (Step 2.6) and summary section for quick reference

## Task 4: Add Report Template

### Completed
- Created `.opencode/analysis-loop/report-template.md` with full structure
- Template includes 5 main sections: Metadata, Executive Summary, Iteration Log, Patch Ledger, Remaining Issues
- Metadata section captures: start/end time, duration, exit reason, iteration count, data source availability
- Iteration Log section provides per-iteration template with: timestamp, analysis summary, patch counts, changes, rejections
- Patch Ledger section uses markdown table format with columns: Iteration, Timestamp, File(s), Start Line, End Line, Status, Description
- Summary section includes: exit reason, recommendations, checkpoint file list, final state notes

### Key Decisions
- Template uses placeholder syntax `{PLACEHOLDER}` for dynamic values (agent fills in at runtime)
- Iteration Log is repeatable — agent appends new iteration blocks as loop progresses
- Patch Ledger table format matches JSON ledger structure for easy cross-reference
- Remaining Issues section is optional — only populated if issues found but not addressed
- Template is directly loadable by task 3 command (Phase 1, Step 5)
- Markdown format chosen for human readability and git-friendly diffs

### Integration Notes
- Task 3 command already supports loading this template if present (graceful fallback to inline format if missing)
- Template structure aligns with command's reporting format (Step 2.4 iteration details, Phase 3 teardown report)
- No changes to command file needed — template is purely additive

## Task 5: Document Acceptance Checks

### Completed
- Created `.opencode/analysis-loop/acceptance-checks.md` with 5 explicit checks
- Each check includes: Purpose, Setup, Execute, Expected Evidence sections
- Checks cover all 5 plan bullets: missing-source handling, out-of-allowlist rejection, convergence stop, checkpoint creation, no auto-commit
- Checks are runnable in package-only repo context (no external dependencies assumed)
- Checks reference command, patch-scope, and template docs for integration verification

### Key Decisions
- Checks are verification-focused, not implementation-focused — they describe what to look for, not how to build
- Each check includes concrete command examples and expected filesystem/report evidence
- Checks 1-5 are all automatic (loop enforces them) — operators just need to verify evidence after running
- Evidence collection points: report.md, patch-ledger.json, checkpoint-*.patch files, git status/log
- Checks are sequenceable — can run all 5 in one loop execution or separately

### Verification Approach
- Check 1 (missing sources): Verify report.md lists source availability with warnings
- Check 2 (allowlist rejection): Verify report.md shows rejection reason for out-of-scope patches
- Check 3 (convergence): Verify report.md exit reason is "converged" after 2 zero-patch iterations
- Check 4 (checkpoints): Verify checkpoint-*.patch files exist in .opencode/analysis-loop/
- Check 5 (no git mutation): Verify git log unchanged, git status shows only local changes, checkpoint files untracked

### Integration Notes
- Acceptance checks document is the final deliverable for task 5
- Checks validate all 3 prior task outputs (command, patch-scope, template)
- Checks are self-contained — operators can run them without additional setup
- No changes to command/patch-scope/template files needed — checks are purely documentation
