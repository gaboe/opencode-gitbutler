# Acceptance Checks for Plugin Analysis Loop

> Verification protocol for the `analyze-plugin-loop` command.
> These checks validate that the loop behaves correctly under key scenarios.
> Each check is runnable in the package-only repo context.

---

## Overview

This document defines 5 acceptance checks that verify the loop's core guardrails:

1. **Missing-source graceful handling** — Loop continues when data sources are unavailable
2. **Out-of-allowlist patch rejection** — Loop rejects patches targeting protected files
3. **Convergence stop behavior** — Loop exits after 2 consecutive zero-patch iterations
4. **Checkpoint file creation** — Loop creates per-iteration recovery patches
5. **No auto-commit / no git mutation** — Loop never modifies git history

Each check includes:
- **Purpose**: What behavior is being verified
- **Setup**: Prerequisites and initial state
- **Execute**: Commands or actions to trigger the check
- **Expected evidence**: What to look for in logs, reports, or filesystem

---

## Check 1: Missing-Source Graceful Handling

### Purpose

Verify that the loop degrades gracefully when one or more data sources are unavailable.
The loop must continue if at least one source is reachable; it must abort only if all 4 are unavailable.

### Setup

1. Ensure `.opencode/analysis-loop/` directory exists
2. Ensure `.opencode/analysis-loop/patch-scope.md` exists (required for loop to start)
3. Simulate missing sources:
   - Ensure `.opencode/plugin/debug.log` does **not** exist (source 1 unavailable)
   - Ensure `scripts/search-opencode-history.ts` does **not** exist (source 2 unavailable)
   - Ensure `but` CLI is **not** installed or not in PATH (source 3 unavailable)
   - `git log` will always be available (source 4 — read-only git)

### Execute

Run the analyze-plugin-loop command:

```bash
# From repo root
node -e "
  // Pseudo-code: agent executes analyze-plugin-loop.md phases
  // Phase 1: Setup
  // - Read patch-scope.md
  // - Initialize patch ledger
  // - Probe 4 data sources
  // - Load report template
  // Phase 2: Iteration Loop (at least 1 iteration)
  // Phase 3: Teardown
"
```

Or, if implemented as a script:

```bash
bun run analyze-plugin-loop
```

### Expected Evidence

In `.opencode/analysis-loop/report.md`:

```markdown
## Metadata

- **Data sources available**:
  - Plugin debug log: NO (debug.log not found — skipping log analysis)
  - Session history: NO (search-opencode-history.ts unavailable — skipping session history)
  - Git log: YES
  - `but` CLI: NO (but CLI not found — skipping but status)

[INFO] 1 of 4 data sources available. Proceeding with analysis.
```

In loop logs (if present):

```
[WARN] debug.log not found — skipping log analysis
[WARN] search-opencode-history.ts unavailable — skipping session history
[WARN] but CLI not found — skipping but status
[OK] git log available
[INFO] Analysis loop started with 1 available data source
```

**Success criteria**:
- Loop does NOT abort in setup phase
- Loop enters iteration loop (at least 1 iteration completes)
- Report metadata lists all 4 sources with correct availability status
- At least one source is marked YES

---

## Check 2: Out-of-Allowlist Patch Rejection

### Purpose

Verify that the loop rejects patches targeting files outside the patch allowlist.
This is a critical safety guardrail to prevent unintended modifications.

### Setup

1. Ensure `.opencode/analysis-loop/patch-scope.md` exists with the allowlist
2. Ensure `.opencode/analysis-loop/patch-ledger.json` is empty or does not exist
3. Prepare a test scenario where the loop would propose a patch to a protected file:
   - Example: A patch to `package.json` (protected)
   - Example: A patch to `README.md` (protected)
   - Example: A patch to `src/index.ts` that removes a public export (violates export signature check)

### Execute

Simulate the loop proposing a patch to `package.json`:

```bash
# Pseudo-code: agent attempts to apply a patch to package.json
# Step 2.2: Plan Patch
# - Identify issue in package.json
# - Pre-patch validation:
#   if file == "package.json" → reject("package.json is protected")
```

Or, if the loop is running and encounters such a scenario:

```bash
# Monitor the loop's patch proposal phase
# The loop should log rejection before attempting to apply
```

### Expected Evidence

In `.opencode/analysis-loop/report.md`:

```markdown
### Iteration N

**Patches**:
- Proposed: 1
- Applied: 0
- Rejected: 1

**Rejections**:
- package.json: package.json is protected
```

