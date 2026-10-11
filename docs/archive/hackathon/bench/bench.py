"""Throwaway benchmark: summarize every source file of a repo with Nemotron via vLLM."""
import json, os, sys, time, statistics, urllib.request
from concurrent.futures import ThreadPoolExecutor

URL = "http://localhost:8000/v1/chat/completions"
KEY = os.environ["NEMOTRON_KEY"]
ROOT = sys.argv[1]
EXTS = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".py")
SKIP = {"node_modules", ".git", "dist", "build", "coverage"}
MAX_BYTES = 60_000
PRICE_PER_HOUR = 1.06


def call(prompt, max_tokens):
    body = json.dumps({
        "model": "nemotron", "max_tokens": max_tokens, "temperature": 0.2,
        "messages": [{"role": "user", "content": prompt}],
        "chat_template_kwargs": {"enable_thinking": False},
    }).encode()
    req = urllib.request.Request(URL, body, {"Content-Type": "application/json", "Authorization": f"Bearer {KEY}"})
    t = time.time()
    with urllib.request.urlopen(req, timeout=120) as r:
        d = json.load(r)
    return d["choices"][0]["message"]["content"], d["usage"], time.time() - t


files = []
for dp, dns, fns in os.walk(ROOT):
    dns[:] = [d for d in dns if d not in SKIP]
    for f in fns:
        if f.endswith(EXTS):
            files.append(os.path.join(dp, f))

lines = 0
jobs = []
for p in files:
    txt = open(p, errors="ignore").read()
    lines += txt.count("\n")
    rel = os.path.relpath(p, ROOT)
    jobs.append((rel, "In 2 short sentences, say what this file does and what it's used for. Plain words.\n"
                      f"Path: {rel}\n{txt[:MAX_BYTES]}"))

t0 = time.time()
results, errors = [], 0
def run(job):
    try:
        out, usage, dt = call(job[1], 150)
        return job[0], out, usage, dt
    except Exception as e:
        return job[0], None, None, str(e)

with ThreadPoolExecutor(16) as ex:
    for r in ex.map(run, jobs):
        if r[1] is None:
            errors += 1
        else:
            results.append(r)
wall = time.time() - t0

pin = sum(r[2]["prompt_tokens"] for r in results)
pout = sum(r[2]["completion_tokens"] for r in results)

# Step-label latency: 20 sequential small requests
lat = []
for i in range(20):
    _, _, dt = call("Describe this coding-agent action in at most 8 words, starting with a verb.\n"
                    f"Tool: Edit\nFile: src/routes/user{i}.ts\nChange:\n- return res.json(user)\n+ return res.json(sanitize(user))", 30)
    lat.append(dt)

summary = {
    "files": len(files), "summarized": len(results), "errors": errors, "lines": lines,
    "prompt_tokens": pin, "completion_tokens": pout, "wall_seconds": round(wall, 1),
    "files_per_minute": round(len(results) / wall * 60, 1),
    "tokens_per_second_in": round(pin / wall), "gpu_cost_usd": round(wall / 3600 * PRICE_PER_HOUR, 3),
    "label_latency_p50_s": round(statistics.median(lat), 2), "label_latency_max_s": round(max(lat), 2),
}
print(json.dumps(summary, indent=2))
json.dump({"summary": summary, "samples": [(r[0], r[1]) for r in results[:15]]}, open("bench_result.json", "w"), indent=2)
