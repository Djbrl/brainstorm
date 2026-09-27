import { Injectable } from "@nestjs/common";
import { ConfigService } from "../core/config.service";

// Owner: B. OpenAI-compatible client to vLLM on Brev. Always send chat_template_kwargs.enable_thinking=false.
@Injectable()
export class NemotronService {
  constructor(private cfg: ConfigService) {}
  /** Returns the completion text plus token usage. Throws on failure after retries. */
  async complete(_system: string, _user: string, _maxTokens = 200): Promise<{ text: string; tokensIn: number; tokensOut: number }> {
    throw new Error("NemotronService.complete not implemented yet");
  }
}
