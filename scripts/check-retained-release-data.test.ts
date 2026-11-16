import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLeaderboardSnapshot } from "../src/lib/leaderboard";
import { encodeLeaderboardParts } from "../src/lib/leaderboard-transport.mjs";
import { TARGET_REPOSITORIES } from "../src/lib/repositories.mjs";
import { penaltyScoreInput } from "../tests/penalty-score-fixture";
import {
  assertRetainedReleaseTimes,
  checkRetainedReleaseData,
} from "./check-retained-release-data";
import { extendPublishedProfiles } from "./extend-published-profiles";

const older = "2026-11-15T00:00:00.000Z";
const newer = "2026-11-16T00:00:00.000Z";
for (const kind of ["leaderboard", "profiles"] as const) {
  test(`refuses a retained ${kind} older than publication`, () => {
    expect(() =>
      assertRetainedReleaseTimes(
        { leaderboard: newer, profiles: newer, [kind]: older },
        { leaderboard: newer, profiles: newer },
      ),
    ).toThrow(`Retained ${kind} is older`);
  });
}

test("equal and newer retained generation times pass", () => {
  expect(() =>
    assertRetainedReleaseTimes(
      { leaderboard: newer, profiles: newer },
      { leaderboard: older, profiles: newer },
    ),
  ).not.toThrow();
  expect(() =>
    assertRetainedReleaseTimes(
      { leaderboard: "invalid", profiles: newer },
      { leaderboard: older, profiles: newer },
    ),
  ).toThrow("Invalid leaderboard");
});

test("normal read accepts registry-extended profiles and refuses newer live profiles", async () => {
  const directory = await mkdtemp(join(tmpdir(), "retained-release-test-"));
  try {
    const leaderboard = createLeaderboardSnapshot(penaltyScoreInput([], newer));
    const profiles = {
      schemaVersion: "2" as const,
      startedAt: older,
      generatedAt: older,
      repositories: TARGET_REPOSITORIES.slice(0, 1).map((row) => ({
        repository: row.id,
        count: 0,
        excluded: 0,
      })),
      people: [],
      issues: {
        firstObservedAt: older,
        repositories: TARGET_REPOSITORIES.slice(0, 1).map((row) => ({
          repository: row.id,
          count: 0,
        })),
        items: [],
      },
    };
    const extended = extendPublishedProfiles(profiles).census;
    await mkdir(join(directory, "data"));
    await writeFile(
      join(directory, "data/leaderboard.json"),
      JSON.stringify(leaderboard),
    );
    await writeFile(
      join(directory, "data/profiles.json"),
      JSON.stringify(extended),
    );
    let publishedProfiles = profiles;
    const request = (async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.redirect).toBe("error");
      expect(init?.cache).toBe("no-store");
      const url = new URL(String(input));
      expect(url.origin).toBe("https://slop.cash");
      return Response.json(
        url.pathname.endsWith("profiles.json")
          ? publishedProfiles
          : leaderboard,
      );
    }) as typeof fetch;
    await expect(
      checkRetainedReleaseData(directory, request),
    ).resolves.toBeUndefined();
    const sharded = encodeLeaderboardParts(
      new TextEncoder().encode(
        JSON.stringify(leaderboard) + " ".repeat(26 * 1024 * 1024),
      ),
    );
    await mkdir(join(directory, "data/leaderboard"));
    for (const part of sharded.parts)
      await writeFile(join(directory, part.path), part.bytes);
    await writeFile(join(directory, "data/leaderboard.json"), sharded.root);
    await expect(
      checkRetainedReleaseData(directory, request),
    ).resolves.toBeUndefined();
    publishedProfiles = { ...profiles, generatedAt: newer };
    await expect(checkRetainedReleaseData(directory, request)).rejects.toThrow(
      "Retained profiles is older",
    );
    const unavailable = Object.assign(
      async () => new Response(null, { status: 403 }),
      { preconnect: fetch.preconnect },
    );
    await expect(
      checkRetainedReleaseData(directory, unavailable),
    ).rejects.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
