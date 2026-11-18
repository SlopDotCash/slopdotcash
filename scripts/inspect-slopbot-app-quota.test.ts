import { expect, test } from "bun:test";
import { createHash, generateKeyPairSync } from "node:crypto";
import { observe } from "./inspect-slopbot-app-quota";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ format: "pem", type: "pkcs8" })
  .toString();
const project = {
  id: "example",
  status: "active",
  authority: { repositoryId: "12", repositoryNodeId: "repo-12" },
  repositories: [{ id: "sample/example" }],
};
const sha = createHash("sha256").update(JSON.stringify(project)).digest("hex");
const env = {
  SLOP_QUOTA_PROJECT: "example",
  SLOP_QUOTA_MANIFEST_SHA256: sha,
  SLOP_QUOTA_PLAN_SHA256: "a".repeat(64),
  SLOPBOT_APP_ID: "44",
  SLOPBOT_APP_PRIVATE_KEY: pem,
};
const repo = {
  id: 12,
  node_id: "repo-12",
  private: false,
  full_name: "sample/example",
};
const reset = Math.floor(Date.now() / 1000) + 1800;
const signer = async (id: string, key: string) => {
  expect(id).toBe("44");
  expect(key.startsWith("-----BEGIN PRIVATE KEY-----")).toBe(true);
  return "fixture-jwt";
};
function fixture(refusal = "") {
  const calls: string[] = [];
  const transport = Object.assign(
    async (input: string | URL | Request, config?: RequestInit) => {
      const spec = new URL(String(input));
      calls.push(spec.pathname);
      if (spec.host === "slop.cash")
        return Response.json({ project, manifestSha256: sha });
      expect(spec.host).toBe("api.github.com");
      expect(config?.redirect).toBe("error");
      const auth = new Headers(config?.headers).get("authorization");
      switch (spec.pathname) {
        case "/repos/sample/example/installation":
          expect(auth).toBe("Bearer fixture-jwt");
          return Response.json({
            id: 78,
            app_id: refusal === "app-id" ? 45 : 44,
          });
        case "/app/installations/78/access_tokens":
          expect(auth).toBe("Bearer fixture-jwt");
          return Response.json({
            token: "fixture-token",
            expires_at: new Date(Date.now() + 3_000_000).toISOString(),
          });
      }
      expect(auth).toBe("Bearer fixture-token");
      switch (spec.pathname) {
        case "/rate_limit":
          return Response.json({
            resources: {
              core: { limit: 5000, remaining: 4999, used: 1, reset },
            },
          });
        case "/installation/repositories":
          expect(spec.search).toBe("?per_page=100&page=1");
          return Response.json({
            total_count: 1,
            repositories: [
              refusal === "repository" ? { ...repo, id: 13 } : repo,
            ],
          });
        case "/repos/sample/example":
          return Response.json(repo, {
            headers: {
              "x-ratelimit-limit": "5000",
              "x-ratelimit-remaining": "4997",
              "x-ratelimit-used": "3",
              "x-ratelimit-reset": String(
                reset + (refusal === "reset" ? 30 : 0),
              ),
            },
          });
        case "/graphql":
          expect(config?.method).toBe("POST");
          return Response.json({
            data: {
              repository: {
                id: "repo-12",
                isPrivate: false,
                nameWithOwner: "sample/example",
              },
              rateLimit: {
                cost: 1,
                limit: 5000,
                remaining: refusal === "graphql" ? 5001 : 4999,
                resetAt: new Date(reset * 1000).toISOString(),
              },
            },
          });
        default:
          throw new Error("unexpected request");
      }
    },
    { preconnect() {} },
  ) as typeof fetch;
  return { calls, transport };
}

test("returns only binding and same-token quota fields", async () => {
  const { calls, transport } = fixture();
  const receipt = await observe(env, transport, signer);
  expect(receipt.effectiveCore.remaining).toBe(4997);
  expect(receipt.installationPageOne.matched).toBe(true);
  expect(receipt.repository.databaseId).toBe(12);
  expect(calls.length).toBe(7);
  expect(receipt.productionWrites).toBe(false);
  const bytes = JSON.stringify(receipt);
  expect(bytes).not.toContain("fixture-token");
  expect(bytes).not.toContain("fixture-jwt");
  expect(bytes).not.toContain("PRIVATE KEY");
});

for (const refusal of ["app-id", "repository", "reset", "graphql"]) {
  test(`refuses inconsistent ${refusal}`, async () => {
    const { transport } = fixture(refusal);
    await expect(observe(env, transport, signer)).rejects.toThrow(
      "quota witness refused",
    );
  });
}
