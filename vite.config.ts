/// <reference types="vitest/config" />
import { defineConfig } from "vite";

const host = process.env["TAURI_DEV_HOST"];

// https://v2.tauri.app/start/frontend/vite/
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host ?? false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "safari16",
    // Keep the start-up bundle lean; Shiki grammars are split into their own chunks.
    chunkSizeWarningLimit: 800,
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
  },
});
