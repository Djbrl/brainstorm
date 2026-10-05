// Synthetic Claude Code session logs for a generated repo: the JSONL shape Claude Code writes (one line per content
// block, tool results in user lines, subagents in <session>/subagents/agent-<id>.jsonl with a .meta.json), with
// made-up content. Two uses:
//   - a long finished thread: writeLongThread({ manifest, claudeDir, steps })
//   - a live writer appending steps at a realistic rate: startLiveWriter({ manifest, claudeDir, ... })
//
//   node gen-thread.mjs --repo <repo dir> --claude-dir <dir> --steps 10000           (long thread)
//   node gen-thread.mjs --repo <repo dir> --claude-dir <dir> --live --seconds 30     (live writer)
//
// "Steps" are counted the way the server stores them: one per prompt, text, thinking, tool call and tool result.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeRoot, log, parseArgs, rng, sleep } from "./lib.mjs";

const VERSION = "2.1.0";
const MODEL = "claude-bench-model";
const PROMPTS = ["Add pagination to the {a} list and keep the {b} filter in the URL", "The {a} page crashes when {b} is empty, fix it",
  "Refactor the {a} service so {b} is loaded lazily", "Write tests for the {a} {b} module", "Rename {a} to {b} everywhere",
  "Why is the {a} build slow? Look at {b}", "Make the {a} form validate {b} before saving", "Move the {a} helpers into the {b} package"];
const WORDS = ["invoice", "billing", "session", "profile", "search", "report", "upload", "schedule", "audit", "theme", "router", "cache"];
const BASH = [["npm test", 40], ["npx tsc --noEmit", 12], ["git status --short", 8], ["git diff --stat", 10], ["npm run lint", 20], ["ls -la src", 15], ["npm run build", 30]];
const fill = (R, n) => Array.from({ length: n }, () => `${R.pick(WORDS)} ${R.pick(WORDS)} ${R.int(0, 9999)}`).join(" ");

/** Builds log lines for one thread (main or subagent), keeping uuids, parents and timestamps consistent. */
class Writer {
  constructor({ R, sessionId, cwd, file, agentId = null, clock }) {
    Object.assign(this, { R, sessionId, cwd, file, agentId, clock, parent: null, steps: 0, lines: [], pending: [] });
  }
  base(type) {
    const uuid = this.R.uuid();
    const o = { parentUuid: this.parent, isSidechain: !!this.agentId, ...(this.agentId ? { agentId: this.agentId } : {}), type, uuid,
      timestamp: this.clock(), userType: "external", entrypoint: "cli", cwd: this.cwd, sessionId: this.sessionId, version: VERSION, gitBranch: "main" };
    this.parent = uuid;
    return o;
  }
  push(o) { this.lines.push(JSON.stringify(o)); }
  prompt(text) { const o = this.base("user"); o.message = { role: "user", content: text }; o.promptId = this.R.uuid(); this.push(o); this.steps++; }
  assistant(block) {
    const o = this.base("assistant");
    o.message = { model: MODEL, id: `msg_${this.R.hex(24)}`, type: "message", role: "assistant", content: [block], stop_reason: block.type === "tool_use" ? "tool_use" : null,
      stop_sequence: null, usage: { input_tokens: this.R.int(1, 50), cache_creation_input_tokens: this.R.int(0, 4000), cache_read_input_tokens: this.R.int(10000, 200000),
        cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: this.R.int(0, 4000) }, output_tokens: this.R.int(10, 900), service_tier: "standard" } };
    o.requestId = `req_${this.R.hex(24)}`;
    this.push(o); this.steps++;
  }
  thinking() { this.assistant({ type: "thinking", thinking: fill(this.R, this.R.int(10, 80)), signature: this.R.hex(64) }); }
  text() { this.assistant({ type: "text", text: fill(this.R, this.R.int(5, 60)) }); }
  toolUse(name, input) { const id = `toolu_${this.R.hex(24)}`; this.assistant({ type: "tool_use", id, name, input }); return id; }
  toolResult(id, content, isError = false) {
    const o = this.base("user");
    o.message = { role: "user", content: [{ tool_use_id: id, type: "tool_result", content, ...(isError ? { is_error: true } : {}) }] };
    o.toolUseResult = typeof content === "string" ? content.slice(0, 200) : content;
    this.push(o); this.steps++;
  }
  /** Lines the listener ignores but real logs are full of. */
  noise() {
    const kind = this.R.pick(["file-history-snapshot", "system", "attachment"]);
    const o = kind === "file-history-snapshot" ? { type: kind, messageId: this.R.uuid(), snapshot: { messageId: this.R.uuid(), trackedFileBackups: {}, timestamp: this.clock() }, isSnapshotUpdate: false }
      : { ...this.base(kind), content: fill(this.R, 6), level: "info" };
    this.push(o);
  }
  take() { const out = this.lines; this.lines = []; return out; }
}

