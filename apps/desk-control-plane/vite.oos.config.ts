import { mergeConfig } from "vite";
import base from "./vite.config";
export default mergeConfig(base, { base: "/oos/", build: { outDir: "dist-oos", rollupOptions: { input: "oos.html" } } });
