// Owner: D. Dev-only fake map, shown with ?mockmap so the Map can be designed before the mapper lands.
import type { FileNode, ProjectMap } from "@contract";

export function mockMap(): ProjectMap {
  const root = "/demo/brainstorm";
  const mods: Record<string, string[]> = {
    "app/server": ["main.ts", "app.module.ts", "types.ts", "ask/ask.service.ts", "ask/ask.controller.ts", "listener/listener.service.ts", "listener/sessions.controller.ts", "mapper/mapper.service.ts", "mapper/map.controller.ts", "reader/reader.service.ts", "llm/claude.service.ts", "llm/nemotron.service.ts", "core/db.service.ts", "core/bus.service.ts", "core/events.gateway.ts", "privacy/mask.ts"],
    "app/web": ["main.tsx", "App.tsx", "styles.css", "lib/live.tsx", "lib/nav.tsx", "lib/api.ts", "map/MapView.tsx", "follow/FollowView.tsx", "follow/StepDetail.tsx", "ask/AskBox.tsx"],
    docs: ["README.md", "plan.md", "build-log.md", "brev-setup.md"],
    video: ["README.md", "script.md"],
  };
  const now = Date.now();
  const files: FileNode[] = [];
  let i = 0;
  for (const [m, list] of Object.entries(mods)) for (const f of list) {
    const ago = [20e3, 3 * 60e3, 12 * 60e3, 40 * 60e3, 5 * 3600e3][i % 5];
    files.push({ path: `${root}/${m}/${f}`, module: m, lines: 20 + ((i * 97) % 400), lastChangedAt: new Date(now - ago).toISOString(),
      activeSessionId: i === 3 || i === 20 ? "s1" : undefined, summary: i % 3 ? `Handles ${f.replace(/\..*$/, "")} for ${m}.` : undefined });
    i++;
  }
  const p = (m: string, f: string) => `${root}/${m}/${f}`;
  const edges = [
    ["main.ts", "app.module.ts"], ["app.module.ts", "ask/ask.service.ts"], ["ask/ask.controller.ts", "ask/ask.service.ts"], ["ask/ask.service.ts", "llm/claude.service.ts"],
    ["ask/ask.service.ts", "llm/nemotron.service.ts"], ["ask/ask.service.ts", "privacy/mask.ts"], ["ask/ask.service.ts", "listener/listener.service.ts"], ["listener/listener.service.ts", "core/db.service.ts"],
    ["listener/listener.service.ts", "privacy/mask.ts"], ["mapper/mapper.service.ts", "core/bus.service.ts"], ["reader/reader.service.ts", "llm/nemotron.service.ts"], ["core/events.gateway.ts", "core/bus.service.ts"],
    ["mapper/map.controller.ts", "mapper/mapper.service.ts"], ["listener/sessions.controller.ts", "listener/listener.service.ts"], ["ask/ask.service.ts", "types.ts"], ["mapper/mapper.service.ts", "types.ts"],
  ].map(([a, b]) => ({ from: p("app/server", a), to: p("app/server", b) }));
  for (const [a, b] of [["main.tsx", "App.tsx"], ["App.tsx", "lib/live.tsx"], ["App.tsx", "lib/nav.tsx"], ["App.tsx", "map/MapView.tsx"], ["App.tsx", "follow/FollowView.tsx"], ["map/MapView.tsx", "ask/AskBox.tsx"], ["follow/FollowView.tsx", "follow/StepDetail.tsx"], ["ask/AskBox.tsx", "lib/api.ts"], ["lib/api.ts", "lib/live.tsx"], ["main.tsx", "styles.css"]])
    edges.push({ from: p("app/web", a), to: p("app/web", b) });
  return { root, files, edges, modules: Object.keys(mods).map((id) => ({ id })) };
}
