# Roadmap

Where Brainstorm goes after the hackathon. A working document: we update it as we settle product decisions.

Last updated: 5 Oct 2026.

## Where we stand

The biggest gap is how people get Brainstorm, not a missing feature. Today it only runs from a clone with two dev servers, env vars and a GPU we've since turned off. If we win, the demo has to be `npx brainstorm` on a laptop with real agents working on stage, because the hosted replay can't show what makes it good: seeing agents work in real time.

## Direction under discussion: build around the replay

Shareable replays and replays on pull requests could be the main value of Brainstorm, with the whole experience built around them. Follow, the Map, Ask and Failures would become ways to record, read and share a replay rather than separate tools. Product design questions are still open (see below) before we commit to this.

## 1. Current features and how to improve them

| Feature | What it does today | Main gap | Improvement |
| --- | --- | --- | --- |
| **Follow** | Live timeline of every Claude Code session, with a label on each step and subagents inline | It's still a log you have to read | A short digest per turn ("moved auth to JWT, 4 files, 1 failing test"). A "needs you" state when an agent waits on permission, retries the same error or goes quiet. |
| **Map** | Files and modules with recency colors and summaries. Live agents move on writes, reads show as lines, trails, thread replay, import links | Hard to read past a few hundred files. Summaries go stale. It shows *where*, not *what it affects* | Zoom by module (clusters that open up). **Blast radius**: an edit lights up the files that import it. **Collision warnings** when two agents write to the same file or module. A history slider. |
| **Ask** | Q&A grounded in the code, answered by Claude, about $0.03 a question | The answer is plain text | Answers link to files that light up on the map and to steps in Follow. Questions about sessions too ("why did the agent change X?"). |
| **Failures** | Failing tool calls grouped and ranked, each group named with a suggested fix | Only after the fact | A live alert when an agent retries the same error 3 times, and a "send this fix to the agent" button. |
| **Setup** | Folder picker and loading checklist | Setup is a clone, two servers and env vars | Solved by packaging (part 2). |
| **Replay and redaction** | Hosted replays with private data removed | Export and redaction are manual | A one-click share link. That's a growth feature (part 3). |

Problems that affect every feature:

- **Summaries and labels depend on Nemotron on a GPU we deleted.** We need a model setting: Claude Haiku with the user's own key, a local model through Ollama, or Nemotron through NVIDIA's hosted API. The last one keeps the NVIDIA story. Our measurement puts Haiku at about $0.75 to read a 300-file repo once (see `numbers.md`); later changes cost cents.
- **Claude Code and Codex are supported** (Codex since 6 Oct 2026). Each agent is a log source (`app/server/src/listener/source.ts`), so Gemini CLI and Cursor can each be another one.
- **There are no tests.** Claude Code's log format isn't documented and can change, so the parser needs tests first.

## 2. Packaging: no new habits

The user keeps typing to their agent, and Brainstorm shows up next to it. Four layers, in order:

1. **`npx brainstorm`**
   - One process that serves the built web app and opens the browser.
   - It detects the current folder and its Claude Code sessions.
   - About half a day plus the model setting. This is the demo-ready base.
2. **A Claude Code plugin**
   - Hooks send events the moment they happen instead of us reading log files.
   - The hook that runs before a tool call makes "pause and steer" possible.
   - A `/brainstorm` command opens the map at the current file.
   - It's distributed through plugin marketplaces, where users already are.
3. **An MCP server: the agents ask Brainstorm too.**
   - Example questions: "what imports this file?", "is another agent editing `auth/`?", "what failed last time I ran this?"
   - Brainstorm stops being just a dashboard for the human and becomes context that saves the agents' tokens and mistakes. Savings can be measured, so this is our strongest point of difference.
4. **Later:** a panel in VS Code or Cursor (the same UI in a webview), and a menu bar status ("3 agents working, 1 waiting on you").

## 3. From useful to paid

