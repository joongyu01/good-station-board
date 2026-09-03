/**
 * 6단계 — 일별 판정 결과를 Supabase 로 올린다.
 *
 *   client/public/data/latest.json → gs_daily
 *
 * 착한주유소 449곳 × 4유종 = 하루 1,796행만 올린다. 전국 1만 건 원본은 올리지
 * 않는다 — 매일 넣으면 연 370만 행이라 무료 한도(500MB)를 넘긴다.
 *
 * service_role 키가 필요하다. 없으면 조용히 건너뛴다. 현황판은 정적 JSON 으로
 * 이미 배포되므로 이 단계가 빠져도 화면은 정상이다.
 *
 * 실행: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run supabase:push
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mode, upsertDaily, type DailyRow } from "../src/lib/supa-admin.ts";
import type { BoardData } from "../src/lib/types.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BOARD = path.join(ROOT, "client", "public", "data", "latest.json");

/** YYYYMMDD → YYYY-MM-DD */
function toDate(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

async function main() {
  if (mode() !== "service") {
    console.log("[push] SUPABASE_SERVICE_ROLE_KEY 가 없어 건너뜁니다. (현황판은 정상 동작)");
    return;
  }
  if (!existsSync(BOARD)) {
    console.error("client/public/data/latest.json 이 없습니다. 먼저 `npm run aggregate`.");
    process.exit(1);
  }

  const board: BoardData = JSON.parse(readFileSync(BOARD, "utf8"));
  const tradeDate = toDate(board.date);

  const rows: DailyRow[] = board.stations.map((s) => ({
    trade_date: tradeDate,
    seq: s.seq,
    fuel_type: s.fuelType,
    price: s.price,
    region_min: s.regionMin,
    region_mean: s.regionMean,
    gap_from_min: s.gapFromMin == null ? null : Math.round(s.gapFromMin),
    signal: s.signal,
    region_rank: s.regionRank,
    region_n: s.regionN,
  }));

  console.log(`[push] 기준일 ${tradeDate} — ${rows.length}행 적재 중…`);
  const n = await upsertDaily(rows);

  const g = rows.filter((r) => r.fuel_type === "gasoline");
  const count = (sig: string) => g.filter((r) => r.signal === sig).length;
  console.log(`[push] 완료 — ${n}행`);
  console.log(`  휘발유: 최저가 ${count("green")} / 근접 ${count("yellow")} / 미달 ${count("red")} / 미상 ${count("unknown")}`);
}

main().catch((e) => { console.error("[push] 예외:", e); process.exit(1); });
