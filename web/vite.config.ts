import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";

// Dev-only: rewrite /p/{username}/{slug} to /p/shell.html (mimics Cloudflare Transform Rule)
function shellRewrite(): Plugin {
  return {
    name: "shell-rewrite",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (
          req.url &&
          req.url.startsWith("/p/") &&
          !req.url.startsWith("/p/page-sw.js") &&
          !req.url.startsWith("/p/shell.html") &&
          !req.url.match(/\.(js|css|json|map)(\?|$)/)
        ) {
          const q = req.url.indexOf("?");
          req.url = "/p/shell.html" + (q !== -1 ? req.url.substring(q) : "");
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), shellRewrite()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost",
      "/auth": "http://localhost",
    },
  },
  build: {
    outDir: "dist",
  },
});
