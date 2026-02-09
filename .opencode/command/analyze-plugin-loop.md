# Command: Analyze Plugin Loop

> Iterative analysis and hardening loop for `opencode-gitbutler` plugin.
> Operator/maintainer workflow only. Not an end-user feature.

---

## Purpose

Run a bounded analysis loop that:
1. Inspects plugin behavior from multiple data sources
2. Identifies defects, fragile patterns, and missing guards
3. Proposes and applies local patches (never committed)
4. Verifies each patch passes build + tests
5. Produces a structured report

**All patches are local-only.** This command MUST NOT commit, push, or run any destructive git operation.

---

## Guardrails

### Patch Scope Policy

**Read and enforce**: `.opencode/analysis-loop/patch-scope.md`

That document is the single source of truth for:
- Which files may be modified (allowlist)
- Which files/symbols are read-only (protected surface)
- Hard rejection rules (7 rules, all mandatory)
- Pre-patch and post-patch validation logic
- Patch ledger entry format

**If patch-scope.md is missing or unreadable, ABORT the entire loop.**

### Hard Constraints (non-negotiable)

1. **No git mutations**: Do NOT run `git add`, `git commit`, `git push`, `git reset`, `git checkout`, or any state-mutating git command. Read-only git commands (`git log`, `git diff`, `git status`) are permitted.
2. **No commits, no pushes**: Under no circumstances create or modify git history.
3. **Allowlist enforcement**: Every patch must target only files listed in the Patch Allowlist in `patch-scope.md`. Reject entire patch if any file is outside allowlist.
4. **Public API freeze**: Exported symbols in `src/index.ts` (`GitButlerPlugin`, `DEFAULT_CONFIG`, `loadConfig`, `stripJsonComments`, `GitButlerPluginConfig`) must not be renamed, removed, or have their type signatures changed.
5. **No dependency changes**: Do not modify `dependencies`, `peerDependencies`, or `devDependencies` in any `package.json`.
6. **No version bumps**: Do not modify `version` in `package.json`.
7. **Overlap guard**: If a patch touches a file region within ±5 lines of a previously applied patch (per `patch-ledger.json`), reject it to prevent oscillation.

---

## Data Sources

The loop draws from 4 data sources. Each is **optional** — the loop MUST degrade gracefully when a source is unavailable.

| # | Source | Path / Method | Fallback |
|---|--------|--------------|----------|
| 1 | **Plugin debug log** | `.opencode/plugin/debug.log` | Log `[WARN] debug.log not found — skipping log analysis` and continue |
| 2 | **Session history** | Run `scripts/search-opencode-history.ts` with relevant patterns | If script is missing, log `[WARN] search-opencode-history.ts unavailable — skipping session history` and continue |
| 3 | **Git log** | `git log --oneline -50 -- packages/opencode-gitbutler/` | Always available (read-only git) |
| 4 | **`but` CLI status** | `but status` (GitButler CLI) | If `but` is not installed, log `[WARN] but CLI not found — skipping but status` and continue |

**At least one source must yield data.** If all 4 sources are unavailable or empty, ABORT with `[ERROR] No data sources available`.

---

## Phases

### Phase 1: Setup

Execute these steps before entering the loop:

1. **Read patch scope policy**
   ```
   Read .opencode/analysis-loop/patch-scope.md
   If missing → ABORT("patch-scope.md not found")
   Parse allowlist and protected surface into working memory
   ```

2. **Initialize patch ledger**
   ```
   If .opencode/analysis-loop/patch-ledger.json exists → load it
   Else → create empty: { "iterations": [], "version": 1 }
   ```

3. **Record start time**
   ```
   Set START_TIME = now()
   Set MAX_DURATION = 30 minutes
   Set iteration = 0
   Set consecutive_zero_patch_count = 0
   ```

4. **Probe data sources**
   ```
   For each of the 4 data sources:
     Check availability
     Log status: [OK] or [WARN] with reason
   If all 4 unavailable → ABORT("No data sources available")
   ```

5. **Load report template** (if exists)
   ```
   If .opencode/analysis-loop/report-template.md exists → load structure
   Else → use inline minimal format (metadata + iteration log)
   ```

---

### Phase 2: Iteration Loop

Repeat until a stop condition is met:

#### Step 2.1: Analyze

Gather and cross-reference available data sources:

- **From debug.log**: Extract error patterns, warning frequency, stack traces, repeated failure modes
- **From session history**: Search for plugin-related error patterns, user-reported issues, recurring failures
- **From git log**: Identify recent changes to plugin files, correlate with error timing
- **From `but` CLI**: Check current branch state, uncommitted changes, workspace status

Produce an **analysis summary** listing:
- Top issues found (ranked by severity)
- Affected files and approximate line ranges
- Proposed fix category (null-check, error-handling, edge-case, validation, etc.)

If no issues found → record zero findings, skip to Step 2.5.

#### Step 2.2: Plan Patch

For each identified issue (max 3 per iteration to limit blast radius):

1. Determine target file(s)
2. **Pre-patch validation**:
   ```
   For each file in proposed patch:
     If file NOT in allowlist → reject("path outside allowlist: {file}")
     If file == "package.json" → reject("package.json is protected")
     If file in node_modules/ or dist/ → reject("generated path: {file}")
   ```
