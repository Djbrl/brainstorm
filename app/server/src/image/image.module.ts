import { Module } from "@nestjs/common";
import { ImageController } from "./image.controller";
import { ListenerModule } from "../listener/listener.module";

// Owner: viewers. A picture an agent looked at (Codex logs only its path), shown from disk (see image.controller.ts).
@Module({ imports: [ListenerModule], controllers: [ImageController] })
export class ImageModule {}
