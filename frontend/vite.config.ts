import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// During development the API runs separately on port 8765 (python -m trdr).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8765",
      "/ws": { target: "ws://127.0.0.1:8765", ws: true },
    },
  },
});
