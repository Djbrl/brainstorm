# Judging audit (15:32)

Rubric re-read from the live site at 15:30. Two changes since planning: **solo entries are allowed** and **Brev is optional** ("judging is tool-neutral"). Brev still counts as purposeful AI use, since we used it well; explain it, don't oversell it.

| Criterion | Pts | Where we stand | Gap | Action (owner, by) |
| --- | --- | --- | --- | --- |
| Problem + user value | 20 | Problem, 3 studies, users and pitch written; landing page live | No real-user evidence yet | 5-minute hallway test with 2 people (human, 15:50). If impossible, drop the claim. |
| Functional execution | 20 | Works end to end on real data: live sessions incl. subagents, map with Nemotron summaries, live labels, Ask with Claude, replay export | Judges can't run it: no public repo, no hosted replay demo | Push repo (human creates it, 15:45); deploy the replay build to Vercel (lead agent, 15:50) |
| Quality of AI use | 20 | Nemotron on Brev for bulk (summaries, labels, risk flags), Claude for Ask, fallback to Nemotron; prompt fix for echoing (0/631 bad labels) | Summary quality vs Claude not measured | Quality check: Claude grades 10 summaries (planning session, 15:45) |
| Testing + reliability | 15 | Measured: 311 files in 73 s for $0.02; labels 0.14 s; Ask $0.031 per question; retries on flaky Nemotron; tunnel drop recovered; content-hash caching | Not written in one place for judges | "Tested" section in the card and README (docs agent, 16:00) |
| Experience + demo | 15 | 90-second film structure done in the landing page's style | **Product scenes in the film and on the landing page are still illustrative** | Capture real app footage and 3 screenshots at 15:40 (human + video agent); replace placeholders; export by 16:10 |
| Responsible AI + data | 10 | Local-first, secret masking before storing or sending, small context packages, human in control | Consent, bias and copyright not mentioned | Add one paragraph to the card: code stays local, only your own sessions are read, summaries can be wrong (labeled AI-generated, with a link to the source step), open-source model license (docs agent, 16:00) |

## Awards to select

- **Primary:** Thunders Engineering Excellence.
- **Tick:** Guepard (AI automation), EY Studio+ (human-centred), CompTIA (technical foundations), Brightest (skills).
- **New fit, SupplyzPro "Find the Hidden Failures":** identify recurring failures in AI-agent conversations and tool calls, group related issues, and prioritize them with evidence. Brainstorm already reads every tool call and result. A small "Failures" panel would qualify: failed tool calls grouped by tool and error, sorted by count, each linking to its steps, with a one-line Nemotron title per group. About 30 minutes for one agent. **Human decides.**

## Shipping timeline

| Time | What |
| --- | --- |
| 15:40 | Code freeze. Capture real footage and screenshots. |
| 15:45 | Human creates the public GitHub repo; push main. |
| 15:50 | Replay demo deployed; landing page updated with real links, screenshots and numbers. |
| 16:00 | Card, disclosures and "Tested" section final. Record narration. |
| 16:10 | Video exported (≤90 s, 1080p) and uploaded unlisted. |
| 16:15 | Form submitted. Test every link in a private window. |
| 16:30 | Deadline. Afterwards, delete the Brev instance. |
