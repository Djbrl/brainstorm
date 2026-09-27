# Brainstorm video — handoff for Claude or the next Codex context

Last updated: 27 September 2026, 14:20 Dakar. Submission 16:30; code freeze 15:40; aim to finish video by 16:10–16:15.

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

`out/` is intentionally gitignored. Local rendered files exist but are not in Git. Source and script are committed. No product footage, human voice, music, captions, or finished 90-second film exists yet.

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
