import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

/**
 * 이번 빌드의 식별자.
 *
 * 번들 파일에는 내용 해시가 붙어 캐시가 저절로 끊기지만, `public/` 에서 그대로
 * 복사되는 것들(config.js, data/*.json)은 이름이 그대로다. GitHub Pages 가
 * `Cache-Control: max-age=600` 을 붙이므로 그런 파일은 10분간 옛 것이 쓰인다.
 *
 * 실제로 판정 칸을 다섯으로 나눠 배포했는데 화면은 옛 latest.json 을 읽어
 * "가격정보 없음 23 · 과거 미신고 0" 을 보여줬다. 코드는 새 것, 데이터는 옛 것.
 *
 * 그래서 이 값을 쿼리로 붙인다. 같은 배포 안에서는 캐시가 살아 있고, 새로
 * 배포하면 값이 바뀌어 곧바로 다시 받는다.
 */
const BUILD_ID = Date.now().toString(36);

/** config.js 도 같은 이유로 쿼리를 갈아 끼운다. */
function configCacheBust() {
  return {
    name: "config-cache-bust",
    transformIndexHtml(html: string) {
      return html.replace('src="./config.js"', `src="./config.js?v=${BUILD_ID}"`);
    },
  };
}

export default defineConfig({
  plugins: [react(), configCacheBust()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
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
