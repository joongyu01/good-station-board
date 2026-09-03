/**
 * 3단계 — 착한주유소 449건 ↔ Opinet 주유소 코드 매칭
 *
 *   data/good-stations.json + data/station-index.json
 *     → data/station-mapping.json   (확정 매핑)
 *     → data/match-report.md        (수기 확인 대상)
 *
 * 매칭 순서 (앞에서 확정되면 뒤는 보지 않는다)
 *   1. manual        data/manual-mapping.json 에 사람이 적어둔 값 — 무조건 우선
 *   2. address       같은 시군구 + 도로명 + 건물번호 일치
 *   2-b. address-sido 시·도 + 도로명 + 건물번호 일치 — 시군구 개편 구제
 *   3. name-exact    같은 시군구 + 상호 완전 일치 (후보가 정확히 1개일 때만)
 *   4. name-fuzzy    같은 시군구 + 상호 유사도 0.82 이상 (후보 1개일 때만)
 *   5. name-sido     같은 시·도 + 상호 완전 일치 (후보 1개)
 *
 * 후보가 2개 이상이면 자동 확정하지 않는다. 틀린 주유소에 신호등을 달면
 * 안 다느니만 못하다. 애매한 건 전부 리포트로 넘긴다.
 *
 * 실행: npm run match
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseRoadAddress, addressKey, sidoAddressKey, normalizeName, similarity,
  FUZZY_THRESHOLD, METHOD_SCORE, type MatchMethod,
} from "../src/lib/match.ts";
import { regionKey } from "../src/lib/region.ts";
import type { GoodStation } from "../src/lib/types.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");

interface IndexEntry {
  name: string; address: string; region: string;
  sido: string; sigungu: string; brand: string;
}

interface Resolved {
  seq: number;
  stationId: string | null;
  method: MatchMethod;
  score: number;
  /** 후보가 여럿이라 보류한 경우 */
  candidates?: Array<{ stationId: string; name: string; address: string }>;
}

