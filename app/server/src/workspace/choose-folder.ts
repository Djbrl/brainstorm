// Owner: S. The system's own folder picker, opened by the server (it runs on the person's machine): a web page can't
// learn a folder's path from the browser's picker or a drop, only its name. macOS: AppleScript's `choose folder`;
// Windows: the .NET folder dialog through PowerShell; Linux: zenity, else kdialog.
import { execFile } from "node:child_process";

/** The folder picked, null when the person cancelled; throws when this machine has no picker we know. */
export type Chosen = { root: string | null };

const PROMPT = "Pick a workspace for Rundown";

function run(cmd: string, args: string[]): Promise<{ code: number; out: string; err: string }> {
  return new Promise((done, fail) => {
    // No timeout: the person may take their time. One dialog at a time (WorkspaceService keeps it to one).
    execFile(cmd, args, { windowsHide: false, maxBuffer: 1 << 20 }, (e, out, err) => {
      const code = e ? (typeof (e as { code?: unknown }).code === "number" ? (e as { code: number }).code : -1) : 0;
      if (e && (e as NodeJS.ErrnoException).code === "ENOENT") { fail(e); return; }
      done({ code, out: String(out), err: String(err) });
    });
  });
}

export async function chooseFolder(platform: NodeJS.Platform = process.platform): Promise<Chosen> {
  if (platform === "darwin") {
    // `activate` brings the dialog to the front (osascript runs in the background otherwise). Cancel: error -128.
    const r = await run("osascript", ["-e", "activate", "-e", `POSIX path of (choose folder with prompt "${PROMPT}")`]);
    if (r.code !== 0) { if (/-128/.test(r.err)) return { root: null }; throw new Error(r.err.trim() || "The folder picker didn't open"); }
    return { root: r.out.trim().replace(/\/+$/, "") || null };
  }
  if (platform === "win32") {
    const ps = "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; "
      + `$f.Description = '${PROMPT}'; $f.ShowNewFolderButton = $false; if ($f.ShowDialog() -eq 'OK') { $f.SelectedPath }`;
    const r = await run("powershell.exe", ["-NoProfile", "-STA", "-Command", ps]);
    if (r.code !== 0) throw new Error(r.err.trim() || "The folder picker didn't open");
    return { root: r.out.trim() || null };
  }
  // Linux and the rest: zenity, else kdialog. Both exit 1 on cancel.
  for (const [cmd, args] of [["zenity", ["--file-selection", "--directory", `--title=${PROMPT}`]], ["kdialog", ["--getexistingdirectory", ".", "--title", PROMPT]]] as const) {
    try {
      const r = await run(cmd, [...args]);
      if (r.code === 1) return { root: null };
      if (r.code !== 0) throw new Error(r.err.trim() || "The folder picker didn't open");
      return { root: r.out.trim() || null };
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  }
  throw new Error("No folder picker on this computer (install zenity or kdialog), or paste the folder's path");
}
