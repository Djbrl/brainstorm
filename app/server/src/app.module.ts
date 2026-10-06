import { Module } from "@nestjs/common";
import { CoreModule } from "./core/core.module";
import { LlmModule } from "./llm/llm.module";
import { ListenerModule } from "./listener/listener.module";
import { MapperModule } from "./mapper/mapper.module";
import { ReaderModule } from "./reader/reader.module";
import { AskModule } from "./ask/ask.module";
import { ReplayModule } from "./replay/replay.module";
import { FailuresModule } from "./failures/failures.module";
import { WorkspaceModule } from "./workspace/workspace.module";
import { AgentsModule } from "./agents/agents.module";
import { HealthController } from "./core/health.controller";
import { CoworkModule } from "./cowork/cowork.module";
import { ShotsModule } from "./shots/shots.module";
import { AttentionModule } from "./attention/attention.module";
import { OpenModule } from "./open/open.module";
import { GitModule } from "./git/git.module";

// Owned by the lead. Agents: don't edit; ask in docs/build-log.md "Requests".
@Module({ imports: [CoreModule, LlmModule, ListenerModule, MapperModule, ReaderModule, AskModule, ReplayModule, FailuresModule, WorkspaceModule, AgentsModule, CoworkModule, ShotsModule, AttentionModule, OpenModule, GitModule], controllers: [HealthController] })
export class AppModule {}
