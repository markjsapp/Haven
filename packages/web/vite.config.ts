import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const coreDir = path.resolve(__dirname, "../haven-core");

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ["react", "react-dom"],
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
    include: [
      "@dnd-kit/core",
      "@dnd-kit/sortable",
      "@dnd-kit/utilities",
      "@dnd-kit/accessibility",
    ],
  },
  // Allow TAURI_ env vars to be accessed via import.meta.env
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "esnext",
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-tiptap": [
            "@tiptap/react",
            "@tiptap/starter-kit",
            "@tiptap/extension-mention",
            "@tiptap/extension-link",
            "@tiptap/extension-placeholder",
            "@tiptap/extension-code-block-lowlight",
            "@tiptap/extension-underline",
            "@tiptap/pm",
            "@tiptap/suggestion",
            "@tiptap/html",
          ],
          "vendor-dnd": ["@dnd-kit/core", "@dnd-kit/sortable"],
          "vendor-livekit": ["@livekit/components-react", "livekit-client"],
          "vendor-crypto": ["libsodium-wrappers-sumo"],
        },
      },
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api/v1/ws": {
        target: "ws://127.0.0.1:8080",
        ws: true,
      },
      "/api": {
        target: "http://127.0.0.1:8080",
        timeout: 300000, // 5 minutes — large file uploads need time
      },
    },
  },
});