In patch-ledger.json:

```json
{
  "iterations": [
    {
      "iteration": N,
      "timestamp": "2026-02-09T...",
      "files": [],
      "regions": [],
      "status": "rejected",
      "description": "Proposed patch to package.json rejected: package.json is protected"
    }
  ]
}
```

In loop logs:

```
[WARN] Patch rejected: path outside allowlist: package.json
[INFO] Iteration N: 0 patches applied, 1 rejected
```

**Success criteria**:
- Patch is NOT applied to `package.json`
- Rejection reason is logged and recorded in report
- Patch ledger entry shows `status: "rejected"`
- No changes to `package.json` in working directory

---

## Check 3: Convergence Stop Behavior

### Purpose

Verify that the loop exits gracefully after 2 consecutive iterations with zero patches applied.
This prevents endless looping when no more improvements are found.

### Setup

1. Ensure `.opencode/analysis-loop/` directory exists
2. Ensure `.opencode/analysis-loop/patch-scope.md` exists
3. Ensure `.opencode/analysis-loop/patch-ledger.json` is empty or does not exist
4. Ensure data sources are available but yield no actionable issues (or all proposed patches are rejected)

### Execute

Run the analyze-plugin-loop command and let it iterate until convergence:

```bash
# From repo root
bun run analyze-plugin-loop
# Or equivalent agent execution
```

Monitor the loop's iteration counter and patch counts.

### Expected Evidence

In `.opencode/analysis-loop/report.md`:

```markdown
## Metadata

- **Exit reason**: converged

---

### Iteration 1

**Patches**:
- Proposed: 0
- Applied: 0
- Rejected: 0

---

### Iteration 2

**Patches**:
- Proposed: 0
- Applied: 0
- Rejected: 0

[INFO] Convergence detected: 2 consecutive zero-patch iterations. Exiting loop.
```

In loop logs:

```
[INFO] Iteration 1: 0 patches applied. consecutive_zero_patch_count = 1
[INFO] Iteration 2: 0 patches applied. consecutive_zero_patch_count = 2
[INFO] Convergence stop condition met. Exiting loop.
```

**Success criteria**:
- Loop completes exactly 2 iterations (or more, but stops after 2 consecutive zero-patch iterations)
- Exit reason in report is `converged`
- No patches are applied in the final iterations
- Loop does NOT continue indefinitely

---

## Check 4: Checkpoint File Creation

### Purpose

Verify that the loop creates per-iteration checkpoint patches for recovery.
Checkpoints allow the operator to revert to a known state if needed.

### Setup

1. Ensure `.opencode/analysis-loop/` directory exists
2. Ensure `.opencode/analysis-loop/patch-scope.md` exists
3. Ensure at least one patch will be applied (data sources yield issues, patches pass validation)

### Execute

Run the analyze-plugin-loop command and let it complete at least 1 iteration with a patch applied:

```bash
bun run analyze-plugin-loop
```

After the loop completes, inspect the `.opencode/analysis-loop/` directory:

```bash
ls -la .opencode/analysis-loop/checkpoint-*.patch
```

### Expected Evidence

Filesystem:

```
.opencode/analysis-loop/
├── checkpoint-1.patch
├── checkpoint-2.patch
├── checkpoint-N.patch
├── patch-ledger.json
├── report.md
└── final-changes.patch
```

Each checkpoint file contains a git diff:

```bash
cat .opencode/analysis-loop/checkpoint-1.patch
# Output: unified diff format showing state before iteration 1 patch was applied
```

In `.opencode/analysis-loop/report.md`:

```markdown
## Summary

**Checkpoint files created**:
- `.opencode/analysis-loop/checkpoint-1.patch`
- `.opencode/analysis-loop/checkpoint-2.patch`
- `.opencode/analysis-loop/checkpoint-N.patch`
```

In patch-ledger.json:

```json
{
  "iterations": [
    {
      "iteration": 1,
      "timestamp": "2026-02-09T...",
      "files": ["packages/opencode-gitbutler/src/plugin.ts"],
      "regions": [{ "file": "src/plugin.ts", "startLine": 42, "endLine": 58 }],
      "status": "applied",
      "description": "Added null check in extractFilePath"
    }
  ]
}
```

**Success criteria**:
- One checkpoint file exists per iteration (e.g., `checkpoint-1.patch`, `checkpoint-2.patch`)
- Each checkpoint file is a valid git diff
- Checkpoint files are listed in the report summary
- Checkpoint files are in `.gitignore` (not committed)

