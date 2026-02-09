# Plugin Analytics Watchdog - Agent Loop Plan

## TL;DR

- Create maintainer-only command to run periodic plugin analysis.
- Data sources: plugin debug log, OpenCode session history, git log, and `but` CLI output.
- Loop analyzes patterns, proposes/implements local patches, writes report, checkpoints state, repeats.

## Objective

- Add a command-driven workflow for iterative hardening of the plugin.
- This is not an end-user runtime feature; it is an operator/maintainer workflow.

## Core Risks and Guardrails

- Patch oscillation across iterations -> maintain patch ledger and skip overlapping regions.
- Out-of-scope edits -> strict path allowlist.
- Unrecoverable local state -> per-iteration checkpoint patches.
- Noisy endless loop -> convergence + timeout stop rules.

## Tasks

- [x] 1. Runtime directory setup
  - Create `.opencode/analysis-loop/`
  - Add runtime artifact policy (`checkpoint-*.patch`, `patch-ledger.json`)

- [x] 2. Define patch scope and protected surface
  - Allowlist patchable files
  - Mark public API surface as read-only

- [x] 3. Create `.opencode/command/analyze-plugin-loop.md`
  - Setup phase
  - Loop phase (analyze -> patch -> report -> checkpoint -> sleep)
  - Teardown phase
  - Hard constraints and stop conditions

- [x] 4. Add report template
  - `.opencode/analysis-loop/report-template.md`
  - Sections: metadata, executive summary, iteration log, patch ledger

- [x] 5. Document acceptance checks
  - Missing-source graceful handling
  - Out-of-allowlist rejection
  - Convergence stop
  - Checkpoint creation
  - No auto-commit behavior

## Required Stop Conditions

- 30-minute hard timeout
- Two consecutive iterations with zero patches (converged)
- Abort on analysis-phase critical error

## Verification

- Command file exists and is executable by agent workflow
- Report and patch ledger are generated on run
- Checkpoint files created per iteration
- No git commits created by loop
