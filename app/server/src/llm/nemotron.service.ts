import { Injectable, Logger } from "@nestjs/common";
import OpenAI from "openai";
import { ConfigService } from "../core/config.service";

/** Tiny in-process concurrency limiter shared by every Nemotron call (labels + summaries alike). */
class Limiter {
  private active = 0;
  private queue: (() => void)[] = [];
  constructor(private max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

// Owner: B. OpenAI-compatible client to vLLM on Brev. Always send chat_template_kwargs.enable_thinking=false.
@Injectable()
export class NemotronService {
  private log = new Logger("Nemotron");
  private client: OpenAI | null = null;
  private limiter = new Limiter(6);

  constructor(private cfg: ConfigService) {}

  private get api(): OpenAI {
    this.client ??= new OpenAI({ apiKey: this.cfg.nemotron.key || "none", baseURL: this.cfg.nemotron.url, timeout: 20_000, maxRetries: 0 });
    return this.client;
  }

  /** Returns the completion text plus token usage. Throws on failure after retries. */
  async complete(system: string, user: string, maxTokens = 200): Promise<{ text: string; tokensIn: number; tokensOut: number }> {
    return this.limiter.run(async () => {
      let lastErr: unknown;
      for (let attempt = 0; attempt <= 2; attempt++) {
        try {
          const res = await this.api.chat.completions.create(
            {
              model: this.cfg.nemotron.model,
              max_tokens: maxTokens,
              messages: [
                { role: "system", content: system },
                { role: "user", content: user },
              ],
              // vLLM/Nemotron-specific: turn off the "thinking" trace so we get fast, direct answers.
              chat_template_kwargs: { enable_thinking: false },
            } as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
            { timeout: 20_000 },
          );
          const text = (res.choices?.[0]?.message?.content ?? "").trim();
          return {
            text,
            tokensIn: res.usage?.prompt_tokens ?? 0,
            tokensOut: res.usage?.completion_tokens ?? 0,
          };
        } catch (e) {
          lastErr = e;
          this.log.warn(`attempt ${attempt + 1}/3 failed: ${(e as Error).message}`);
          if (attempt < 2) await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
    });
  }
}
