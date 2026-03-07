import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost",
      "/auth": "http://localhost",
      "/p": "http://localhost",
    },
  },
  build: {
    outDir: "dist",
  },
});
