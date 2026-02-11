# Plugin DX Analysis Report

## Metadata
- **Project**: `/Users/gabrielecegi/bp/t/andocs`
- **Context**: consumer project (runtime telemetry from real usage)
- **Date**: 2026-02-09T17:27:00+01:00
- **Duration**: ~18m
- **Data sources**:
  - `[OK]` Plugin debug log: `/Users/gabrielecegi/bp/t/andocs/.opencode/plugin/debug.log`
  - `[OK]` Session history: OpenCode sessions for `andocs` project
  - `[OK]` Git log: `git log --oneline -80`
  - `[OK]` `but` CLI status: `but status --json -f`
- **Iterations**: 6 clusters + cross-cutting synthesis

## Feature Scorecard

| # | Feature | Status | Success Rate | Key Evidence |
|---|---------|--------|--------------|--------------|
| 1 | Post-edit hook | Working | ~85% observed edit paths | `after-edit` 182, `cursor-ok(after-edit)` 155, `rub-ok` 70 |
| 2 | Stop/idle hook | Degraded | ~89% (stop ok with retries) | `session-stop` 302, `cursor-ok(stop)` 350, `cursor-error(stop)` 34 |
| 3 | Pre-edit lock serialization | Degraded | High but imperfect | `lock-acquired` 617, `lock-timeout` 2, mixed legacy/new lock-release telemetry |
| 4 | Branch creation (session -> branch) | Working | Observed | `after-edit` with stable `conversationId`; branches materialized in `but status` |
| 5 | File-to-branch assignment | Degraded | Partial | `but status` currently shows unassigned `g0` for `agent-tools/gh-tool/pr.ts` |
| 6 | Auto-assign existing branch (`but rub`) | Working | 100% in observed logs | `rub-ok` 70, no `rub-failed` observed |
| 7 | No phantom branches for read-only sessions | Working | 100% in sampled check | `stop_without_after = 0`, `stop_ok_without_after = 0` |
| 8 | Empty branch cleanup | Degraded | 94% (17/18) | `cleanup-ok` 17, `cleanup-failed` 1 (`ge-branch-139`) |
| 9 | Auto-commit on stop | Degraded | Mostly works | stop flow present, but periodic lock/DB errors in historical log |
| 10 | LLM commit message generation | Working | 100% in recent NDJSON sample | `llm-start` 1 -> `llm-success` 1; many `reword` entries with `source:"llm"` |
| 11 | Deterministic fallback path | Working | Present | `reword` entries with `source:"deterministic"` observed |
| 12 | Commit reword | Working | High | `reword` 70, no `reword-failed` / `reword-error` matches |
| 13 | Branch auto-rename (`ge-branch-N`) | Working | Observed | Notification evidence: `Branch renamed from ge-branch-* ...` (4 matches) |
| 14 | No rename of user-named branches | Working | Observed | Rename notifications only target `ge-branch-*` |
| 15 | Context injection | Working | High | `notification-queued` 126 -> `context-injected` 43 |
| 16 | Session title sync | Working | High | 56 `Session title updated to ...` notifications |
| 17 | Session mapping for subagents | Working | Observed | `session-map-subagent` 7 with parent linkage |
| 18 | No cross-session branch leaks | Untested | N/A | No direct collision marker; not provable from current logs alone |
| 19 | State persistence across restart | Working | High | `state-loaded` 58 with non-zero counts |
| 20 | Stale lock cleanup robustness | Degraded | High but not zero-failure | `lock-timeout` present (2), no explicit `lock-stale` events in sample window |
| 21 | Rub multi-branch guard | Untested | N/A | No `rub-skip-multi-branch` events observed |

**Summary**: 14 Working, 6 Degraded, 0 Broken, 2 Untested

## Findings

### Critical (Broken)
- None observed as consistently broken in sampled runtime data.

### Important (Degraded)

