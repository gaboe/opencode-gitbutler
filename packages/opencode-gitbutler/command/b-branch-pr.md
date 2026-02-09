---
description: Create GitButler branch, commit, push, open PR, and monitor CI with auto-fix
---

# Create GitButler Branch, PR, and Monitor CI

Full workflow: analyze changes → create/reuse branch → commit → push → create PR → monitor CI → auto-fix failures and review comments.

## Delegation

Delegate PR-state and CI-failure analysis; keep branch writes, pushes, and PR updates in the main agent.
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
- Check if branch already has a PR (Step 6 will handle this)

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

### Step 4: Format and validate

```bash
bun run format
bun run check
```

Fix any issues found by `bun run check` before proceeding. Re-run until clean.

### Step 5: Commit

```bash
but status --json -f
```

Collect the file/hunk IDs that belong to this branch, then commit:

```bash
but commit <branch> -m "<type>(<scope>): <description>" --changes <id>,<id>
```

**Commit message rules:**
- Conventional commits: `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`
- Include scope when clear (e.g., `feat(auth):`, `fix(ui):`)
- Short description (max 72 chars)

If format changes were generated, absorb them:

```bash
but status --json -f
but absorb <format-file-id>
```

### Step 6: Push and create/update PR

Push the branch:

```bash
but push <branch>
```

Check if a PR already exists for this branch (must specify `--head` in GitButler workspace):

```bash
bun run gh-tool pr view --head <branch> 2>/dev/null
```

**If no PR exists**, create one:

```bash
but pr new <branch> -t
```

Or with a custom message for more control:

```bash
but pr new <branch> -m "<PR title>

## Summary
<1-2 sentences>

## Changes
- <bullet list>"
```

**If PR already exists**, update it:

```bash
bun run gh-tool pr edit <pr_number> --title "<title>" --body "<body>"
```

Get the PR number for monitoring:

```bash
bun run gh-tool pr view --head <branch> --json number -q .number
```

### Step 7: Monitor CI checks

Inform the user: "PR created/updated. Monitoring CI checks... (say 'stop' to exit)"

#### 7.1 Wait for checks

```bash
bun run gh-tool pr checks --pr <pr_number> --watch --fail-fast > /dev/null 2>&1; echo $?
```

**Exit codes:**
- `0` - All checks passed
- `1` - One or more checks failed

#### 7.2 Handle check results

**If checks failed (exit code 1):**

1. Get failed check details:
   ```bash
   bun run gh-tool pr checks-failed --pr <pr_number>
   ```

2. Analyze the failure, fix locally
3. Run `bun run check` to validate
4. Format, commit, and push the fix:
   ```bash
   bun run format
   but status --json -f
   but commit <branch> -m "fix: resolve CI check failures" --changes <id>,<id>
   but push <branch>
   ```
5. **Go back to Step 7.1**

**If checks passed (exit code 0):**

1. Check for review comments:
   ```bash
   bun run gh-tool pr threads --pr <pr_number> --unresolved-only
   bun run gh-tool pr issue-comments-latest --pr <pr_number> --author claude --body-contains "Claude Code Review"
   ```

2. **If unresolved review comments exist:**
   - Inform user: "CI passed but review comments found. Processing..."
   - **Execute the pr-fix-comments workflow** (Steps 3-7 from pr-fix-comments command):
     - Analyze each comment
     - Apply valid fixes
     - Reply to each comment and resolve threads
     - Run `bun run check`
     - Commit and push fixes using `but commit <branch> --changes`
   - **Go back to Step 7.1** to re-monitor

3. **If no comments:**
   - Inform user: "All checks passed and no review comments. PR is ready for review!"
   - Exit

#### 7.3 Loop exit conditions

Exit when:
- All checks pass AND no unresolved review comments
- User says "stop"
- Maximum 5 iterations reached (ask user to continue)

## PR Body Format

```
## Summary
<1-2 sentences>

## Changes
- <bullet list>
```

## Constraints

- **NEVER commit without `--changes`** — prevents committing other agents' work
- **NEVER discard changes** in `zz` that you didn't create
- **NEVER move files** that don't belong to current work
- **ALWAYS run `bun run format`** before committing
- **ALWAYS run `bun run check`** before first push
- If unsure which files belong, **ASK the user**

## State

!`but status --json -f 2>/dev/null || echo "GitButler not active"`

### Existing PR
!`bun run gh-tool pr view 2>/dev/null || echo "No PR found for current branch"`
|||||||
