# Using Nemotron (for agents)

Nemotron 3 Nano runs on our NVIDIA Brev GPU and is reachable from this Mac at `http://localhost:8000/v1`. It speaks the OpenAI request format. Use it for bulk work: file and module summaries, step labels, risk flags, and fallback answers.

## Connection

| Setting | Value |
| --- | --- |
| URL | `NEMOTRON_URL` in `app/.env` (`http://localhost:8000/v1`) |
| Password | `NEMOTRON_KEY` in `app/.env`. Read it from the environment; never paste it into code, logs, docs or commits. |
| Model name | `nemotron` (`NEMOTRON_MODEL` in `app/.env`) |
| Context limit | 32,768 tokens per request (prompt + answer) |
| Parallel requests | Up to 16 at once; queue anything beyond that |

## Rules

1. **Always send `chat_template_kwargs: { enable_thinking: false }`.** Otherwise Nemotron writes long reasoning first, which is slow and wastes tokens.
2. **Always set `max_tokens`**: about 30 for a step label, about 150 for a file summary.
3. **Cap input at about 60 KB of text (roughly 15k tokens).** Truncate long files, keep the top, and say "(truncated)".
4. **Timeout 20 s, retry twice, then fall back.** Show "summary pending" and keep the app working without AI.
5. **Cache by file content hash** so an unchanged file is never summarized twice.
6. **Don't touch the GPU machine** (no ssh, no restarting Docker). If it's down, add a line under "Requests" in `docs/build-log.md` for the human.

## TypeScript (server)

```ts
import OpenAI from "openai";

const nemotron = new OpenAI({
  baseURL: process.env.NEMOTRON_URL,
  apiKey: process.env.NEMOTRON_KEY,
  timeout: 20_000,
  maxRetries: 2,
});

export async function askNemotron(prompt: string, maxTokens = 150): Promise<string | null> {
  try {
    const res = await nemotron.chat.completions.create({
      model: process.env.NEMOTRON_MODEL ?? "nemotron",
      max_tokens: maxTokens,
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
      // @ts-expect-error vLLM-specific: turn off step-by-step reasoning
      chat_template_kwargs: { enable_thinking: false },
    });
    return res.choices[0]?.message?.content?.trim() ?? null;
  } catch {
    return null; // caller shows "pending" and retries later
  }
}
```

Install with `npm install openai dotenv` in `app/server`, and load the env with `import "dotenv/config"` (point it at `app/.env`).

## Prompts that work

- **Step label:** `Describe this coding-agent action in at most 8 words, starting with a verb. No punctuation at the end.\nTool: {tool}\nFile: {path}\nChange:\n{diff excerpt}`
- **File summary:** `In 2 short sentences, say what this file does and what it's used for. Plain words.\nPath: {path}\n{file text}`
- **Module summary:** `In 2 short sentences, say what this module does, based on its files' summaries:\n{list of path: summary}`
- **Risk flags:** `List risks in this change as a JSON array of short strings, chosen only from: "deleted test", "touches auth", "touches payments", "touches env or secrets", "large deletion". Return [] if none.\n{diff}`

## Quick check

```bash
cd app && source .env && curl -s "$NEMOTRON_URL/models" -H "Authorization: Bearer $NEMOTRON_KEY"
```

A JSON list containing `nemotron` means it's up. Setup details and proof of Brev use are in `docs/brev-setup.md`.
