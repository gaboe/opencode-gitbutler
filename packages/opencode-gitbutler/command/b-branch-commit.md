---
description: Create GitButler branch from changes and commit
---

# Create GitButler Branch and Commit

Analyze modified files, create/reuse a `but` branch with a meaningful name, format code, and commit changes.

## Delegation

Delegate change analysis and commit-message drafting; keep formatting and `but commit --changes` execution in the main agent.
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

### Step 2: Decide branch strategy

**If changes are already on a named branch** (not `zz`):
- Reuse that branch, skip to Step 4

**If changes are unassigned** (in `zz`):
- Analyze the modified files to understand the scope
- Classify: `feat/`, `fix/`, `chore/`, `refactor/`, `docs/`
- Generate descriptive branch name (e.g., `feat/add-user-settings`)

**If an existing branch matches the work:**
- ASK user whether to reuse it or create new

### Step 3: Create branch and assign changes (if needed)

```bash
but branch new <branch-name>
but status --json -f
but stage <file-id> <branch-name>
```

Repeat staging for each unassigned file that belongs to this work.

### Step 4: Format code

```bash
bun run format
```

### Step 5: Get change IDs and commit

```bash
but status --json -f
```

Collect the file/hunk IDs that belong to this branch, then commit:

```bash
but commit <branch> -m "<type>(<scope>): <description>" --changes <id>,<id>
```

**Commit message rules:**
- Use conventional commits: `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`
- Include scope when clear (e.g., `feat(auth):`, `fix(ui):`)
- Short description (max 72 chars)
- Describe WHAT and WHY, not HOW

If the pre-commit hook fails on YOUR changes, fix the code and retry.
If the hook fails on pre-existing errors, run `bun run format` and use `--no-hooks`.

### Step 6: Verify

```bash
but status --json -f
```

Confirm:
- Branch exists with correct name
- Changes are committed
- No unrelated files were committed

Report: "Branch `<branch-name>` created. Committed: `<commit-message>`"

## Constraints

- **NEVER commit without `--changes`** — this prevents committing other agents' work
- **NEVER discard changes** in `zz` that you didn't create
- **NEVER move files** that don't belong to current work
- **ALWAYS run `bun run format`** before committing
- If unsure which files belong, **ASK the user**

## State

!`but status --json -f 2>/dev/null || echo "GitButler not active"`