---

## Check 5: No Auto-Commit / No Git Mutation

### Purpose

Verify that the loop never modifies git history or creates commits.
All patches are local-only; the operator must manually review and commit if desired.

### Setup

1. Ensure git repo is clean (no uncommitted changes):
   ```bash
   git status
   # Output: On branch main, nothing to commit, working tree clean
   ```
2. Ensure `.opencode/analysis-loop/` directory exists
3. Ensure `.opencode/analysis-loop/patch-scope.md` exists
4. Run the analyze-plugin-loop command and let it apply at least 1 patch

### Execute

Run the analyze-plugin-loop command:

```bash
bun run analyze-plugin-loop
```

After the loop completes, check git status:

```bash
git status
git log --oneline -5
git diff --stat
```

### Expected Evidence

After loop completes:

```bash
$ git status
On branch main
Changes not staged for commit:
  (use "git add <file>..." to update the what will be committed)
  (use "git restore <file>..." to discard changes in working directory)
        modified:   packages/opencode-gitbutler/src/plugin.ts
        modified:   packages/opencode-gitbutler/src/config.ts

Untracked files:
  (use "git add <file>..." to track the what will be committed)
        .opencode/analysis-loop/checkpoint-1.patch
        .opencode/analysis-loop/checkpoint-2.patch
        .opencode/analysis-loop/patch-ledger.json
        .opencode/analysis-loop/report.md
```

Git log is unchanged:

```bash
$ git log --oneline -5
# Output: same as before loop started (no new commits)
```

Checkpoint and report files are untracked:

```bash
$ git ls-files .opencode/analysis-loop/
# Output: (empty — no tracked files in analysis-loop except report-template.md and patch-scope.md)
```

In loop logs:

```
[INFO] Analysis loop completed.
[INFO] All patches are local-only. No git commits created.
[INFO] To review changes: git diff -- packages/opencode-gitbutler/src/
[INFO] To revert: git checkout -- packages/opencode-gitbutler/src/
```

**Success criteria**:
- `git log` shows no new commits
- `git status` shows modified files (patches applied) but no staged changes
- Checkpoint and report files are untracked (not in git index)
- Loop logs explicitly state "no git commits created"
- Operator can manually review changes with `git diff` and decide to commit or revert

---

## Running All Checks

To run all 5 checks in sequence:

```bash
# 1. Verify missing-source handling
# (Ensure debug.log, search-opencode-history.ts, and but CLI are unavailable)
bun run analyze-plugin-loop
# Check report.md for source availability warnings

# 2. Verify out-of-allowlist rejection
# (Manually trigger a patch proposal to package.json or similar)
# Check report.md for rejection reason

# 3. Verify convergence stop
# (Run loop until 2 consecutive zero-patch iterations)
bun run analyze-plugin-loop
# Check report.md for "converged" exit reason

# 4. Verify checkpoint creation
# (Run loop with at least 1 patch applied)
bun run analyze-plugin-loop
ls -la .opencode/analysis-loop/checkpoint-*.patch
# Verify checkpoint files exist

# 5. Verify no git mutation
# (Run loop and check git status afterward)
git status
git log --oneline -5
# Verify no new commits, only local changes
```

---

## Integration with Command and Template

These checks align with:

- **`.opencode/command/analyze-plugin-loop.md`**: Defines the loop phases and stop conditions
- **`.opencode/analysis-loop/patch-scope.md`**: Defines the allowlist and rejection rules
- **`.opencode/analysis-loop/report-template.md`**: Defines the report structure for evidence collection

All checks are verifiable by inspecting:
- `.opencode/analysis-loop/report.md` (primary evidence)
- `.opencode/analysis-loop/patch-ledger.json` (patch tracking)
- `.opencode/analysis-loop/checkpoint-*.patch` (recovery files)
- `git status` and `git log` (git state)
- Loop logs (if available)

---

## Notes for Operators

- **Check 1** (missing sources) is automatic — the loop will log warnings for unavailable sources
- **Check 2** (allowlist rejection) is automatic — the loop enforces patch-scope.md rules
- **Check 3** (convergence) is automatic — the loop exits after 2 zero-patch iterations
- **Check 4** (checkpoints) is automatic — the loop creates checkpoints before each patch
- **Check 5** (no git mutation) is automatic — the loop uses read-only git commands only

To verify all checks pass, run the loop once and inspect the report, ledger, and git status.
If all 5 checks show expected evidence, the loop is functioning correctly.
