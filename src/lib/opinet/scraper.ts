/**
 * Opinet 「사업자별 과거 판매가격」 다운로드.
 *
 * OPMS server/services/oilScraper.ts 이식판. 바꾼 곳:
 *   - Replit Nix 크로미움 경로 하드코딩 제거 → playwright 번들 크로미움 사용
 *   - /tmp 고정 → os.tmpdir()
 *   - 재시도 추가
 *
 * 이 페이지는 로그인은 없지만 NetFunnel(대기열)을 통과해야 한다. 대기열이 밀리면
 * fn_Download 자체가 늦게 뜨기 때문에 타임아웃을 길게 잡는다. CI에서 간헐적으로
 * 실패하는 것이 정상이며, 호출부는 실패를 전제로 직전 성공분을 유지해야 한다.
 */
import { chromium, type Browser } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const DOWNLOAD_PAGE = "https://www.opinet.co.kr/user/opdown/opDownload.do";
const DOWNLOAD_DIR = path.join(tmpdir(), "opinet_downloads");

const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-setuid-sandbox",
  "--no-first-run",
  "--disable-extensions",
  "--disable-background-networking",
  "--disable-default-apps",
  "--disable-sync",
  "--disable-translate",
  "--hide-scrollbars",
  "--mute-audio",
];

export interface DownloadResult {
  buffer: Buffer;
  filename: string;
}

/**
 * @param targetDate YYYYMMDD (START_DT = END_DT = targetDate)
 */
async function attemptDownload(targetDate: string): Promise<DownloadResult | null> {
  let browser: Browser | undefined;

  try {
    if (!existsSync(DOWNLOAD_DIR)) mkdirSync(DOWNLOAD_DIR, { recursive: true });

    console.log(`[scraper] 브라우저 시작 (기준일 ${targetDate})`);
    browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      locale: "ko-KR",
      acceptDownloads: true,
    });

    const page = await context.newPage();
    page.on("dialog", (d) => {
      console.log(`[scraper] 다이얼로그 수락: ${d.message().slice(0, 80)}`);
      d.accept().catch(() => {});
    });

    await page.goto(DOWNLOAD_PAGE, { waitUntil: "domcontentloaded", timeout: 120_000 });

    // NetFunnel 대기열을 통과해야 fn_Download가 정의된다.
    console.log("[scraper] NetFunnel 대기열 통과 대기 (최대 300초)...");
    const fnReady = await page
      .waitForFunction(() => typeof (window as any).fn_Download === "function", undefined, {
        timeout: 300_000,
      })
      .then(() => true)
      .catch(() => false);

    if (!fnReady) throw new Error("fn_Download 로드 실패 — NetFunnel 대기열 타임아웃(300초)");

    await page.evaluate((date: string) => {
      const $ = (window as any).$;
      $("#span_start_date_picker").val(date);
      $("#span_end_date_picker").val(date);
    }, targetDate);

    const set = await page.evaluate(() => ({
      start: (document.getElementById("span_start_date_picker") as HTMLInputElement)?.value,
      end: (document.getElementById("span_end_date_picker") as HTMLInputElement)?.value,
    }));
    if (set.start !== targetDate || set.end !== targetDate) {
      throw new Error(`날짜 설정 실패 — 기대 ${targetDate}, 실제 ${set.start}~${set.end}`);
    }

    console.log("[scraper] fn_Download(6) 호출, 다운로드 대기 (최대 600초)...");
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 600_000 }),
      page.evaluate(() => { (window as any).fn_Download(6); }),
    ]);

    const filename = download.suggestedFilename() || `opinet_${targetDate}.csv`;
    const savePath = path.join(DOWNLOAD_DIR, filename);
    await download.saveAs(savePath);

    const buffer = await readFile(savePath);
    await unlink(savePath).catch(() => {});

    console.log(`[scraper] 완료: ${filename}, ${buffer.byteLength} bytes`);
    return { buffer, filename };
  } catch (err) {
    console.error("[scraper] 실패:", err instanceof Error ? err.message : String(err));
    return null;
  } finally {
    await browser?.close().catch(() => {});
  }
}

/** 재시도를 감싼 다운로드. */
export async function downloadOilPrice(
  targetDate: string,
  attempts = 3,
): Promise<DownloadResult | null> {
  for (let i = 1; i <= attempts; i++) {
    console.log(`[scraper] 시도 ${i}/${attempts}`);
    const result = await attemptDownload(targetDate);
    if (result) return result;
    if (i < attempts) {
      const waitMs = 30_000 * i;
      console.log(`[scraper] ${waitMs / 1000}초 후 재시도`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  return null;
}
