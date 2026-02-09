# GitButler Workspace Guide

When GitButler is active, the repository runs in **workspace mode** — multiple branches coexist simultaneously. All write operations go through the `but` CLI instead of raw git.

## Session Workflow

1. **Sync** → `but pull` (get upstream changes before working)
2. **Check state** → `but status --json` (see branches, uncommitted changes)
3. **Branch** → Start editing — the plugin auto-creates and auto-renames branches from your prompt. For explicit control: `but branch new <name>`
4. **Commit** → `but commit <branch> -m "msg" --changes <id>,<id>` (always specify `--changes`)
5. **Push** → `but push <branch>`
6. **PR** → `but pr new <branch> -t`

> The opencode-gitbutler plugin automatically renames branches, generates commit messages via LLM, and injects state notifications. Manual branch rename is optional.

## Critical Rules

- **Use `but`, not `git`** for write operations (`commit`, `push`, `checkout`). Read-only git commands (`log`, `diff`, `blame`) are fine.
- **Always use `--json`** flag for machine-parseable output.
- **Always use `--changes <id>,<id>`** when committing — omitting it commits ALL uncommitted changes (dangerous in multi-agent workspaces).
- **Never discard changes you didn't create.** Unassigned changes (`zz`) may belong to other agents or the user.
- **Never leave your changes unassigned.** After editing, commit or stage to a branch immediately.

## Essential Commands

| Command | Purpose |
|---------|---------|
| `but status --json` | Show workspace state (start here) |
| `but status --json -f` | Full status with file lists |
| `but branch new <name>` | Create independent branch |
| `but commit <branch> -m "msg" --changes <id>,<id>` | Commit specific files/hunks |
| `but absorb <file-id>` | Auto-amend file into matching commit |
| `but squash <commits>` | Combine commits |
| `but reword <id> -m "msg"` | Change commit message or branch name |
| `but rub <source> <dest>` | Universal move (stage/amend/squash/move) |
| `but push <branch>` | Push to remote |
| `but pull` | Sync upstream changes |
| `but pr new <branch> -t` | Create pull request |
| `but apply <branch>` | Bring unapplied branch into workspace |
| `but unapply <branch>` | Remove branch from workspace (keeps commits) |

## Commit Messages

Use conventional commit format: `type(scope): description` (max 72 chars)

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `style`, `perf`, `chore`

## Key Concepts

- **CLI IDs**: Every object has a short ID (e.g., `c5`, `bu`). Use `but status --json` to discover them.
- **`but rub`**: Universal primitive — file+branch=stage, file+commit=amend, commit+commit=squash, commit+branch=move.
- **Parallel branches**: Independent work streams in the same workspace.
- **Stacked branches**: Dependent work where one builds on another (`but branch new <name> -a <anchor>`).

## Post-Merge PR Flow

```bash
but unapply <merged-branch>    # MUST do BEFORE pull
but pull                        # Then sync
```

If `but unapply` fails after remote branch deletion, use the GitButler desktop app or `but teardown` → `but setup` → `but config target origin/<branch>`.

## Multi-Agent Safety

These commands are **banned** without explicit IDs in multi-agent workspaces:

| Banned | Safe Alternative |
|--------|-----------------|
| `but commit <branch> -m "msg"` (no --changes) | `but commit <branch> -m "msg" --changes <id>,<id>` |
| `but absorb` (no args) | `but absorb <file-id>` or `but absorb <branch-id>` |
| `but discard` (no args) | `but discard <id>,<id>` |

## Known Issues

| Issue | Workaround |
|-------|------------|
| `but pull` before unapply of merged branch | Always `but unapply` merged branches first |
| `but unapply` after remote deletion | Use desktop app or teardown/setup cycle |
| Pre-commit hook fails on pre-existing errors | `bun run format` first, then `--no-hooks` only for pre-existing failures |
| `but config target` requires unapply | Unapply all branches → change target → apply |
