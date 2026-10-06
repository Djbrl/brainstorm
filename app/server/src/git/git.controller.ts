import { Controller, Get } from "@nestjs/common";
import { GitService } from "./git.service";

// Owner: git. GET /api/git: the project's git state (see git.service.ts); live changes come over the socket as "git".
@Controller()
export class GitController {
  constructor(private git: GitService) {}
  @Get("git") state() { return this.git.get(); }
}
