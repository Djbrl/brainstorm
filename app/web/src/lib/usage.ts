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

export type UsageStatus = { enabled: boolean; locked: string | null; sends: boolean; lastSent: string | null; pending: Record<string, number> };

/** The setting in Settings: on by default, off for good with one click. */
export function useUsageSetting() {
  const [status, setStatus] = useState<UsageStatus | null>(null);
  useEffect(() => {
    if (isReplay()) return;
    fetch("/api/usage").then((r) => (r.ok ? r.json() : null)).then(setStatus).catch(() => setStatus(null));
  }, []);
  const toggle = useCallback(() => {
    if (!status) return;
    fetch("/api/usage", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: !status.enabled }) })
      .then((r) => (r.ok ? r.json() : null)).then((s) => s && setStatus(s)).catch(() => { /* keep what's shown */ });
  }, [status]);
  return { status, toggle };
}
