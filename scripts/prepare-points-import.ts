import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  assemblePoints,
  assertPointsJournalExtension,
  type PointsIndex,
  type PointsJournal,
} from "../src/lib/points";
import { loadPublishedPoints, pointsSql } from "./generate-points";

export async function preparePointsImport(
  root: string,
  output: string,
  currentOrigin?: string,
  loadCurrent: () => Promise<PointsJournal | null> = loadPublishedPoints,
) {
  if (currentOrigin !== undefined && currentOrigin !== "https://slop.cash")
    throw new Error("Only the production Points origin is supported");
  const index: PointsIndex = JSON.parse(
    await readFile(join(root, "data/points.json"), "utf8"),
  );
  const parts = await Promise.all(
    Array.from({ length: 16 }, (_, i) =>
      readFile(join(root, `data/points/${i.toString(16)}.json`), "utf8"),
    ),
  );
  const candidate = assemblePoints(index, parts);
  if (currentOrigin !== undefined) {
    const current = await loadCurrent();
    if (!current) throw new Error("Production Points history is unavailable");
    assertPointsJournalExtension(current, candidate);
  }
  await writeFile(output, pointsSql(candidate));
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (
    args.length !== 2 &&
    !(args.length === 4 && args[2] === "--current-origin")
  )
    throw new Error(
      "Usage: prepare-points-import.ts VERIFIED_DIST OUTPUT_SQL [--current-origin https://slop.cash]",
    );
  await preparePointsImport(args[0], args[1], args[3]);
}
