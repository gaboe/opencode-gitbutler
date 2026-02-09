# GitButler Integration — Architecture & Gap Analysis

This document compares GitButler's native IDE integrations (Cursor, Claude Code) with our OpenCode plugin, identifies feature gaps, and proposes fixes.

## How GitButler IDE Integrations Work

GitButler provides two native integration crates:

- **`but-cursor`** — Cursor IDE integration via `but cursor after-edit` and `but cursor stop` CLI
- **`but-claude`** — Claude Code integration via `.claude/settings.json` hooks (PreToolUse, PostToolUse, Stop)

Both use a shared action layer (`but-action`) for commits, LLM-based message generation, and branch renaming.

Our **OpenCode plugin** (`.opencode/plugin/gitbutler.ts`) bridges OpenCode's hook system to `but cursor` CLI — essentially pretending to be Cursor.

## Feature Comparison

| # | Feature | Cursor | Claude Code | OpenCode (ours) | Status |
|---|---------|--------|-------------|-----------------|--------|
| **Lifecycle** |
| 1 | Pre-tool hook (before edit) | — | PreToolUse | `tool.execute.before` (unused) | Available but unused |
| 2 | Post-tool hook (after edit) | `after-edit` | PostToolUse | `tool.execute.after` | **OK** |
| 3 | Stop/idle hook | `stop` | Stop | `session.idle` event | **OK** |
| **Branch & Hunk Management** |
| 4 | Session → branch creation | `get_or_create_session` | `get_or_create_session` | via `conversation_id` | **OK** |
| 5 | Hunk assignment (diff → branch) | From `edits[]` | From `structured_patch` | From `before/after` metadata | Partial — missing for `write` tool |
| 5b | Auto-assign to existing branch | Cursor internal | Claude internal | `but rub` via `findFileBranch()` | **FIXED** — auto-assigns on edit |
| 6 | Branch auto-rename (LLM) | From Cursor DB prompt | From Claude transcript | `postStopProcessing` via SDK | **FIXED** — `but reword` + user prompt |
| **Commit Management** |
| 7 | Auto-commit on stop | `handle_changes()` | `handle_changes()` | via `but cursor stop` | **OK** |
| 8 | Commit message from context | Cursor DB `text_description` | Claude transcript summary | `postStopProcessing` via SDK | **FIXED** — `but reword` with user prompt |
| 9 | Commit message LLM reword | OpenAI gpt-4-mini | OpenAI gpt-4-mini | `but reword` post-stop | **FIXED** — deterministic from prompt |
| **Session Management** |
| 10 | Session persistence | GitButler SQLite | GitButler SQLite | JSON file (session-map.json) | **OK** |
| 11 | Session resumption | — | `add_session_id()` | `resolveSessionRoot()` | **OK** |
| 12 | Multi-agent session mapping | — | — | `parentSessionByTaskSession` | **Unique to us** |
| **Safety** |
| 13 | File locking (concurrent edits) | — | 60s wait + retry | `tool.execute.before` 60s poll + stale cleanup | **OK** |
| 14 | GUI context detection | — | `GITBUTLER_IN_GUI` env | N/A | Not needed |
| **Data & Context** |
| 15 | External prompt (user intent) | From Cursor DB | From transcript file | `fetchUserPrompt()` via SDK | **FIXED** — fetched from OpenCode session |
| 16 | External summary (change desc) | — (empty) | From transcript | Derived from prompt | **FIXED** — first line of user prompt |
| 17 | Source tracking (audit trail) | `Source::Cursor` | `Source::ClaudeCode` | Reports as `Source::Cursor` | Cosmetic |
| **Agent Context** |
| 18 | Agent state notification | — | — | `experimental.chat.messages.transform` | **Unique to us** |
| **Extras** |
| 19 | Permission system | — | Approved/denied per session | N/A | Not needed |
| 20 | Question handling | — | `AskUserQuestion` | N/A | Not needed |

## Root Cause of All Gaps

