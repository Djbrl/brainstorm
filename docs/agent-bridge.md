# Agents talking through Rundown (saved for later)

Saved on 6 Oct 2026. Not started: pick it up with the person first.

## The idea

With Codex support, people will see two harnesses (Claude Code and Codex) working in the same codebase. Rundown is
the only thing on the machine that sees every agent: both harnesses, every worktree, every edit as it happens. So it
can be the bridge between them: agents ask it who is working where, claim the part they're changing, and leave each
other messages. Through a CLI, `rundown`, talking to the local server on 127.0.0.1.

Neither harness will build this for the other (Claude Code's own agent teams only see Claude Code). This repo already
does it by hand: the "Requests" section of `build-log.md` and "check `git worktree list` before you start" in
`CLAUDE.md` are agents coordinating through text files.

## Why a CLI, not MCP

Both harnesses run shell commands with no setup; MCP needs configuring in each. The plugin's hooks can call the same
CLI. The roadmap's MCP server (`roadmap.md`, part 2; `graph-for-agents.md`) can sit on the same endpoints later.

## Three layers, cheapest first

1. **Collision warnings (no cooperation needed).** Rundown already knows who is editing which file. A hook that runs
   before an edit asks "has another agent touched this file in the last few minutes?" and tells the agent before it
   writes. Across worktrees the collision is a future merge conflict: the "conflict forecast" in `roadmap.md`. This
   layer alone proves the idea or not: count the collisions it caught.
2. **Claims.** `rundown claim app/server/auth --for 20m`, `rundown who <file>`, `rundown release`. Leases that end by
   themselves when the agent's session stops (Rundown sees that), so a crashed agent never keeps a folder locked.
3. **Messages.** `rundown tell <thread> "I changed the session type, rebuild"`, `rundown inbox`. The hard part is
   delivery: an agent reads its inbox only if something makes it look. Claude Code: a hook puts new messages into
   the agent's context on its next turn. Codex: check what hooks it offers when building its adapter; the fallback is
   a line in AGENTS.md ("run `rundown inbox` before editing"), which agents follow unreliably.

## Left out, at least at first

**Assigning tasks.** Once agents hand each other work, Rundown becomes an orchestrator: a different, much bigger
product, up against the harnesses' own subagents and teams. The person assigns; agents can suggest a split that the
person approves in the app.

## Risks to design in from the start

- **Agents giving each other instructions.** A bridge any local process can write to is a way for one agent to steer
  another. Messages arrive marked as from another agent, as information, never as instructions. Every message shows
  in the app, so the person sees the agents talk: a bridge you can't see is a liability, one you can is the point of
  Rundown.
- **Claims are advisory.** An agent can ignore one; the layer-1 warning is what makes ignoring it visible.
- **Privacy.** Local only, like everything else: the server listens on 127.0.0.1, nothing leaves the machine.

## Where to start when it's picked up

Layer 1 for Claude Code, before Codex lands: this repo has several agents at once, so a week of use shows whether it
catches real collisions.
