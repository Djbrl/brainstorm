# Brainstorm video — handoff for Claude or the next Codex context

**For the final stretch, start with `FINAL-HANDOFF.md`.**

Last updated: 27 September 2026, 15:29 Dakar. Submission 16:30; code freeze 15:40; aim to finish video by 16:10–16:15.

## Latest user direction and deliverable (v3, 15:22)

The user now wants the film to mirror their landing page, https://brainstorm-landing.vercel.app/, with more time for motivation, technical workings, and tokenomics. This supersedes v2's violet-led visual direction. We inspected the live site and read its source in `.claude/worktrees/hackathon-landing-page-7cd864/site/index.html` without modifying it.

- New entry: `src/film-v3.tsx`, composition `Film`, 2700 frames, 30fps, 1920×1080. Full 90-second silent animatic.
- Latest narration and shot plan: `script-v3.md`, 164 spoken words. User has NOT recorded or approved it yet. Optional timed draft text is in `narration-v3.vtt`, linked as captions in `review.html`. Retiming must follow actual voice.
- New render: `npm run render:film -- --browser-executable='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'` from `video/`. Output `out/film-v3.mp4`, 720p review. Preserve v1/v2 for comparison.
- Visuals now match site: pure white / #f5f5f7, Cabinet Grotesk 800, Satoshi; green gradient #3f8c00 → #76b900 → #9ccc1c; blue/violet/cyan agent trails; orange/red map heat.
- Story: hero 0–6s; one/three-agent trails 6–14; scrolling edits 14–20; comprehension 20–31; product carousel 31–45; local technical flow 45–54; model responsibilities 54–65; benchmark 65–77; incremental rereads/token-free map 77–83; closing 83–90.
- **Still illustrative product UI** in the 31–45s segment. The live landing page also has placeholder product panels. Replace these with real app footage before calling the film a prototype demonstration. Ask answer is explicitly marked illustrative in the preview. No music or narration yet.
- Research restored at user's request for more motivation: Anthropic January 2026, 52 developers learning Trio, quiz 50% with AI / 67% without. Explanation-seeking correlates with stronger comprehension; no claim Brainstorm itself has a measured learning benefit. Verified official source in `script-v3.md`.
- Real benchmark now exists: `docs/bench/hono-result.json`, `docs/bench/bench.py`. 311/311 successful responses; 73.2s; 646,453 input tokens and 20,460 output tokens. Price in docs is $1.06/hr; allocated warm-run GPU cost = $0.02155, displayed 2.2¢. Excludes startup/download/idle time.
- Important: benchmark slices each file to 60,000 CHARACTERS despite variable named MAX_BYTES. Do not claim all 80,983 corpus lines were read. Video discloses cap and 16 concurrent requests. Do not use estimated 35× comparison or invent Ask costs.
- Confirmed in the coding worktree source: reader uses content-hash summary caching; Ask context caps file excerpt to 150 lines. Integrated runtime still needs verification.
- Next priority: review full animatic, record human narration, replace product scenes with actual capture at 15:40, then sound/captions/final ≤90-second 1080p export.

## Mission and ownership

Continue the 90-second hackathon film. Work in `video/`, with milestones/requests in `docs/build-log.md`. Read root `CLAUDE.md` and `video/README.md`. The user has authorized making a mockup and script, then revising them. Claude is handling product/setup work separately; do not change `app/` without assignment. The older README script is a reference, not the latest approved direction. User feedback overrides it.

## Conversation and current direction

The user wants Apple-style feature presentation: full-bleed panels, oversized typography, smooth zooms/reveals, product demonstrations between ideas. References:
- https://www.youtube.com/watch?v=mUoWMlZXQ28 (Apple Developer, Shortcuts)
- https://www.youtube.com/watch?v=mHXELsEResE (Apple child safety features)
- https://www.apple.com/

The user liked the initial mockup, then specifically requested:
- LIGHT theme, big breathable compositions, minimal text.
- Lead with the idea and visuals; supporting text only when useful.
- Do not rely on stacked cards. Use open grids, spatial relationships, sliding sequences, motion.
- NO small label/eyebrow titles. Remove “01 / FOLLOW”, “ONE QUESTION”, all-caps section labels, etc.
- Big-type hero with motion leading into the next scene. They used “landing page hero” wording in this video conversation; currently interpreting that as video-opening direction, not authorization to edit the product landing page.
- Find a font duo on https://www.fontshare.com/.

## Current revision (v2)

- `src/index.tsx` now implements the light, spacious revision. No eyebrow headings or disclosure watermark inside the film; concept disclosure is in the review page and delivery message.
- Cabinet Grotesk 700/800 headlines + Satoshi 400/500 supporting copy, selected from Fontshare. Local font binaries are in `public/fonts/`, gitignored per Fontshare redistribution restrictions. Family/license/source notes are in `public/fonts/README.md`. Run `sh video/download-fonts.sh` from repo root on a new machine.
- Fonts are loaded with FontFace and delayRender before frames render.
- `script-v2.md` is the latest script: narration unchanged, visual directions updated.
- `npm run render` now targets `out/opening-v2.mp4`. `src/opening-v1.tsx` preserves the original source.
- `review.html` uses the v2 video. Opening remains a 24-second mockup, not the full 90-second film.

