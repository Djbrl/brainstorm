// Counting a use for the anonymous usage stats (server usage/usage.service.ts): the server keeps the
// counts and sends one report a day, if the setting is on. A replay (the hosted demo, a shared file) counts nothing.
import { useCallback, useEffect, useState } from "react";
import type { UpdatesStatus, UsageStatus } from "@contract";
import { isRecording } from "./live";
import { getTheme } from "./theme";
import { get, post, put } from "./api";

type WebEvent = "op" | "th" | "rp" | "lv";

/** One use: app opened (with the theme in use), thread opened, replay played, live follow. Fire and forget. */
export function track(name: WebEvent) {
  if (isRecording()) return;
  post("/api/usage/event", name === "op" ? { name, theme: getTheme() } : { name }, { keepalive: true }).catch(() => { /* offline or an older server: nothing to do */ });
}

export type { UsageStatus, UpdatesStatus };

/** Where the site says exactly what's sent, how long it's kept and how to have it deleted. */
export const PRIVACY_URL = "https://brainstorm-landing.vercel.app/privacy.html#usage-stats";


/** The setting: off until the person says yes (the app asks once), and off again with one click. */
export function useUsageSetting() {
  const [status, setStatus] = useState<UsageStatus | null>(null);
  useEffect(() => {
    if (isRecording()) return;
    get<UsageStatus>("/api/usage").then(setStatus, () => setStatus(null));
  }, []);
  const set = useCallback((enabled: boolean) => {
    put<UsageStatus>("/api/usage", { enabled }).then(setStatus).catch(() => { /* keep what's shown */ });
  }, []);
  const toggle = useCallback(() => { if (status) set(!status.enabled); }, [status, set]);
  /** Ask the site to delete every report sent from this install. Resolves to whether it worked. */
  const forget = useCallback(() => post<{ status: UsageStatus; deleted: boolean }>("/api/usage/forget")
    .then((r) => { setStatus(r.status); return !!r.deleted; })
    .catch(() => false), []);
  return { status, set, toggle, forget };
}

/** "Tell me when there's a new version" (server updates/updates.service.ts): on by default, apart from the usage stats. */
export function useUpdatesSetting() {
  const [status, setStatus] = useState<UpdatesStatus | null>(null);
  useEffect(() => {
    if (isRecording()) return;
    get<UpdatesStatus>("/api/updates").then(setStatus, () => setStatus(null));
  }, []);
  const toggle = useCallback(() => {
    if (!status) return;
    put<UpdatesStatus>("/api/updates", { enabled: !status.enabled }).then(setStatus).catch(() => { /* keep what's shown */ });
  }, [status]);
  return { status, toggle };
}
