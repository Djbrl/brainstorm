# Roadmap

Where Brainstorm goes after the hackathon. A working document: we update it as we settle product decisions.

Last updated: 28 Sep 2026.

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
- **Only Claude Code is supported.** The listener is the only part tied to Claude, so Codex, Gemini CLI and Cursor can each be a separate parser.
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

## Open product questions

To settle before building. Record each decision here with the date.

- Is the replay the core of the product, with the other views built around it?

## Decisions

| Date | Decision |
| --- | --- |
| 27 Sep 2026 | After the deadline, new code goes to the `post-deadline` branch; `main` stays the judged entry. |