## Existing deliverables

- `script-v1.md`: 90-second narration and shot plan, 143 spoken words. The user has not approved exact copy yet.
- `src/index.tsx`: Remotion entry and 24-second opening composition `Opening`, 1920×1080, 30fps, 720 frames. Version 2 is light throughout, using open spheres, file-name lines, an open node map and a single product frame.
- `out/opening-v1.mp4`: rendered silent 24-second mockup, 1280×720, 30fps, H.264, ~1.8MB.
- `out/contact-sheet-v1.jpg`: six sampled frames in a 2×3 sheet.
- `out/poster-v1.jpg`: first-scene still.
- `review.html`: local video player with scene jump buttons, linked script.
- `package.json`, `package-lock.json`: local Remotion/React dependencies installed in `video/node_modules`.
- Initial commit: `65edd20` (`[Video] add opening motion mockup and 90-second script`).

`out/` is intentionally gitignored. Local rendered files exist but are not in Git. Source and script are committed. No product footage, human voice, music, captions, or finished submission film exists yet. A full 90-second animatic is now available in v3.

## How it is made

We author motion as React components using Remotion. Each video frame is deterministic from `useCurrentFrame()`. `interpolate`, `Easing`, and `spring` drive position, scale, opacity. The renderer uses headless Chrome and encodes H.264. No After Effects or manual editor is necessary. All imagery so far is CSS/SVG and text; there are no generated image assets.

From `/Users/dsy/Documents/brainstorm/video`:

```sh
npm install --no-audit --no-fund
npm run render -- --browser-executable='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
```

The script renders the `Opening` composition at 2/3 scale (720p) and concurrency 2. The sandboxed Chrome process failed with SIGABRT; retrying the same render through the tool's `require_escalated` permission succeeded. Do not interpret that first error as a code failure. Render took roughly two minutes on this Mac. Node v24 is installed; FFmpeg and OBS also installed.

For new revisions, use a new output filename so old reviews remain reproducible. For final delivery omit the scale override to render at 1920×1080. `npm run studio` starts Remotion's preview if needed, but it has not been used yet. A plain local MP4 is sufficient for review and can be opened with Codex `open_in_codex` or displayed with a Markdown image tag containing its absolute path.

Verification example:

```sh
ffprobe -v error -show_entries format=duration:stream=codec_name,width,height,r_frame_rate -of json out/opening-v1.mp4
ffmpeg -hide_banner -loglevel error -i out/opening-v1.mp4 -vf "select='eq(n,90)+eq(n,210)+eq(n,285)+eq(n,435)+eq(n,540)+eq(n,690)',scale=640:360,tile=2x3" -frames:v 1 -y out/contact-sheet-v1.jpg
```

Inspect the contact sheet with an image-viewing tool and correct clipping. The large interface frame intentionally extends off the right edge in version 1, like a cropped product demonstration.

## Truthfulness and script constraints

The opening and current interface are clearly disclosed concept animation, with illustrative data. The 47 files are a narrative example, not a measured count. Never show mock UI as working prototype evidence in final submission. Replace product demonstrations with real recordings at 15:40. Footage can be sped up if labeled. Use the human's own voice; there is no voice recording yet.

Research statistics were removed from v1 narration to give the product time. Never invent costs, speed, or quality scores. Take verified figures from `docs/numbers.md` and Brev details from `docs/brev-setup.md`. Avoid “watched itself all day” unless actual recordings prove it. Do not promise pause/steer, private mode, history, etc. unless working.

## Next actions

1. Review the version 2 render with the user; record further visual decisions here.
2. Version 2 rendered successfully: 24 seconds, 1280×720, 30fps, H.264, ~1.5MB. Six-scene contact sheet inspected; text fits. Next: obtain user feedback on it.
3. Lock narrative with the user, have them record the voice; use its real timing.
4. Build remaining scenes for full 90 seconds and leave footage slots.
5. Capture Follow edit, Ask answer, Map activity/summary and real Brev proof when app is ready.
6. Replace illustrative product UI, add narration/music if authorized, captions, and actual metrics.
7. Export final ≤90s 1080p MP4, verify sound/captions/claims, help upload before 16:15.

Keep this handoff updated as decisions change. Commit only this work; other agents share the repository.

## Verification and current output

Version 2 export: `out/opening-v2.mp4`; six-scene visual check: `out/contact-sheet-v2.jpg`; poster: `out/poster-v2.jpg`. Font loading completed without errors. Source is still 1080p, preview is 720p. Product frame intentionally enters from below and extends beyond the bottom of the shot. No sound yet.

## Version 3 validation

The full animatic exported at exactly 90.000 seconds, 1280×720, 30fps, H.264. Ten representative scenes were visually inspected. A carousel caption mismatch was corrected in source (`page = Math.round(shift)`). The 31–45s segment was re-rendered with `--frames=930-1349` and spliced into the full export with FFmpeg to avoid rerendering unchanged scenes. A normal `render:film` run produces the corrected composition directly. Outputs remain gitignored. Final submission still needs actual product footage, human voice, sound, final captions, and a 1080p export.
