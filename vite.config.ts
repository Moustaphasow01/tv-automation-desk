import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: {
    sourcemap: false,
    target: "es2020",
    rolldownOptions: {
      checks: {
        pluginTimings: false,
      },
      output: {
        manualChunks(moduleId: string) {
          if (moduleId.includes("/node_modules/react/") || moduleId.includes("/node_modules/react-dom/")) {
            return "vendor-react";
          }

          if (moduleId.includes("/node_modules/react-router") || moduleId.includes("/node_modules/@remix-run/")) {
            return "vendor-router";
          }

          if (moduleId.includes("/node_modules/@tanstack/")) {
            return "vendor-query";
          }

          if (moduleId.includes("/node_modules/")) {
            return "vendor";
          }

          return null;
        },
      },
    },
  }
});
