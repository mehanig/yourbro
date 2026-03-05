import { defineConfig } from "vite";

export default defineConfig({
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
