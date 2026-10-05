# The map as a tool for agents (saved for later, 5 Oct 2026)

The server already sends the import graph (`map.edges`), and every recorded thread is a walk over it: what an agent
read, edited and broke. Together they can answer things a model only finds by reading many files. Nothing here is
built yet.

## Blast radius first

If this file changes, what else could break: everything that depends on it, directly or through others, by distance.

- **Agents, before an edit:** a two-line note from a `PreToolUse` hook: the direct dependents by name ("used by
  `MapView.tsx`, `drawNode.ts`, `useMapCamera.ts`, `fold.ts`"), the rest as a count. Read the callers before changing a
  signature, instead of finding out from a failing build.
- **Agents, before "done":** compare what changed with what was checked: "you changed `nav.tsx` (40 files depend on
  it, 3 test files reach it) and ran no tests".
- **Agents, when planning:** a small radius is safe to just do; a huge one (`types.ts`) means plan, ask or split.
- **People, on the map:** clicking a file shows rings of its dependents, bright near, fading far; in replay each edit
  lights its radius for a moment.
- **People, reviewing a thread:** "changed 3 files that reach 41", and the steps with a big reach flagged like the risk
  labels; an approval request says "wants to edit `store.ts` (reaches 60 files)".
- **Keep it useful:** it's an upper bound; direct dependents by name, the rest as a number, test files called out.
  A file everything imports reaches everything, so rank, don't list.

## Other algorithms worth trying

- On the code: keystone files (PageRank or betweenness), import cycles (strongly connected components), how the code
  clusters against the folders (community detection, files in the wrong folder), dead files (unreachable from an
  entry point), why A depends on B (shortest path).
- With the agents: did it read a file's callers before editing it; parallel agents whose working sets overlap through
  the graph (collision warning); an agent whose reads jump across distant parts of the graph (lost); files edited
  together with no import between them (hidden coupling); the tests that reach a changed file.

## Delivering it to agents

- Tools in an MCP server shipped with the plugin, calling the local server: `blast_radius(file)`, `likely_files(task)`
  (start from the files a prompt names, spread through the graph, weigh what similar past threads touched),
  `path(a, b)`, `who_is_working_where()`.
- Hints without asking, from hooks: before an edit (radius, another agent nearby), when a prompt is sent (a short
  ranked list of likely files).
- Grep is already fast for direct importers; our edge is the transitive answer in one call, history, and other
  agents right now.

## Limits

- Imports only: string-based routing, config, dynamic dispatch and calls across languages are missed. Symbol-level
  (tree-sitter or language servers) would be better and is a bigger project.
- Hints must stay short and ranked, or they cost more context than they save.
- The map keeps at most 3,000 files; the tools need the whole graph on the server.

## Measure before building

Replay the recorded threads offline. Blast radius: did the files an agent later had to fix fall inside the radius of
its edit? Likely files: of the files a thread touched, how many were in our top 10 or 20 for its prompt? Ship only
what the numbers support.
