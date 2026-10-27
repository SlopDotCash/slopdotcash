// A local development origin is accepted only when loopback is switched on
// explicitly. Production and staging behavior must not change.
import { expect, test } from "bun:test";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { randomToken } from "./crypto";
import { handleIdentityRequest } from "./handler";
import { D1IdentityPersistence } from "./persistence";

const LOCAL = "http://localhost:4466";

function worker(allowLoopback: boolean) {
  const { db } = sqliteD1();
  const dependencies = {
    persistence: new D1IdentityPersistence(db as never),
    stateEncryptionSecret: Buffer.alloc(32, 1).toString("base64url"),
    assertionSecret: Buffer.alloc(32, 2).toString("base64url"),
    githubClientId: "Iv1.localfixture",
    publicOrigin: LOCAL,
    allowLoopback,
    now: () => new Date(),
    randomToken,
    resolveGithubIdentity: async () => null,
  };
  return (origin: string) =>
    handleIdentityRequest(
      new Request(`${LOCAL}/v1/oauth/start`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ audience: "slop-points-web" }),
      }),
      dependencies,
    );
}

test("the identity Worker accepts a local origin over HTTP only when enabled", async () => {
  // Without the switch a local origin is not a valid identity origin at all.
  await expect(worker(false)(LOCAL)).rejects.toThrow(
    "Unsupported identity public origin",
  );
  const allowed = await worker(true)(LOCAL);
  expect(allowed.status).toBe(201);
  expect(allowed.headers.get("access-control-allow-origin")).toBe(LOCAL);
  const body = (await allowed.json()) as { authorizationUrl: string };
  expect(body.authorizationUrl.startsWith(`${LOCAL}/v1/oauth/authorize?`)).toBe(
    true,
  );
  // A page on any other origin, including the production site, is refused.
  for (const origin of ["https://slop.cash", "http://localhost:9999"])
    expect((await worker(true)(origin)).status).toBe(403);
});
