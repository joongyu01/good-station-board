import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

/**
 * config.js 는 번들에 들어가지 않고 그대로 복사되는 파일이라 파일명에 해시가 붙지
 * 않는다. 그러면 접속 정보를 바꿔도 브라우저가 캐시된 옛 파일을 계속 쓴다(실제로
 * 겪었다). 빌드할 때마다 쿼리를 갈아 끼워 강제로 다시 받게 한다.
 */
function configCacheBust() {
  const v = Date.now().toString(36);
  return {
    name: "config-cache-bust",
    transformIndexHtml(html: string) {
      return html.replace('src="./config.js"', `src="./config.js?v=${v}"`);
    },
  };
}

export default defineConfig({
  plugins: [react(), configCacheBust()],
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