Watching agents is hard to charge a single developer for. Brainstorm becomes worth more with more agents, more people and more money at stake. Tiers (the prices are guesses we'd need to test):

- **Free, open source, local.** One developer on one machine, and the code never leaves it. That builds trust and spreads it.
- **Pro, about $10–15 a month.**
  - Models included, no API keys needed.
  - History and search across every session ("when did login break?").
  - **Spend per session and per feature.** The landing page's "Where your money goes" section, made real.
  - **Shareable replays** with redaction. We already built this, and vibecoders like showing off how they built something, so it can spread on its own.
- **Team, about $20–30 per seat.**
  - One shared map across teammates' agents, with collision warnings across machines.
  - **Replays on pull requests:** a GitHub app attaches the agent session and its blast radius to each PR, so reviewers can see how the AI code was made.
  - Reviewing AI-written code is a real pain, and the buyer is the engineering lead.
- **Enterprise.**
  - Records of which code an agent wrote, from which prompt, and who approved it.
  - Rules such as "agents can't touch `payments/`".
  - Self-hosting and single sign-on.

**The paid feature to lead with: replays on pull requests.** It's concrete, the saved review time can be measured, it spreads through teams, and it reuses the replay, redaction and map we already have.

**Main risk:** Anthropic or Cursor build their own session views. What protects us is covering several tools (Claude, Codex and Cursor on one map) plus the team layer, since no vendor will show a competitor's agents.

## Two-week plan

- **Week 1: something anyone can install.**
  - `npx brainstorm`.
  - The model setting (Haiku, Ollama, hosted Nemotron).
  - Real-time events through hooks.
  - Parser tests.
- **Week 2: the demo's key moments.**
  - The MCP server.
  - Collision warnings.
  - "Needs you" states.
  - A share link.
- **Then:** put it in front of 5–10 vibecoders before building any team features.

This also gives the stage demo, all live: install in a fresh repo, start 3 agents, the map lights up, Failures catches a loop, and an agent avoids a collision by asking Brainstorm.

## Product vision (28 Sep 2026)

**Brainstorm records AI-built code: every agent session becomes a replay you can watch, question and share.**

It records locally and automatically, with no setup per session. Three kinds of people use a replay:

- **You**, to catch up: watch it live on the map, or replay what happened while you were away.
- **Your agents**, as context: through the MCP server they learn who is editing what, what depends on a file, and why it was last changed.
- **Other people**, to understand: a share link, or a replay attached to a pull request.

The Map, Follow, Ask and Failures are ways of reading a replay. Local use is free and open source. The paid product is replays that leave your machine: hosted links, pull request replays, teams.

## Packaging: the Claude Code plugin

- **One bundle, two ways in.** The plugin contains the local app (server and web in one process). `npx brainstorm` ships the same bundle later, for Codex and Cursor users.
- **Install:** `/plugin marketplace add Djbrl/brainstorm`, then `/plugin install brainstorm@brainstorm`.
- **Start:** a `SessionStart` hook starts Brainstorm in the background (or reuses the running one). Claude Code's logs stay on disk, so it catches up on anything it missed.
- **Viewing:** `/brainstorm:open` opens the map in a browser tab on `localhost`, focused on the current project. To try: Claude's desktop browser pane. Later: a desktop app with a shortcut.
- **Node:** the plugin needs Node 22 or later. If it's missing, the open command asks Claude to install it (the "agent installer" idea).
- **Keys:** plugin settings (`userConfig`). The Anthropic key is marked sensitive, so it's stored in the system's credential store and only reaches Brainstorm through the hook's environment. Default AI: the user's own Claude Code (`claude -p`), so no key is needed on day one. Other choices later: Anthropic key, NVIDIA (Nemotron), local (Ollama), off.
- **Security:** the server listens on 127.0.0.1 only, accepts only localhost `Host` headers (against DNS rebinding) and rejects WebSocket connections from other sites.
- **Releases:** the plugin pins a `version`. A release is a version bump plus a push. Auto-update is off by default for third-party marketplaces, so the page shows "Update available" when GitHub has a newer version. The launcher restarts a running server whose version differs from the plugin's. The database lives in the plugin's data folder, which survives updates, so schema changes need migrations.

### Plugin milestones

1. **v0.1 (half a day):** one process serving the web app, data in the plugin folder, workspace from the project, one shared server, `/brainstorm:open` and `/brainstorm:stop`, `SessionStart` hook, marketplace file. Map, Follow, Failures and replays work; no AI summaries unless a key is set.
2. **Day 1:** AI through `claude -p` (lazy summaries: files agents touch or the user opens), `/brainstorm:recap`.
3. **Day 2:** MCP server (`who_is_editing`, `impact`, `history`, `past_failures`, `overview`) and a skill telling agents when to use it.
4. **Day 3:** real-time hooks, `/brainstorm:share` (redacted replay file), clean-machine test.
5. **Later:** hosted encrypted share links, pull request replays, pause and steer, the official marketplace.

## Tasks: following agents beyond code (28 Sep 2026)

Agents don't only write code. They edit videos with FFmpeg, write documents, research the web for a paper or a reference board, and automate things on the computer. Tasks lets anyone follow and replay that work, and learn how it was done. It starts from the prototype on `feature/cowork` (see `docs/cowork.md`), which sorts every non-code tool call into a place (site, page, service, app) and separates reads from changes. "Cowork" is Anthropic's product name, so the feature is called **Tasks**.

**A task replay has four parts:**

1. **The goal:** what the user asked for.
2. **How it did it:** the steps in plain language, grouped under the agent's own explanations. Commands are explained (for example, what each FFmpeg option does), so the replay doubles as a recipe you can learn from and ask about.
3. **What it made:** the files and outputs, with previews (images, video frames, documents).
4. **Where it got things:** the sites, pages, files and images it used.

**Picture-in-picture, in three levels:**

1. **The agent's own screenshots.** Browser and computer-use tools take a screenshot at almost every step, and Claude Code stores them in its logs (JPEG, about 30 KB each). Kept and shown in order, they make a filmstrip replay and a picture-in-picture that updates at each step. No permissions, no extra cost.
2. **Live previews of the files being worked on.** Brainstorm watches the output files and refreshes a thumbnail when one changes: images, video frames (extracted locally with FFmpeg), rendered documents.
3. **Live video of an app window** (Photoshop, a video editor), with the system's window capture. It needs a native helper and screen-recording permission, so it's for the future desktop app, opt-in only.

**Layout:** a task is a sequence, not a network, so Tasks uses a storyboard (filmstrip, steps, outputs, sources) rather than a graph. The code map stays a map, possibly with a treemap view for large repos.

**Open questions:**

- **Reaching non-coders' tools.** Cowork keeps no local transcripts, and neither do ChatGPT's agent or most browser agents. We need a way in (a Cowork plugin, if hooks load there, or an import format) before Tasks can serve people who don't use Claude Code or Codex.
- **Privacy.** Screenshots and browsing show far more than code: emails, messages, typed text. Tasks needs a private mode and redaction for screenshots before anything is shared.
- **Audience.** We launch with developers ("see everything your agents do, not just the code"; about a quarter of their agents' tool calls are already outside the code), then expand once we can reach non-coders' tools.

**Order:**

1. Task view (goal, how, made, sources) and the filmstrip replay, on `feature/tasks`. **v0 built (28 Sep), see [tasks.md](tasks.md).**
2. Live file previews.
3. The places map merged into the main map.
4. Research access to Cowork and other agents.
5. Window capture in the desktop app.

## Big directions (5 Oct 2026)

Chosen: **record, share and live**, and the **experiments lab**. See [share-and-experiments.md](share-and-experiments.md): what each needs, the foundations they share, and the open questions.

### Fridge

Good ideas we're not building now:

- **The project's memory.** Brainstorm keeps what every thread learned (decisions, failed approaches, gotchas, conventions) and hands the relevant parts to agents at the start of a session or through MCP. The value adds up with every thread and can be measured: fewer repeated failures and tokens.
- **Keeping the human up to date.** An "understanding map" of the code you've looked at versus what only agents touched since, a daily "what you should know" briefing, optional quizzes. Answers the research on people losing their grip on agent-written code.
- **Threads become recipes.** A thread that worked becomes a parameterized, installable Claude Code skill; a library of recipes made from real sessions.
- **Smaller ones from the same discussion:** claim check (what the agent said vs what it did; also in `todo.md`), parallel agents with a conflict forecast across worktrees, spend per thread, a "what changed while you were away" recap, a risky-actions feed, search across history.

## Open product questions

To settle before building. Record each decision here with the date.

- Pricing and what exactly sits in Pro vs Team.
- Share links: anonymous (no account) or tied to GitHub sign-in?

## Decisions

| Date | Decision |
| --- | --- |
| 27 Sep 2026 | After the deadline, new code goes to the `post-deadline` branch; `main` stays the judged entry. |
| 28 Sep 2026 | The replay is the core of the product; the other views are ways to read one. |
| 28 Sep 2026 | Local-first: recording and viewing stay on the machine; the cloud is only for replays the user chooses to share. |
| 28 Sep 2026 | First package: a Claude Code plugin (replay + map), built on the same bundle a later `npx brainstorm` will use. |
| 28 Sep 2026 | AI: bring your own, detected automatically; default is the user's Claude Code. We provide AI only in the paid, hosted parts, paid per token rather than on our own GPUs. |
| 28 Sep 2026 | License: FSL-1.1-ALv2 (Functional Source License). Free to use, change and self-host; no competing product or service; each release becomes Apache 2.0 after two years. The future cloud service stays in a separate, closed repo. |
| 28 Sep 2026 | Results out: 3rd place, Senegal. `post-deadline` merged into `main`, which is the development branch again. The judged state stays tagged `hackathon-submission`, and the judged demo stays online unchanged. |
| 28 Sep 2026 | Tasks (formerly the Cowork prototype): follow and replay agents' non-code work as a storyboard (goal, how, made, sources) with a filmstrip of the agent's screenshots. Developers first, non-coders once we can reach their tools. |
| 5 Oct 2026 | Next big directions: record, share and live; and the experiments lab ([share-and-experiments.md](share-and-experiments.md)). Project memory, the comprehension layer and recipes go in the Fridge. |
