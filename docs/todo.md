# To do: Brainstorm inside the Claude Code workflow

Written 5 Oct 2026 from a product discussion. Nothing here is built yet. The goal: make Brainstorm the thing you look at by default while an agent codes, without adding a habit.

The principle we agreed on: Brainstorm follows you silently and interrupts only when something needs you. No "want to see?" prompt on every message.

Sizes are estimates for one developer who knows the codebase.

## 1. Foundation: more hooks (do this first)

Today the plugin has one hook, SessionStart (`plugin/hooks/hooks.json`), and the server reads Claude Code's log files (`app/server/src/listener/`). Every hook receives the session id, so more hooks give exact signals.

- [x] Add an endpoint on the local server that receives hook events (session id, event name, project folder). Done 5 Oct: `POST /api/hooks`, see [attention.md](attention.md).
- [ ] `UserPromptSubmit` hook: marks this thread as the one the user is on. The hook exists since 5 Oct (it clears a thread's waiting state); marking the thread you're on isn't built.
- [ ] `PostToolUse` hook: a step happened, in real time (the log reader stays as the fallback and for history).
- [x] `Notification` hook: this thread is waiting on the user (permission, idle). Done 5 Oct, with `PermissionRequest` for the tool and its input.
- [x] `Stop` hook: this thread finished its turn. Done 5 Oct.
- [x] Each hook is one small POST from a script and must never slow or block the session: short timeout, silent when the server is down. Done 5 Oct: `plugin/scripts/signal.mjs`, async hooks.
- [ ] Parser and hook tests, since the log format isn't documented.

Size: ½ day.

## 2. Make Brainstorm the default view

- [ ] **Follow me.** When the user sends a prompt, every open Brainstorm tab switches to that thread and follows it live (a "focus" message over the WebSocket). A pin keeps the current thread. Size: ½ day.
- [ ] **End-of-turn recap in Claude Code.** The Stop hook prints one line in the session ("6 files changed, 1 command failed, see it") with a link to `/thread/<id>`. Size: 2 hours.
- [ ] **Needs-you board.** With 2 or more threads running, one lane per thread with its state: working, waiting on you, failing, done. Clicking a lane opens the thread. Size: 1 day.
- [ ] **Notifications on events only.** A macOS notification when a thread finishes, repeats the same error 3 times, or two threads write the same file. Clicking it opens that step. A setting to turn each kind off. Size: ½ day.
- [ ] **Inside Claude Code (spike first).** A status line ("3 threads, 1 needs you") and, in the desktop app, Brainstorm in a pane beside the conversation. Not checked yet: how far a plugin can go on either. Spike: 2 hours.

## 3. Bigger features, in the order we'd build them

- [ ] **Claim check per turn.** Compare what the agent said with what it did: "said tests pass, no test command ran", "said it fixed X, never edited X". Uses the paired calls and results we already keep (`app/server/src/listener/pairing.ts`). First big feature to build.
- [ ] **Approve and steer from Brainstorm.** One inbox for permission requests across all threads, and "send this step or error back to the agent". Needs a `PreToolUse` hook that asks Brainstorm before a call runs. Security-sensitive, and hook timeouts limit how long a call can wait. Overlaps "Pause and steer" in `next-steps.md`.
- [ ] **Rewind to a step.** Scrub the replay to where it still worked, restore the files to that step and continue from there. Needs a file snapshot per step, which is the expensive part. Overlaps "History slider" in `next-steps.md`.
- [ ] **Runtime errors on the map.** Catch dev server and browser console errors, then light up the file and the agent step that last wrote the failing line.
- [ ] **Learn tab.** A chat in the sidebar: ask how something works (a feature, a bug, a PR), and the map walks you through it, stopping on the key steps with the code at each. A headless, read-only Claude Code session Brainstorm follows, plus one tool for paced stops. Plan and risks in [learn-tab.md](learn-tab.md).
- [ ] **Git on the map (built, hidden).** "Show git" in the bottom bar rings the files not committed and not pushed, or an open thread's worktree branch. Hidden on 6 Oct as a step too far for now: `GIT_SHOWN` in `app/web/src/map/gitFilter.ts` turns it back on; the server still serves `/api/git`. Next if it comes back: a menu on the switch listing the agents' worktrees.
- [ ] **Brainstorm as context for agents (MCP).** "Is another thread editing this?", "what failed last time?". Already in `roadmap.md`, part 2. The import graph makes it sharper: blast radius before an edit, likely files for a prompt, parallel agents whose work overlaps. Ideas, uses and how to measure them first in [graph-for-agents.md](graph-for-agents.md).

## Open questions

- Can a plugin set the status line, or does the user have to add it to their settings?
- Can a plugin open a pane in the desktop app, and does it work in the terminal too?
- What is the longest a `PreToolUse` hook may wait for an answer from Brainstorm?
