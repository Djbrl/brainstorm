# Sharing and experiments

The two big directions chosen on 5 Oct 2026. Nothing here is built yet. The other big ideas from that discussion are in the roadmap's "Fridge".

## Facts checked before planning (5 Oct 2026)

- **Sharing today:** `/brainstorm:share` (or Share on a thread) saves one `.html` file that holds the whole app and the recording, plus a Markdown report. Secrets, the home folder, account and computer names and emails are masked first. Screenshots are left out. Nothing is hosted.
- **File snapshots:** Claude Code keeps snapshots at each of your messages in `~/.claude/file-history` (the log's `file-history-snapshot` lines point to them). They only cover files its edit tools changed, not what a shell command changed.
- **Forking:** Claude Code can fork a whole conversation (`--resume <id> --fork-session`) and pick a model (`--model`), headless with `-p`. It can't fork from a given step. That would mean writing a truncated copy of the conversation's log ourselves, an undocumented format.

## 1. Record, share, live

Threads become something you publish: "how I set up a GPU in 20 minutes", "my skill, running on a real repo". People already post screen recordings of agents; this is the readable, replayable version.

What has to be true first:

1. **A story, not a log.** A 3-hour thread watched in 2 minutes:
   - chapters titled from your requests;
   - a one-line narration per chapter;
   - key moments, especially "failed, then fixed";
   - the result at the end (a screenshot or link);
   - playback that compresses time.

   Most of this needs AI on by default.
2. **An editor before publishing:** trim, hide steps, rename chapters, captions, a cover image.
3. **A privacy review people trust:**
   - a preview of everything that will be shared;
   - flagged items (paths, emails, links with tokens);
   - screenshots to blur or drop;
   - how much code to show: full diffs, file names only, or none (private repos).
4. **Formats that travel without our servers:** the `.html` file exists. Next: a **video or GIF export** of the map replay, which posts straight to X, Discord or a README. The cheapest big win.
5. **Hosted links** (needs a cloud service, in a separate closed repo per the license decision):
   - a page per replay;
   - embeds for blogs and READMEs;
   - preview cards for social posts;
   - unlisted or public, and deletable;
   - storage and abuse handling.
6. **Live:**
   - real-time steps through hooks;
   - redaction applied before each event leaves the machine;
   - a relay server;
   - "go live" with pause;
   - viewers on the map;
   - chat later.
7. **Skill demos:** a replay linked to the skill it used ("made with skill X"), embeddable in the skill's README.

Order: story mode and editor, privacy review, video export (all local), then hosted links, then live.

## 2. Experiments lab

Pick a request from a real thread, rerun it from the same starting point with other models or prompts, and compare.

What it needs:

1. **Exact starting points:** a hook saves the working tree into hidden git refs at each of your messages. That's cheap, exact (shell changes too) and deduplicated, and it also enables "rewind" later.
2. **A runner:** creates a worktree at the snapshot and runs Claude Code headless with `--model`, several runs in parallel. Each run is recorded as a thread.
3. **The same context:**
   - First version: the request plus a short summary of what came before.
   - Later: fork the conversation at the exact step by writing a truncated copy of its log.
4. **Spend per thread,** read from the token usage in the logs.
5. **What "better" means:**
   - the tests pass (a check command per project), plus the claim check;
   - or you pick the winner;
   - optionally, an AI judge.
6. **A compare view:** lanes side by side with the files changed, a diff against the original run, cost, time and failures. On the map, several agents replay at once.
7. **Consent and quota:** runs use your own Claude plan or key; show the cost before starting.

The two directions meet: a comparison ("Opus vs Sonnet on my real refactor: $3.10 vs $0.90, both passed") is exactly the kind of thing people share.

## Foundations, for both

| Foundation | Needed for | Size |
| --- | --- | --- |
| AI on by default (`claude -p`) | Narration, chapter titles, summaries, the AI judge | 1 day |
| Real-time step hooks (`PostToolUse`) | Live, and an instant feel everywhere | ½ day |
| Spend per thread (token usage in the logs) | Showing cost, comparing runs | ½–1 day |
| A stable, versioned replay format with a size budget | Hosting, embeds, old links that keep working | 1 day |
| Snapshots per message (git refs, via a hook) | Experiments, the result at the end, rewind | 1 day |
| Tests for the log reader | Everything: the log format can change silently | ½ day |

## Open questions

- **Hosted links:** anonymous, or GitHub sign-in? Free or paid? Which domain?
- **Default code visibility in shares:** full diffs, or file names only?
- **Experiments:** spending the user's own quota on runs; whether comparisons include Codex later.
