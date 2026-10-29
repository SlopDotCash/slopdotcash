/** Real Pages handler and session/registry tables; GitHub is the controlled external boundary. */
import { afterEach, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { CloudflareProjectPersistence } from "../backend/projects/cloudflare-persistence";
import { onRequest } from "../functions/api/v1/[[path]]";
import { assertProjectPolicyTransition } from "../src/lib/project-policy.mjs";
import { fixtureProject } from "../tests/fixture-overlay.mjs";
import { sqliteD1 } from "../tests/sqlite-d1";
import { sha256Hex } from "../workers/identity/crypto";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("organization maintainers reach private monthly awards after an approved rename; other actors and changed identities do not", async () => {
  const { db, sqlite } = sqliteD1(
    readdirSync("migrations")
      .filter((name) => name.endsWith(".sql"))
      .sort(),
  );
  try {
    const project = fixtureProject("eliza");
    project.reward.feeBasisPoints = 200;
    project.reward.chain = "base";
    project.escrow = {
      schemaVersion: "1",
      effectiveCycle: "2026-11",
      chain: "base",
      feeBasisPoints: 200,
      withdrawalFeeBasisPoints: 200,
      feeMode: "deduct-from-gross",
      deployments: [],
    };
    const manifest = JSON.stringify(project);
    sqlite
      .prepare(
        "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,1,?,?,?,?)",
      )
      .run(
        project.id,
        manifest,
        await sha256Hex(manifest),
        "Fixture approval",
        "2026-10-01T00:00:00.000Z",
      );
    sqlite
      .prepare(
        "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,?,1,?,?,?,?)",
      )
      .run(
        project.id,
        project.status,
        manifest,
        await sha256Hex(manifest),
        "2026-10-01T00:00:00.000Z",
        "2026-10-01T00:00:00.000Z",
      );
    sqlite.exec(
      "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES('human','900000071','human-maintainer','2026-10-01T00:00:00.000Z',0)",
    );
    const token = "o".repeat(48);
    sqlite
      .prepare(
        "INSERT INTO points_sessions(token_hash,actor_id,expires_at) VALUES(?,'human','2099-01-01T00:00:00.000Z')",
      )
      .run(await sha256Hex(token));
    let permission = "maintain";
    let returnedActorId = 900000071;
    let ownerId = Number(project.steward.github.actorId);
    let repositoryId = Number(project.authority.repositoryId);
    let currentPath = project.repositories[0].id;
    const requests: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      requests.push(url.pathname);
      const target = `/repos/${currentPath}`;
      if (
        currentPath !== project.repositories[0].id &&
        url.pathname === `/repos/${project.repositories[0].id}`
      )
        return Response.redirect(
          `https://api.github.com/repositories/${repositoryId}`,
          301,
        );
      if (url.pathname === target)
        return Response.json({
          id: repositoryId,
          node_id: project.authority.repositoryNodeId,
          owner: {
            id: ownerId,
            node_id: project.steward.github.nodeId,
            type: "Organization",
            login: project.steward.github.login,
          },
        });
      if (
        url.pathname === `${target}/collaborators/human-maintainer/permission`
      )
        return Response.json({ permission, user: { id: returnedActorId } });
      return Response.json({ message: "Not Found" }, { status: 404 });
    }) as typeof fetch;
    const request = (signedIn = true) =>
      onRequest({
        request: new Request(
          `https://slop.cash/api/v1/payments/projects/${project.id}/monthly/2026-11`,
          {
            headers: signedIn ? { cookie: `__Host-slop_points=${token}` } : {},
          },
        ),
        env: { SLOP_DB: db } as never,
      });
    expect((await request(false)).status).toBe(401);
    expect(requests).toEqual([]);
    const authorized = await request();
    expect(authorized.status).toBe(200);
    // No proposal exists yet; authority was checked on GitHub, not inferred
    // from the stored steward.
    expect(await authorized.json()).toMatchObject({
      projectId: project.id,
      period: "2026-11",
      automatic: true,
      proposal: null,
      run: null,
    });
    expect(requests).toEqual([
      `/repos/${project.repositories[0].id}`,
      `/repos/${project.repositories[0].id}/collaborators/human-maintainer/permission`,
    ]);
    // An active vault project (legacy paymentMode is always "disabled")
    // reaches the same authority checks before any reservation plan.
    requests.length = 0;
    const commitment = await onRequest({
      request: new Request(
        `https://slop.cash/api/v1/payments/projects/${project.id}/monthly/2026-11/commitment`,
        {
          method: "POST",
          headers: {
            cookie: `__Host-slop_points=${token}`,
            origin: "https://slop.cash",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            network: "base-mainnet",
            githubUserId: "123",
            snapshotSha256: "d".repeat(64),
            manifestSha256: "c".repeat(64),
          }),
        },
      ),
      env: { SLOP_DB: db, PAYMENT_NETWORKS: '["base-mainnet"]' } as never,
    });
    expect(project.reward.paymentMode).toBe("disabled");
    expect(commitment.status).toBe(409);
    expect(await commitment.json()).toMatchObject({
      error: "project_changed",
    });
    expect(requests).toHaveLength(2);
    // An approved rename retains the immutable id but publishes a new URL.
    // The historical name now redirects, so monthly authority must read the
    // current name for both identity and the maintainer's permission.
    currentPath = `${project.steward.github.login}/eliza-renamed`;
    const renamed = structuredClone(project);
    renamed.repositories[0].aliases = [
      ...(renamed.repositories[0].aliases ?? []),
      currentPath,
    ];
    renamed.repositories[0].displayName = currentPath;
    renamed.repositories[0].githubUrl = `https://github.com/${currentPath}`;
    assertProjectPolicyTransition(project, renamed);
    const renamedText = JSON.stringify(renamed);
    expect(
      await new CloudflareProjectPersistence(db).appendProjectRevision(
        {
          projectId: project.id,
          expectedRevision: 1,
          manifest: renamed,
          manifestText: renamedText,
          manifestSha256: await sha256Hex(renamedText),
          reason: "Approved repository rename",
          actor: { githubId: "900000071", githubLogin: "human-maintainer" },
          at: "2026-10-02T00:00:00.000Z",
        },
        0,
      ),
    ).toBe("updated");
    requests.length = 0;
    const afterRename = await request();
    expect(afterRename.status).toBe(200);
    expect(await afterRename.json()).toMatchObject({
      projectId: project.id,
      period: "2026-11",
      proposal: null,
    });
    expect(requests).toEqual([
      `/repos/${currentPath}`,
      `/repos/${currentPath}/collaborators/human-maintainer/permission`,
    ]);
    for (const failure of [
      "read-only",
      "different-human",
      "transferred-owner",
      "replaced-repository",
    ]) {
      requests.length = 0;
      permission = failure === "read-only" ? "read" : "maintain";
      returnedActorId = failure === "different-human" ? 900000072 : 900000071;
      ownerId =
        failure === "transferred-owner"
          ? 900000073
          : Number(project.steward.github.actorId);
      repositoryId =
        Number(project.authority.repositoryId) +
        (failure === "replaced-repository" ? 1 : 0);
      expect((await request()).status).toBe(
        failure === "transferred-owner" || failure === "replaced-repository"
          ? 409
          : 403,
      );
      // A failed authority check stops before any further GitHub read.
      expect(requests.length).toBeLessThanOrEqual(2);
    }
  } finally {
    sqlite.close();
  }
});
