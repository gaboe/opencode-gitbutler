# GitButler CLI Cheat Sheet

Quick reference for `but` commands. For full details, see `references/reference.md`.

## GitButler Detection

```bash
git branch --show-current
# "gitbutler/workspace" → Use 'but' commands for all writes
```

| Command Type | Rule |
|---|---|
| Read-only (`git log`, `git diff`, `git show`, `git blame`) | ✅ Safe, use freely |
| Has `but` equivalent (commit, push, branch, rebase) | ⚠️ **Must use `but`** |
| No `but` equivalent (cherry-pick, stash, tag, revert) | ✅ Use `git` |
| Destructive (`reset --hard`, `push --force`) | ⚠️ Create snapshot first |

---

## Session Start (Every Time)

```bash
but pull                # Sync upstream
but status --json -f    # See workspace state
```

---

## Git → But Command Mapping

| Git Command | But Command | Notes |
|---|---|---|
| `git status` | `but status --json` | Use `--json` for agents, `-f` for file lists |
| `git add <file>` | `but stage <id> <branch>` | Stage to specific branch |
| `git commit -m` | `but commit <branch> -m --changes <ids>` | Always use `--changes` |
| `git commit --amend` | `but absorb <id>` or `but amend <id> <commit>` | Smart or explicit amend |
| `git checkout -b` | `but branch new <name>` | Creates virtual branch |
| `git checkout` / `git switch` | `but apply <branch>` | Activate branch |
| `git rebase -i` (squash) | `but squash <commits>` | No editor needed |
| `git rebase -i` (reword) | `but reword <id> -m` | Auto-rebases dependents |
| `git push` | `but push <branch>` | Push specific branch |
| `git push --force` | `but push --with-force` | Use carefully |
| `git reflog` | `but oplog` | More powerful — tracks everything |
| `git reset --hard` | `but oplog restore <sha>` | Safer, reversible |
| N/A | `but undo` | Undo last operation |
| N/A | `but absorb` | Auto-amend to correct commit |
| N/A | `but pr new <branch> -t` | Push + create PR in one step |

---

## Inspection

```bash
but status --json           # Workspace overview (agent-friendly)
but status --json -f        # With full file lists
but show <id> --json        # Details about commit/branch
but diff <id>               # Diff for file, branch, or commit
but diff --json             # Diff with hunk IDs (for --changes)
```

---

## Branching

```bash
but branch new <name>           # Independent (parallel) branch
but branch new <name> -a <id>   # Stacked (dependent) branch
but branch                      # List all branches
but apply <id>                  # Activate branch in workspace
but unapply <id>                # Deactivate branch from workspace
but branch delete <id>          # Delete branch
```

---

## Committing

```bash
# RECOMMENDED: commit specific files
but commit <branch> -m "msg" --changes <id>,<id>

# Commit only pre-staged files
but commit <branch> --only -m "msg"

# RISKY: commits ALL uncommitted changes
but commit <branch> -m "msg"
```

**Getting IDs for `--changes`:**
- File IDs: `but status --json`
- Hunk IDs: `but diff --json` (for fine-grained control)

---

## Staging

```bash
but stage <file-id> <branch>    # Assign file to branch
```

---

## The `rub` Multi-Tool

One command, four operations based on source/target types:

| Source | Target | Operation | Example |
|---|---|---|---|
| File | Branch | **Stage** | `but rub a1 bu` |
| File | Commit | **Amend** | `but rub a1 c3` |
| Commit | Commit | **Squash** | `but rub c2 c3` |
| Commit | Branch | **Move** | `but rub c2 bv` |

---

## Editing History

```bash
but reword <id> -m "new msg"        # Edit commit message or rename branch
but squash <c1> <c2> <c3>           # Squash specific commits
but squash <c1>..<c4>               # Squash a range
but squash <branch>                 # Squash all commits in branch
but amend <file-id> <commit-id>     # Explicit amend (you choose target)
but absorb <file-id>                # Smart amend (GitButler chooses target)
but absorb <file-id> --dry-run      # Preview absorb
but move <commit> <target>          # Move commit to different location
but uncommit <commit-id>            # Uncommit back to unstaged area
but discard <file-id>               # Discard uncommitted changes
```

