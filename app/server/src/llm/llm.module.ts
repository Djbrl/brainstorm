import { Global, Module } from "@nestjs/common";
import { NemotronService } from "./nemotron.service";
import { ClaudeService } from "./claude.service";

@Global()
@Module({ providers: [NemotronService, ClaudeService], exports: [NemotronService, ClaudeService] })
export class LlmModule {}
