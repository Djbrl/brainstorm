# Brainstorm video — final stretch handoff to Claude

**Start here. Updated 27 September 2026, 15:38 Dakar. Submission deadline: 16:30; aim to upload by 16:15.**

The user asked Codex to finish this video iteration and hand the final stretch to Claude. This is a Markdown handoff (the user typed “.mid” in the last message). The latest result is a complete **90-second silent animatic**, not yet a submission-ready narrated prototype video.

## Open these first

All paths are under `/Users/dsy/Documents/brainstorm` in the shared root checkout, branch `main`.

| Item | Exact path |
| --- | --- |
| Latest playable draft | `/Users/dsy/Documents/brainstorm/video/out/film-v3.mp4` |
| Latest narration + shot plan + source caveats | `/Users/dsy/Documents/brainstorm/video/script-v3.md` |
| Full film source | `/Users/dsy/Documents/brainstorm/video/src/film-v3.tsx` |
| Review page with scene buttons and optional captions | `/Users/dsy/Documents/brainstorm/video/review.html` |
| Provisional narration captions | `/Users/dsy/Documents/brainstorm/video/narration-v3.vtt` |
| Longer workflow/context history | `/Users/dsy/Documents/brainstorm/video/HANDOFF.md` |
| Measured benchmark | `/Users/dsy/Documents/brainstorm/docs/bench/hono-result.json` |
| Benchmark method | `/Users/dsy/Documents/brainstorm/docs/bench/bench.py` |
| GPU setup proof | `/Users/dsy/Documents/brainstorm/docs/brev-setup.md` |

**If you are in a separate Claude worktree, these files may not be present there. Use the absolute root paths above, or bring in the latest video commit.** Rendered MP4s and local font binaries are gitignored: a Git merge alone does not copy them. They already exist on this Mac.

## What Codex finished

- A full 90-second, 1280×720, 30fps H.264 animatic, about 2.8MB. Confirmed duration is exactly 90.000 seconds.
- Matched the actual landing page at https://brainstorm-landing.vercel.app/: oversized green hero, one-to-three coloured agent trails, code graph, open layouts, sliding product panels, architecture, benchmark, closing.
- Updated the full script to 164 spoken words, with more time for motivation, technical flow and tokenomics.
- Included real benchmark figures, verified against the result JSON and benchmark code, with honest scope/cost caveats.
- Checked representative frames for text fit. Fixed the product carousel captions to track the visible panel.
- Preserved v1 and v2 as earlier drafts. Latest film entry is `film-v3.tsx`, NOT `index.tsx` (which still renders the old 24-second v2 opening).
- Kept all application code untouched.

## What remains — do these in order

1. **Have the human record the `Recording copy` in `script-v3.md` now.** The draft is 164 words, leaving time for visual holds. A phone or headset recording in a quiet room is enough. Get one complete take; retakes can be individual sentences. No voice or music has been recorded or added yet.
2. **Capture real app footage for 31–45 seconds.** The current `Product` component is an illustrative mockup and the answer is explicitly labeled illustrative. Replace it with recordings of a real Follow edit, a real Ask response, and a real Map. OBS is installed; macOS recording also works. The website's product panels are placeholders, not real footage.
3. Verify the integrated app before promising behavior. If Ask uses Nemotron fallback, show/name Nemotron instead of claiming the answer came from Claude. If live activity is unavailable, change both the matching narration and shot. Do not add unverified history/private-mode/pause/steer/self-observation claims.
4. Put audio and real clips in `video/public/` (e.g. `public/audio/voice.m4a`, `public/clips/follow.mp4`, `ask.mp4`, `map.mp4`). Add voice to the Remotion composition; replace the mockup contents while retaining the visual framing. Retiming the draft captions must follow the actual recording.
5. Add light, appropriately licensed music only if available quickly; voice clarity matters more. No third-party music has been sourced. Do not use Apple soundtrack audio.
6. Render final 1080p, inspect picture/sound/captions and actual duration, then help upload and test the link before 16:15. Do not spend the remaining time redesigning.

## Story timing

