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
        // The graph library (react-force-graph-2d and what it brings: force-graph, d3, tween.js, lodash-es…) in a chunk of
        // its own, loaded with the map: it no longer rides along in a chunk of the app's own code (labels-*.js), so a change
        // to the app doesn't make the browser fetch it again. (The diff viewer is already its own chunk, loaded when a diff
        // shows: lib/Diff.tsx imports it lazily. A manual chunk for it would take in refractor, which the app's own
        // highlighting needs on the first page.)
        // React (and the helpers both use) gets its own chunk too: a manual chunk takes in every module it needs that no
        // other chunk claims, and React would otherwise land in "graph" and make the first page load it.
        manualChunks(id) {
          if (id.includes("commonjsHelpers")) return "react";
          if (!id.includes("/node_modules/")) return undefined;
          if (/\/node_modules\/(react|react-dom|scheduler|prop-types|@babel\/runtime)\//.test(id)) return "react";
          if (/\/node_modules\/(react-force-graph-2d|force-graph|react-kapsule|kapsule|jerrypick|@tweenjs|accessor-fn|bezier-js|canvas-color-tracker|d3-(?!hierarchy)[a-z-]+|float-tooltip|index-array-by|lodash-es|internmap|delaunator|robust-predicates|preact)\//.test(id)) return "graph";
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
