// The diff viewer (and its syntax highlighter) loads the first time a diff is shown, not with the app.
import { lazy, Suspense, type ComponentProps } from "react";

const DiffViewer = lazy(() => import("react-diff-viewer-continued"));

export function Diff(props: ComponentProps<typeof DiffViewer>) {
  return <Suspense fallback={null}><DiffViewer {...props} /></Suspense>;
}
