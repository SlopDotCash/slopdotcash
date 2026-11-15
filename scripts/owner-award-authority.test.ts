/** Real Pages handler and session/registry tables; GitHub is the controlled external boundary. */
import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { CloudflareProjectPersistence } from "../backend/projects/cloudflare-persistence";
import { onRequest } from "../functions/api/v1/[[path]]";
import { sha256Hex } from "../src/lib/async-sha256.mjs";
import { assertProjectPolicyTransition } from "../src/lib/project-policy.mjs";
import { fixtureProject } from "../tests/fixture-overlay.mjs";
import { sqliteD1 } from "../tests/sqlite-d1";

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
    let permission = "write";
    let returnedActorId = 900000071;
    let ownerId = Number(project.steward.github.actorId);
    let repositoryId = Number(project.authority.repositoryId);
    let currentPath = project.repositories[0].id;
    const requests: string[] = [];
    const slopbot = {
      async fetch(input: Request) {
        const url = new URL(input.url);
        expect(url.origin).toBe("https://slopbot.internal");
        expect(url.pathname).toBe("/v1/repository-access");
        requests.push(url.searchParams.get("repository") ?? "");
        expect(url.searchParams.get("repositoryId")).toBe(
          project.authority.repositoryId,
        );
        expect(url.searchParams.get("login")).toBe("human-maintainer");
        expect(url.searchParams.get("githubId")).toBe("900000071");
        expect(url.searchParams.get("includeRepository")).toBe("1");
        if (
          url.searchParams.get("repository") !== currentPath ||
          returnedActorId !== 900000071
        )
          return Response.json(
            { error: "github_unavailable" },
            { status: 503 },
          );
        return Response.json({
          installation: "installed",
          installationId: 123,
          permission,
          roleName: permission === "write" ? "maintain" : permission,
          repository: {
            id: repositoryId,
            node_id: project.authority.repositoryNodeId,
            full_name: currentPath,
            private: false,
            owner: {
              id: ownerId,
              node_id: project.steward.github.nodeId,
              type: "Organization",
              login: project.steward.github.login,
            },
          },
        });
      },
    };
    const request = (signedIn = true) =>
      onRequest({
        request: new Request(
          `https://slop.cash/api/v1/payments/projects/${project.id}/monthly/2026-11`,
          {
            headers: signedIn ? { cookie: `__Host-slop_points=${token}` } : {},
          },
        ),
        env: { SLOP_DB: db, SLOPBOT: slopbot } as never,
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
      // A maintainer who is not the steward or an admin cannot change awards.
      canManage: false,
      proposal: null,
      run: null,
    });
    expect(requests).toEqual([project.repositories[0].id]);
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
      env: {
        SLOP_DB: db,
        SLOPBOT: slopbot,
        PAYMENT_NETWORKS: '["base-mainnet"]',
      } as never,
    });
    expect(project.reward.paymentMode).toBe("disabled");
    expect(commitment.status).toBe(409);
    expect(await commitment.json()).toMatchObject({
      error: "project_changed",
    });
    expect(requests).toHaveLength(1);
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
    expect(requests).toEqual([currentPath]);
    for (const failure of [
      "read-only",
      "different-human",
      "transferred-owner",
      "replaced-repository",
    ]) {
      requests.length = 0;
      permission = failure === "read-only" ? "read" : "write";
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
          : failure === "different-human"
            ? 503
            : 403,
      );
      // One Slopbot check binds the current repository and account.
      expect(requests.length).toBe(1);
    }
  } finally {
    sqlite.close();
  }
});
