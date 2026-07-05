import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: import.meta.dirname,
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 3002,
    proxy: {
      "/start": "http://localhost:3001",
      "/stop":  "http://localhost:3001",
      "/enter": "http://localhost:3001",
      "/events":"http://localhost:3001",
      "/discord-webhook": "http://localhost:3001",
    },
  },
});
