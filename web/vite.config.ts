import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8080",
      "/auth": "http://localhost:8080",
      "/p": "http://localhost:8080",
    },
  },
  build: {
    outDir: "dist",
  },
});
