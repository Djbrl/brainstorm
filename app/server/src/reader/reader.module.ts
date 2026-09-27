import { Module } from "@nestjs/common";
import { ReaderService } from "./reader.service";

// Owner: B.
@Module({ providers: [ReaderService], exports: [ReaderService] })
export class ReaderModule {}
