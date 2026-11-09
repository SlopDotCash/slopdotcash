import assert from "node:assert/strict";
import { resolve } from "node:path";
import { startHandlerWorker } from "../../tests/miniflare-d1.mjs";
import { applicationManifest } from "../../tests/project-application-manifest.ts";

// Real Workers fetch and the monthly verifier; synthetic GitHub facts only.
const project = applicationManifest("monthly-native", "example/monthly-native");
const actor = { githubId: "900000002", githubLogin: "fixture-maintainer" };
const token = "ghs_synthetic_monthly_authority_fixture";
const state = { permission: "write", repositoryId: 123456789, redirect: false };
const requests = [];
let worker;
try {
  worker = await startHandlerWorker({
    outbound(request) {
      const url = new URL(request.url);
      assert.equal(url.origin, "https://api.github.com");
      assert.equal(request.method, "GET");
      assert.equal(request.headers.get("authorization"), `Bearer ${token}`);
      requests.push(url.pathname);
      if (state.redirect)
        return new Response(null, {
          status: 302,
          headers: { location: "https://redirect.invalid/elsewhere" },
        });
      if (url.pathname === "/repos/example/monthly-native")
        return Response.json({
          id: state.repositoryId,
          node_id: "R_example",
          owner: {
            id: 987654321,
            node_id: "O_example",
            login: "example",
            type: "Organization",
          },
        });
      assert.equal(
        url.pathname,
        "/repos/example/monthly-native/collaborators/fixture-maintainer/permission",
      );
      return Response.json({
        permission: state.permission,
        user: { id: Number(actor.githubId) },
      });
    },
    entrySource: `
import { verifyProjectAuthority } from ${JSON.stringify(resolve("backend/payments/monthly.ts"))};
export default { async fetch() {
  try {
    await verifyProjectAuthority(${JSON.stringify(project)}, ${JSON.stringify(actor)}, ${JSON.stringify(token)});
    return Response.json({authorized: true});
  } catch (error) {
    return Response.json({code: error.code, name: error.name, message: error.message}, {status: error.status ?? 503});
  }
}};`,
  });
  const { runtime } = worker;
  const check = () =>
    runtime.dispatchFetch("https://slop.cash/__fixture/monthly-authority");
  const valid = await check();
  assert.equal(valid.status, 200, await valid.clone().text());
  assert.deepEqual(await valid.json(), { authorized: true });
  assert.equal(requests.length, 2);
  state.permission = "read";
  const reader = await check();
  assert.equal(reader.status, 403);
  assert.equal((await reader.json()).code, "owner_required");
  state.permission = "write";
  state.repositoryId++;
  const changed = await check();
  assert.equal(changed.status, 409);
  assert.equal((await changed.json()).code, "repository_changed");
  state.repositoryId--;
  state.redirect = true;
  const beforeRedirect = requests.length;
  const redirected = await check();
  assert.equal(redirected.status, 503);
  assert.equal((await redirected.json()).code, "github_unavailable");
  assert.equal(requests.length, beforeRedirect + 1);
  console.log(
    JSON.stringify({
      nativeWorkersFetch: true,
      authorized: true,
      readerRefused: true,
      changedIdentityRefused: true,
      redirectNotFollowed: true,
      realProviderRequests: 0,
    }),
  );
} finally {
  await worker?.dispose();
}
