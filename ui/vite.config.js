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
  experimental: {
    // Keep the lazy chunk's CSS and preload requests beside the versioned
    // entry module. Root-relative URLs bypass the service worker's precache.
    renderBuiltUrl: (_filename, { hostType }) => hostType === "js" ? { relative: true } : undefined,
  },
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
  // @vitejs/plugin-react's babel pass runs for the client build only: under
  // Vitest's SSR transform .jsx falls back to esbuild's classic runtime, so
  // every rendered component would need `import React`. Pinning automatic here
  // keeps src/ and tests/ on one JSX runtime.
  esbuild: { jsx: "automatic" },
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
    css: { modules: { classNameStrategy: "non-scoped" } },
  },
});
