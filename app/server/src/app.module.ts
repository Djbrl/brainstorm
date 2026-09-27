import { Module } from "@nestjs/common";
import { CoreModule } from "./core/core.module";
import { LlmModule } from "./llm/llm.module";
import { ListenerModule } from "./listener/listener.module";
import { MapperModule } from "./mapper/mapper.module";
import { ReaderModule } from "./reader/reader.module";
import { AskModule } from "./ask/ask.module";

// Owned by the lead. Agents: don't edit; ask in docs/build-log.md "Requests".
@Module({ imports: [CoreModule, LlmModule, ListenerModule, MapperModule, ReaderModule, AskModule] })
export class AppModule {}
