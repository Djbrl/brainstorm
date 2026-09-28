// Owned by the lead. Pure helpers for Tasks: what a shell command produced and used, what kind a file is,
// and FFmpeg options in plain words (so a replay doubles as a recipe you can learn from).
import { homedir } from "node:os";
import { basename, extname, isAbsolute, resolve } from "node:path";
import type { TaskFileKind } from "../types";

const KINDS: [TaskFileKind, RegExp][] = [
  ["image", /^(png|jpe?g|gif|webp|svg|bmp|tiff?|heic|avif|ico|psd)$/],
  ["video", /^(mp4|mov|mkv|webm|avi|m4v|mpg|mpeg|wmv)$/],
  ["audio", /^(mp3|wav|m4a|aac|flac|ogg|opus|aiff?)$/],
  ["pdf", /^pdf$/],
  ["doc", /^(md|mdx|txt|rtf|docx?|odt|pages|tex|html?|pptx?|key|epub)$/],
  ["data", /^(json|jsonl|csv|tsv|xlsx?|ya?ml|xml|toml|sqlite|db|parquet)$/],
  ["code", /^(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|php|css|scss|sh|sql|vue|svelte|lua|dart)$/],
];

export function fileKind(path: string): TaskFileKind {
  const ext = extname(path).slice(1).toLowerCase();
  return KINDS.find(([, re]) => re.test(ext))?.[0] ?? "other";
}

