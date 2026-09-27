# Video (agent briefing)

A 90-second video in English. The human records the voice. Screen footage must be real Brainstorm running. Speed-ups are allowed if labeled "2×".

**Deadlines:** script and captions ready by 15:00. Capture 15:40–16:00. Edit and upload by 16:15 (unlisted YouTube, or Google Drive with "anyone with the link").

## Script

| Time | On screen | Voice-over (read at a calm pace) |
| --- | --- | --- |
| 0:00–0:12 | Split screen of three terminals, all typing "Write my entire SaaS. Make no mistakes." Captions: "Person 1: opens TikTok." "Person 2: opens 4 more threads." "Person 3: tries to read… 47 files later: Accept all." | "Three people give an AI the same job. One scrolls TikTok. One opens four more agents. One tries to keep up, and gives up." |
| 0:12–0:27 | Title cards: "Developers were 19% slower with AI, but felt 20% faster (METR, 2025)". Then "Learning with AI: 50% vs 67% comprehension. Those who asked questions kept up (Anthropic, 2026)." | "Studies show we lose track and don't notice. But people who ask questions keep their understanding. We have incredible tools. Our way of keeping up hasn't caught up." |
| 0:27–0:35 | Claude Code: "Done! Updated 47 files", scrolling a wall of diffs | "Nobody reads this. You don't learn a city by reading a list of streets. You look at a map." |
| 0:35–1:02 | Brainstorm: sessions list, then Follow with labeled steps, click an edit, ask "why did you change this?", answer with cost shown, zoom out to the Map with nodes pulsing live, click a node, see its summary | "This is Brainstorm. Work as usual in Claude Code. Follow any agent live: every step labeled, every edit clickable. Ask why. Then zoom out: your whole codebase, glowing where agents are working right now." |
| 1:02–1:12 | Point it at an existing repo; the map appears. History slider moving. | "Already wrote your code? Point Brainstorm at any project. Every question and map is saved, so you can see how your project grew." |
| 1:12–1:25 | Brainstorm's own map time-lapse. Text: "Built today, watched by itself. Nemotron on NVIDIA Brev: [N] files read in [N] min for $[X]. [X]¢ per question." | "We built Brainstorm with agents, and Brainstorm watched them. The reading runs on NVIDIA Nemotron on Brev, on our own GPU." |
| 1:25–1:30 | Logo plus closing line | "Let the agents type. Keep your brain in the loop." |

Numbers in brackets come from `../docs/numbers.md`. If a number is missing, remove the claim; never guess.

## Video agent tasks

1. Write `captions.srt` from the voice-over column.
2. Make title cards (1920×1080 PNG, plain dark background, large text) for the two studies, the stats and the closing line, in `cards/`.
3. Write `shot-list.md`: exactly what to capture on screen and in which order, so the human can record in one 15-minute pass.
4. Put the hook's three terminal recordings in `clips/`, recorded by the human or scripted with a terminal recorder.
5. Assemble the video in iMovie or CapCut (human) or with ffmpeg (agent) from `clips/`, `cards/` and the voice track.

**Tools:** QuickTime (File > New Screen Recording) for the screen; the human's own voice through headphones with a mic; iMovie or CapCut to assemble; captions burned in.
