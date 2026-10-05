// The diff viewer (and its syntax highlighter) loads the first time a diff is shown, not with the app. Given the file's
// `path`, it colours the code in the file's language (lib/highlight.ts), in the map theme's light or dark palette.
import { lazy, Suspense, type ComponentProps } from "react";
import { langOf, usePalette } from "./highlight";

/** The diff viewer's names for the few grammars it doesn't have under ours. */
const DIFF_LANG: Record<string, string> = { markup: "html", tsx: "typescript", jsx: "javascript", toml: "ini" };

const DiffViewer = lazy(() => import("react-diff-viewer-continued"));

export function Diff({ path, ...props }: ComponentProps<typeof DiffViewer> & { path?: string | null }) {
  const { palette, dark } = usePalette();
  const lang = DIFF_LANG[langOf(path) ?? ""] ?? langOf(path);
  return (
    <Suspense fallback={null}>
      <DiffViewer useDarkTheme={dark} {...props} {...(lang ? { highlightLanguage: lang, highlightTheme: palette } : {})} />
    </Suspense>
  );
}
