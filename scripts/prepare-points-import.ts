import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assemblePoints, type PointsIndex } from "../src/lib/points";
import { pointsSql } from "./generate-points";

if (process.argv.length !== 4)
  throw new Error("Usage: prepare-points-import.ts VERIFIED_DIST OUTPUT_SQL");
const root = process.argv[2];
const index: PointsIndex = JSON.parse(
  await readFile(join(root, "data/points.json"), "utf8"),
);
const parts = await Promise.all(
  Array.from({ length: 16 }, (_, i) =>
    readFile(join(root, `data/points/${i.toString(16)}.json`), "utf8"),
  ),
);
await writeFile(process.argv[3], pointsSql(assemblePoints(index, parts)));
