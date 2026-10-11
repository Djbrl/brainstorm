import { Module } from "@nestjs/common";
import { ReaderService } from "./reader.service";

// Risk flags on edits (reader.service.ts).
@Module({ providers: [ReaderService] })
export class ReaderModule {}
