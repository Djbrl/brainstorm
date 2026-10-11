import { Injectable } from "@nestjs/common";
import { config } from "./config";

/** The open project's folder, the one value every module asks for. Only WorkspaceService changes it (when the person
 * picks a project); until then it is config.startRoot. */
@Injectable()
export class WorkspaceState {
  private current = config.startRoot;
  get root(): string { return this.current; }
  set(root: string) { this.current = root; }
}
