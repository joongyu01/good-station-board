/**
 * 수집 원본 보관.
 *
 * 전국 1.1만 건 하루치가 JSON 으로 3.5MB 라 예전에는 커밋하지 않고 버렸다.
 * 그 대가가 컸다 — 판정 방식을 바꿀 때마다 오피넷에서 두 달치를 다시 긁어야
 * 했고, NetFunnel 대기열 때문에 세 시간씩 걸렸다.
 *
 * gzip 을 씌우면 317KB(8.7%)로 줄어 **연 113MB** 다. 저장소가 감당할 만한
 * 크기이고, 원본이 손에 있으면 재계산이 몇 초로 끝난다.
 *
 * 읽을 때는 `.json.gz` 를 먼저 보고 없으면 `.json` 을 본다. 압축 전에 받아둔
 * 파일이 로컬에 남아 있을 수 있다.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import path from "node:path";
import { sameIgnoring } from "./stable-write.ts";

/** 그 날짜의 원본 경로. 없으면 null. */
export function rawPath(dir: string, date: string): string | null {
  const gz = path.join(dir, `${date}.json.gz`);
  if (existsSync(gz)) return gz;
  const plain = path.join(dir, `${date}.json`);
  return existsSync(plain) ? plain : null;
}

export function hasRaw(dir: string, date: string): boolean {
  return rawPath(dir, date) != null;
}

export function readRaw<T>(dir: string, date: string): T | null {
  const p = rawPath(dir, date);
  if (!p) return null;
  const buf = readFileSync(p);
  return JSON.parse(p.endsWith(".gz") ? gunzipSync(buf).toString("utf8") : buf.toString("utf8")) as T;
}

/**
 * 언제나 gzip 으로 쓴다. 압축 안 한 옛 파일이 있으면 남겨 두되 읽기는 gz 가 이긴다.
 *
 * 행이 그대로면 다시 쓰지 않는다. `collectedAt` 이 매번 달라져 같은 자료를
 * 다시 집어도 파일이 바뀌고, 그 탓에 헛커밋이 쌓였다 — stable-write.ts 참고.
 * 이미 gz 가 있을 때만 따진다. 압축 안 한 옛 파일뿐이면 견주지 않고 새로 써서
 * gz 를 만들어 둔다.
 */
export function writeRaw(
  dir: string,
  date: string,
  value: unknown,
): { bytes: number; changed: boolean } {
  const gzPath = path.join(dir, `${date}.json.gz`);

  if (existsSync(gzPath)) {
    try {
      const old = JSON.parse(gunzipSync(readFileSync(gzPath)).toString("utf8"));
      if (sameIgnoring(old, value, ["collectedAt"])) {
        return { bytes: statSync(gzPath).size, changed: false };
      }
    } catch {
      // 읽거나 파싱하지 못하면 견줄 것이 없다. 새로 쓴다.
    }
  }

  const gz = gzipSync(Buffer.from(JSON.stringify(value), "utf8"), { level: 9 });
  writeFileSync(gzPath, gz);
  return { bytes: gz.length, changed: true };
}

/** 보관 중인 날짜 목록. 오름차순. */
export function listRawDates(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out = new Set<string>();
  for (const f of readdirSync(dir)) {
    const m = /^(\d{8})\.json(\.gz)?$/.exec(f);
    if (m) out.add(m[1]);
  }
  return [...out].sort();
}