/** Where the agent works: a folder it stays in for a while, then moves on (a random walk over the repo). */
class Focus {
  constructor(R, manifest) {
    this.R = R;
    this.code = manifest.files.filter((f) => /\.(ts|tsx|js)$/.test(f.ext));
    this.byRel = new Map(manifest.files.map((f) => [f.rel, f]));
    this.byFolder = new Map();
    for (const f of this.code) { const d = f.rel.slice(0, f.rel.lastIndexOf("/")); (this.byFolder.get(d) ?? this.byFolder.set(d, []).get(d)).push(f); }
    this.move();
  }
  move() { this.current = this.R.pick(this.code); this.left = this.R.int(10, 40); }
  file() {
    if (--this.left <= 0) this.move();
    const R = this.R, f = this.current;
    const d = f.rel.slice(0, f.rel.lastIndexOf("/"));
    const pick = R.weighted([["self", 40], ["folder", 35], ["import", 20], ["any", 5]]);
    if (pick === "folder") return R.pick(this.byFolder.get(d));
    if (pick === "import" && f.imports.length) return this.byRel.get(R.pick(f.imports)) ?? f;
    if (pick === "any") return R.pick(this.code);
    return f;
  }
}

const numbered = (R, lines) => Array.from({ length: lines }, (_, i) => `${String(i + 1).padStart(6)}\t${fill(R, R.int(1, 6))}`).join("\n");
const snippet = (R, n) => Array.from({ length: n }, () => `  const ${R.pick(WORDS)} = ${R.pick(WORDS)}(${R.int(0, 99)});`).join("\n");

/**
 * One tool call and its result on `w`. Returns the subagent to run when the call is an Agent call. `onEdit(file)` lets
 * the live writer change the file on disk like a real edit would.
 */
function toolCall(w, focus, { errorRate = 0.04, allowAgent = true, onEdit } = {}) {
  const R = w.R;
  const tool = R.weighted([["Read", 32], ["Edit", 20], ["Bash", 16], ["Grep", 8], ["Glob", 5], ["Write", 4], ["TodoWrite", 3], ["MultiEdit", 1], ["Agent", allowAgent ? 2 : 0], ["WebFetch", 1]]);
  const f = focus.file();
  const fail = R.chance(errorRate);
  let id;
  switch (tool) {
    case "Read":
      id = w.toolUse("Read", { file_path: f.path });
      w.toolResult(id, fail ? "<tool_use_error>File does not exist.</tool_use_error>" : [{ type: "text", text: numbered(R, Math.min(f.lines, 800)) }], fail);
      return;
    case "Edit": case "MultiEdit": {
      const old_string = snippet(R, R.int(1, 25)), new_string = snippet(R, R.int(1, 30));
      id = tool === "Edit" ? w.toolUse("Edit", { file_path: f.path, old_string, new_string, replace_all: false })
        : w.toolUse("MultiEdit", { file_path: f.path, edits: [{ old_string, new_string }, { old_string: snippet(R, 3), new_string: snippet(R, 4) }] });
      if (!fail) onEdit?.(f);
      w.toolResult(id, fail ? "<tool_use_error>String to replace not found in file.</tool_use_error>" : `The file ${f.path} has been updated successfully.`, fail);
      return;
    }
    case "Write":
      id = w.toolUse("Write", { file_path: f.path, content: snippet(R, Math.min(f.lines, R.int(20, 400))) });
      if (!fail) onEdit?.(f);
      w.toolResult(id, `File created successfully at: ${f.path}`);
      return;
    case "Bash": {
      const [command, outLines] = R.pick(BASH);
      id = w.toolUse("Bash", { command, description: `Run ${command.split(" ")[1] ?? command}` });
      const out = Array.from({ length: R.int(1, outLines) }, () => fill(R, R.int(2, 10))).join("\n");
      w.toolResult(id, fail ? `Exit code 1\nError: ${fill(R, 5)}\n${out}` : out, fail);
      return;
    }
    case "Grep": case "Glob": {
      id = w.toolUse(tool, tool === "Grep" ? { pattern: R.pick(WORDS), path: focus.current.path.slice(0, focus.current.path.lastIndexOf("/")) } : { pattern: `**/${R.pick(WORDS)}*.ts` });
      w.toolResult(id, Array.from({ length: R.int(0, 30) }, () => R.pick(focus.code).path).join("\n") || "No files found");
      return;
    }
    case "TodoWrite":
      id = w.toolUse("TodoWrite", { todos: Array.from({ length: R.int(2, 6) }, () => ({ content: fill(R, 4), status: R.pick(["pending", "in_progress", "completed"]), activeForm: fill(R, 3) })) });
      w.toolResult(id, "Todos have been modified successfully.");
      return;
    case "WebFetch":
      id = w.toolUse("WebFetch", { url: "https://example.com/docs", prompt: fill(R, 6) });
      w.toolResult(id, fill(R, R.int(20, 200)));
      return;
    case "Agent": {
      const description = `${R.pick(["Explore", "Review", "Test"])} ${R.pick(WORDS)} code`;
      id = w.toolUse("Agent", { description, subagent_type: "general-purpose", prompt: fill(R, R.int(20, 80)) });
      return { toolUseId: id, description };
    }
  }
}

