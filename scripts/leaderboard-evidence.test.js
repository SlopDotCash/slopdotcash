import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  encodeLeaderboardParts,
  readLeaderboardBytes,
} from "../src/lib/leaderboard-transport.mjs";
import {
  PRIMARY_REPOSITORY,
  TARGET_REPOSITORIES,
} from "../src/lib/repositories.mjs";
import {
  assertLiveLedgerReady,
  verifyRemoteArtifacts,
} from "./evidence-contract.mjs";

test("evidence accepts reconstructed byte arrays exactly as the original JSON buffer", async () => {
  const now = new Date().toISOString();
  const ledger = {
    schemaVersion: "6",
    repository: PRIMARY_REPOSITORY?.id ?? null,
    repositories: TARGET_REPOSITORIES.map((r) => ({ id: r.id })),
    stale: false,
    generatedAt: now,
    source: {
      provider: "github-graphql",
      fetchedAt: now,
      requestCount: 1,
      counts: { mergedPullRequests: 1, openIssues: 1, openPullRequests: 1 },
    },
    leaders: [{}],
    ledger: [{}],
    workQueue: { issues: [{}], pullRequests: [{}] },
  };
  const original = Buffer.from(
    " ".repeat(26 * 1024 * 1024) + JSON.stringify(ledger),
  );
  const encoded = encodeLeaderboardParts(original);
  const restored = await readLeaderboardBytes(
    encoded.root,
    async (path) => encoded.parts.find((p) => p.path === path).bytes,
  );
  expect(Buffer.compare(original, restored)).toBe(0);
  expect(assertLiveLedgerReady(restored, { now: Date.parse(now) })).toEqual(
    assertLiveLedgerReady(original, { now: Date.parse(now) }),
  );
});

test("release evidence verifies referenced part bytes and refuses changed or redirected content", async () => {
  const contents = Buffer.from("retained leaderboard bytes");
  const digest = createHash("sha256").update(contents).digest("hex");
  const artifact = { path: `data/leaderboard/${digest}.part`, contents };
  const response = (body) => Response.json(body);
  const request = async () =>
    new Response(contents, {
      headers: { "content-type": "application/octet-stream" },
    });
  await expect(
    verifyRemoteArtifacts({
      artifacts: [artifact],
      cacheKey: "test",
      fetchImpl: request,
    }),
  ).resolves.toHaveLength(1);
  await expect(
    verifyRemoteArtifacts({
      artifacts: [artifact],
      cacheKey: "test",
      fetchImpl: async () => response("changed"),
    }),
  ).rejects.toThrow();
  await expect(
    verifyRemoteArtifacts({
      artifacts: [{ ...artifact, path: "data/leaderboard/../../other.part" }],
      cacheKey: "test",
      fetchImpl: request,
    }),
  ).rejects.toThrow("invalid artifact");
});
