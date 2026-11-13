import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { resolve } from "node:path";
import { startHandlerWorker } from "../../tests/miniflare-d1.mjs";

// The Slopbot GitHub client in the Workers runtime (workerd), along the path
// a review takes: App JWT, installation token, then a repository read
// (review.ts loadContext). Bun and Node accept a bare fetch called as an
// object's method; workerd does not, so only this runtime proves the client.
// The App key, token and GitHub answers are synthetic and served locally.
const key = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ format: "pem", type: "pkcs8" })
  .toString();
const token = "ghs_synthetic_slopbot_client_fixture_only";
const repository = { id: 7, node_id: "R_fixture", full_name: "example/tools" };
const requests = [];
const worker = await startHandlerWorker({
  async outbound(request) {
    const url = new URL(request.url);
    assert.equal(url.origin, "https://api.github.com");
    requests.push(`${request.method} ${url.pathname}`);
    if (url.pathname === "/app/installations/42/access_tokens")
      return Response.json({ token }, { status: 201 });
    assert.equal(request.headers.get("authorization"), `Bearer ${token}`);
    if (url.pathname === "/repos/example/tools")
      return Response.json(repository);
    return new Response(null, { status: 404 });
  },
  entrySource: `
import {GitHubClient} from ${JSON.stringify(resolve("workers/slopbot/github.ts"))};
export default {async fetch() {
  try {
    const github = await GitHubClient.forInstallation("1", ${JSON.stringify(key)}, 42);
    return Response.json({ok: true, repository: await github.get("/repos/example/tools")});
  } catch (error) {
    return Response.json({ok: false, error: String(error)});
  }
}};`,
});
try {
  const response = await worker.runtime.dispatchFetch("http://local/");
  assert.deepEqual(await response.json(), { ok: true, repository });
  assert.deepEqual(requests, [
    "POST /app/installations/42/access_tokens",
    "GET /repos/example/tools",
  ]);
  console.log("Slopbot GitHub client: workerd installation read passed");
} finally {
  await worker.dispose();
}
