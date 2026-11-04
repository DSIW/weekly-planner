import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The app is served under /plan next to KitchenOwl (ARCHITECTURE.md section 11). VITE_BASE overrides it.
const base = process.env.VITE_BASE ?? "/plan/";

// DEV_HOST (e.g. dev.example.org) opens the dev server to a reverse proxy that terminates TLS (README, "On a phone").
const devHost = process.env.DEV_HOST;

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    proxy: { [`${base}api`]: "http://localhost:3000" },
    ...(devHost ? { host: true, allowedHosts: [devHost], hmr: { protocol: "wss", clientPort: 443 } } : {}),
  },
  test: { environment: "jsdom", setupFiles: ["./test/setup.ts"] },
});
