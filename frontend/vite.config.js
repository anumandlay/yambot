/**
 * @fileoverview Vite config for YamBot web app.
 * Purpose: React plugin + Tailwind v4 Vite plugin; proxies /api in local dev optional via env.
 * Downstream: `npm run dev` / `npm run build` for deployment.
 */

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
  },
});
