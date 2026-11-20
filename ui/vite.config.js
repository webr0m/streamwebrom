// ui/vite.config.js
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The Go server only serves versioned files from js/ and css/, so every Vite
// artifact has to land in one of those two folders.
export default defineConfig({
  // Absolute so every path below means the same thing from the repo root, from ui/
  // and from scripts/build-ui.mjs.
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "/",
  build: {
    outDir: "../web",
    emptyOutDir: false,
    manifest: true,
    sourcemap: false,
    rollupOptions: {
      input: { studio: "studio.html" },
      output: {
        entryFileNames: "js/[name]-[hash].js",
        chunkFileNames: "js/[name]-[hash].js",
        assetFileNames: "css/[name]-[hash][extname]",
      },
    },
  },
  server: {
    port: 5173,
    proxy: Object.fromEntries(
      ["/ws", "/api", "/whip", "/whep", "/recordings", "/metrics"].map((path) => [
        path,
        { target: process.env.SWR_ORIGIN || "http://localhost:8443", changeOrigin: true, secure: false, ws: path === "/ws" },
      ]),
    ),
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["tests/setup.js"],
    include: ["tests/**/*.test.jsx"],
  },
});
