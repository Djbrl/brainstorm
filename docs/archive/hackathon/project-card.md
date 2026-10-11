# Project card (draft: cut anything that didn't ship)

**Name:** Brainstorm

**One-line story:** A live map of your code and of the AI agents writing it.

**Problem:** AI agents write code faster than we can understand it. Studies show we lose track without noticing (METR 2025), but people who ask questions keep their understanding (Anthropic 2026). Brainstorm turns agent work into something you can see and question.

**What it does:** Follow any Claude Code session live, with every step labeled and every edit clickable. Ask "why?" about any step or file. See the whole codebase as a map glowing where agents are working, and replay how it evolved.

**Team:** TODO

**Tools:** Claude Code (built it), Claude API (answers), NVIDIA Nemotron 3 Nano on Brev via vLLM (reading, labels, risk flags), TypeScript, React, SQLite.

**How we used NVIDIA Brev:** One NVIDIA model on Brev with several jobs. Nemotron 3 Nano runs on a TODO GPU via vLLM. It reads the whole codebase, labels every agent step and flags risky edits. Measured: TODO files in TODO min for $TODO. Summary quality against Claude: TODO/5. Reading stays on our own GPU, which is also our private mode.

**Tested:** TODO (cost per question, fallbacks when a model is down, hallway test).

**Responsible AI:** Local-first storage, secrets masked before storing or sending, only small context packages sent, a human in control.

**Next step:** Codex support, a desktop app with a global shortcut, a pilot with GOMYCODE students.

**Primary prize:** Thunders Engineering Excellence. Also: Guepard, EY Studio+, CompTIA, Brightest.
