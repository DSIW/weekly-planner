import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The app is served under /plan next to KitchenOwl (ARCHITECTURE.md section 11). VITE_BASE overrides it.
const base = process.env.VITE_BASE ?? "/plan/";

export default defineConfig({
  base,
  plugins: [react()],
  server: { proxy: { [`${base}api`]: "http://localhost:3000" } },
  test: { environment: "jsdom", setupFiles: ["./test/setup.ts"] },
});