---

## Remote Operations

```bash
but push <branch>               # Push specific branch
but push                        # Push all branches with unpushed commits
but push --dry-run              # Preview what would be pushed
but pull                        # Fetch and rebase all branches
but pr new <branch> -t          # Push + create PR (auto-title)
but pr new <branch> -m "Title"  # Push + create PR with custom message
```

---

## Undo & Recovery

```bash
but undo                            # Undo last operation (one step back)
but oplog                           # View all operations
but oplog snapshot -m "checkpoint"  # Create named checkpoint
but oplog restore <snapshot-id>     # Restore to any point
```

**Quick decision:**
- Last thing went wrong → `but undo`
- Need to go back further → `but oplog` → `but oplog restore <id>`

---

## Conflict Resolution

```bash
but resolve <commit-id>     # Enter resolution mode
# Fix conflicts in files...
but resolve status           # Check remaining conflicts
but resolve finish           # Finalize resolution
but resolve cancel           # Abort, return to workspace
```

---

## Marks (Auto-staging)

```bash
but mark <branch-id>            # New changes auto-stage to this branch
but mark <commit-id>            # New changes auto-amend into this commit
but mark <id> --delete          # Remove mark
but unmark                      # Remove all marks
```

---

## Post-Merge Cleanup

```bash
but unapply <merged-branch>    # MUST do BEFORE pull
but pull                        # Then pull merged changes
```

**Order matters.** Pull before unapply = orphan branch errors.

---

## Status Symbols

| Symbol | Meaning |
|---|---|
| `A` | Added (new file) |
| `M` | Modified |
| `D` | Deleted |
| `[LOCKED]` | File depends on specific commit (absorb target) |
| `zz` | Unassigned — file not staged to any branch |
| `●` | Commit |
| `CONFLICTED` | Needs conflict resolution |

---

## Safety Rules

1. **Always use `--changes`** when committing in multi-agent environments
2. **Never discard changes you didn't create** — `zz` may contain others' work
3. **Always `but unapply` before `but pull`** after PR merge
4. **Always `but pull` at session start** to prevent stale-base conflicts
5. **Always `but status --json`** before using IDs — they change after every operation

---

## Common Workflows (Quick)

### Commit specific files

```bash
but status --json -f          # Get file IDs
but commit bu -m "msg" --changes a1,a2
```

### Fix typo in old commit

```bash
but status --json             # Find commit ID
but reword c2 -m "Fixed message"
```

### Squash all branch commits

```bash
but squash bu
but reword c1 -m "Clean single commit message"
```

### Auto-amend a fix into the right commit

```bash
but status --json -f          # Check for [LOCKED] indicator
but absorb a1 --dry-run       # Preview
but absorb a1                 # Execute
```

### Recover from mistake

```bash
but undo                      # Quick: undo last operation
# OR
but oplog                     # Find the right snapshot
but oplog restore <id>        # Time travel
```

### Full feature flow

```bash
but pull
but branch new feat/my-feature
# make changes...
but status --json -f
but commit feat/my-feature -m "Implement feature" --changes a1,a2
but pr new feat/my-feature -t
# after merge:
but unapply feat/my-feature
but pull
```

---

## Troubleshooting Quick Reference

| Symptom | Cause | Fix |
|---|---|---|
| Files stuck in `zz` with `[LOCKED]` | Hunks locked to commits on different branches | `but diff --json` → commit each hunk individually with `--changes <hunk-id>` |
| Files in `zz` after edits (no locks) | Plugin `after-edit` didn't auto-assign | `but stage <file-id> <branch>` or `but commit <branch> -m "msg" --changes <id>` |
| Many empty `ge-branch-*` branches | Plugin auto-cleanup failed (~12% failure rate) | Run `/b-branch-gc` or `but unapply <branch-id>` for each |
| `but absorb` puts hunk on wrong commit | Hunk locked to commit on different branch | Use `but amend <file-id> <commit-id>` for explicit control |
| `but pull` fails after PR merge | Merged branch still applied in workspace | `but unapply <merged-branch>` first, then `but pull` |
| Changes "disappear" after `but cursor stop` | Plugin auto-committed to a `ge-branch-*` | `but status --json -f` — check all branches for your files |
