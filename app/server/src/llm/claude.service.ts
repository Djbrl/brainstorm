import { Injectable } from "@nestjs/common";
import { ConfigService } from "../core/config.service";

// Owner: D.
@Injectable()
export class ClaudeService {
  constructor(private cfg: ConfigService) {}
  async complete(_system: string, _user: string, _maxTokens = 800): Promise<{ text: string; model: string; tokensIn: number; tokensOut: number }> {
    throw new Error("ClaudeService.complete not implemented yet");
  }
}
