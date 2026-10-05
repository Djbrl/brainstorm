import { Injectable } from "@nestjs/common";
import Anthropic from "@anthropic-ai/sdk";
import { ConfigService } from "../core/config.service";

// Owner: D.
@Injectable()
export class ClaudeService {
  private client: Anthropic | null = null;
  constructor(private cfg: ConfigService) {}

  private get api(): Anthropic {
    if (!this.cfg.claude.key) throw new Error("ANTHROPIC_API_KEY not set");
    const ws = process.env.ANTHROPIC_WORKSPACE_ID;
    this.client ??= new Anthropic({ apiKey: this.cfg.claude.key, timeout: 30_000, maxRetries: 1, ...(ws && { defaultHeaders: { "anthropic-workspace-id": ws } }) });
    return this.client;
  }

  async complete(system: string, user: string, maxTokens = 800): Promise<{ text: string; model: string; tokensIn: number; tokensOut: number; cut: boolean }> {
    const res = await this.api.messages.create({
      model: this.cfg.claude.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    });
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    // cut: the answer hit max_tokens and stops mid-sentence.
    return { text, model: res.model ?? this.cfg.claude.model, tokensIn: res.usage.input_tokens, tokensOut: res.usage.output_tokens, cut: res.stop_reason === "max_tokens" };
  }
}
