// Owner: C. Ask about a step (the step panel), a file (the map) or a whole thread (the Track). Shows answer, model and cost.
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AskRequest, AskResponse } from "@contract";
import { ask } from "../lib/api";
import { Markdown } from "./Markdown";
import "./ask.css";

type QA = { id: number; question: string; answer?: AskResponse; error?: string };

const SUGGESTIONS = ["Why this change?", "What could break?", "Explain like I'm new here"];

let nextId = 1;

export function formatCost(usd: number): string {
  if (!usd) return "$0";
  if (usd < 0.0001) return "<$0.0001";
  if (usd < 1) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

const fmtTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export function AskBox({ context, placeholder, suggestions = SUGGESTIONS }: { context: Omit<AskRequest, "question">; placeholder?: string; suggestions?: string[] }) {
  const [items, setItems] = useState<QA[]>([]);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const key = `${context.stepId ?? ""}|${context.filePath ?? ""}|${context.root ?? ""}|${context.sessionId ?? ""}`;

  const keyRef = useRef(key);
  keyRef.current = key;

  // New context → fresh conversation.
  useEffect(() => { setItems([]); setValue(""); setBusy(false); }, [key]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [items]);

  const submit = async (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    const id = nextId++;
    const askedFor = key;
    setItems((l) => [...l, { id, question }]);
    setValue("");
    setBusy(true);
    try {
      const answer = await ask({ ...context, question });
      if (askedFor !== keyRef.current) return;
      setItems((l) => l.map((x) => (x.id === id ? { ...x, answer } : x)));
    } catch (e) {
      if (askedFor !== keyRef.current) return;
      setItems((l) => l.map((x) => (x.id === id ? { ...x, error: e instanceof Error ? e.message : "Something went wrong" } : x)));
    } finally {
      if (askedFor === keyRef.current) setBusy(false);
    }
  };
  const onSubmit = (e: FormEvent) => { e.preventDefault(); submit(value); };

  return (
    <div className="askbox">
      {items.length > 0 && (
        <div className="ask-thread">
          {items.map((it) => (
            <div key={it.id} className="ask-qa">
              <div className="ask-q">{it.question}</div>
              {it.answer ? (
                <div className="ask-a">
                  <Markdown text={it.answer.answer} />
                  <div className="ask-meta">
                    <span>{it.answer.model}</span>
                    <span className="sep">·</span>
                    <span>{fmtTokens(it.answer.tokensIn)} in / {fmtTokens(it.answer.tokensOut)} out</span>
                    <span className="sep">·</span>
                    <span className="ask-cost">{formatCost(it.answer.costUsd)}</span>
                    {it.answer.fallback && (<><span className="sep">·</span><span className="ask-fallback">fallback model</span></>)}
                  </div>
                </div>
              ) : it.error ? (
                <div className="ask-a ask-error">Couldn't get an answer: {it.error}</div>
              ) : (
                <div className="ask-a ask-loading" aria-live="polite">
                  <span className="ask-shimmer" />
                  <span className="ask-shimmer short" />
                  <span className="ask-shimmer mid" />
                </div>
              )}
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}

      <div className="ask-chips">
        {suggestions.map((s) => (
          <button key={s} type="button" className="ask-chip" disabled={busy} onClick={() => submit(s)}>{s}</button>
        ))}
      </div>

      <form className="ask-form" onSubmit={onSubmit}>
        <input
          ref={inputRef}
          className="ask-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder ?? "Ask anything about this…"}
          disabled={busy}
        />
        <button className="ask-send" type="submit" disabled={busy || !value.trim()} aria-label="Ask">
          {busy ? <span className="ask-spinner" /> : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 13V3M8 3L3.5 7.5M8 3l4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          )}
        </button>
      </form>
    </div>
  );
}
