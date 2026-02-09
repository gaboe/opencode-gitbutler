# Issues - Plugin Analytics Watchdog

## Task 1: Runtime Directory Setup

### No Blockers
- Directory creation completed without issues
- `.gitignore` policy is clear and explicit
- Notepad files initialized successfully

### Observations
- Notepad directory existed but files were not pre-created
- `.opencode/` directory did not exist at repo root - created fresh
- All bootstrap files in place for subsequent tasks

### Risks to Monitor
- Patch ledger format (JSON) will be defined in Task 2-3
- Checkpoint patch naming convention must be consistent across iterations
- Report template structure will be defined in Task 4

## Task 2: Define Patch Scope and Protected Surface

### No Blockers
- `.opencode/analysis-loop/` directory already existed from task 1
- All source files identified and inventoried without ambiguity

### Observations
- `patch-scope.md` is a tracked file (not in `.gitignore` exclusions) — intentional, it's a policy doc
- Patch ledger entry format now defined; task 3 can reference it directly
- The ±5 line overlap guard may need tuning once real iterations run (too strict = blocks valid follow-up patches, too loose = oscillation)

### Risks to Monitor
- Export signature check relies on text matching of `src/index.ts` exports — fragile if someone refactors to barrel exports
- No plugin.test.ts exists yet; the loop may create one, which is allowed but task 3 should handle test file creation gracefully
- `plugin.ts` at 1240 lines is large; patch region tracking needs line-level granularity to be useful

## Task 3: Create analyze-plugin-loop.md Command

### No Blockers
- `.opencode/command/` directory created successfully
- All referenced files from patch-scope.md exist
- Command structure is complete and self-contained

### Observations
- `scripts/search-opencode-history.ts` does not exist in this repo — session history data source will always be skipped. If this script is added later, the command handles it automatically (no changes needed)
- `but` CLI may or may not be installed on the operator's machine — command degrades gracefully
- `.opencode/plugin/debug.log` is the primary data source but may not exist until the plugin has been run with debug logging enabled
- Report template (`.opencode/analysis-loop/report-template.md`) does not exist yet — task 4 will create it. Command uses inline fallback format until then

### Risks to Monitor
- The 30-minute timeout is wall-clock based. If the agent is slow (e.g., large build times), it may only complete 2-3 iterations. Consider whether iteration count should also be a configurable cap.
- `bun build` / `bun test` commands assumed but not verified — if build/test toolchain changes, the command file will need updating
- The 5-second sleep between iterations is a fixed value. May need tuning based on actual loop performance.
- Checkpoint creation via `git diff` captures ALL uncommitted changes, not just loop changes. If the operator has pre-existing uncommitted work, checkpoints will be noisy. Could be mitigated by diffing only allowlist paths.

## Task 4: Add Report Template

### No Blockers
- `.opencode/analysis-loop/` directory already exists from task 1
- Template structure aligns with command file expectations (task 3)
- No file conflicts or dependencies

### Observations
- Template uses placeholder syntax `{PLACEHOLDER}` for runtime substitution — agent must fill in actual values
- Iteration Log section is repeatable — agent appends new blocks per iteration
- Patch Ledger table format mirrors JSON ledger structure for consistency
- Template is optional in task 3 command (graceful fallback exists) — no breaking changes

### Risks to Monitor
- Placeholder naming must be consistent between template and agent implementation (e.g., `{START_TIME}` vs `{START_TIMESTAMP}`)
- Iteration Log section assumes agent will append blocks in order — if iterations are processed out-of-order, report will be confusing
- Patch Ledger table may become very long if loop runs many iterations — consider pagination or summary table in final report
- Remaining Issues section is optional — agent must decide when to populate it (only if issues found but not addressed)

## Task 5: Document Acceptance Checks

### No Blockers
- All prior task outputs (command, patch-scope, template) exist and are stable
- Acceptance checks document is purely documentation — no code changes required
- Checks reference existing files and command behavior

### Observations
- Checks 1-5 are all automatic — the loop enforces them by design
- Operators verify checks by inspecting report.md, patch-ledger.json, checkpoint files, and git state
- Checks are sequenceable — can be verified in a single loop run or across multiple runs
- Evidence collection is straightforward: filesystem inspection, report parsing, git commands

### Risks to Monitor
- Check 1 (missing sources): If all 4 sources are unavailable, loop aborts in setup — operator must ensure at least 1 source is reachable
- Check 2 (allowlist rejection): Requires loop to encounter a patch proposal to protected file — may not happen in every run
- Check 3 (convergence): Requires 2 consecutive zero-patch iterations — may take multiple runs to observe
- Check 4 (checkpoints): Requires at least 1 patch to be applied — may not happen if no issues found
- Check 5 (no git mutation): Easiest to verify — just check git log and git status after run

### Future Considerations
- Once loop is implemented and run, actual evidence should be collected and compared against expected evidence in acceptance-checks.md
- If evidence differs, acceptance-checks.md may need refinement (e.g., placeholder names, report section names)
- Checks assume report.md and patch-ledger.json are the primary evidence sources — if loop implementation uses different output format, checks will need updating
