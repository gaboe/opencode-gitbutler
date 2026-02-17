# Plugin DX Analysis Report

## Metadata
- **Project**: `/Users/gabrielecegi/bp/t/andocs`
- **Context**: Consumer project runtime diagnostics (read-only)
- **Date**: 2026-02-17T07:20:49Z
- **Duration**: ~20m bounded loop
- **Data sources**:
  - `[OK]` Plugin debug log: `/Users/gabrielecegi/bp/t/andocs/.opencode/plugin/debug.log`
  - `[OK]` Session history: available (`ses_399638195ffetKBTSho12wpRvv` and related sessions)
  - `[OK]` Git log: available (`git log --oneline -50`)
  - `[OK]` `but` CLI status: available (`but status --json -f`)
- **Iterations**: 7 (full parity baseline coverage)

## Feature Scorecard

| # | Feature | Status | Success Rate | Key Evidence |
|---|---------|--------|--------------|--------------|
| 1 | Post-edit hook | **Degraded** | 88.3% (520/589) | `after-edit: 589`, `cursor-ok(after-edit): 520`; many `after-edit-already-assigned: 280` |
| 2 | Stop/idle hook | **Working** | 99.5% (419/421) | `session-stop: 421` -> `cursor-ok(stop): 419` |
| 3 | Pre-edit lock | **Working** | 93.6% pairing | `lock-acquired: 1507`, `lock-released: 1410`, `lock-timeout: 0` |
| 4 | Branch creation | **Working** | Observed | `session-map-created: 146` |
| 5 | File-to-branch assignment | **Working** | Observed | Current `but status` has `unassignedChanges: []`; reported 6 files are in commit `e7a8a260` |
| 6 | Auto-assign existing branch | **Working** | 100% (183/183) | `rub-ok: 183`, `rub-failed: 0` |
| 7 | No phantom branches | **Degraded** | N/A | Current status still shows empty branch `do` (no commits); indicates residual empty branch lifecycle friction |
| 8 | Empty branch cleanup | **Degraded** | 88.2% (45/51) | `cleanup-ok: 45`, `cleanup-failed: 6` |
| 9 | Auto-commit on stop | **Working** | 99.5% (419/421) | `session-stop: 421`, `post-stop-start: 419`, `cursor-stop-error: 0` in current window |
| 10 | LLM commit message | **Working** | 95.6% (43/45) | `llm-start: 47`, `llm-success: 43`, `llm-timeout-or-empty: 2` |
| 11 | Deterministic fallback | **Working** | 4.4% fallback | `reword` source split: `llm: 36`, `deterministic: 2` |
| 12 | Commit reword | **Degraded** | 80.9% (38/47) | `reword: 38`, `reword-failed: 9` |
| 13 | Branch auto-rename | **Untested** | N/A | `branch-rename` events are all `status:"skipped"` (`reason:"user-named"`); no default-branch rename observed in this sample |
| 14 | No rename of user-named | **Working** | 100% observed | `branch-rename` skipped `reason:"user-named"` (27 events) |
| 15 | Context injection | **Degraded** | 54.8% (142/259) | `notification-queued: 259`, `context-injected: 142`, `notification-expired: 11` |
| 16 | Session title sync | **Working** | Observed | Repeated `notification-queued` messages containing `Session title updated to ...` |
| 17 | Session mapping | **Working** | Observed | `session-map-subagent: 254` |
| 18 | No cross-session leaks | **Degraded** | N/A | No direct ownership audit event in runtime output; verification requires manual correlation |
| 19 | State persistence | **Working** | Observed | `state-loaded: 87` on plugin init cycles |
| 20 | Lock stale cleanup | **Working** | Observed | `lock-stale: 1`, `lock-timeout: 0` |
| 21 | Rub multi-branch guard | **Working** | Observed | `rub-skip-multi-branch: 4` |

**Summary**: 13 Working, 5 Degraded, 0 Broken, 1 Untested, 2 Working-with-manual-correlation caveats

## Findings

### Critical (Broken)

None currently reproducible. Current state has converged: `unassignedChanges: []`.

