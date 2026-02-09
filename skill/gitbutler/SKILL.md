---
name: but
version: 0.19.0
description: Commit, push, branch, and manage version control. Use for git commit, git status, git push, git diff, creating branches, staging files, editing history, pull requests, or any git/version control operation. Replaces git write commands with 'but' - always use this instead of raw git.
author: GitButler Team
---

# GitButler CLI Skill

Help users work with GitButler CLI (`but` command) in workspace mode.

## New Session Workflow

**EVERY new agent session that involves code changes MUST follow this flow:**

1. **Sync first** → `but pull` to get latest upstream changes (prevents conflicts and stale base)
2. **Check state** → `but status` to see existing branches and unstaged changes
3. **Decide branch** →
   - If an existing branch matches the task → reuse it (it's already applied)
   - If this is new work → `but branch new <task-name>` (e.g. `feat/add-auth`, `fix/login-bug`)
   - If you need to resume unapplied work → `but apply <branch>`
4. **Make changes** → Edit files as needed
5. **Stage & commit** → `but commit <branch> -m "message" --changes <id>,<id>`
6. **Refine** → Use `but absorb` or `but squash` to clean up history
7. **Push when ready** → `but push <branch>`
8. **Create PR** → `but pr new <branch> -t` (uses default target branch)

**Branch naming**: Use conventional prefixes: `feat/`, `fix/`, `chore/`, `refactor/`

**Commit early, commit often.** Don't hesitate to create commits - GitButler makes editing history trivial. You can always `squash`, `reword`, or `absorb` changes into existing commits later. Small atomic commits are better than large uncommitted changes.

## After Using Write/Edit Tools

When ready to commit:

1. Run `but status --json` to see uncommitted changes and get their CLI IDs
2. Commit the relevant files directly: `but commit <branch> -m "message" --changes <id>,<id>`

You can batch multiple file edits before committing - no need to commit after every single change.

## Critical Concept: Workspace Model

**GitButler ≠ Traditional Git**

- **Traditional Git**: One branch at a time, switch with `git checkout`
- **GitButler**: Multiple stacks simultaneously in one workspace, changes assigned to stacks

**This means:**

- ❌ Don't use `git status`, `git commit`, `git checkout`
- ✅ Use `but status`, `but commit`, `but` commands
- ✅ Read-only git commands are fine (`git log`, `git diff`)

## Hard Safety Rules (Non-Negotiable)

1. **Never discard changes you did not create.**
   - `zz` (unassigned) often contains work from other sessions/agents/users.
   - If unrelated changes exist, leave them untouched and ask before any discard action.
2. **Never leave your own changes in `zz` at the end of work.**
   - After edits, run `but status --json` and move your file/hunk IDs to the correct branch via `but stage` or `but commit --changes`.
3. **Validate branch ownership before commit.**
   - Confirm each changed file/hunk belongs to the intended branch/task, then commit only those IDs.

## Quick Start

**Installation:**

```bash
curl -sSL https://gitbutler.com/install.sh | sh
but setup                          # Initialize in your repo
but skill install --path <path>    # Install/update skill (agents use --path with known location)
```

**Note for AI agents:**
- When installing or updating this skill programmatically, always use `--path` to specify the exact installation directory. The `--detect` flag requires user interaction if multiple installations exist.
- **Use `--json` flag for all commands** to get structured, parseable output. This is especially important for `but status --json` to reliably parse workspace state.

**Core workflow:**

```bash
but status --json       # Always start here - shows workspace state (JSON for agents)
but branch new feature  # Create new stack for work
# Make changes...
but commit <branch> -m "…" --changes <id>,<id>  # Commit specific files by CLI ID
but push <branch>       # Push to remote
```

## Essential Commands

For detailed command syntax and all available options, see [references/reference.md](references/reference.md).
For a hands-on learning guide, see [references/tutorial.md](references/tutorial.md).
For a one-page quick lookup, see [references/cheatsheet.md](references/cheatsheet.md).

**IMPORTANT for AI agents:** Add `--json` flag to all commands for structured, parseable output.

**Understanding state:**

- `but status --json` - Overview (START HERE, always use --json for agents)
- `but status --json -f` - Overview with full file lists (use when you need to see all changed files)
- `but show <id> --json` - Details about commit/branch
- `but diff <id>` - Show diff

**Flags explanation:**
- `--json` - Output structured JSON instead of human-readable text (always use for agents)
- `-f` - Include detailed file lists in status output (combines with --json: `but status --json -f`)

**Organizing work:**

- `but branch new <name>` - Independent branch
- `but branch new <name> -a <anchor>` - Stacked branch (dependent)
- `but stage <file> <branch>` - Pre-assign file to branch (optional, for organizing before commit)

**Making changes:**

- `but commit <branch> -m "msg" --changes <id>,<id>` - Commit specific files or hunks (recommended)
- `but commit <branch> -m "msg" -p <id>,<id>` - Same as above, using short flag
- `but commit <branch> -m "msg"` - Commit ALL uncommitted changes to branch
- `but commit <branch> --only -m "msg"` - Commit only pre-staged changes (cannot combine with --changes)
- `but amend <file-id> <commit-id>` - Amend file into specific commit (explicit control)
- `but absorb <file-id>` - Absorb file into auto-detected commit (smart matching)
- `but absorb <branch-id>` - Absorb all changes staged to a branch
- `but absorb` - Absorb ALL uncommitted changes (use with caution)

**Getting IDs for --changes:**
- **File IDs**: `but status --json` - commit entire files
- **Hunk IDs**: `but diff --json` - commit individual hunks (for fine-grained control when a file has multiple changes)

**Editing history:**

- `but rub <source> <dest>` - Universal edit (stage/amend/squash/move)
- `but squash <commits>` - Combine commits
- `but reword <id>` - Change commit message/branch name

**Remote operations:**

- `but pull` - Update with upstream
- `but push [branch]` - Push to remote
- `but pr new <branch>` - Push and create pull request (auto-pushes, no need to push first)
- `but pr new <branch> -m "Title..."` - Inline PR message (first line is title, rest is description)
- `but pr new <branch> -F pr_message.txt` - PR message from file (first line is title, rest is description)
- For stacked branches, the custom message (`-m` or `-F`) only applies to the selected branch; dependent branches use defaults

## Key Concepts

For deeper understanding of the workspace model, dependency tracking, and philosophy, see [references/concepts.md](references/concepts.md).

**CLI IDs**: Every object gets a short ID (e.g., `c5` for commit, `bu` for branch). Use these as arguments.

**Parallel vs Stacked branches**:

- Parallel: Independent work that doesn't depend on each other
- Stacked: Dependent work where one feature builds on another

**The `but rub` primitive**: Core operation that does different things based on what you combine:

- File + Branch → Stage
- File + Commit → Amend
- Commit + Commit → Squash
- Commit + Branch → Move

## Workflow Examples

For complete step-by-step workflows and real-world scenarios, see [references/examples.md](references/examples.md).

**Starting independent work:**

```bash
but status --json
but branch new api-endpoint
but branch new ui-update
# Make changes, then commit specific files to appropriate branches
but status --json  # Get file CLI IDs
but commit api-endpoint -m "Add endpoint" --changes <api-file-id>
but commit ui-update -m "Update UI" --changes <ui-file-id>
```

**Committing specific hunks (fine-grained control):**

```bash
but diff --json             # See hunk IDs when a file has multiple changes
but commit <branch> -m "Fix first issue" --changes <hunk-id-1>
but commit <branch> -m "Fix second issue" --changes <hunk-id-2>
```

**Cleaning up commits:**

```bash
but absorb              # Auto-amend changes
but status --json       # Verify absorb result
but squash <branch>     # Squash all commits in branch
```

**Resolving conflicts:**

```bash
but resolve <commit>    # Enter resolution mode
# Fix conflicts in editor
but resolve finish      # Complete resolution
```

**Managing workspace:**

```bash
but config target origin/test   # Set default PR target (requires unapply all branches first)
but unapply <branch>            # Remove branch from workspace (keeps commits)
but apply <branch>              # Bring branch back into workspace
but teardown                    # Exit GitButler mode → normal git
but setup                       # Re-enter GitButler mode
but discard <ids>               # Discard unstaged changes
```

## Post-Merge PR Flow

After a PR is squash-merged on GitHub, follow this exact sequence:

```bash
but unapply <merged-branch>    # MUST do BEFORE pull - prevents orphan branch errors
but pull                        # Pull merged changes from remote
```

**Critical**: If you `but pull` before unapplying the merged branch, GitButler will error with orphan branch conflicts. Always unapply first.

**If `but unapply` fails** (branch already gone from workspace after remote deletion with `--delete-branch`), `but pull` may also fail with "resolution mismatch" errors because the ghost stack still exists internally. In this case, the GitButler desktop app can handle it — tell the user to run `but pull` from the GUI. Alternatively, use `but teardown` → `but setup` → `but config target origin/<branch>` to reset.

**After `but teardown` → `but setup`**: Target config resets. Run `but config target origin/<branch>` again.

## Using `--no-hooks` Safely

When pre-commit hooks fail on pre-existing errors unrelated to your changes, use `--no-hooks`. But this skips the formatter too:

```bash
bun run format                                    # Format FIRST
but commit <branch> -m "msg" --changes <ids> --no-hooks  # Then commit without hooks
```

Alternatively, commit normally and absorb formatter fixes:

```bash
but commit <branch> -m "msg" --changes <ids>      # Commit (hooks may fix formatting)
but absorb                                         # Absorb any auto-formatted changes
```

## Known Issues & Workarounds

| Issue | What happens | Workaround |
|-------|-------------|------------|
| `but resolve` loses target config | After entering resolve mode, `but config target` resets to "not set" | Run `but config target origin/<branch>` again after `but resolve finish`. If finish fails, do `git checkout gitbutler/workspace` → `but teardown` → `but setup` |
| `but absorb` hunk lock | Absorb assigns hunk to wrong commit when it's locked by another commit on a different branch | Use `but amend <file> <commit>` for explicit control instead of absorb |
| `but pr new` has no `--base` flag | Always creates PR against default target | Set target first: `but config target origin/<branch>` |
| `but config target` requires unapply | Cannot change target with applied branches | `but unapply` all → change target → `but apply` |
| `but config forge auth` is interactive | Cannot run in non-interactive agent mode | User must run in terminal + grant org access on GitHub |
| `but commit` pre-commit hook fails | Hook fails on pre-existing errors unrelated to your changes | `but commit --no-hooks` if errors are not from your changes. **Always `bun run format` first** since `--no-hooks` skips the formatter |
| `but branch delete` last segment | Cannot delete if it would leave anonymous segment | Use `but unapply` instead of delete |
| `but stage` prefix matching | Branch name can be abbreviated | `but stage <id> ch` works for `chore/gitbutler-setup` |
| `but discard` hunk range error | Discarding file-level changes sometimes fails with hunk range errors | Use `git checkout -- <file>` instead of `but discard` for file-level discards |
| `but teardown` + `but setup` resets target | After teardown/setup cycle, target config is lost | Run `but config target origin/<branch>` again after setup |
| Lefthook `pre-commit.old` accumulates | Lefthook creates `pre-commit.old` backup that conflicts on next install | Add `rm -f .git/hooks/pre-commit.old` to `prepare` script in package.json |
| `but pull` before unapply | Pulling with merged branches still applied causes orphan errors | **Always** `but unapply <merged-branch>` before `but pull` |
| `but unapply` after remote branch deletion | `but unapply` fails with "branch not found" when remote deleted the branch (e.g. `--delete-branch` on merge), and subsequent `but pull` fails with "resolution mismatch" | Use GitButler desktop app to pull, or `but teardown` → `but setup` → `but config target origin/<branch>` |

## Critical Safety Rules

1. **NEVER discard changes you didn't create.** Unassigned changes in `zz` may belong to other agents, sessions, or the user. Always ask the user before running `but discard` or `git checkout --` on any change you don't recognize. In GitButler workspace, multiple actors work in parallel — discarding "stale" or "already merged" changes is a destructive assumption.
2. **Always assign your changes to a branch immediately.** Don't leave edits sitting in `zz` (unassigned). After editing files, stage them to your working branch with `but stage <file-id> <branch>` or commit directly with `--changes`.

## Guidelines

1. Always start with `but status --json` to understand current state (agents should always use `--json`)
2. Create a new stack for each independent work theme
3. Use `--changes` to commit specific files directly - no need to stage first
4. **Commit early and often** - don't wait for perfection. Unlike traditional git, GitButler makes editing history trivial with `absorb`, `squash`, and `reword`. It's better to have small, atomic commits that you refine later than to accumulate large uncommitted changes.
5. **Use `--json` flag for ALL commands** when running as an agent - this provides structured, parseable output instead of human-readable text
6. Use `--dry-run` flags (push, absorb) when unsure
7. **Run `but pull` frequently** — at session start, before creating branches, and before pushing. Stale workspace = merge conflicts
8. When updating this skill, use `but skill install --path <known-path>` to avoid prompts
