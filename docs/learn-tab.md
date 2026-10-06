# Learn tab (saved for later, 6 Oct 2026)

A fourth sidebar tab that's a chat: ask Claude how something works (a feature, a part of the database, a bug, a PR, what
an agent did), and the map walks you through it step by step, stopping on the key steps, with a window for the code,
image or HTML at each stop. Nothing here is built yet.

## How, with what exists

- **A Learn session is a Claude Code session Brainstorm follows.** The question starts Claude Code headless
  (`claude -p`, the CLI the plugin already runs in), on the person's own login: no API key (Ask needs one today).
- **Read-only by its permissions, not by asking:** Read, Grep, Glob, and a few read-only commands (`git log`, `git show`,
  `gh pr view`, `gh pr diff`). No edits, no writes, no other commands.
- **The map follows it live with what's there:** the listener reads its log, the tracer moves to each file it reads, the
  file window shows the code, diffs, images and HTML.
- **Paced stops are the new piece:** a Brainstorm tool (MCP, shipped with the plugin), `show(file, lines, say, wait)`:
  the map glides there, the file window opens at those lines, the text goes in the chat; with `wait` the call returns
  only when the person clicks Next or asks a follow-up.
- **Follow-ups resume the same session** (`--resume`), so it keeps its context.
- **Sources:** files and imports (how a feature works), recorded threads (a bug: what failed, which steps edited what),
  `gh pr diff` (a PR), a thread (what an agent did), blast radius ([graph-for-agents.md](graph-for-agents.md)).

## Risks

- First stop after 10–30 s while Claude reads (streaming helps); each tour uses the person's Claude usage.
- Learn sessions would appear as threads: tag them and keep them out of the Threads list.
- A tool call that waits minutes for a click: check it first, everything about pacing depends on it.

## Plan

1. Check: headless Claude Code calls a Brainstorm tool that waits several minutes for a click (half a day).
2. Basic (1–2 days): the Learn tab chat, a read-only headless session, the map following it live, answers in the chat.
3. Paced tours (about 2 days): `show` stops with Next, the file window at exact lines, images and HTML at a stop.
4. Later: a PR picker, "explain this failure" from a red step, a thread recap.