| Seconds | Scene |
| --- | --- |
| 0–6 | Landing-page hero: “A live map of your code.” |
| 6–14 | One agent → three trails → map |
| 14–20 | Scrolling code edits: “Nobody reads this.” |
| 20–31 | Why: comprehension study and asking to understand |
| 31–45 | Follow → Ask → Map (REPLACE MOCKUPS WITH REAL FOOTAGE) |
| 45–54 | Logs/files → listener/mapper → local SQLite → map |
| 54–65 | Nemotron on Brev for bulk summaries/labels; Claude for grounded questions |
| 65–77 | Measured benchmark: 311 files, 73.2 seconds, 2.2¢ GPU run time |
| 77–83 | Cached summaries / changed-file rereads; map uses 0 model tokens |
| 83–90 | “Let the agents type. Keep your brain in the loop.” |

The timings are provisional until the voice is recorded. Keep the submitted film at or below 90 seconds.

## Render commands

Node, FFmpeg, Chrome and local dependencies are ready. Run from `/Users/dsy/Documents/brainstorm/video`.

Preview (720p):

```sh
npm run render:film -- --browser-executable='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
```

Final (1080p; do NOT use the preview script's scale flag):

```sh
./node_modules/.bin/remotion render src/film-v3.tsx Film out/brainstorm-final.mp4 --concurrency=2 --browser-executable='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
```

The composition is 1920×1080, 30fps, 2700 frames. Preview scales to 2/3. The full 720p render took roughly three minutes. Allow extra time for final 1080p and real footage. If sandboxed Chrome exits SIGABRT, rerun through the tool's approved escalation mechanism; this happened in Codex and escalation resolved it.

Verification:

```sh
ffprobe -v error -show_entries format=duration:stream=codec_name,width,height,r_frame_rate -of json out/brainstorm-final.mp4
```

Check there is an audio stream after adding voice. Watch the beginning, every transition around real clips, and ending. Ensure no draft disclosure text remains inside final app demonstration clips.

## Design decisions — preserve these

- The user's latest reference is THEIR website, not a generic Apple ad.
- Pure white / #f5f5f7; graphite #1d1d1f; green headline gradient #3f8c00 → #76b900 → #9ccc1c.
- Cabinet Grotesk 800 headlines; Satoshi 400/500 supporting copy. Local fonts already exist in `video/public/fonts/` and load before rendering starts.
- Blue/violet/cyan agent trails; warm orange/red map heat.
- No small label/eyebrow titles. Minimal copy. Big breathable compositions. No stacked explanatory cards.
- The occasional single product window is intentional. Its mock content must be replaced, not merely passed off as captured UI.
- Fontshare binaries are gitignored because they must not be redistributed through a public repository. Font provenance and usage notes are in `public/fonts/README.md`. On another machine obtain original fonts from Fontshare using `sh video/download-fonts.sh` from repo root.

## Claims: exact evidence and limits

**Research:** Anthropic, 29 January 2026: https://www.anthropic.com/research/AI-assistance-coding-skills . 52 mostly junior Python developers learning Trio. Mean immediate quiz scores: 50% with AI, 67% without. Explanation-seeking was associated with stronger understanding, not proven causal. No study of Brainstorm itself. Keep the study context on screen.

**Brev benchmark:** 311/311 summarized responses, 0 request errors; 73.2 seconds; 646,453 prompt tokens and 20,460 completion tokens. Nemotron 3 Nano, L40S, vLLM, 16 concurrent requests. Price documented as $1.06/hour.

**Cost:** 73.2 ÷ 3600 × $1.06 = $0.02155, rounded to 2.2¢. This is allocated GPU inference time on a running machine, NOT total infrastructure cost. Startup, model download and idle billing are excluded. This limitation is stated both in narration and on screen.

**Input cap:** `bench.py` sends at most 60,000 characters per file (`txt[:MAX_BYTES]`, despite that variable's name). Do not say every one of the corpus's 80,983 lines was read. The displayed token totals are the measured API usage.

**Do not invent:** per-question cost, summary quality score, 35× savings comparison, real user outcome, or “watched itself all day.” The script omits these.

**Implementation inspected:** content-hash summary cache and 150-line Ask file excerpt cap exist in the coding worktree source. Integrated runtime must still be checked before final capture.

## Coordination

Follow root CLAUDE.md. Work in `video/`; log milestones in `docs/build-log.md`. Keep commits small with `[Video]` prefix. Other agents share this repo. Preserve their changes. Main submission coordination lives in `docs/status.md` and `docs/submission-checklist.md`.
