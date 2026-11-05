/**
 * Publication order for the leaderboard snapshot file: a run that started
 * earlier but finishes later must never replace a newer published snapshot
 * with its older one. Newer and equal republication stays allowed, and a
 * target that does not hold a readable snapshot never blocks recovery.
 */
import { afterEach, expect, setSystemTime, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createLeaderboardSnapshot,
  type LeaderboardSnapshot,
} from "../src/lib/leaderboard";
import { penaltyScoreInput } from "../tests/penalty-score-fixture";
import {
  type GeneratorDependencies,
  type GraphqlExecutor,
  runGenerator,
  writeLeaderboardAtomically,
} from "./generate-leaderboard";

const T_OLD = "2026-11-20T00:00:00.000Z";
const T_NEW = "2026-11-21T00:00:00.000Z";
const snap = (generatedAt: string): LeaderboardSnapshot =>
  createLeaderboardSnapshot(penaltyScoreInput([], generatedAt));
const bytes = (snapshot: LeaderboardSnapshot) =>
  `${JSON.stringify(snapshot)}\n`;

const client = {} as unknown as GraphqlExecutor;
const deps = (
  generate: GeneratorDependencies["generate"],
): GeneratorDependencies => ({
  getToken: async () => "test-token",
  createClient: () => client,
  generate,
  write: writeLeaderboardAtomically,
});

const workdirs: string[] = [];
async function workdir(): Promise<string> {
  const dir = await mkdtemp(join(process.cwd(), "snapshot-publication-order-"));
  workdirs.push(dir);
  return dir;
}
afterEach(async () => {
  setSystemTime();
  for (const dir of workdirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});

test("an older snapshot cannot replace a newer published snapshot", async () => {
  setSystemTime(new Date("2026-11-22T00:00:00.000Z"));
  const target = join(await workdir(), "leaderboard.json");
  await writeLeaderboardAtomically(snap(T_NEW), target);
  await expect(writeLeaderboardAtomically(snap(T_OLD), target)).rejects.toThrow(
    "refusing to replace it with an older snapshot",
  );
  expect(await readFile(target, "utf8")).toBe(bytes(snap(T_NEW)));
  expect(
    (await readdir(join(target, ".."))).filter((name) => name.endsWith(".tmp")),
  ).toEqual([]);
});

test("a newer snapshot replaces an older one, and an equal one republishes", async () => {
  setSystemTime(new Date("2026-11-22T00:00:00.000Z"));
  const target = join(await workdir(), "leaderboard.json");
  await writeLeaderboardAtomically(snap(T_OLD), target);
  await writeLeaderboardAtomically(snap(T_NEW), target);
  expect(await readFile(target, "utf8")).toBe(bytes(snap(T_NEW)));
  await writeLeaderboardAtomically(snap(T_NEW), target);
  expect(await readFile(target, "utf8")).toBe(bytes(snap(T_NEW)));
});

test("an existing file that is not a readable snapshot does not block publication", async () => {
  setSystemTime(new Date("2026-11-22T00:00:00.000Z"));
  const target = join(await workdir(), "leaderboard.json");
  await writeFile(target, "not a snapshot\n");
  await writeLeaderboardAtomically(snap(T_OLD), target);
  expect(await readFile(target, "utf8")).toBe(bytes(snap(T_OLD)));
});

test("overlapping runs keep the newer snapshot and fail the stale run loudly", async () => {
  setSystemTime(new Date("2026-11-22T00:00:00.000Z"));
  const target = join(await workdir(), "leaderboard.json");
  const slowOld = runGenerator(
    target,
    deps(async () => {
      await new Promise((done) => setTimeout(done, 80));
      return snap(T_OLD);
    }),
  );
  const fastNew = runGenerator(
    target,
    deps(async () => snap(T_NEW)),
  );
  const [oldResult, newResult] = await Promise.allSettled([slowOld, fastNew]);
  expect(newResult.status).toBe("fulfilled");
  expect(oldResult.status).toBe("rejected");
  if (oldResult.status === "rejected")
    expect(String(oldResult.reason)).toContain(
      "refusing to replace it with an older snapshot",
    );
  const final = JSON.parse(
    await readFile(target, "utf8"),
  ) as LeaderboardSnapshot;
  expect(final.generatedAt).toBe(T_NEW);
});

test("concurrent writes under a frozen clock keep the newer snapshot", async () => {
  // A frozen clock used to make both calls share one temporary path, so the
  // second rename failed with ENOENT — and a stale run that had already
  // passed its guard could rename its older snapshot over the newer one.
  // Writers for one path now serialize and use a unique temporary path each.
  setSystemTime(new Date("2026-11-22T00:00:00.000Z"));
  const target = join(await workdir(), "leaderboard.json");
  const results = await Promise.allSettled([
    writeLeaderboardAtomically(snap(T_OLD), target),
    writeLeaderboardAtomically(snap(T_NEW), target),
  ]);
  expect(results[1].status).toBe("fulfilled");
  for (const result of results) {
    if (result.status === "rejected")
      expect(String(result.reason)).not.toContain("ENOENT");
  }
  const final = JSON.parse(
    await readFile(target, "utf8"),
  ) as LeaderboardSnapshot;
  expect(final.generatedAt).toBe(T_NEW);
  expect(
    (await readdir(join(target, ".."))).filter((name) => name.endsWith(".tmp")),
  ).toEqual([]);
});
