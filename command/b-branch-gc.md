---
description: Clean up empty or orphaned GitButler branches
---

# GitButler Branch Garbage Collection

Identify and remove empty or orphaned `ge-branch-*` branches that have accumulated from past sessions.

## When to Run

- **After multi-session work** — each agent session may create `ge-branch-*` branches that become empty after commits are moved or squashed
- **When `but status` shows 3+ `ge-branch-*` branches** — workspace clutter slows down branch selection and increases lock contention
- **After `but cursor stop` failures** — the plugin's auto-cleanup has ~12% failure rate; empty branches may persist
- **When user reports "too many branches"** — proactively offer to run this command
- **User-named branches are NEVER auto-cleaned** — only `ge-branch-*` pattern branches are candidates

## Additional Instructions

$ARGUMENTS

## Instructions

### Step 1: Survey current branches

```bash
but status --json -f
```

Review the output and categorize branches:

- **Empty branches**: `ge-branch-*` with 0 commits and 0 assigned changes — safe to remove
- **Orphaned branches**: `ge-branch-*` with commits but no recent activity — list for user review
- **Active branches**: branches with assigned changes or recent commits — DO NOT touch
- **User-named branches**: branches NOT matching `ge-branch-*` — DO NOT touch

### Step 2: Report findings

Present a summary table:

| Branch | Commits | Changes | Status | Action |
|--------|---------|---------|--------|--------|

### Step 3: Clean up empty branches

For each empty `ge-branch-*` branch (0 commits, 0 changes):

```bash
but unapply <branch-cli-id>
```

Report each cleanup result.

### Step 4: Handle orphaned branches

For orphaned `ge-branch-*` branches (has commits but appears stale):

- List them with their last commit message
- Ask the user which ones to remove
- Only remove explicitly approved branches

### Safety Rules

- NEVER remove branches that are NOT `ge-branch-*` pattern
- NEVER remove branches with assigned changes
- NEVER remove branches without user confirmation (except empty ones)
- If `but unapply` fails, log the error and continue with the next branch
