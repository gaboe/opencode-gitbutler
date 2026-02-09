# GitButler CLI Tutorial

A hands-on guide to working with `but` — safer, faster, and more intuitive than raw git.

## Table of Contents

1. [What is GitButler?](#what-is-gitbutler)
2. [First Steps](#first-steps)
3. [Understanding Status Output](#understanding-status-output)
4. [Your First Commit](#your-first-commit)
5. [Fixing Commit Messages](#fixing-commit-messages)
6. [Squashing Commits](#squashing-commits)
7. [Auto-Amending with Absorb](#auto-amending-with-absorb)
8. [Working on Multiple Features](#working-on-multiple-features)
9. [Stacked Branches](#stacked-branches)
10. [Undo and Recovery](#undo-and-recovery)
11. [Conflict Resolution](#conflict-resolution)
12. [Creating Pull Requests](#creating-pull-requests)
13. [Post-Merge Cleanup](#post-merge-cleanup)
14. [Tips and Gotchas](#tips-and-gotchas)

---

## What is GitButler?

GitButler replaces most git write commands with safer alternatives:

| Feature | Git | GitButler |
|---------|-----|-----------|
| Undo anything | Complex reflog | `but undo` |
| Squash commits | `rebase -i` + editor | `but squash` |
| Fix old commit | stash, rebase, amend | `but absorb` |
| Multiple features | Switch branches constantly | Virtual branches (simultaneous) |
| Safe time travel | Risky reset | `but restore <sha>` |

Your repository is still a regular Git repo. GitButler works on top of it.

---

## First Steps

### Check if GitButler is active

```bash
git branch --show-current
```

If the result is `gitbutler/workspace`, you're in GitButler mode. Use `but` commands for all write operations.

### Start every session with

```bash
but pull                # Get latest upstream changes
but status --json -f    # See workspace state
```

**Always start here.** This prevents stale-base conflicts and shows you what's going on.

---

## Understanding Status Output

Run `but status` to see your workspace:

```
╭┄00 [Unassigned Changes]
┊   a1 M calculator.py [LOCKED] 8ebedce
┊   a2 A new-file.py
┊
┊╭┄bu [calculator-feature]
┊●   c3 859393e Add main entry point
┊●   c2 bac83b0 Add complete test suite
┊●   c1 8ebedce Add divide function
├╯
┊
┊╭┄bv [utilities-feature] (no commits)
├╯
┊
┴ 6e7da9e (common base) [origin/main]
```

### Key elements

| Element | Meaning |
|---------|---------|
| `a1`, `a2` | File/change IDs (use in commands) |
| `bu`, `bv` | Branch IDs |
| `c1`, `c2`, `c3` | Commit IDs |
| `M`, `A`, `D` | Modified, Added, Deleted |
| `[LOCKED] 8ebedce` | GitButler detected this change belongs to that commit |
| `●` | A commit in the branch |
| `(common base)` | Where branches diverge from remote |

### For agents: use `--json`

```bash
but status --json       # Structured output for parsing
but status --json -f    # With full file lists
```

**IDs change after every operation.** Always refresh with `but status` before using IDs.

---

## Your First Commit

### The Problem

You edited `api.js` and want to commit it to a branch.

### The Solution

```bash
# 1. Check what's changed
but status --json -f

# 2. Create a branch (if needed)
but branch new feat/add-api-endpoint

# 3. Commit specific files by their IDs
but commit feat/add-api-endpoint -m "Add user details endpoint" --changes a1
```

### Why `--changes`?

Without `--changes`, `but commit` grabs ALL uncommitted changes — including files from other work or other agents. **Always use `--changes <id>,<id>` to commit only what you intend.**

```bash
# SAFE: commit only file a1
but commit bu -m "Add endpoint" --changes a1

# RISKY: commits EVERYTHING uncommitted
but commit bu -m "Add endpoint"
```

**In git, this would be:** `git add api.js && git commit -m "Add endpoint"`

---

## Fixing Commit Messages

### The Problem

```
●   c2 8b8568c Add basic calculator fnctions  ← typo!
```

### The Solution

```bash
but reword c2 -m "Add basic calculator functions"
```

GitButler automatically rebases all dependent commits. All commits get new SHAs (this is normal).

**In git, this would require:** `git rebase -i`, change `pick` to `reword`, edit in editor, save, hope for no conflicts.

---

## Squashing Commits

### The Problem

```
●   c5 Fix test edge case
●   c4 Fix another test
●   c3 Add tests
●   c2 Implement feature
●   c1 Initial scaffold
```

Too many small commits. You want a clean history.

### The Solution

**Squash all commits in a branch:**

```bash
but squash bu    # Squash all commits in branch bu into one
```

**Squash specific commits:**

```bash
but squash c3 c4 c5    # Squash these three into one
```

**Squash a range:**

```bash
but squash c3..c5    # Squash from c3 to c5
```

After squashing, update the message:

```bash
but reword c1 -m "Implement feature with full test suite"
```

**In git, this would require:** `git rebase -i` with pick/squash commands, conflict resolution, and editor juggling.

---

## Auto-Amending with Absorb

This is GitButler's killer feature.

### The Scenario

You fix a bug in a function, but the fix should go into the original commit that added that function — not as a new "fix typo" commit.

### The Solution

```bash
# 1. Edit the file, then check status
but status --json -f
# Shows: a1 M file.py [LOCKED] abc123  ← Detected dependency!

# 2. Preview what absorb would do
but absorb a1 --dry-run

# 3. Auto-amend to the correct commit
but absorb a1
```

GitButler automatically:
1. Analyzes which lines changed
2. Finds the commit that introduced them
3. Amends the change into that commit
4. Rebases all dependent commits

### Targeted vs blanket absorb

```bash
but absorb a1      # Absorb specific file (RECOMMENDED)
but absorb bu      # Absorb all changes staged to branch bu
but absorb         # Absorb EVERYTHING (use with caution in multi-agent setups)
```

**In git, this would require:** `git stash` → `git rebase -i` → mark commit for edit → `git stash pop` → `git add` → `git commit --amend` → `git rebase --continue`

With GitButler: just `but absorb a1`.

---

## Working on Multiple Features

### The Problem

You need to work on an API endpoint AND fix a UI bug, but don't want to switch branches.

### The Solution: Parallel Branches

```bash
# 1. Create two branches
but branch new feat/api-endpoint
but branch new fix/button-styling

# 2. Edit files for both features (in the same working directory!)

# 3. Check status to get file IDs
but status --json -f
# a1 M api/users.js
# a2 M components/Button.tsx

# 4. Commit each file to the right branch
but commit feat/api-endpoint -m "Add user endpoint" --changes a1
but commit fix/button-styling -m "Fix button hover state" --changes a2

# 5. Push and create PRs independently
but pr new feat/api-endpoint -t
but pr new fix/button-styling -t
```

**No context switching!** Both branches are active simultaneously.

**In git, this would require:** Stash, checkout, work, commit, checkout back, stash pop, repeat.

---

## Stacked Branches

### When to Use

When Feature B depends on Feature A (e.g., user profile page needs authentication).

### The Solution

```bash
# 1. Create base branch
but branch new feat/authentication

# 2. Implement auth and commit
but commit feat/authentication -m "Add JWT authentication" --changes a1,a2

# 3. Create stacked branch anchored on auth
but branch new feat/user-profile -a feat/authentication

# 4. Implement profile (depends on auth code)
but commit feat/user-profile -m "Add user profile page" --changes a3

# 5. Push both
but push
```

**Result:** Two PRs where user-profile depends on authentication. GitHub shows the dependency.

### Parallel vs Stacked — when to use which

| Use Parallel | Use Stacked |
|---|---|
| Tasks don't depend on each other | Feature B needs code from Feature A |
| Can be merged independently | Must merge in order |
| API endpoint + unrelated bug fix | Auth → Profile → Settings |

---

## Undo and Recovery

### Quick Undo (one step back)

```bash
but undo    # Reverts the last operation
```

Works for: commits, squashes, absorbs, branch operations, file movements.

### Time Travel (go back further)

```bash
# View all operations
but oplog

# Output:
# s5 [SQUASH] SquashCommit
# s4 [CREATE] CreateCommit
# s3 [MOVE_HUNK] MoveHunk

# Restore to any point
but oplog restore s4
```

Even undos are tracked. You can undo an undo.

### Create Safety Checkpoints

Before risky operations:

```bash
but oplog snapshot -m "before-major-refactor"
```

**When to use `undo` vs `restore`:**
- **`but undo`**: Last operation went wrong. Quick single-step rollback.
- **`but oplog restore`**: Need to go back multiple operations or to a named checkpoint.

---

## Conflict Resolution

After `but pull`, some commits may have conflicts.

### The Workflow

```bash
# 1. Status shows conflicted commits
but status --json
# c3: Add validation (CONFLICTED)

# 2. Enter resolution mode
but resolve c3

# 3. Fix conflicts in files (remove <<< === >>> markers)

# 4. Check progress
but resolve status

# 5. Finalize
but resolve finish
```

**During resolution:** You're in a special mode. Other GitButler operations are limited until you finish or cancel.

```bash
but resolve cancel    # Abort resolution, return to workspace
```

---

## Creating Pull Requests

```bash
# Auto-pushes and creates PR (recommended)
but pr new feat/my-feature -t

# With custom title/description
but pr new feat/my-feature -m "Add user dashboard

Implements the main dashboard with widgets and charts."

# From file (first line = title, rest = description)
but pr new feat/my-feature -F pr_message.txt
```

**Key:** `but pr new` automatically pushes the branch. No need to `but push` first.

---

## Post-Merge Cleanup

After a PR is squash-merged on GitHub:

```bash
# 1. MUST unapply BEFORE pull (prevents orphan branch errors)
but unapply feat/my-feature

# 2. Pull merged changes
but pull
```

**Critical:** If you `but pull` before unapplying the merged branch, GitButler errors with orphan branch conflicts. Always unapply first.

---

## Tips and Gotchas

### 1. Always refresh IDs

IDs (`a1`, `bu`, `c3`) change after every operation. Run `but status --json` before using them.

### 2. Use `--json` for automation

All commands support `--json` for structured output. Always use it when scripting or running as an agent.

### 3. Use `--changes` for safe commits

Never commit without `--changes` in multi-agent environments. Without it, you may commit other agents' work.

### 4. Don't mix git and but writes

`git commit`, `git checkout`, `git push` can corrupt virtual branch state. Use `but` equivalents. Read-only git commands (`git log`, `git diff`, `git blame`) are fine.

### 5. Commit early and often

GitButler makes editing history trivial. Small atomic commits are better than large uncommitted changes — you can always `squash`, `reword`, or `absorb` later.

### 6. Preview before doing

```bash
but absorb a1 --dry-run    # See where file would be absorbed
but push --dry-run          # See what would be pushed
```

### 7. The workspace commit

You'll see a "GitButler Workspace Commit" in `git log`. This is an internal placeholder — ignore it.

### 8. Post-merge: always unapply first

```bash
but unapply <merged-branch>    # THEN
but pull                        # NOT the other way around
```

---

## Summary: Why Use But?

| Task | Git Complexity | But Simplicity |
|------|---------------|----------------|
| Fix old commit message | `rebase -i`, edit, continue | `but reword` |
| Squash commits | `rebase -i`, pick/squash, conflicts | `but squash` |
| Amend to old commit | stash, rebase, edit, pop, amend, continue | `but absorb` |
| Undo anything | Complex/impossible | `but undo` or `but restore` |
| Multiple features | Stash, checkout, work, checkout, pop | Virtual branches |
| Targeted commit | `git add -p` | `but commit --changes` |
| Create PR | push, open browser, fill form | `but pr new -t` |

---

## Next Steps

- **Quick lookup:** See `references/cheatsheet.md` for a one-page command reference
- **Deep dive:** See `references/concepts.md` for the workspace model and philosophy
- **Real workflows:** See `references/examples.md` for 11 production scenarios
- **Full API:** See `references/reference.md` for every command and flag
