// Owned by the lead. Counting a use for the anonymous usage stats (server usage/usage.service.ts): the server keeps the
// counts and sends one report a day, if the setting is on. A replay (the hosted demo, a shared file) counts nothing.
import { useCallback, useEffect, useState } from "react";
import { isReplay } from "./live";
import { getTheme } from "./theme";

type WebEvent = "op" | "th" | "rp" | "lv";

/** One use: app opened (with the theme in use), thread opened, replay played, live follow. Fire and forget. */
export function track(name: WebEvent) {
  if (isReplay()) return;
  fetch("/api/usage/event", {
    method: "POST", headers: { "content-type": "application/json" }, keepalive: true,
    body: JSON.stringify(name === "op" ? { name, theme: getTheme() } : { name }),
  }).catch(() => { /* offline or an older server: nothing to do */ });
}

export type UsageStatus = { enabled: boolean; asked: boolean; id: string | null; locked: string | null; sends: boolean; lastSent: string | null; pending: Record<string, number> };

/** Where the site says exactly what's sent, how long it's kept and how to have it deleted. */
export const PRIVACY_URL = "https://brainstorm-landing.vercel.app/privacy#usage-stats";

const put = (enabled: boolean) => fetch("/api/usage", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled }) })
  .then((r) => (r.ok ? (r.json() as Promise<UsageStatus>) : null));

/** The setting: off until the person says yes (the app asks once), and off again with one click. */
export function useUsageSetting() {
  const [status, setStatus] = useState<UsageStatus | null>(null);
  useEffect(() => {
    if (isReplay()) return;
    fetch("/api/usage").then((r) => (r.ok ? r.json() : null)).then(setStatus).catch(() => setStatus(null));
  }, []);
  const set = useCallback((enabled: boolean) => {
    put(enabled).then((s) => s && setStatus(s)).catch(() => { /* keep what's shown */ });
  }, []);
  const toggle = useCallback(() => { if (status) set(!status.enabled); }, [status, set]);
  /** Ask the site to delete every report sent from this install. Resolves to whether it worked. */
  const forget = useCallback(() => fetch("/api/usage/forget", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    .then((r) => (r.ok ? r.json() : null))
    .then((r: { status: UsageStatus; deleted: boolean } | null) => { if (r) setStatus(r.status); return !!r?.deleted; })
    .catch(() => false), []);
  return { status, set, toggle, forget };
}
