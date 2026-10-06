import "./lib/storage-migrate"; // first: renames the saved settings from Brainstorm before anything reads them
import { createRoot } from "react-dom/client";
import { LiveProvider } from "./lib/live";
import { App } from "./App";
import "./styles.css";
import "./themes.css";
import "./lib/theme"; // applies the saved map theme before the first paint

createRoot(document.getElementById("root")!).render(
  <LiveProvider>
    <App />
  </LiveProvider>,
);