function main() {
  const goodPath = path.join(DATA, "good-stations.json");
  const indexPath = path.join(DATA, "station-index.json");

  if (!existsSync(goodPath)) {
    console.error("data/good-stations.json 이 없습니다. 먼저 `npm run normalize`.");
    process.exit(1);
  }
  if (!existsSync(indexPath)) {
    console.error("data/station-index.json 이 없습니다. 먼저 `npm run collect`.");
    process.exit(1);
  }

  const good: GoodStation[] = JSON.parse(readFileSync(goodPath, "utf8"));
  const index: Record<string, IndexEntry> = JSON.parse(readFileSync(indexPath, "utf8"));

  const manualPath = path.join(DATA, "manual-mapping.json");
  const manual: Record<string, string> = existsSync(manualPath)
    ? JSON.parse(readFileSync(manualPath, "utf8"))
    : {};

  // ── Opinet 쪽 인덱스 3종 구성 ────────────────────────────────────────
  const byAddress = new Map<string, string[]>();               // regionKey|road|bldg → stationIds
  const bySidoAddress = new Map<string, string[]>();           // sido|road|bldg → stationIds
  const byRegionName = new Map<string, string[]>();            // regionKey|normName → stationIds
  const bySidoName = new Map<string, string[]>();              // sido|normName → stationIds
  const byRegion = new Map<string, string[]>();                // regionKey → stationIds

  for (const [id, e] of Object.entries(index)) {
    const rk = regionKey(e.sido, e.sigungu);
    const road = parseRoadAddress(e.address);
    if (road) {
      push(byAddress, addressKey(rk, road), id);
      push(bySidoAddress, sidoAddressKey(e.sido, road), id);
    }

    const nn = normalizeName(e.name);
    push(byRegionName, `${rk}|${nn}`, id);
    push(bySidoName, `${e.sido}|${nn}`, id);
    push(byRegion, rk, id);
  }

  // ── 매칭 ────────────────────────────────────────────────────────────
  const resolved: Resolved[] = [];

  for (const s of good) {
    // 1. 수기 지정
    const manualId = manual[String(s.seq)];
    if (manualId) {
      resolved.push({ seq: s.seq, stationId: manualId, method: "manual", score: 100 });
      continue;
    }

    // 2. 도로명 + 건물번호
    const road = parseRoadAddress(s.address);
    if (road) {
      const hits = byAddress.get(addressKey(s.regionKey, road));
      if (hits && hits.length === 1) {
        resolved.push({ seq: s.seq, stationId: hits[0], method: "address", score: 100 });
        continue;
      }
      if (hits && hits.length > 1) {
        // 한 건물번호에 주유소가 둘일 수는 없다. 상호로 갈라본다.
        const nn = normalizeName(s.name);
        const narrowed = hits.filter((id) => normalizeName(index[id].name) === nn);
        if (narrowed.length === 1) {
          resolved.push({ seq: s.seq, stationId: narrowed[0], method: "address", score: 100 });
          continue;
        }
      }
    }

    // 2-b. 시군구는 어긋나도 시·도 + 도로명 + 건물번호가 맞으면 같은 곳으로 본다.
    //      인천 서구 → 검단구·서해구 분구처럼 명단이 개편을 못 따라간 경우를 구제한다.
    if (road) {
      const hits = bySidoAddress.get(sidoAddressKey(s.sido, road));
      if (hits && hits.length === 1) {
        resolved.push({ seq: s.seq, stationId: hits[0], method: "address-sido", score: 95 });
        continue;
      }
    }

    const nn = normalizeName(s.name);

    // 3. 같은 시군구 + 상호 완전 일치
    const exact = byRegionName.get(`${s.regionKey}|${nn}`);
    if (exact && exact.length === 1) {
      resolved.push({ seq: s.seq, stationId: exact[0], method: "name-exact", score: 85 });
      continue;
    }

    // 4. 같은 시군구 + 상호 유사
    const regionIds = byRegion.get(s.regionKey) ?? [];
    const scored = regionIds
      .map((id) => ({ id, sim: similarity(nn, normalizeName(index[id].name)) }))
      .filter((c) => c.sim >= FUZZY_THRESHOLD)
      .sort((a, b) => b.sim - a.sim);

    if (scored.length === 1) {
      resolved.push({
        seq: s.seq, stationId: scored[0].id, method: "name-fuzzy",
        score: Math.round(scored[0].sim * 100),
      });
      continue;
    }
    // 1등이 2등보다 확실히 앞서면 채택
    if (scored.length > 1 && scored[0].sim - scored[1].sim >= 0.08) {
      resolved.push({
        seq: s.seq, stationId: scored[0].id, method: "name-fuzzy",
        score: Math.round(scored[0].sim * 100),
      });
      continue;
    }

    // 5. 같은 시·도 + 상호 완전 일치 (시군구 표기가 어긋난 경우 구제)
    const sidoHits = bySidoName.get(`${s.sido}|${nn}`);
    if (sidoHits && sidoHits.length === 1) {
      resolved.push({ seq: s.seq, stationId: sidoHits[0], method: "name-sido", score: 70 });
      continue;
    }

    // 보류 — 후보를 리포트에 실어 사람이 고르게 한다.
    const cands = (scored.length ? scored.map((c) => c.id) : (exact ?? sidoHits ?? []))
      .slice(0, 5)
      .map((id) => ({ stationId: id, name: index[id].name, address: index[id].address }));

    resolved.push({
      seq: s.seq, stationId: null, method: "unmatched",
      score: 0, candidates: cands.length ? cands : undefined,
    });
  }

  // ── 산출물 ──────────────────────────────────────────────────────────
  const mapping: Record<string, { stationId: string; method: MatchMethod; score: number }> = {};
  for (const r of resolved) {
    if (r.stationId) mapping[String(r.seq)] = { stationId: r.stationId, method: r.method, score: r.score };
  }
  writeFileSync(path.join(DATA, "station-mapping.json"), JSON.stringify(mapping, null, 2), "utf8");

  const byMethod = new Map<MatchMethod, number>();
  for (const r of resolved) byMethod.set(r.method, (byMethod.get(r.method) ?? 0) + 1);

  const matched = resolved.filter((r) => r.stationId).length;
  const unmatched = resolved.filter((r) => !r.stationId);
  const lowConf = resolved.filter((r) => r.stationId && r.score < METHOD_SCORE["name-exact"]);

  const bySeq = new Map(good.map((g) => [g.seq, g]));
  const out: string[] = [];
  out.push("# 착한주유소 ↔ Opinet 코드 매칭 리포트\n");
  out.push(`- 전체: **${good.length}건**`);
  out.push(`- 매칭 성공: **${matched}건** (${((matched / good.length) * 100).toFixed(1)}%)`);
  out.push(`- 미매칭: **${unmatched.length}건**`);
  out.push(`- 저신뢰(수기 확인 권장): **${lowConf.length}건**\n`);

  out.push("## 매칭 방법별\n");
  out.push("| 방법 | 건수 | 설명 |");
  out.push("|---|---:|---|");
  const desc: Record<string, string> = {
    manual: "사람이 직접 지정",
    address: "도로명 + 건물번호 일치",
    "address-sido": "시·도 + 도로명 + 건물번호 일치 (시군구 개편 구제)",
    "name-exact": "같은 시군구 + 상호 완전 일치",
    "name-fuzzy": "같은 시군구 + 상호 유사",
    "name-sido": "같은 시·도 + 상호 완전 일치",
    unmatched: "미매칭",
  };
  for (const [m, n] of [...byMethod.entries()].sort((a, b) => b[1] - a[1])) {
    out.push(`| \`${m}\` | ${n} | ${desc[m] ?? ""} |`);
  }

  if (unmatched.length) {
    out.push("\n## 미매칭 — 수기 확인 필요\n");
    out.push("아래 `seq`를 `data/manual-mapping.json` 에 `\"seq\": \"주유소코드\"` 로 적으면 다음 실행부터 반영됩니다.\n");
    out.push("| seq | 상호 | 주소 | 후보 |");
    out.push("|---:|---|---|---|");
    for (const r of unmatched) {
      const g = bySeq.get(r.seq)!;
      const cand = r.candidates?.length
        ? r.candidates.map((c) => `\`${c.stationId}\` ${c.name}`).join("<br>")
        : "_후보 없음_";
      out.push(`| ${r.seq} | ${g.name} | ${g.address} | ${cand} |`);
    }
  }

  if (lowConf.length) {
    out.push("\n## 저신뢰 매칭 — 검토 권장\n");
    out.push("| seq | 명단 상호 | Opinet 상호 | 방법 | 점수 |");
    out.push("|---:|---|---|---|---:|");
    for (const r of lowConf) {
      const g = bySeq.get(r.seq)!;
      const e = index[r.stationId!];
      out.push(`| ${r.seq} | ${g.name} | ${e?.name ?? "?"} | \`${r.method}\` | ${r.score} |`);
    }
  }

  writeFileSync(path.join(DATA, "match-report.md"), out.join("\n") + "\n", "utf8");

  console.log(`매칭 완료 — ${matched}/${good.length}건 (${((matched / good.length) * 100).toFixed(1)}%)`);
  for (const [m, n] of [...byMethod.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${m.padEnd(12)} ${n}`);
  }
  console.log(`\n  data/station-mapping.json`);
  console.log(`  data/match-report.md`);
  if (unmatched.length) {
    console.log(`\n미매칭 ${unmatched.length}건은 data/match-report.md 를 보고 data/manual-mapping.json 에 적어주세요.`);
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}

main();
