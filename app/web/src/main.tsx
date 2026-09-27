import { createRoot } from "react-dom/client";
import { LiveProvider } from "./lib/live";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <LiveProvider>
    <App />
  </LiveProvider>,
);
