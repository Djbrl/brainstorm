import { Global, Module } from "@nestjs/common";
import { ClaudeService } from "./claude.service";

@Global()
@Module({ providers: [ClaudeService], exports: [ClaudeService] })
export class LlmModule {}
