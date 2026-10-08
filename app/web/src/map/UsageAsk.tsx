// Owned by the lead. The one question about usage stats, asked once, after the welcome card: nothing is counted or sent
// until the person answers yes (server usage/usage.service.ts). Saying no is as easy as saying yes, and Settings can
// change it later. Not on a replay (the hosted demo, a shared file) or a development build, which never sends.
import { useEffect, useState } from "react";
import { isReplay } from "../lib/live";
import { PRIVACY_URL, useUsageSetting } from "../lib/usage";
import { welcomed } from "../lib/visit";
import "./usage-ask.css";

export function UsageAsk() {
  const { status, set } = useUsageSetting();
  const [ready, setReady] = useState(() => welcomed());
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (ready) return;
    const on = () => setReady(true);
    window.addEventListener("rundown-welcomed", on);
    return () => window.removeEventListener("rundown-welcomed", on);
  }, [ready]);
  if (isReplay() || !ready || done || !status || status.asked || status.locked || !status.sends) return null;
  const answer = (yes: boolean) => { set(yes); setDone(true); };
  return (
    <section className="usage-ask" role="region" aria-labelledby="usage-ask-title">
      <h2 id="usage-ask-title">Share anonymous usage stats?</h2>
      <p>
        Once a day: how much you used Rundown (counts only), its version, your OS and country. Never code, paths,
        prompts or names. You can change this in Settings.
      </p>
      <div className="usage-ask-actions">
        <button onClick={() => answer(true)}>Share stats</button>
        <button onClick={() => answer(false)}>Don't share</button>
        <a href={PRIVACY_URL} target="_blank" rel="noopener">What's sent</a>
      </div>
    </section>
  );
}
