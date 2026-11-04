import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The app is served under /plan next to KitchenOwl (ARCHITECTURE.md section 11). VITE_BASE overrides it.
const base = process.env.VITE_BASE ?? "/plan/";

// DEV_PHONE opens the dev server to a reverse proxy that terminates TLS (README, "On a phone"); DEV_HOST (e.g.
// dev.example.org) limits it to that address.
const phone = process.env.DEV_PHONE === "1";
const devHost = process.env.DEV_HOST;

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    proxy: { [`${base}api`]: "http://localhost:3000" },
    ...(phone
      ? { host: true, allowedHosts: devHost ? [devHost] : true, hmr: { protocol: "wss", clientPort: 443 } }
      : {}),
  },
  test: { environment: "jsdom", setupFiles: ["./test/setup.ts"] },
});
