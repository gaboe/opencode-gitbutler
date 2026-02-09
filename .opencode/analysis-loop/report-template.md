# Plugin Analysis Loop Report

## Metadata

- **Start**: {START_TIME}
- **End**: {END_TIME}
- **Duration**: {DURATION_MINUTES}m {DURATION_SECONDS}s
- **Exit reason**: {EXIT_REASON}
  - Options: `timeout` (30-min hard limit reached), `converged` (2 consecutive zero-patch iterations), `error` (critical failure)
- **Iterations completed**: {ITERATION_COUNT}
- **Data sources available**:
  - Plugin debug log: {AVAILABLE_YES_NO}
  - Session history: {AVAILABLE_YES_NO}
  - Git log: {AVAILABLE_YES_NO}
  - `but` CLI: {AVAILABLE_YES_NO}

---

## Executive Summary

- **Total patches proposed**: {TOTAL_PROPOSED}
- **Total patches applied**: {TOTAL_APPLIED}
- **Total patches rejected**: {TOTAL_REJECTED}
- **Files modified**: {FILE_LIST}
- **Key findings**:
  - {Finding 1}
  - {Finding 2}
  - {Finding 3}

---

## Iteration Log

### Iteration 1

**Timestamp**: {ISO_8601_TIMESTAMP}

**Analysis**:
- Sources consulted: {list of available sources}
- Issues found: {count}
- Top issues:
  - {Issue 1}: {severity}, {affected file(s)}
  - {Issue 2}: {severity}, {affected file(s)}

**Patches**:
- Proposed: {count}
- Applied: {count}
- Rejected: {count}

**Changes**:
- {file}: {description of change}

**Rejections** (if any):
- {file}: {rejection reason}

---

### Iteration N

**Timestamp**: {ISO_8601_TIMESTAMP}

**Analysis**:
- Sources consulted: {list}
- Issues found: {count}
- Top issues:
  - {Issue}: {severity}, {file}

**Patches**:
- Proposed: {count}
- Applied: {count}
- Rejected: {count}

**Changes**:
- {file}: {description}

**Rejections** (if any):
- {file}: {reason}

---

## Patch Ledger

| Iteration | Timestamp | File(s) | Start Line | End Line | Status | Description |
|-----------|-----------|---------|------------|----------|--------|-------------|
| 1 | {ISO_8601} | src/plugin.ts | 42 | 48 | applied | Added null-check for config object |
| 2 | {ISO_8601} | src/index.ts | 15 | 20 | rejected | Overlaps iteration 1 patch at src/plugin.ts:40-50 |
| N | {ISO_8601} | {file} | {start} | {end} | {status} | {description} |

---

## Remaining Issues

Issues identified during analysis but not addressed (for manual review):

- {Issue 1}: {description}, {affected file}, {severity}
- {Issue 2}: {description}, {affected file}, {severity}

---

## Summary

**Loop exit**: {EXIT_REASON}

**Recommendations for next run**:
- {Recommendation 1}
- {Recommendation 2}

**Checkpoint files created**:
- `.opencode/analysis-loop/checkpoint-1.patch`
- `.opencode/analysis-loop/checkpoint-N.patch`

**Final state**:
- All patches are local-only (not committed)
- Patch ledger saved to `.opencode/analysis-loop/patch-ledger.json`
- Final diff available at `.opencode/analysis-loop/final-changes.patch`