/** Words of one shell command, honoring quotes. Good enough for the commands agents write. */
function words(cmd: string): string[] {
  const out: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  for (let m; (m = re.exec(cmd)); ) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/** Split on && || ; | and newlines, outside quotes. */
function segments(cmd: string): string[] {
  const out: string[] = [];
  let cur = "", q: string | null = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q) { cur += c; if (c === q && cmd[i - 1] !== "\\") q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === "\n" || c === ";" || c === "|" || (c === "&" && cmd[i + 1] === "&")) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      if ((c === "&" || c === "|") && cmd[i + 1] === c) i++;
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const hasExt = (w: string) => /\.[A-Za-z0-9]{1,5}$/.test(w) && !w.startsWith("-");
const abs = (p: string, cwd: string) => (p.startsWith("~/") ? resolve(homedir(), p.slice(2)) : isAbsolute(p) ? p : resolve(cwd || "/", p));

/** Files a command writes and reads: redirects, -o/--output, and what ffmpeg, ImageMagick, pandoc, cp, mv, zip take. */
export function commandFiles(cmd: string, cwd: string): { outputs: { path: string; via: string }[]; inputs: string[] } {
  const outputs: { path: string; via: string }[] = [];
  const inputs: string[] = [];
  for (const seg of segments(cmd)) {
    let w = words(seg);
    while (w.length && (/^[A-Z_][A-Z0-9_]*=/.test(w[0]) || w[0] === "sudo" || w[0] === "time" || w[0] === "nohup")) w = w.slice(1);
    if (!w.length) continue;
    const prog = basename(w[0]);
    if (prog === "cd") { if (w[1]) cwd = abs(w[1], cwd); continue; } // later commands run there
    // Redirects: `> out.txt`, `>out.txt`, `>> log` (not 2>, not /dev/null). Taken out of the words before reading the rest.
    const kept: string[] = [];
    for (let i = 0; i < w.length; i++) {
      const m = /^(\d?)>>?(.*)$/.exec(w[i]);
      if (!m) { kept.push(w[i]); continue; }
      const target = m[2] || w[++i];
      if (m[1] !== "2" && target && !target.startsWith("&") && target !== "/dev/null") outputs.push({ path: abs(target, cwd), via: prog });
    }
    w = kept;
    const flagValue = (...names: string[]) => {
      for (let i = 1; i < w.length; i++) {
        for (const n of names) {
          if (w[i] === n && w[i + 1]) return w[i + 1];
          if (n.startsWith("--") && w[i].startsWith(n + "=")) return w[i].slice(n.length + 1);
        }
      }
      return undefined;
    };
    const plain = w.slice(1).filter((x, i, all) => !x.startsWith("-") && !(all[i - 1] ?? "").match(/^-(i|o|f|c|b|r|s|t|ss|to|vf|af|map|preset|crf|filter_complex|filter:v|filter:a)$/));

    if (prog === "ffmpeg") {
      for (let i = 1; i < w.length; i++) if (w[i] === "-i" && w[i + 1]) inputs.push(abs(w[i + 1], cwd));
      const last = w[w.length - 1];
      if (hasExt(last) && w[w.length - 2] !== "-i") outputs.push({ path: abs(last, cwd), via: "ffmpeg" });
      continue;
    }
    if (prog === "magick" || prog === "convert") {
      const files = plain.filter(hasExt);
      if (files.length) { outputs.push({ path: abs(files[files.length - 1], cwd), via: prog }); inputs.push(...files.slice(0, -1).map((f) => abs(f, cwd))); }
      continue;
    }
    if (prog === "cp" || prog === "mv") {
      const files = plain;
      if (files.length >= 2 && hasExt(files[files.length - 1])) { outputs.push({ path: abs(files[files.length - 1], cwd), via: prog }); inputs.push(...files.slice(0, -1).map((f) => abs(f, cwd))); }
      continue;
    }
    if (prog === "zip" && plain[0]) { outputs.push({ path: abs(plain[0].endsWith(".zip") ? plain[0] : plain[0] + ".zip", cwd), via: "zip" }); continue; }
    if (prog === "tar") { const f = flagValue("-f", "-cf", "-czf", "-cjf", "--file"); if (f) outputs.push({ path: abs(f, cwd), via: "tar" }); continue; }
    if (prog === "wget") { const f = flagValue("-O", "--output-document"); if (f && f !== "-") outputs.push({ path: abs(f, cwd), via: "wget" }); continue; }
    const out = flagValue("-o", "--output", "--out", "-out", "--outfile", "--output-file");
    if (out && out !== "-" && hasExt(out)) {
      outputs.push({ path: abs(out, cwd), via: prog });
      if (prog === "pandoc") inputs.push(...plain.filter(hasExt).filter((f) => f !== out).map((f) => abs(f, cwd)));
    }
  }
  return { outputs, inputs };
}

// ---- FFmpeg in plain words ----

const FLAGS: Record<string, (v: string) => string> = {
  "-i": (v) => `Read ${basename(v)}`,
  "-ss": (v) => `Start at ${v}`,
  "-to": (v) => `Stop at ${v}`,
  "-t": (v) => `Keep ${v}${/^\d+(\.\d+)?$/.test(v) ? " seconds" : ""}`,
  "-r": (v) => `${v} frames per second`,
  "-s": (v) => `Size ${v}`,
  "-crf": (v) => `Quality ${v} (lower is better; 18 to 28 is usual)`,
  "-preset": (v) => `Encoding speed "${v}" (slower makes smaller files)`,
  "-b:v": (v) => `Video bitrate ${v}`,
  "-b:a": (v) => `Audio bitrate ${v}`,
  "-pix_fmt": (v) => (v === "yuv420p" ? "Pixel format that plays everywhere (yuv420p)" : `Pixel format ${v}`),
  "-movflags": (v) => (v.includes("faststart") ? "Let the video start playing before it's fully downloaded" : `MP4 option ${v}`),
  "-map": (v) => `Use stream ${v}`,
  "-f": (v) => (v === "concat" ? "Join the files listed in the input, one after another" : `Format ${v}`),
  "-loop": (v) => (v === "1" ? "Repeat the input image" : `Loop ${v}`),
  "-frames:v": (v) => `Keep ${v} frame${v === "1" ? "" : "s"}`,
  "-vframes": (v) => `Keep ${v} frame${v === "1" ? "" : "s"}`,
  "-aspect": (v) => `Aspect ratio ${v}`,
  "-ar": (v) => `Audio sample rate ${v} Hz`,
  "-ac": (v) => (v === "1" ? "Mono audio" : v === "2" ? "Stereo audio" : `${v} audio channels`),
};
const SWITCHES: Record<string, string> = {
  "-y": "Overwrite the output if it exists",
  "-an": "Remove the audio",
  "-vn": "Remove the video (keep only the sound)",
  "-sn": "Remove subtitles",
  "-shortest": "Stop when the shortest input ends",
  "-hide_banner": "",
  "-nostdin": "",
};
const CODECS: Record<string, string> = {
  libx264: "H.264 (plays everywhere)", libx265: "H.265 (smaller files)", "libvpx-vp9": "VP9 (for the web)", "libaom-av1": "AV1", libsvtav1: "AV1",
  aac: "AAC", libmp3lame: "MP3", libopus: "Opus", copy: "as is, without re-encoding (fast, no quality loss)", prores_ks: "ProRes (for editing)",
};

function filters(chain: string): string {
  return chain.split(/[,;]/).map((f) => {
    const [name, args = ""] = f.split(/=(.*)/s);
    const n = name.replace(/^\[.*?\]/, "").trim();
    if (n === "scale") return `resize to ${args.replace(/:/, "×").replace(/-1|-2/g, "auto")}`;
    if (n === "crop") return "crop";
    if (n === "fade") return /t=out|^out/.test(args) ? "fade out" : "fade in";
    if (n === "afade") return /t=out|^out/.test(args) ? "fade the sound out" : "fade the sound in";
    if (n === "fps") return `${args.replace(/^fps=/, "")} fps`;
    if (n === "setpts") { const m = /([\d.]+)\*PTS/.exec(args); return m ? `play at ${+(1 / +m[1]).toFixed(2)}× speed` : "change timing"; }
    if (n === "atempo") return `play the sound at ${args}× speed`;
    if (n === "volume") return `volume ${args}`;
    if (n === "drawtext") return "draw text on the video";
    if (n === "overlay") return "put one video over another";
    if (n === "transpose") return "rotate";
    if (n === "hflip") return "mirror horizontally";
    if (n === "vflip") return "flip vertically";
    if (n === "subtitles" || n === "ass") return "burn in subtitles";
    if (n === "eq") return "adjust brightness, contrast or colors";
    if (n === "pad") return "add borders";
    if (n === "concat") return "join clips";
    if (n === "trim" || n === "atrim") return "cut a section";
    if (n === "loudnorm") return "even out the loudness";
    if (n === "palettegen" || n === "paletteuse") return "build a color palette (for GIFs)";
    return n;
  }).filter(Boolean).join(", ");
}

/** Each option of the first ffmpeg call in a command, in plain words. Empty if there's no ffmpeg. */
export function explainFfmpeg(cmd: string): string[] {
  const seg = segments(cmd).find((s) => /(^|\/)ffmpeg\s/.test(s));
  if (!seg) return [];
  const w = words(seg);
  const out: string[] = [];
  const start = w.findIndex((x) => /(^|\/)ffmpeg$/.test(x));
  for (let i = start + 1; i < w.length; i++) {
    const f = w[i], v = w[i + 1];
    if (i === w.length - 1 && !f.startsWith("-")) { out.push(`Write ${basename(f)}`); break; }
    if (f in SWITCHES) { if (SWITCHES[f]) out.push(SWITCHES[f]); continue; }
    if ((f === "-vf" || f === "-filter:v") && v) { out.push(`Video: ${filters(v)}`); i++; continue; }
    if ((f === "-af" || f === "-filter:a") && v) { out.push(`Sound: ${filters(v)}`); i++; continue; }
    if (f === "-filter_complex" && v) { out.push(`Combine inputs: ${filters(v)}`); i++; continue; }
    const codec = /^-(c|codec|vcodec|acodec)(:([va]))?$/.exec(f);
    if (codec && v) {
      const what = codec[3] === "v" || codec[1] === "vcodec" ? "video" : codec[3] === "a" || codec[1] === "acodec" ? "sound" : "everything";
      out.push(`Encode the ${what} ${CODECS[v] ? (v === "copy" ? CODECS[v] : `as ${CODECS[v]}`) : `with ${v}`}`);
      i++; continue;
    }
    if (f in FLAGS && v !== undefined) { out.push(FLAGS[f](v)); i++; continue; }
  }
  return out;
}