/** A long finished thread: `steps` steps (main + subagents) spread over the hours before `endAt`. */
export function writeLongThread({ manifest, claudeDir, steps = 10_000, seed = 1, endAt = Date.now() - 10 * 60_000, sessionId }) {
  const R = rng(seed * 31 + steps);
  sessionId ??= R.uuid();
  const dir = join(claudeDir, encodeRoot(manifest.root));
  mkdirSync(join(dir, sessionId, "subagents"), { recursive: true });
  const startAt = endAt - steps * 3000; // about 3 s a step: 10k steps ≈ 8 h of work
  let t = startAt;
  const clock = () => new Date(t += R.int(200, 5800)).toISOString(); // 3 s apart on average
  const focus = new Focus(R, manifest);
  const main = new Writer({ R, sessionId, cwd: manifest.root, clock });
  const counts = { main: 0, subagents: 0, agents: 0 };
  const subFiles = [];
  while (main.steps + counts.subagents < steps) {
    main.prompt(R.pick(PROMPTS).replace("{a}", R.pick(WORDS)).replace("{b}", R.pick(WORDS)));
    const calls = R.int(5, 60);
    for (let c = 0; c < calls && main.steps + counts.subagents < steps; c++) {
      if (R.chance(0.15)) main.thinking();
      if (R.chance(0.1)) main.text();
      if (R.chance(0.05)) main.noise();
      const agent = toolCall(main, focus);
      if (agent) {
        const agentId = `a${R.hex(16)}`;
        const sub = new Writer({ R, sessionId, cwd: manifest.root, agentId, clock });
        sub.prompt(fill(R, 20));
        const n = R.int(30, 150);
        while (sub.steps < n) { if (R.chance(0.1)) sub.thinking(); toolCall(sub, focus, { allowAgent: false }); }
        sub.text();
        counts.subagents += sub.steps; counts.agents++;
        const file = join(dir, sessionId, "subagents", `agent-${agentId}.jsonl`);
        writeFileSync(file, sub.take().join("\n") + "\n");
        writeFileSync(file.replace(/\.jsonl$/, ".meta.json"), JSON.stringify({ agentType: "general-purpose", description: agent.description, toolUseId: agent.toolUseId, spawnDepth: 1 }));
        subFiles.push(file);
        main.toolResult(agent.toolUseId, [{ type: "text", text: fill(R, R.int(20, 120)) }]);
      }
    }
    main.text();
  }
  const file = join(dir, `${sessionId}.jsonl`);
  const lines = main.take();
  writeFileSync(file, lines.join("\n") + "\n");
  counts.main = main.steps;
  return { sessionId, file, subFiles, steps: counts.main + counts.subagents, ...counts, lines: lines.length, lastTs: new Date(t).toISOString() };
}

