/**
 * 1단계 — 착한주유소 명단(adress.csv) 정규화
 *
 *   adress.csv  →  data/good-stations.json  +  data/normalize-report.md
 *
 * 하는 일
 *   - "행복주유소 대표" 에서 상호만 떼기
 *   - 시·도 표기 통일 (강원도→강원, 경상북도→경북, 세종특별자치시→세종 …)
 *   - 시·군·구 추출, 집계 키 생성
 *   - 비표준 행정구역 표기(전남광주통합특별시 등) 리포트
 *
 * 실행: npm run normalize
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeRegion } from "../src/lib/region.ts";
import type { GoodStation } from "../src/lib/types.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "adress.csv");
const OUT_DIR = path.join(ROOT, "data");

/** 따옴표를 존중하는 최소 CSV 파서. 주소에 콤마가 들어있는 행이 있다. */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      out.push(cur); cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** "행복주유소 대표" → "행복주유소" */
function cleanName(raw: string): string {
  return raw.replace(/\s*대표\s*$/, "").trim();
}

function main() {
  const text = readFileSync(SRC, "utf8").replace(/^﻿/, "");
  const lines = text.split(/\r?\n/).filter((l) => l.trim());

  const stations: GoodStation[] = [];
  const failures: Array<{ line: number; name: string; address: string; reason: string }> = [];
  const anomalies: Array<{ seq: number; name: string; address: string; token: string }> = [];

  for (let i = 1; i < lines.length; i++) { // 0행은 헤더
    const cols = parseCsvLine(lines[i]);
    const rawName = cols[0] ?? "";
    const address = cols[1] ?? "";
    if (!rawName || !address) continue;

    const seq = stations.length + 1;
    const name = cleanName(rawName);
    const region = normalizeRegion(address);

    if (!region) {
      failures.push({ line: i + 1, name, address, reason: "시·도 또는 시·군·구 인식 실패" });
      continue;
    }

    if (region.anomaly) {
      anomalies.push({ seq, name, address, token: region.anomaly });
    }

    stations.push({
      seq,
      name,
      address,
      sido: region.sido,
      sigungu: region.sigungu,
      sigunguDetail: region.sigunguDetail,
      regionKey: region.key,
      stationId: null,
      ...(region.anomaly ? { anomaly: region.anomaly } : {}),
    });
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    path.join(OUT_DIR, "good-stations.json"),
    JSON.stringify(stations, null, 2),
    "utf8",
  );

  // ── 리포트 ────────────────────────────────────────────────────────────
  const bySido = new Map<string, number>();
  const bySigungu = new Map<string, number>();
  for (const s of stations) {
    bySido.set(s.sido, (bySido.get(s.sido) ?? 0) + 1);
    bySigungu.set(s.regionKey, (bySigungu.get(s.regionKey) ?? 0) + 1);
  }

  const dupNames = new Map<string, number>();
  for (const s of stations) dupNames.set(s.name, (dupNames.get(s.name) ?? 0) + 1);
  const dups = [...dupNames.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);

  const lines2: string[] = [];
  lines2.push("# 착한주유소 명단 정규화 리포트\n");
  lines2.push(`- 원본: \`adress.csv\``);
  lines2.push(`- 정규화 성공: **${stations.length}건**`);
  lines2.push(`- 실패: **${failures.length}건**`);
  lines2.push(`- 통합 이전 행정구역 표기: **${anomalies.length}건**`);
  lines2.push(`- 시·군·구 수: ${bySigungu.size}개\n`);

  lines2.push("## 시·도별 분포\n");
  lines2.push("| 시·도 | 주유소 수 |");
  lines2.push("|---|---:|");
  for (const [sido, n] of [...bySido.entries()].sort((a, b) => b[1] - a[1])) {
    lines2.push(`| ${sido} | ${n} |`);
  }

  if (anomalies.length) {
    lines2.push("\n## 통합 이전 행정구역 표기 — 원본 갱신 권장\n");
    lines2.push(
      "광주광역시·전라남도는 **전남광주통합특별시**로 통합되었고 Opinet도 `전남광주`로 " +
      "내려옵니다. 아래 건들은 통합 이전 명칭으로 적혀 있어 자동 보정했습니다. " +
      "집계는 정상 동작하지만 명단 원본을 통합 명칭으로 갱신해 두는 편이 좋습니다.\n",
    );
    lines2.push("| # | 상호 | 주소 | 옛 표기 |");
    lines2.push("|---:|---|---|---|");
    for (const a of anomalies) {
      lines2.push(`| ${a.seq} | ${a.name} | ${a.address} | \`${a.token}\` |`);
    }
  }

  if (failures.length) {
    lines2.push("\n## 정규화 실패 — 수기 확인 필요\n");
    lines2.push("| 원본 행 | 상호 | 주소 | 사유 |");
    lines2.push("|---:|---|---|---|");
    for (const f of failures) {
      lines2.push(`| ${f.line} | ${f.name} | ${f.address} | ${f.reason} |`);
    }
  }

  if (dups.length) {
    lines2.push("\n## 중복 상호 — 이름 매칭 금지 근거\n");
    lines2.push("같은 상호가 여러 지역에 있습니다. 주소 기반으로만 매칭해야 합니다.\n");
    lines2.push("| 상호 | 건수 |");
    lines2.push("|---|---:|");
    for (const [name, n] of dups) lines2.push(`| ${name} | ${n} |`);
  }

  // 표본 부족이 예상되는 시군구 (착한주유소 기준이 아니라 참고용)
  writeFileSync(path.join(OUT_DIR, "normalize-report.md"), lines2.join("\n") + "\n", "utf8");

  console.log(`정규화 완료 — 성공 ${stations.length}건 / 실패 ${failures.length}건 / 비표준표기 ${anomalies.length}건`);
  console.log(`  data/good-stations.json`);
  console.log(`  data/normalize-report.md`);
  if (failures.length) {
    console.log("\n실패 목록:");
    for (const f of failures) console.log(`  행 ${f.line}: ${f.name} — ${f.address}`);
  }
}

main();
