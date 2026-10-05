# Waiting for you

Brainstorm shows when a thread can't go on without you, and when it's your turn.

| State | When | Sure? |
| --- | --- | --- |
| **Needs you: permission** | A tool call waits for your OK | Sure with the plugin's hooks. Without them, a guess: an instant tool (Edit, Write, Read, Grep, WebFetch…) with no result and no activity for 8 s. Commands, subagents and browsers can legitimately take long, so they're never guessed. |
| **Needs you: question** | The agent asked you something (AskUserQuestion, or an MCP form) | Sure |
| **Needs you: plan** | A plan waits for approval (ExitPlanMode) | Sure |
| **Stuck** | The same tool failed 3 times in a row on the main thread | Sure; clears on a success or a new message |
| **Your turn** | The agent finished: its last word was a message and nothing is open | Sure with the Stop hook, else after 4 s of quiet |

After 2 hours without activity a thread stops asking (except for an unanswered question or plan).

## Where it shows

- **Sidebar:** an amber breathing dot and a "Needs you" or "Stuck" badge on the thread; "Your turn" in grey.
- **Steps:** the last row of the open thread says what it's waiting for (the command, the file, the question) and links to the step.
- **Map:** the waiting agent stays on the map with an amber ring that breathes, and its label says why.
- **Tab title:** "(2) Brainstorm" when two threads need you.
- **Desktop notifications:** opt in from Settings. Only for sure states (and stuck), only fresh ones, and only while the Brainstorm tab is in the background.

## How it works

- `app/server/src/attention/`: one tracker per thread (calls with no result, by tool_use id; failures in a row; the last main-thread step), fed by live steps and caught up from the stored log. `GET /api/attention`, ws `attention`.
- Plugin hooks (`plugin/hooks/hooks.json`): `PermissionRequest`, `Notification` (permission_prompt, idle_prompt, elicitation_*), `Stop` and `UserPromptSubmit` run `plugin/scripts/signal.mjs` in the background (async). It posts the event to `POST /api/hooks` with an `x-brainstorm-hook` header, which other web pages can't send (no CORS), and drops the transcript path and working directory.
- A permission signal clears when its call gets a result, or when the main thread does anything new.

## Not done yet

- Notifications are untested in a real browser (the test browser can't grant them).
- The hooks only reach a plugin built from this branch: until the next plugin release, the installed server answers them with 404 (silently ignored).
- A "Notify me" prompt the first time a thread needs you, instead of only the Settings switch.
