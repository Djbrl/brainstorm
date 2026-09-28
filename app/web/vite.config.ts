import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// API_PORT lets a second checkout run next to the main one (e.g. the cowork prototype on 4410).
const api = process.env.API_PORT ?? "4000";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@contract": fileURLToPath(new URL("../server/src/types.ts", import.meta.url)) } },
  server: {
    port: 5173,
    proxy: {
      "/api": `http://127.0.0.1:${api}`,
      "/ws": { target: `ws://127.0.0.1:${api}`, ws: true },
    },
  },
});