3. Check patch ledger for region overlap (±5 lines)
   ```
   If overlap detected → reject("overlaps iteration {N} patch at {file}:{lines}")
   ```
4. If all checks pass → proceed to apply

#### Step 2.3: Apply & Verify Patch

1. **Create checkpoint** before applying:
   ```
   git diff > .opencode/analysis-loop/checkpoint-{iteration}.patch
   ```

2. **Apply the patch** (edit files directly)

3. **Post-patch validation**:
   ```
   If src/index.ts was modified:
     Verify all public exports still exist:
       GitButlerPlugin, DEFAULT_CONFIG, loadConfig, stripJsonComments, GitButlerPluginConfig
     If any missing → revert from checkpoint, log rejection, continue
   ```

4. **Build check**:
   ```
   Run: bun build (or bun run build / bunx tsc --noEmit)
   If build fails → revert from checkpoint, log failure, continue
   ```

5. **Test check**:
   ```
   Run: bun test
   If tests fail → revert from checkpoint, log failure, continue
   ```

6. If all checks pass → record patch in ledger:
   ```json
   {
     "iteration": <N>,
     "timestamp": "<ISO-8601>",
     "files": ["<affected files>"],
     "regions": [{ "file": "<relative>", "startLine": <N>, "endLine": <N> }],
     "status": "applied",
     "description": "<brief description of change>"
   }
   ```

#### Step 2.4: Report Iteration

Append to `.opencode/analysis-loop/report.md`:

```markdown
### Iteration {N}

**Time**: {timestamp}
**Sources consulted**: {list of available sources}
**Issues found**: {count}
**Patches proposed**: {count}
**Patches applied**: {count}
**Patches rejected**: {count} (reasons: ...)

#### Changes
- {file}: {description}

#### Rejections
- {file}: {reason}
```

#### Step 2.5: Checkpoint & Update Counters

```
Save patch-ledger.json
If patches_applied == 0:
  consecutive_zero_patch_count += 1
Else:
  consecutive_zero_patch_count = 0
iteration += 1
```

#### Step 2.6: Stop Condition Check

Evaluate in order:

| Condition | Action |
|-----------|--------|
| `now() - START_TIME >= 30 minutes` | STOP — hard timeout reached |
| `consecutive_zero_patch_count >= 2` | STOP — converged (two consecutive zero-patch iterations) |
| Critical error in analysis phase | STOP — abort on unrecoverable error |

If no stop condition met → **pause 5 seconds** (prevent tight-loop), then return to Step 2.1.

---

### Phase 3: Teardown

Execute after the loop exits (regardless of exit reason):

1. **Write final report**
   ```
   Finalize .opencode/analysis-loop/report.md with:
     - Exit reason (timeout | converged | error)
     - Total iterations completed
     - Total patches applied / rejected
     - Summary of all changes
     - Remaining issues not addressed
   ```

2. **Save final patch ledger**
   ```
   Write .opencode/analysis-loop/patch-ledger.json
   ```

3. **Generate summary diff**
   ```
   git diff -- packages/opencode-gitbutler/src/ > .opencode/analysis-loop/final-changes.patch
   ```
   (This is a read-only git command — permitted.)

4. **Log completion**
   ```
   [INFO] Analysis loop completed.
   Exit reason: {reason}
   Iterations: {count}
   Patches applied: {total}
   Report: .opencode/analysis-loop/report.md
   ```

---

## Stop Conditions (Summary)

| Condition | Threshold | Behavior |
|-----------|-----------|----------|
| **Hard timeout** | 30 minutes from start | Immediate exit to teardown |
| **Convergence** | 2 consecutive iterations with 0 patches | Normal exit to teardown |
| **Critical error** | Unrecoverable failure in analysis phase | Abort exit to teardown |
| **All sources unavailable** | 0 of 4 data sources reachable | Abort in setup (no loop entered) |
| **Patch scope missing** | `patch-scope.md` not found | Abort in setup (no loop entered) |

---

## Reporting Format

Each iteration appends to `.opencode/analysis-loop/report.md`. Final report structure:

```markdown
# Plugin Analysis Loop Report

## Metadata
- **Start**: {ISO timestamp}
- **End**: {ISO timestamp}
- **Duration**: {minutes}m {seconds}s
- **Exit reason**: {timeout | converged | error}
- **Iterations**: {N}

## Executive Summary
- Patches applied: {N}
- Patches rejected: {N}
- Files modified: {list}
- Key findings: {bullet list}

## Iteration Log
{per-iteration details as described in Step 2.4}

## Patch Ledger
{JSON content of patch-ledger.json or formatted table}

## Remaining Issues
{Issues identified but not addressed, for manual review}
```

---

## Quick Reference: What This Command Does NOT Do

- Does NOT commit any changes
- Does NOT push to any remote
- Does NOT run destructive git commands
- Does NOT modify files outside the patch allowlist
- Does NOT change public API signatures
- Does NOT modify dependencies or versions
- Does NOT run indefinitely (30-min hard cap)
- Does NOT require all data sources to be present
