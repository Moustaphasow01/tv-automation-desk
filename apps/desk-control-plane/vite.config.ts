import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

const deskBuildId = process.env.DESK_BUILD_ID
  || process.env.RELEASE_VERSION
  || process.env.GITHUB_SHA?.slice(0, 12)
  || new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);

export default defineConfig({
  plugins: [react()],
  define: {
    "import.meta.env.VITE_DESK_BUILD_ID": JSON.stringify(deskBuildId),
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  server: {
    port: 8090,
    proxy: {
      "/front-api": {
        target: process.env.VITE_FRONT_API_PROXY_TARGET || "http://127.0.0.1:8787",
        changeOrigin: true
      },
      "/api": {
        target: process.env.VITE_FRONT_API_PROXY_TARGET || "http://127.0.0.1:8787",
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
