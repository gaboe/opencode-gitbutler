---
description: Create a GitButler branch from current changes with a descriptive name
---

# Create GitButler Branch

Analyze all modified/unassigned files, create a new `but` branch with a meaningful name, and assign changes to it.

## Delegation

Delegate change-scope analysis and branch-name proposal; keep branch creation and staging actions in the main agent.
Flow: Subagent (analyze/summarize) -> Main agent (decide/execute).

## Additional Instructions

$ARGUMENTS

## Instructions

### Step 1: Sync and check state

```bash
but pull
but status --json -f
```

Review the output:
- Identify **unassigned changes** (in `zz` or uncommitted)
- Identify which files YOU modified (if unsure, list them and ask)
- Check if an existing branch already matches this work

### Step 2: Analyze changes and generate branch name

Look at the modified files and understand the scope of changes:

1. Read the changed files to understand what was done
2. Classify the change type: `feat/`, `fix/`, `chore/`, `refactor/`, `docs/`
3. Generate a descriptive branch name (e.g., `feat/add-user-settings`, `fix/auth-token-refresh`)

**Branch name rules:**
- Use conventional prefix: `feat/`, `fix/`, `chore/`, `refactor/`, `docs/`
- Use kebab-case after prefix
- Keep it short but descriptive (max 50 chars total)
- Must describe WHAT the changes do, not WHERE they are

### Step 3: Create branch and assign changes

```bash
but branch new <branch-name>
```

Then check status to get file IDs:

```bash
but status --json -f
```

If files are unassigned (in `zz`), stage them to the new branch:

```bash
but stage <file-id> <branch-name>
```

Repeat for each unassigned file that belongs to this work.

### Step 4: Verify

```bash
but status --json -f
```

Confirm:
- Branch exists with correct name
- All relevant files are assigned to the branch
- No unrelated files were moved

Report: "Branch `<branch-name>` created with N files assigned."

## Constraints

- **NEVER discard changes** in `zz` that you didn't create
- **NEVER move files** that don't belong to current work
- If unsure which files belong to the branch, **ASK the user**
- If a matching branch already exists, **ASK** whether to reuse it or create a new one

## State

!`but status --json -f 2>/dev/null || echo "GitButler not active"`
