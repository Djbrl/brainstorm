import { Controller, Get, Module } from "@nestjs/common";
import { ElsewhereService } from "./elsewhere.service";
import { ListenerModule } from "../listener/listener.module";
import { AttentionModule } from "../attention/attention.module";

// Owner: switcher.
@Controller()
export class ElsewhereController {
  constructor(private elsewhere: ElsewhereService) {}
  /** Threads at work in the person's other projects (see elsewhere.service.ts). */
  @Get("elsewhere") list() { return this.elsewhere.list(); }
}

@Module({ imports: [ListenerModule, AttentionModule], providers: [ElsewhereService], controllers: [ElsewhereController] })
export class ElsewhereModule {}
