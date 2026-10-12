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
  build: {
    rollupOptions: {
      output: {
        // React (and the helpers it uses) in a chunk of its own, so a change to the app doesn't make the browser fetch it
        // again. (The diff viewer is already its own chunk, loaded when a diff shows: lib/Diff.tsx imports it lazily.)
        manualChunks(id) {
          if (id.includes("commonjsHelpers")) return "react";
          if (!id.includes("/node_modules/")) return undefined;
          if (/\/node_modules\/(react|react-dom|scheduler|prop-types|@babel\/runtime)\//.test(id)) return "react";
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": `http://127.0.0.1:${api}`,
      "/ws": { target: `ws://127.0.0.1:${api}`, ws: true },
    },
  },
});
