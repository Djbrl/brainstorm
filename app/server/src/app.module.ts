import { Module } from "@nestjs/common";
import { CoreModule } from "./core/core.module";
import { LlmModule } from "./llm/llm.module";
import { ListenerModule } from "./listener/listener.module";
import { MapperModule } from "./mapper/mapper.module";
import { AskModule } from "./ask/ask.module";
import { ReplayModule } from "./replay/replay.module";
import { WorkspaceModule } from "./workspace/workspace.module";
import { AgentsModule } from "./agents/agents.module";
import { HealthController } from "./core/health.controller";
import { CoworkModule } from "./cowork/cowork.module";
import { ShotsModule } from "./shots/shots.module";
import { AttentionModule } from "./attention/attention.module";
import { OpenModule } from "./open/open.module";
import { ImageModule } from "./image/image.module";
import { ElsewhereModule } from "./elsewhere/elsewhere.module";

// The server: every module it runs.
import { UsageModule } from "./usage/usage.module";
import { UpdatesModule } from "./updates/updates.module";
import { OnboardingModule } from "./onboarding/onboarding.controller";
@Module({ imports: [CoreModule, UsageModule, UpdatesModule, LlmModule, ListenerModule, MapperModule, AskModule, ReplayModule, WorkspaceModule, AgentsModule, CoworkModule, ShotsModule, AttentionModule, OpenModule, ImageModule, ElsewhereModule, OnboardingModule], controllers: [HealthController] })
export class AppModule {}
