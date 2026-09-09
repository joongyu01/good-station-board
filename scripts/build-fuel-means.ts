/** Add per-fuel historical means from retained raw only. Does not change prices/signals. */
import { readFileSync, writeFileSync } from "node:fs";
import { readRaw } from "../src/lib/raw.ts";
import { mergeRegionFuelMean, type History, type regionMeanOf } from "../src/lib/history.ts";
const file = new URL("../data/history.json", import.meta.url);
const rawDir = new URL("../data/raw/", import.meta.url);
import { fileURLToPath } from "node:url";
const history: History = JSON.parse(readFileSync(file, "utf8"));
const before = JSON.stringify({ ...history, regionFuelMean: undefined });
for (const date of history.dates) {
  const raw = readRaw<{ rows: Parameters<typeof regionMeanOf>[0] }>(fileURLToPath(rawDir), date);
  if (!raw) throw new Error(`Missing raw: ${date}`);
  mergeRegionFuelMean(history, date, raw.rows);
}
if (JSON.stringify({ ...history, regionFuelMean: undefined }) !== before) throw new Error("Unrelated history changed");
writeFileSync(file, JSON.stringify(history));
writeFileSync(new URL("../client/public/data/history.json", import.meta.url), JSON.stringify(history));
console.log(`Added fuel means for ${history.dates.length} dates; existing history unchanged.`);
