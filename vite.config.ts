import { defineConfig } from "vite";

export default defineConfig({
  root: "studio",
  server: {
    host: "127.0.0.1",
    port: 4730,
    strictPort: true,
    fs: { allow: [".."] },
  },
  build: {
    outDir: "../dist-studio",
    emptyOutDir: true,
  },
});