All three functional gaps (#6, #8, #15) share the same root cause:

```
Our plugin sends: generation_id = crypto.randomUUID()
                                       ↓
GitButler looks up generation_id in Cursor's SQLite DB
                                       ↓
No match found (we're not Cursor) → prompt = ""
                                       ↓
Commit messages generated from diff only (no user intent context)
Branch rename skipped (no meaningful name to generate)
```

The `but cursor stop` handler in `crates/but-cursor/src/lib.rs:228-235`:

```rust
let prompt = get_generations(&dir, nightly)
    .map(|gens| {
        gens.iter()
            .find(|g| g.generation_uuid == input.generation_id)
            .map(|g| g.text_description.clone())
            .unwrap_or_default()  // → "" when not found
    })
    .unwrap_or_default();         // → "" when DB missing
```

## Fix: Pure TS Post-Stop Processing (IMPLEMENTED)

All three gaps (#6, #8, #15) are resolved without any Rust changes. The plugin uses a two-phase approach:

1. **`but cursor stop`** — GitButler creates a commit with a generic message (from diff only, as before)
2. **`postStopProcessing()`** — immediately after, the plugin rewrites both commit message and branch name using the actual user prompt

### How It Works

```
Session goes idle
    ↓
but cursor stop → creates generic commit on ge-branch-N
    ↓
postStopProcessing(sessionID)
    ↓
fetchUserPrompt(rootSessionID)  ← OpenCode SDK client.session.messages()
    ↓
getFullStatus() → find branches with exactly 1 unpushed commit
    ↓
but reword <commit-cliId> -m "<first line of user prompt>"
    ↓
but reword <branch-cliId> -m "<prompt-as-kebab-case-slug>"
    (only for branches matching ge-branch-\d+)
```

### Key Implementation Details

| Component | Description |
|-----------|-------------|
| `fetchUserPrompt(sessionID)` | Calls `client.session.messages()` from OpenCode SDK, finds first user message with text content |
| `toCommitMessage(prompt)` | First line of user prompt, truncated to 72 chars |
| `toBranchSlug(prompt)` | Alphanumeric words from prompt, kebab-case, max 50 chars |
| `getFullStatus()` | Parses `but status --json -f` for branch/commit metadata |
| `butReword(target, message)` | Wrapper around `but reword <target> -m <message>` |
| `rewordedBranches` Set | Idempotent guard — never reword the same branch twice (tracked by `branchCliId`, not commit SHA) |

### Eligibility Guards

A branch is only post-processed when ALL conditions are met:

1. `branchStatus === "completelyUnpushed"` — never rewrite pushed history
2. `commits.length > 0` — skip empty branches
3. Branch not in `rewordedBranches` set — idempotent (tracked by `branchCliId`, not commit SHA which changes after reword)
4. Branch name matches `ge-branch-\d+` (for rename only) — don't rename user-named branches

### What This Fixes

| Before | After |
|--------|-------|
| Commit message from diff only | Commit message = user's first prompt line |
| Branch stays `ge-branch-N` | Branch renamed to `add-dark-mode-toggle` |
| No user intent context | User prompt fetched via OpenCode SDK |

### Optional Future Enhancement: Upstream Rust PR

For even better quality, an upstream PR could add `external_prompt` field to `StopEvent`:

```rust
#[serde(default)]
pub external_prompt: Option<String>,
```

This would let GitButler's LLM generate messages with full user intent context, rather than our deterministic truncation. However, this is **optional** — the pure TS fix covers all practical needs.

## Architecture Decisions

### Why not a native `but-opencode` Rust crate?

1. **Low value/effort ratio** — 3+ days of Rust for minimal gain over the facade approach
2. **Upstream risk** — GitButler team unlikely to maintain a third agent-specific crate
3. **Tech debt** — `but-cursor` already depends on `but-claude` session helpers; another crate increases coupling
4. **Better alternative** — Small generic enhancement (optional fields) benefits all non-Cursor consumers

### Why not simulate Claude hooks instead of Cursor?

1. **Claude hooks require `transcript_path`** — a file with Claude's conversation transcript in specific format
2. **Claude hooks use `.claude/settings.json`** — triggered by Claude Code process, not CLI-callable
3. **Cursor hooks are simpler** — JSON via stdin to `but cursor` CLI, no filesystem dependencies
4. **Session management reuse** — Claude's `get_or_create_session` is already used by Cursor facade

### Why keep the Cursor facade?

1. **Minimal surface area** — only 2 CLI commands (`after-edit`, `stop`)
2. **Stable interface** — unlikely to break between GitButler versions
3. **Our unique features** (multi-agent session mapping) sit in the TS plugin layer, not the Rust layer
4. **Easy to debug** — JSON in, JSON out, no binary protocol

## Known Issues & Fixes

### Phantom empty branches on file edit (FIXED)

**Problem**: `but cursor after-edit` calls `get_or_create_session()` which creates a new branch for every new `conversation_id` — even when the edited file already belongs to an existing branch via ownership rules. Result: phantom `ge-branch-N` branches with zero commits.

**Fix (PR #111)**: Preflight check before calling `after-edit`. The plugin runs `but status --json -f`, parses `assignedChanges` and committed `changes[]` in branches, and skips the call when the file belongs to an existing branch. When the file is in a branch but appears as an unassigned modification (new edit of a previously committed file), the plugin auto-assigns it via `but rub <file-cliId> <branch-cliId>`.

### Empty branches from read-only subagent sessions (FIXED)

**Problem**: Subagents (explore, oracle, librarian) go idle without making file edits. The idle event triggered `but cursor stop`, which called `get_or_create_session` and created empty branches.

**Fix (PR #111)**: Two layers of protection:
1. `conversationsWithEdits` set — tracks which conversation IDs actually called `after-edit`. The `stop` handler skips sessions not in this set.
2. Session map persistence — subagent sessions resolve to parent session via `resolveSessionRoot()`, so they share the same `conversation_id` and branch.

### Empty edits from write tool (FIXED)

**Problem**: The `write` tool creates new files with no `before/after` diff. Sending `edits: []` caused `but cursor after-edit` to fail with "No hunk headers found".

**Fix (PR #111)**: `extractEdits()` always returns `[]` for missing diffs. "No hunk headers" and "no changes" are added to the suppressed error list. GitButler still assigns the file to the branch based on file path.

### Auto-assign edits to existing branches (FIXED)

**Problem**: When editing a file that was previously committed in a branch, the plugin correctly skipped `but cursor after-edit` (preventing phantom branches), but the new modification stayed as an unassigned change. Users had to manually run `but commit <branch> --changes <id>` to include it.

**Fix (PR #111)**: `findFileBranch()` replaces the old boolean `isFileInExistingBranch()`. It returns the branch's `cliId` and the unassigned file's `cliId` when both exist. The plugin then calls `but rub <file-cliId> <branch-cliId>` to auto-assign the change to the correct branch. This means edits to files in existing branches are automatically staged to that branch — no manual intervention needed.

### Generic commit messages and branch names (FIXED)

**Problem**: `but cursor stop` generates commits using `generation_id` to look up the user's prompt in Cursor's SQLite DB. Since we're not Cursor, the lookup returns empty — resulting in generic commit messages (from diff only) and branches stuck as `ge-branch-N`.

**Fix (PR #111, improved in PR #117)**: `postStopProcessing()` runs immediately after `but cursor stop`. It fetches the user's original prompt via `client.session.messages()` from the OpenCode SDK, then uses `but reword` to rewrite the commit message (first line of prompt, max 72 chars, with conventional commit prefix detection) and rename the branch (prompt as kebab-case slug, max 50 chars). Targets all completely unpushed branches with at least 1 commit. Idempotent via `rewordedBranches` set (tracked by `branchCliId`).

### Cannot unapply/pull after PR merge with `--delete-branch` (UPSTREAM BUG)

**Problem**: After a PR is squash-merged on GitHub with `--delete-branch`, the local GitButler workspace can't clean up:
1. `but unapply <branch>` fails with "Branch not found in any applied stack" (remote deletion removed the branch reference)
2. `but pull` then fails with "Chosen resolutions do not match quantity of applied virtual branches" / "resolution mismatch"

**Root cause**: GitButler's workspace model expects branches to exist when resolving integration. When remote deletes the branch during merge, the local state becomes inconsistent.

**Upstream issues**:
- [#9739](https://github.com/gitbutlerapp/gitbutler/issues/9739) — unapply squash-merged branch doesn't recognize integrated changes
- [#9817](https://github.com/gitbutlerapp/gitbutler/issues/9817) — integration of squash-merged stacked branches fails
- [#11648](https://github.com/gitbutlerapp/gitbutler/issues/11648) — app unusable after unapply failure

**Active fix PRs**:
- [#10872](https://github.com/gitbutlerapp/gitbutler/pull/10872) — v3 unapply: MVP (complete rewrite of unapply, last activity Jan 2026)
- [#12085](https://github.com/gitbutlerapp/gitbutler/pull/12085) — delete GitButler branches upon teardown (last activity Feb 2026)

**Workarounds** (in order of preference):
1. **GitButler desktop app** — GUI handles pull correctly even when CLI fails
2. **Teardown/setup reset** — `but teardown` → `but setup` → `but config target origin/test` (loses target config and empty branches)
3. **Unapply before merge** — `but unapply <branch>` before merging the PR, then `but pull` (prevents the issue entirely but requires manual step)

### Zombie ownership rules after branch cleanup

**Problem**: Unapplied branches leave file→branch assignment rules in GitButler's SQLite database.

**Workaround**: Run `but unmark` to clear all stale rules.

## Parity Assessment (vs Native Integrations)

Oracle-reviewed comparison after v2 implementation (PR #117):

| Area | vs Native | Notes |
|------|-----------|-------|
| Lifecycle hooks (edit/stop) | **Equal** | Full parity — same `after-edit` + `stop` flow |
| Auto-assign to existing branch | **Better** | Native integrations don't do this — we use `but rub` explicitly |
| Multi-agent session mapping | **Better/Unique** | Neither Cursor nor Claude Code supports this |
| Hunk-level rub guard | **Better** | Skip auto-assign when file has hunks in multiple stacks |
| File locking (concurrent edits) | **Equal** | `tool.execute.before` with 60s poll + stale cleanup + `try/finally` release |
| State persistence | **Equal** | `plugin-state.json` survives restarts (simpler than SQLite, same reliability) |
| Post-stop reword scope | **Equal** | Now works for multi-commit unpushed branches (tracks by branchCliId) |
| Debug logging | **Equal** | Structured JSON log at `.opencode/plugin/debug.log` |
| Rub failure handling | **Equal** | Logged with context (`rub-ok`/`rub-failed`) |
| Commit message quality | **Equal** | LLM-powered via OpenCode SDK `client.session.prompt()` with diff context; deterministic fallback |
| Agent state awareness | **Better/Unique** | Neither native integration informs the agent about automatic operations |
| Source tracking | **Cosmetic** | Reports as `Source::Cursor` — no functional impact |

**Score**: 7 Equal, 4 Better, 1 Cosmetic

### LLM-Powered Commit Messages (Implemented)

Commit message quality now matches native integrations. The plugin uses the OpenCode SDK to invoke the LLM with the actual commit diff and user intent:

1. `postStopProcessing()` collects the commit diff via `git show <commitId>`
2. Creates a temporary internal session via `client.session.create()`
3. Guards the session ID in `internalSessionIds` to prevent recursive hook triggering
4. Sends a system-prompted LLM request with diff + user intent (tools disabled, 15s timeout)
5. Validates the response: must be a conventional commit format, max 72 chars
6. If valid → `but reword` with LLM message; if invalid/error/timeout → falls back to deterministic `toCommitMessage()`

The temporary session is deleted after use. Uses `anthropic/claude-haiku-4-5` for cost efficiency. Debug log entries show `source: "llm"` or `source: "deterministic"` in the `reword` category.

### Session Title Sync

After reword, the plugin syncs the OpenCode session title to match the GitButler branch name via `client.session.update()`. This keeps the session list readable — instead of generic session IDs, sessions show their corresponding branch name (e.g., `fix/assistant-init-timeout-guard`).

### Empty Branch Cleanup

GitButler may leave behind empty branches (0 commits, 0 assigned changes) with auto-generated names (`ge-branch-*`). The plugin automatically unapplies these at the end of `postStopProcessing()`. Debug log entries show `cleanup-ok` or `cleanup-failed`.

### Agent State Notifications (Context Injection)

Neither Cursor nor Claude Code notifies the AI agent about GitButler's automatic operations (branch rename, commit reword, cleanup). The agent works blind — it doesn't know its branch was renamed or its commit message was rewritten.

Our plugin solves this via the `experimental.chat.messages.transform` hook, following the same `ContextCollector` pattern as oh-my-opencode:

1. **Accumulate**: `addNotification()` queues messages during `postStopProcessing()` — keyed by root session ID
2. **Coalesce**: Multiple operations in one idle cycle produce a single notification batch
3. **Inject**: On the agent's next user message, the transform hook inserts a `<system-reminder>` synthetic part before the user's text
4. **Consume**: Notifications are consumed on delivery — no duplicates

Events that generate notifications:
- Commit message reworded → `Commit on branch X reworded to: "feat: add dark mode"`
- Branch renamed → `Branch renamed from ge-branch-42 to add-dark-mode`
- Session title updated → `Session title updated to add-dark-mode`
- Empty branch cleaned up → `Empty branch ge-branch-43 cleaned up`

Events deliberately NOT notified (noise):
- Per-file `after-edit` assignments
- Per-file `but rub` moves

Debug log entries: `notification-queued` (on accumulate) and `context-injected` (on delivery).

## Manual Test Results (2026-02-07)

Plugin verified working after v2 implementation (PR #117):

| Test | Action | Expected | Result |
|------|--------|----------|--------|
| Edit new file | Edit `packages/common/src/type-coercion.ts` | `lock-acquired` → `after-edit` → `cursor-ok` in debug.log | **PASS** |
| Edit same file again | Second edit to same file | `lock-acquired`, file already in branch, no rub needed | **PASS** |
| File assignment | Check `but status --json -f` | File assigned to correct stack (not unassigned) | **PASS** |
| State persistence | Restart OpenCode | `state-loaded` in debug.log with correct counts | **PASS** |
| Session stop + reword | Session goes idle after edits | `session-stop` → `cursor-ok` → `reword` in debug.log | **PASS** (verified from previous session logs) |

### Plugin auto-discovery warning

OpenCode auto-discovers all `.ts` files in `.opencode/plugin/` as plugins. Only the main plugin file (`gitbutler.ts`) should export a `Plugin` function. Utility modules, test files, or helper libraries must NOT be placed directly in `.opencode/plugin/` — they will be loaded as plugins and crash if they export non-function values (e.g., RegExp, Set).

## File Reference

| File | Purpose |
|------|---------|
| `.opencode/plugin/gitbutler.ts` | OpenCode → GitButler bridge plugin (~1240 lines) |
| `.opencode/plugin/session-map.json` | Persisted session mapping (gitignored) |
| `.opencode/plugin/plugin-state.json` | Persisted plugin state — `conversationsWithEdits` + `rewordedBranches` (gitignored) |
| `.opencode/plugin/debug.log` | Structured JSON debug log (gitignored) |
| `.claude/skills/gitbutler/SKILL.md` | Agent skill with multi-agent safety rules |
| `CLAUDE.md` (GitButler section) | Project-level GitButler workflow rules |
| `docs/gitbutler-integration.md` | This document — architecture, gaps, parity assessment |
| `opensrc/repos/.../but-cursor/` | GitButler Cursor integration source |
| `opensrc/repos/.../but-claude/` | GitButler Claude Code integration source |
| `opensrc/repos/.../but-action/` | Shared commit/rename/reword logic |
