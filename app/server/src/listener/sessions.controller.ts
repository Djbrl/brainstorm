import { Controller, Get, Param } from "@nestjs/common";
import { ListenerService } from "./listener.service";

// Owner: A.
@Controller()
export class SessionsController {
  constructor(private listener: ListenerService) {}
  @Get("sessions") sessions() { return this.listener.listSessions(); }
  @Get("sessions/:id/steps") steps(@Param("id") id: string) { return this.listener.listSteps(id); }

}
