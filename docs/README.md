# Docs (agent briefing)

This folder is the paper trail judges need, written while we build. Keep every file short and factual. **Never invent a number:** a missing number stays `TODO`.

| File | What goes in it | Who fills it |
| --- | --- | --- |
| `plan.md` | Pitch, features, research links (reference; don't edit) | Done |
| `build-log.md` | Timestamped milestones, decisions, and "Requests" between agents. It also backs the "built with itself" claim. | Every agent |
| `brev-setup.md` | Every command run on the Brev GPU, GPU type, $/hour, model, vLLM version. This is the proof of Brev use. | Agent D plus the human |
| `numbers.md` | Measured results: read speed, cost per read, cost per question, summary quality score, hallway test | Agent D, docs agent |
| `project-card.md` | The submission card text | Docs agent |
| `disclosures.md` | Every AI tool, model, dataset and generated asset used | Docs agent |
| `submission-checklist.md` | What to submit, with links, ticked off | Docs agent |

**Docs agent tasks, in order:**
1. Keep `build-log.md` tidy. Every 20 minutes, read `git log` and add a line for anything missing.
2. Finish `disclosures.md` and `project-card.md` from what actually got built. Cut claims for features that didn't ship.
3. At 15:40, fill the Brev section of the card from `brev-setup.md` and `numbers.md`.
4. Write the public repo README at `../README.md` at 15:45: what it is, a screenshot, how to run it, where the Brev proof is.
5. At 16:10, check every link in `submission-checklist.md`.