#### 1) Assignment drift still appears in active workspace
- **User experience**: A file with recent branch history can appear as unassigned, requiring manual cleanup.
- **Evidence**: `but status --json -f` currently reports unassigned `g0` for `agent-tools/gh-tool/pr.ts` while related branch work exists.
- **Root cause (hypothesis)**: Race/order edge case between post-edit flow, branch status refresh, and `rub` assignment path.
- **Suggested direction**: Add post-stop/periodic assignment reconciliation and explicit telemetry for assignment decisions.

#### 2) Stop flow reliability has intermittent DB/reference failures
- **User experience**: Occasional stop-cycle hiccups (retry/failure logs), potential delayed commit/reword/cleanup.
- **Evidence**: historical `cursor-error` includes `database is locked`, workspace reference mismatch, `Stack not found`.
- **Root cause (hypothesis)**: transient GitButler DB/workspace contention under rapid multi-session activity.
- **Suggested direction**: keep bounded retries + classify transient vs terminal stop errors in metrics dashboards.

#### 3) Empty cleanup is not fully reliable
- **User experience**: Some empty `ge-branch-*` artifacts linger.
- **Evidence**: `cleanup-ok` 17 vs `cleanup-failed` 1.
- **Root cause (hypothesis)**: branch state changed during cleanup window or CLI refusal due workspace state.
- **Suggested direction**: deferred retry queue for cleanup-failed branches with guardrails.

#### 4) Locking mostly works but still times out in rare cases
- **User experience**: rare edit path stalls/lock waits.
- **Evidence**: `lock-timeout` 2 events.
- **Root cause (hypothesis)**: long-running competing operations with no stale-release trigger in those windows.
- **Suggested direction**: enrich lock telemetry with owner age + operation type; introduce adaptive stale thresholds.

### Improvement Opportunities

#### 5) Rename observability is split
- **User experience**: branch rename works, but dedicated `branch-rename` categories are sparse; evidence appears mainly via notifications.
- **Evidence**: rename message notifications exist; direct category hits are minimal in current mixed-format log.
- **Root cause (hypothesis)**: legacy/new log format overlap and partial category adoption.
- **Suggested direction**: normalize all rename outcomes to structured `branch-rename` / `branch-rename-failed` entries.

#### 6) Cross-session leak guard lacks explicit proof metric
- **User experience**: behavior looks healthy, but operator cannot prove isolation quickly.
- **Evidence**: `session-map-subagent` exists, but no explicit per-root branch ownership assertion.
- **Root cause (hypothesis)**: observability gap, not necessarily functional gap.
- **Suggested direction**: emit periodic root-session -> branch mapping snapshots for auditability.

## External Context (Research)
- Git automation pitfalls from external evidence strongly match observed local risks:
  - DB/workspace contention during concurrent operations
  - assignment/reconciliation drift
  - commit/rename trust/quality observability gaps
- GitButler CLI semantics from official docs/source are consistent with plugin expectations (`cursor`, `rub`, `reword`, `status --json -f`).

## Raw Data Summary
- **debug.log**: 2024 lines total; categories include 617 `lock-acquired`, 471 `cursor-ok`, 182 `after-edit`, 70 `rub-ok`, 70 `reword`, 126 `notification-queued`, 43 `context-injected`.
- **warn/error-like events**: 37 inferred from legacy categories (`*error*`, `*failed*`, `*timeout*`), including 34 `cursor-error`, 2 `lock-timeout`, 1 `cleanup-failed`.
- **but status**: 3 active stacks/branches in current workspace snapshot, 1 unassigned change.
- **Session history**: active multi-session usage confirmed (recent high-volume `andocs` sessions).
- **Git log**: 80 recent commits reviewed for branch/reword flow context.

## Recommendations
1. Prioritize assignment reconciliation telemetry and recovery for unassigned drift cases.
2. Add explicit stop-flow reliability counters (retry count, terminal vs transient classification).
3. Implement cleanup retry policy for `cleanup-failed` with cooldown/backoff.
4. Normalize rename telemetry into dedicated structured categories across all codepaths.
5. Add an explicit isolation audit event proving root-session to branch ownership (for leak detection).
