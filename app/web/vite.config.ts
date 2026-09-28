import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@contract": fileURLToPath(new URL("../server/src/types.ts", import.meta.url)) } },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:4000",
      "/ws": { target: "ws://127.0.0.1:4000", ws: true },
    },
  },
});
