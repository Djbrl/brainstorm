import { Module } from "@nestjs/common";
import { ReaderService } from "./reader.service";
import { ListenerModule } from "../listener/listener.module";
import { MapperModule } from "../mapper/mapper.module";

// Owner: B.
@Module({ imports: [ListenerModule, MapperModule], providers: [ReaderService], exports: [ReaderService] })
export class ReaderModule {}