### Important (Degraded)

#### Finding 1: User-visible `zz` spikes are transient but alarming
- **User experience**: User sees many `zz [unstaged changes]` entries with lock markers and assumes data is stuck.
- **Evidence**: Reported snapshot showed 6 locked files in `zz`; current status shows `unassignedChanges: []` and those files committed on `fi` (`e7a8a26025797652646ad76382f6cf5634bead73`).
- **Root cause hypothesis**: Temporary unassigned/locked state during active multi-branch edits; later `rub`/stop reconciliation converges.
- **Suggested direction**: Surface a clear "transient lock/unassigned" hint in notifications to reduce false-positive incident perception.

#### Finding 2: Post-edit success appears degraded against strict baseline
- **User experience**: Not every edit emits `cursor-ok(after-edit)`; behavior can look inconsistent in logs.
- **Evidence**: 589 `after-edit` vs 520 `cursor-ok(after-edit)`, plus 280 `after-edit-already-assigned`.
- **Root cause hypothesis**: Intentional optimization paths (already-assigned fast paths) bypass strict one-to-one expectation.
- **Suggested direction**: Add explicit terminal event for no-op/optimized paths so parity scoring can distinguish expected skip vs failure.

#### Finding 3: Cleanup reliability not fully converged
- **User experience**: Empty/default branches can linger.
- **Evidence**: `cleanup-failed: 6` and current empty branch `do` in `but status`.
- **Root cause hypothesis**: Cleanup race/eligibility edge cases.
- **Suggested direction**: strengthen cleanup observability (reason codes) and rerun metrics after next release.

#### Finding 4: Context delivery drops
- **User experience**: Agent does not always receive operation summaries.
- **Evidence**: `notification-queued: 259` vs `context-injected: 142`; `notification-expired: 11`.
- **Root cause hypothesis**: delivery depends on next transform cycle; notifications can age out.
- **Suggested direction**: keep expiry telemetry and consider delivery retry on session resume.

#### Finding 5: Cross-session leak proof remains hard to audit
- **User experience**: difficult to quickly prove mapping isolation during incidents.
- **Evidence**: mapping events exist (`session-map-created`, `session-map-subagent`) but no branch ownership snapshot event in this runtime sample.
- **Root cause hypothesis**: observability gap rather than confirmed leak.
- **Suggested direction**: add periodic ownership snapshot telemetry for operational audits.

### Specific incident: "Why did many unstaged changes remain?"

- **Observed by user at incident time**: 6 files in `zz` with lock markers (`🔒`), including one with multiple lock SHAs.
- **Current verified state**: all cleared; files are now in branch `fi` commit `e7a8a260` and `unassignedChanges` is empty.
- **Authoritative semantics (docs/source)**:
  - `zz` is unassigned pool (expected intermediate state)
  - lock marker means hunk dependency constraints
  - multi-stack lock can force `stack_id=None` until reconciled
  - later `after-edit` / `stop` reconciliation can converge state
- **Conclusion**: this incident matches transient lock/assignment convergence, not persistent failure.

## Raw Data Summary

- debug.log: 7,810 structured entries (`info: 7,777`, `warn: 27`, `error: 6`)
- but status: 2 active stacks, `unassignedChanges: 0`, plus one empty branch (`do`)
- Session history: active thread `ses_399638195ffetKBTSho12wpRvv` plus historical sessions
- Git log: recent plugin-managed branch history includes commits up to `fe100889`

## Recommendations (for operator discussion)

1. Keep current fix strategy: no immediate code patch for this incident because runtime state converged and no persistent break is present.
2. Improve observability for incident triage:
   - explicit event for optimized no-op edit handling
   - branch ownership snapshot telemetry
   - stronger cleanup failure reason fields
3. Add an operator runbook for `zz + 🔒` incidents:
   - capture `but status --json -f`
   - correlate with `rub-*`, `session-stop`, `post-stop-*` in debug log
   - classify transient vs persistent after a short idle/reconciliation window.

---

*Report generated: 2026-02-17*
