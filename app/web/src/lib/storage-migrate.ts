// Owned by the lead. Rundown was called Brainstorm until 0.5, and its saved settings in this browser were named
// "brainstorm-…" (theme, editor, sidebar, map prefs, last visit…). Copy each to its new "rundown-…" name once, before
// anything reads them: main.tsx imports this first. Remove in 0.6.
try {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const old = localStorage.key(i);
    if (!old?.startsWith("brainstorm-")) continue;
    const key = "rundown-" + old.slice("brainstorm-".length);
    const value = localStorage.getItem(old);
    if (localStorage.getItem(key) === null && value !== null) localStorage.setItem(key, value);
    localStorage.removeItem(old);
  }
} catch { /* storage blocked: the settings start fresh */ }
export {};
