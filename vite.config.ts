import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname, "client"),
  // 정적 호스팅 경로가 루트가 아닐 수 있어(GitHub Pages 하위 경로 등) 상대 경로로 뽑는다.
  base: "./",
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
  },
  resolve: {
    alias: { "@shared": path.resolve(__dirname, "src") },
  },
});
