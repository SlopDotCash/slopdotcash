import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { verifyRemoteArtifacts } from "./evidence-contract.mjs";

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