/**
 * Append steps to a new running thread in real time: `rate` steps a second on average, with a burst of 10–25 steps
 * about every `burstEvery` seconds (parallel tool calls landing together). Edits also change the file on disk (a
 * comment appended), as Claude Code would. Returns { sessionId, file, stop(): Promise<stats>, stats }.
 */
export function startLiveWriter({ manifest, claudeDir, rate = 3, burstEvery = 8, seed = 2, touchFiles = true, sessionId }) {
  const R = rng(seed * 101 + 7);
  sessionId ??= R.uuid();
  const dir = join(claudeDir, encodeRoot(manifest.root));
  mkdirSync(join(dir, sessionId, "subagents"), { recursive: true });
  const file = join(dir, `${sessionId}.jsonl`);
  const focus = new Focus(R, manifest);
  const w = new Writer({ R, sessionId, cwd: manifest.root, clock: () => new Date().toISOString() });
  const stats = { sessionId, file, steps: 0, lines: 0, bytes: 0, bursts: 0, edits: 0, writes: 0, startedAt: Date.now(), stoppedAt: 0 };
  const onEdit = touchFiles ? (f) => { try { appendFileSync(f.path, `// edited by the bench at ${new Date().toISOString()}\n`); stats.edits++; } catch { /* ignore */ } } : undefined;
  const flush = () => {
    const lines = w.take();
    if (!lines.length) return;
    const text = lines.join("\n") + "\n";
    appendFileSync(file, text);
    stats.lines += lines.length; stats.bytes += Buffer.byteLength(text); stats.writes++;
  };
  w.prompt(R.pick(PROMPTS).replace("{a}", R.pick(WORDS)).replace("{b}", R.pick(WORDS)));
  flush();
  let stopped = false;
  const loop = (async () => {
    let nextBurst = Date.now() + burstEvery * 1000 * (0.5 + R.next());
    while (!stopped) {
      const before = w.steps;
      if (Date.now() >= nextBurst) {
        // A burst: several calls, then their results, within about a second.
        const k = R.int(5, 12);
        for (let i = 0; i < k; i++) { toolCall(w, focus, { allowAgent: false, onEdit }); if (i % 3 === 2) { flush(); await sleep(R.int(50, 250)); } }
        flush();
        stats.bursts++;
        nextBurst = Date.now() + burstEvery * 1000 * (0.5 + R.next());
      } else {
        if (R.chance(0.1)) w.thinking();
        else if (R.chance(0.05)) w.text();
        else toolCall(w, focus, { allowAgent: false, onEdit }); // a call and its result: 2 steps
        flush();
      }
      stats.steps += w.steps - before;
      // Exponential gap so the average rate holds: the last action wrote (w.steps - before) steps.
      const gap = (-Math.log(1 - R.next()) * (w.steps - before) * 1000) / rate;
      await sleep(Math.min(gap, 4000));
    }
  })();
  return {
    sessionId, file, stats,
    async stop() { stopped = true; await loop; stats.stoppedAt = Date.now(); return stats; },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = parseArgs();
  if (!a.repo || !a.claudeDir) { console.error("usage: node gen-thread.mjs --repo <repo dir> --claude-dir <dir> [--steps 10000] [--live --seconds 30 --rate 3]"); process.exit(1); }
  const manifest = JSON.parse(readFileSync(`${a.repo.replace(/\/$/, "")}.manifest.json`, "utf8"));
  if (a.live) {
    const lw = startLiveWriter({ manifest, claudeDir: a.claudeDir, rate: Number(a.rate ?? 3) });
    log(`live writer → ${lw.file}`);
    const stop = async () => { const s = await lw.stop(); console.log(JSON.stringify(s)); process.exit(0); };
    process.on("SIGINT", stop);
    if (a.seconds) setTimeout(stop, Number(a.seconds) * 1000);
  } else {
    const r = writeLongThread({ manifest, claudeDir: a.claudeDir, steps: Number(a.steps ?? 10_000) });
    console.log(JSON.stringify({ ...r, subFiles: r.subFiles.length }));
  }
}
