// Every call to the local server goes through here: one place that checks the answer and turns a failure into an
// ApiError the page can show in plain words (the setup view, the crash screen).
import type { AskRequest, AskResponse } from "@contract";
import { replayAnswer, isRecording } from "./live";

/** A request that failed: the server said no (`status`), or it couldn't be reached (`status` 0). */
export class ApiError extends Error {
  /** `said`: the server's own words for it, when it sent some. */
  constructor(readonly status: number, readonly path: string, readonly body: unknown = null, readonly said?: string) {
    super(said ?? (status ? `The server couldn't do that (${status}).` : "Can't reach Rundown. Its server isn't answering."));
    this.name = "ApiError";
  }
  /** The server's `code` for this refusal, if it sent one (for example "large" on a 409 from POST /api/workspace). */
  get code(): string | undefined {
    const c = (this.body as { code?: unknown } | null)?.code;
    return typeof c === "string" ? c : undefined;
  }
}

/** What the server said, in its own words when it sent some (Nest's `message`, a string or a list, or `error`). */
function said(body: unknown): string | undefined {
  const b = body as { message?: unknown; error?: unknown } | null;
  if (!b || typeof b !== "object") return undefined;
  if (Array.isArray(b.message)) return b.message.join(" ") || undefined;
  if (typeof b.message === "string" && b.message) return b.message;
  return typeof b.error === "string" && b.error ? b.error : undefined;
}

type Options = { keepalive?: boolean };

async function request<T>(method: string, path: string, body?: unknown, o: Options = {}): Promise<T> {
  let r: Response;
  try {
    r = await fetch(path, {
      method,
      ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      ...(o.keepalive ? { keepalive: true } : {}),
    });
  } catch {
    throw new ApiError(0, path);
  }
  if (!r.ok) {
    const b: unknown = await r.json().catch(() => null);
    throw new ApiError(r.status, path, b, said(b));
  }
  // 204 or an empty body (open, reveal, usage events): nothing to read, and not a failure.
  const text = await r.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** GET a JSON answer. Throws ApiError when the request fails. */
export const get = <T>(path: string) => request<T>("GET", path);
/** POST a JSON body (an empty object by default), JSON back. */
export const post = <T>(path: string, body: unknown = {}, o?: Options) => request<T>("POST", path, body, o);
/** PUT a JSON body, JSON back. */
export const put = <T>(path: string, body: unknown) => request<T>("PUT", path, body);

/** A message for a person from anything thrown: the server's words, else `fallback` (a failed request), else the error's. */
export const errorWords = (e: unknown, fallback: string) =>
  e instanceof ApiError ? (e.said ?? (e.status ? fallback : e.message)) : e instanceof Error && e.message ? e.message : fallback;

export async function ask(req: AskRequest): Promise<AskResponse> {
  if (isRecording()) return replayAnswer(req);
  return post<AskResponse>("/api/ask", req);
}
