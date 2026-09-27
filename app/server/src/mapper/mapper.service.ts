import { Injectable } from "@nestjs/common";
import type { ProjectMap, Snapshot } from "../types";

// Owner: B. Walk the project, imports → edges, lastChangedAt from git + mtime, watch for changes.
@Injectable()
export class MapperService {
  getMap(root: string): ProjectMap { return { root, files: [], edges: [], modules: [] }; }
  getHistory(_root: string): Snapshot[] { return []; }
}
