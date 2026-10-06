import { Module } from "@nestjs/common";
import { GitService } from "./git.service";
import { GitController } from "./git.controller";
import { ListenerModule } from "../listener/listener.module";
import { WorkspaceModule } from "../workspace/workspace.module";

// Owner: git. The project's branch, what isn't committed or pushed, and the agents' worktrees (git.service.ts).
@Module({ imports: [ListenerModule, WorkspaceModule], providers: [GitService], controllers: [GitController] })
export class GitModule {}
