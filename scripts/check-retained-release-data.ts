/** Verify retained data under the production publication lock before writes. */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readBoundedJson } from "../src/lib/browser-json";
import { assertLeaderboardSnapshot } from "../src/lib/leaderboard";
import { readLeaderboardBytes } from "../src/lib/leaderboard-transport.mjs";
import type { ProfileIndex } from "../src/lib/profiles";
import { isExactUtc } from "../src/lib/record-validation.mjs";
import { downloadLeaderboard } from "./download-leaderboard";
import { assertRetainedProfiles } from "./published-profiles";

export function assertRetainedReleaseTimes(
  retained: { leaderboard: string; profiles: string },
  published: { leaderboard: string; profiles: string },
) {
  for (const name of ["leaderboard", "profiles"] as const) {
    if (!isExactUtc(retained[name]) || !isExactUtc(published[name]))
      throw new Error(`Invalid ${name} generation time`);
    const before = Date.parse(retained[name]);
    const current = Date.parse(published[name]);
    if (before < current)
      throw new Error(`Retained ${name} is older than current publication`);
  }
}

export async function checkRetainedReleaseData(
  directory: string,
  request: typeof fetch = fetch,
) {
  const root = resolve(directory);
  const retainedLeaderboard = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(
      await readLeaderboardBytes(
        new Uint8Array(await readFile(join(root, "data/leaderboard.json"))),
        async (path: string) =>
          new Uint8Array(await readFile(join(root, path))),
      ),
    ),
  );
  const retainedProfiles = JSON.parse(
    await readFile(join(root, "data/profiles.json"), "utf8"),
  );
  assertLeaderboardSnapshot(retainedLeaderboard);
  assertRetainedProfiles(retainedProfiles);
  const temporary = await mkdtemp(join(tmpdir(), "slop-release-freshness-"));
  try {
    const path = join(temporary, "leaderboard.json");
    await downloadLeaderboard("https://slop.cash/data/leaderboard.json", path, {
      request,
    });
    const publishedLeaderboard = JSON.parse(await readFile(path, "utf8"));
    assertLeaderboardSnapshot(publishedLeaderboard);
    const url = new URL("https://slop.cash/data/profiles.json");
    url.searchParams.set("snapshot", crypto.randomUUID());
    const response = await request(url, {
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error("Published profiles unavailable");
    const publishedProfiles = (await readBoundedJson(
      response,
      25 * 1024 * 1024,
      "profiles",
    )) as ProfileIndex;
    assertRetainedProfiles(publishedProfiles);
    assertRetainedReleaseTimes(
      {
        leaderboard: retainedLeaderboard.generatedAt,
        profiles: retainedProfiles.generatedAt,
      },
      {
        leaderboard: publishedLeaderboard.generatedAt,
        profiles: publishedProfiles.generatedAt,
      },
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  if (process.argv.length !== 3)
    throw new Error("Expected checked bundle path");
  await checkRetainedReleaseData(process.argv[2]);
  console.log("Retained production data is current");
}
