import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  UNIT_ROOTS,
  UNIT_SHARDS,
  unitShard,
  unitTestFiles,
} from "./run-unit-shard.mjs";

// The shards replace `bun run test` in CI only if they cover the same roots.
// A root added to the package script without the shard runner would silently
// drop its tests from the sharded run.
test("unit shards cover exactly the roots of bun run test", () => {
  const { scripts } = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  const roots = (scripts.test as string)
    .split(" ")
    .filter((part) => part.startsWith("./"))
    .map((part) => part.slice(2));
  expect(roots).toEqual(UNIT_ROOTS);
  expect(
    new Set(unitTestFiles().map((path: string) => unitShard(path))),
  ).toEqual(new Set(UNIT_SHARDS));
});
