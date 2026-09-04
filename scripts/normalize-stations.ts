/**
 * 1단계 — 착한주유소 명단 CSV 정규화
 *
 *   stations.csv  →  data/good-stations.json  +  data/normalize-report.md
 *
 * 파싱 자체는 src/lib/station-csv.ts 가 한다. 관리 화면의 CSV 업로드와 같은
 * 코드를 써야 두 경로가 어긋나지 않는다. 이 스크립트는 파일을 읽어 넘기고
 * 리포트를 쓰는 껍데기다.
 *
 * 실행: npm run normalize [파일경로]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseStationCsv } from "../src/lib/station-csv.ts";
import { BRAND_LABELS, type BrandCode } from "../src/lib/brand.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "data");

function main() {
  const arg = process.argv.slice(2).find((a) => !a.startsWith("-"));
  const src = arg ? path.resolve(arg) : path.join(ROOT, "stations.csv");

  if (!existsSync(src)) {
    console.error(`명단 파일이 없습니다: ${src}`);
    process.exit(1);
  }

  const { stations, failures, anomalies, unknownBrands, missingIds } =
    parseStationCsv(readFileSync(src, "utf8"));

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    path.join(OUT_DIR, "good-stations.json"),
    JSON.stringify(stations, null, 2),
    "utf8",
  );

  // ── 리포트 ────────────────────────────────────────────────────────────
  const bySido = new Map<string, number>();
  const bySigungu = new Map<string, number>();
  const byBrand = new Map<string, number>();
  for (const s of stations) {
    bySido.set(s.sido, (bySido.get(s.sido) ?? 0) + 1);
    bySigungu.set(s.regionKey, (bySigungu.get(s.regionKey) ?? 0) + 1);
    const b = s.brand ?? "(미상)";
    byBrand.set(b, (byBrand.get(b) ?? 0) + 1);
  }

  const dupNames = new Map<string, number>();
  for (const s of stations) dupNames.set(s.name, (dupNames.get(s.name) ?? 0) + 1);
  const dups = [...dupNames.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);

  const withId = stations.filter((s) => s.stationId).length;
  const selfCount = stations.filter((s) => s.isSelf).length;

  const out: string[] = [];
  out.push("# 착한주유소 명단 정규화 리포트\n");
  out.push(`- 원본: \`${path.relative(ROOT, src) || path.basename(src)}\``);
  out.push(`- 정규화 성공: **${stations.length}건**`);
  out.push(`- 실패: **${failures.length}건**`);
  out.push(`- 오피넷 주유소코드 보유: **${withId}건** (미보유 ${missingIds}건 — 매칭 단계로)`);
  out.push(`- 셀프: ${selfCount}건 / 일반: ${stations.length - selfCount}건`);
  out.push(`- 통합 이전 행정구역 표기: **${anomalies.length}건**`);
  out.push(`- 시·군·구 수: ${bySigungu.size}개\n`);

  out.push("## 폴(상표) 분포\n");
  out.push("| 코드 | 상표 | 주유소 수 |");
  out.push("|---|---|---:|");
  for (const [code, n] of [...byBrand.entries()].sort((a, b) => b[1] - a[1])) {
    const label = BRAND_LABELS[code as BrandCode] ?? "—";
    out.push(`| ${code} | ${label} | ${n} |`);
  }

  if (unknownBrands.size) {
    out.push("\n## 해석하지 못한 상표 표기 — 확인 필요\n");
    out.push("`src/lib/brand.ts` 의 별칭 표에 추가해야 코드가 붙습니다.\n");
    out.push("| 원본 표기 | 건수 |");
    out.push("|---|---:|");
    for (const [raw, n] of [...unknownBrands.entries()].sort((a, b) => b[1] - a[1])) {
      out.push(`| \`${raw}\` | ${n} |`);
    }
  }

  out.push("\n## 시·도별 분포\n");
  out.push("| 시·도 | 주유소 수 |");
  out.push("|---|---:|");
  for (const [sido, n] of [...bySido.entries()].sort((a, b) => b[1] - a[1])) {
    out.push(`| ${sido} | ${n} |`);
  }

  if (anomalies.length) {
    out.push("\n## 통합 이전 행정구역 표기 — 원본 갱신 권장\n");
    out.push(
      "광주광역시·전라남도는 **전남광주통합특별시**로 통합되었고 Opinet도 `전남광주`로 " +
      "내려옵니다. 아래 건들은 통합 이전 명칭으로 적혀 있어 자동 보정했습니다. " +
      "집계는 정상 동작하지만 명단 원본을 통합 명칭으로 갱신해 두는 편이 좋습니다.\n",
    );
    out.push("| # | 상호 | 주소 | 옛 표기 |");
    out.push("|---:|---|---|---|");
    for (const a of anomalies) out.push(`| ${a.seq} | ${a.name} | ${a.address} | \`${a.token}\` |`);
  }

  if (failures.length) {
    out.push("\n## 정규화 실패 — 수기 확인 필요\n");
    out.push("| 원본 행 | 상호 | 주소 | 사유 |");
    out.push("|---:|---|---|---|");
    for (const f of failures) out.push(`| ${f.line} | ${f.name} | ${f.address} | ${f.reason} |`);
  }

  if (dups.length) {
    out.push("\n## 중복 상호\n");
    out.push("같은 상호가 여러 지역에 있습니다. 코드가 없는 행은 주소로만 매칭해야 합니다.\n");
    out.push("| 상호 | 건수 |");
    out.push("|---|---:|");
    for (const [name, n] of dups) out.push(`| ${name} | ${n} |`);
  }

  writeFileSync(path.join(OUT_DIR, "normalize-report.md"), out.join("\n") + "\n", "utf8");

  console.log(`정규화 완료 — 성공 ${stations.length}건 / 실패 ${failures.length}건`);
  console.log(`  주유소코드 보유 ${withId}건, 미보유 ${missingIds}건`);
  console.log(`  폴: ${[...byBrand.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(" / ")}`);
  if (unknownBrands.size) {
    console.log(`  ⚠ 해석 못한 상표 ${unknownBrands.size}종: ${[...unknownBrands.keys()].join(", ")}`);
  }
  console.log(`  data/good-stations.json`);
  console.log(`  data/normalize-report.md`);
  if (failures.length) {
    console.log("\n실패 목록:");
    for (const f of failures) console.log(`  행 ${f.line}: ${f.name} — ${f.reason}`);
  }
}

main();
