import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const coreDir = path.resolve(__dirname, "../haven-core");

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // libsodium-wrappers-sumo ESM imports ./libsodium-sumo.mjs which lives
      // in the sibling libsodium-sumo package. Point Rollup to the right file.
      "./libsodium-sumo.mjs": path.resolve(
        coreDir,
        "node_modules/libsodium-sumo/dist/modules-sumo-esm/libsodium-sumo.mjs",
      ),
    },
  },
  optimizeDeps: {
    exclude: ["libsodium-wrappers-sumo"],
  },
  build: {
    target: "esnext",
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8080",
      "/api/v1/ws": {
        target: "ws://127.0.0.1:8080",
        ws: true,
      },
    },
  },
});
