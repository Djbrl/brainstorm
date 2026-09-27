# Brainstorm — website-led 90-second film

Version 3, 27 September 2026. Narration: 164 words. Reference: https://brainstorm-landing.vercel.app/

The film follows the site's experience: oversized green hero → one moving agent → three trails → a map → why understanding matters → product → architecture → measured economics → closing. White and #f5f5f7; Cabinet Grotesk 800 / Satoshi. Green gradient #3f8c00 → #76b900 → #9ccc1c. Agent trails blue, violet, cyan. Heat orange/red. No eyebrow headings.

## Timed narration and picture

| Time | Narration | Picture |
| --- | --- | --- |
| 00–06 | Brainstorm. A live map of your code, and the agents writing it. | Recreate the site's large green hero; type rises into view. |
| 06–14 | One agent, you can follow. Three, and the changes scatter across your project. | One blue trail, then purple and cyan paths. Camera pulls back to the code graph. |
| 14–20 | A wall of edits tells you what changed. Understanding why takes more. | Scrolling terminal changes become “Nobody reads this.” |
| 20–31 | In one coding study, AI users scored lower on comprehension. Those who sought explanations understood more. That's the habit we're designing for. | 50% with AI / 67% without. Then “Ask to understand.” Source and study limits along bottom. |
| 31–45 | Follow a session. Open an edit. Ask why. Then zoom out to see where agents are working and how your files connect. | Sliding product sequence: Follow, Ask, Map. Current animatic is illustrative; replace with real capture. |
| 45–54 | Underneath, local listeners read session logs. A mapper follows files and imports. SQLite keeps the record. | Logs + files → listener + mapper → local SQLite → map. Lines draw, data moves. |
| 54–65 | Nemotron on our Brev GPU summarizes code and labels steps. Claude answers questions from a small package of relevant context. | Open two-column diagram: bulk code → Nemotron; selected step and diff → Claude. |
| 65–77 | On our Hono benchmark: three hundred eleven files, seventy-three seconds, about two cents of GPU time. Startup and idle time are extra. | 311 files / 73.2 seconds / 2.2¢. Supporting totals: 646,453 input and 20,460 output tokens. Footnote explains run-only cost and input cap. |
| 77–83 | Re-read only changed files. Keep each question focused. The map itself uses no model tokens. | Unchanged files dim; one changed file flows to model. “0 model tokens” for map. |
| 83–90 | Let the agents type. Keep your brain in the loop. | Site's closing type treatment and Brainstorm wordmark. |

## Recording copy

Brainstorm. A live map of your code, and the agents writing it.

One agent, you can follow. Three, and the changes scatter across your project.

A wall of edits tells you what changed. Understanding why takes more.

In one coding study, AI users scored lower on comprehension. Those who sought explanations understood more. That's the habit we're designing for.

Follow a session. Open an edit. Ask why. Then zoom out to see where agents are working and how your files connect.

Underneath, local listeners read session logs. A mapper follows files and imports. SQLite keeps the record.

Nemotron on our Brev GPU summarizes code and labels steps. Claude answers questions from a small package of relevant context.

On our Hono benchmark: three hundred eleven files, seventy-three seconds, about two cents of GPU time. Startup and idle time are extra.

Re-read only changed files. Keep each question focused. The map itself uses no model tokens.

Let the agents type. Keep your brain in the loop.

## Evidence and final-shot gates

- Research: https://www.anthropic.com/research/AI-assistance-coding-skills (29 January 2026). 52 mostly junior Python developers, one new library, immediate comprehension quiz; AI 50%, hand-coding 67%. The relationship between explanation-seeking and higher scores is qualitative/associational, not proof that Brainstorm improves learning. Do not say “Brainstorm protects understanding” as a measured outcome.
- The site also quotes METR. We use one study in 90 seconds to leave room for the technical and economic explanation.
- Benchmark source: `../docs/bench/hono-result.json` and `../docs/bench/bench.py`. 311/311 files, 0 request errors, 73.2 seconds, 646,453 prompt tokens, 20,460 output tokens. Script uses 16 parallel requests and limits each file to 60,000 characters. Therefore do NOT claim all 80,983 lines were sent/read, even though that is the full corpus line count.
- GPU run cost: 73.2 / 3600 × $1.06 = $0.02155, rounded to 2.2¢. This is allocated inference time on an already-running L40S, not the total Brev bill. Startup, downloads, and idle hours are excluded. Do not call it “free” or an all-in project cost.
- Do not repeat the estimated “35× cheaper” comparison or any per-question price without matching measured usage and verified model prices.
- Product / architecture scenes are an explanation of the intended flow. Before submission, verify the integrated app and replace the product mockups with real recordings. If Ask is using Nemotron fallback, show and name that actual provider.
- The landing page currently makes private-mode, secret-masking, and self-observation claims. These are deliberately absent until demonstrated. The page's product slots are placeholders, not usable app footage.
- Draft narration captions are in `narration-v3.vtt` and available through the review player. They are timing placeholders, not final voice-synced captions. This draft has no voice track or music. Record the human's voice after copy approval. Timings are provisional and must follow the spoken delivery while staying under 90 seconds.
