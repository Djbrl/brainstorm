/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// API_PORT lets a second checkout run next to the main one (e.g. the cowork prototype on 4410).
const api = process.env.API_PORT ?? "4000";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@contract": fileURLToPath(new URL("../server/src/shared/contract.ts", import.meta.url)), "@shared": fileURLToPath(new URL("../server/src/shared", import.meta.url)) } },
  // `npm test`: the pure parts (the stores' reducers, the layout, the thread builder) in Node, with a small DOM shim.
  test: { environment: "node", setupFiles: ["src/test/setup.ts"], include: ["src/**/*.test.ts"], css: { include: /.+/ } },
  server: {
    port: 5173,
    proxy: {
      "/api": `http://127.0.0.1:${api}`,
      "/ws": { target: `ws://127.0.0.1:${api}`, ws: true },
    },
  },
});
