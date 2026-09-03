/**
 * Opinet 「사업자별 과거 판매가격」 파일 파서.
 *
 * OPMS(joongyu01/opms) server/services/oilParser.ts 를 이식했다.
 * 원본은 DB insert 타입까지 만들었지만 여기서는 순수 파싱만 남긴다.
 *
 * 다운로드 파일은 날에 따라 CSV(EUC-KR)로도, XLS로도 내려온다. 둘 다 받는다.
 */
import iconv from "iconv-lite";
import * as XLSX from "xlsx";
import type { StationPriceRow } from "../types.ts";

/** 가격 문자열 → 정수. 0과 빈값은 "취급 안 함"이므로 null. */
function parsePrice(val: string | undefined): number | null {
  if (val == null) return null;
  const n = parseInt(String(val).trim(), 10);
  if (isNaN(n) || n === 0) return null;
  return n;
}

function parsePriceNum(val: unknown): number | null {
  if (val === undefined || val === null || val === "") return null;
  const n = typeof val === "number" ? Math.round(val) : parseInt(String(val).trim(), 10);
  if (isNaN(n) || n === 0) return null;
  return n;
}

/** 지역 컬럼("서울 강남구")의 첫 토큰이 시·도. */
function extractSido(region: string): string {
  return region.trim().split(" ")[0] || region.trim();
}

export function parseOilPriceCSV(buffer: Buffer): StationPriceRow[] {
  const text = iconv.decode(buffer, "EUC-KR");
  const lines = text.split(/\r?\n/);
  const rows: StationPriceRow[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (i === 0) continue;             // 헤더
    if (line.startsWith('"기준')) continue; // "기준일자 : ..." 안내행

    const cols = line.split(",").map((c) => c.replace(/^"|"$/g, "").trim());
    if (cols.length < 11) continue;

    const [stationId, region, stationName, address, date, brand, selfStr,
           premiumRaw, gasolineRaw, dieselRaw, keroseneRaw] = cols;

    if (!stationId || !date || date.length !== 8) continue;

    rows.push({
      stationId,
      stationName,
      address,
      region,
      sido: extractSido(region),
      date,
      brand,
      isSelf: selfStr === "셀프",
      premiumGasoline: parsePrice(premiumRaw),
      gasoline: parsePrice(gasolineRaw),
      diesel: parsePrice(dieselRaw),
      kerosene: parsePrice(keroseneRaw),
    });
  }

  return rows;
}

export function parseOilPriceXLS(buffer: Buffer): StationPriceRow[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];

  // A2 = "기준일자 : 20260327"
  const a2Val = String(sheet["A2"]?.v ?? "").trim();
  const date = a2Val.match(/(\d{8})/)?.[1] ?? "";
  if (!date) console.warn("[parser] XLS A2에서 기준일자 추출 실패:", a2Val);

  // A1=제목 A2=기준일자 A3=공백 A4=헤더 A5~=데이터
  const rows: StationPriceRow[] = [];
  for (let r = 5; ; r++) {
    const idCell = sheet[`A${r}`];
    if (!idCell) break;
    const stationId = String(idCell.v ?? "").trim();
    if (!stationId) break;

    const region = String(sheet[`B${r}`]?.v ?? "").trim();
    rows.push({
      stationId,
      stationName: String(sheet[`C${r}`]?.v ?? "").trim(),
      address: String(sheet[`D${r}`]?.v ?? "").trim(),
      region,
      sido: extractSido(region),
      date,
      brand: String(sheet[`E${r}`]?.v ?? "").trim(),
      isSelf: String(sheet[`F${r}`]?.v ?? "").trim() === "셀프",
      premiumGasoline: parsePriceNum(sheet[`G${r}`]?.v),
      gasoline: parsePriceNum(sheet[`H${r}`]?.v),
      diesel: parsePriceNum(sheet[`I${r}`]?.v),
      kerosene: parsePriceNum(sheet[`J${r}`]?.v),
    });
  }

  return rows;
}

/** 확장자를 모를 때. XLS 시그니처를 보고 갈라준다. */
export function parseOilPriceFile(buffer: Buffer, filename: string): StationPriceRow[] {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".xls") || lower.endsWith(".xlsx")) {
    return parseOilPriceXLS(buffer);
  }
  // XLS(BIFF8) = D0CF11E0, XLSX(zip) = 504B0304
  const sig = buffer.subarray(0, 4).toString("hex").toUpperCase();
  if (sig === "D0CF11E0" || sig === "504B0304") {
    return parseOilPriceXLS(buffer);
  }
  return parseOilPriceCSV(buffer);
}
