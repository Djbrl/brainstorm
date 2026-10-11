# Brainstorm: plan (reference)

**One-liner:** Brainstorm is a live map of your code and of the AI agents writing it.
**Closing line:** "Let the agents type. Keep your brain in the loop."

## Problem
AI coding agents make it easy to stop understanding your own code ("comprehension debt"). Agents work in a chat scroll; a 47-file change gets "Accept all". Reading diffs line by line is the wrong way to understand a system. You look at a map.

## Research
| Study | Finding | Caveat |
| --- | --- | --- |
| [Anthropic, How AI assistance impacts the formation of coding skills (2026)](https://www.anthropic.com/research/AI-assistance-coding-skills) | Learning with AI: 50% vs 67% comprehension, biggest gap on debugging. Those who used AI to ask questions scored 65–86%. | 52 developers |
| [METR, Early-2025 AI and experienced OSS developer productivity (2025)](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/) | 19% slower with AI, but felt 20% faster | 16 developers |
| [MIT Media Lab, Your Brain on ChatGPT (2025)](https://arxiv.org/abs/2506.08872) | Weakest brain engagement with an LLM; 83% couldn't quote their own essay | Preprint, 54 people |

## Users
Students learning while building with AI; anyone building with AI who wants to know what's under the hood; tech leads reviewing AI work.

## Positioning
Claude Code and Codex are harnesses: they run agents. Brainstorm is a visualizer: it shows what agents did, where, and lets you question it. It sits alongside them.

## AI use (the right model for each job)
- **Nemotron 3 Nano on NVIDIA Brev (vLLM)** does the bulk work: file and module summaries, a label for every agent step, risk flags. Flat hourly GPU cost, and private mode.
- **Claude** answers questions from a small, grounded context package.
- Most features need no AI: the timeline, the map structure, heat and history.

## Privacy
Local-first: everything is stored on your machine. Questions go to the provider your agent already uses, with your own key. Only small packages are sent. Secrets are masked. Private mode runs everything on your own GPU. A human stays in control: follow, ask, pause.

## Known limits
Claude Code only today (Codex is next). Steering works through Claude Code hooks. Large repos show modules first.
