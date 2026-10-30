import { afterEach, expect, test } from "bun:test";
import { createHash, generateKeyPairSync } from "node:crypto";
import { type PointRevision, pointRevisionId } from "../../src/lib/points";
import { applicationManifest } from "../../tests/project-application-manifest";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { sha256Hex } from "../../workers/identity/crypto";
import { escalateAppeal } from "../../workers/slopbot/appeals";
import { handleNotificationsApi } from "../notifications/handler";
import { handlePointsApi } from "./handler";

const NOW = "2026-10-30T14:00:00.000Z";
const owner = {
  githubId: "42",
  githubLogin: "recipient",
  node: btoa("04:User42"),
};
const moderator = {
  githubId: "43",
  githubLogin: "moderator",
  node: btoa("04:User43"),
};
const token = "a".repeat(48);
const otherToken = "b".repeat(48);
const databases: { close(): void }[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
async function fixture() {
  const { db, sqlite } = sqliteD1();
  databases.push(sqlite);
  for (const [actor, session] of [
    [owner, token],
    [moderator, otherToken],
  ] as const) {
    sqlite
      .query(
        "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES(?,?,?,?,1)",
      )
      .run(actor.node, actor.githubId, actor.githubLogin, NOW);
    sqlite
      .query(
        "INSERT INTO points_sessions(token_hash,actor_id,expires_at) VALUES(?,?,?)",
      )
      .run(await sha256Hex(session), actor.node, "2026-10-31T14:00:00.000Z");
  }
  const record: Omit<PointRevision, "id"> = {
    previous: null,
    recordedAt: NOW,
    sourceDigest: "a".repeat(64),
    sourceRule: "legacy-reviewed-award",
    award: {
      key: "alpha:manual:42",
      actor: { id: owner.node, login: owner.githubLogin },
      projectId: "alpha",
      category: "evaluated-contribution",
      amount: 90,
      occurredAt: NOW,
      sourceId: "manual-award-42",
      sourceUrl: "https://example.com/accepted-work",
      workUnitId: "manual-award-42",
      provisional: false,
    },
  };
  const revision: PointRevision = { ...record, id: pointRevisionId(record) };
  const insert = (r: PointRevision) =>
    sqlite
      .query(
        "INSERT INTO points_revisions(id,source_key,previous,recorded_at,payload) VALUES(?,?,?,?,?)",
      )
      .run(r.id, r.award.key, r.previous, r.recordedAt, JSON.stringify(r));
  insert(revision);
  const started: string[] = [];
  const deps = {
    db,
    now: () => new Date(NOW),
    rateLimitSecret: "s".repeat(64),
    identity: { fetch: async () => Response.json({}) },
    disputes: {
      moderators: new Set([moderator.githubId, owner.githubId]),
      process: async (key: string) => {
        started.push(key);
      },
    },
  };
  const call = (path = "", body?: unknown, session = token) =>
    handlePointsApi(
      new Request(`https://slop.cash/api/v1/points/disputes${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          cookie: `__Host-slop_points=${session}`,
          origin: "https://slop.cash",
          "content-type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      deps,
    );
  return { db, sqlite, revision, insert, started, call };
}

test("a manual award recipient can retain a private dispute and retry without duplicate state", async () => {
  const h = await fixture();
  const input = {
    revisionId: h.revision.id,
    reason: "The accepted work was credited to the wrong month.",
  };
  const response = await h.call("", input);
  expect(response.status).toBe(201);
  const created = await response.json();
  expect(created.state).toBe("triage");
  expect(h.started).toEqual([created.id]);
  expect((await h.call("", input)).status).toBe(201);
  expect(
    h.sqlite.query("SELECT COUNT(*) AS n FROM points_disputes").get(),
  ).toEqual({ n: 1 });
  expect(
    h.sqlite.query("SELECT COUNT(*) AS n FROM notifications").get(),
  ).toEqual({ n: 1 });
  expect(
    (await h.call("", { ...input, reason: "Changed statement" })).status,
  ).toBe(409);
  expect((await h.call(`/${created.id}`)).status).toBe(200);
  expect(
    h.sqlite.query("SELECT COUNT(*) AS n FROM points_revisions").get(),
  ).toEqual({ n: 1 });
  expect(
    h.sqlite.query("SELECT COUNT(*) AS n FROM payment_obligations").get(),
  ).toEqual({ n: 0 });
});

test("a superseded revision cannot open a dispute, but the current revision can", async () => {
  const h = await fixture();
  const { id: _, ...record } = h.revision;
  const changed = {
    ...record,
    previous: h.revision.id,
    award: { ...record.award, amount: 30 },
  };
  const successor: PointRevision = { ...changed, id: pointRevisionId(changed) };
  h.insert(successor);
  const reason = "The accepted work was credited to the wrong month.";
  expect((await h.call("", { revisionId: h.revision.id, reason })).status).toBe(
    409,
  );
  expect(h.started).toEqual([]);
  expect(
    h.sqlite.query("SELECT COUNT(*) AS n FROM points_disputes").get(),
  ).toEqual({ n: 0 });
  expect((await h.call("", { revisionId: successor.id, reason })).status).toBe(
    201,
  );
  expect(
    h.sqlite.query("SELECT COUNT(*) AS n FROM points_disputes").get(),
  ).toEqual({ n: 1 });
});

test("another actor cannot submit or read a recipient's private dispute", async () => {
  const h = await fixture();
  const input = {
    revisionId: h.revision.id,
    reason: "Review this manual award.",
  };
  expect((await h.call("", input, otherToken)).status).toBe(403);
  const created = await (await h.call("", input)).json();
  expect((await h.call(`/${created.id}`, undefined, otherToken)).status).toBe(
    404,
  );
  expect(
    (
      await h.call(
        `/${created.id}`,
        { action: "uphold", reason: "I agree." },
        otherToken,
      )
    ).status,
  ).toBe(404);
});

test("a later correction cannot replace the retained source, and a moderator cannot decide their own award", async () => {
  const h = await fixture();
  const created = await (
    await h.call("", {
      revisionId: h.revision.id,
      reason: "The month is wrong.",
    })
  ).json();
  const { id: _, ...record } = h.revision;
  const changed = {
    ...record,
    previous: h.revision.id,
    award: { ...record.award, amount: 30 },
  };
  h.insert({ ...changed, id: pointRevisionId(changed) });
  await escalateAppeal(
    h.db,
    created.id,
    "Original source needs review",
    new Set([owner.githubId, moderator.githubId]),
    "points_disputes",
  );
  const detail = await (await h.call(`/${created.id}`)).json();
  expect(detail.revision.id).toBe(h.revision.id);
  expect(detail.revision.award.amount).toBe(90);
  expect(detail.mayDecide).toBe(false);
  expect(
    (
      await h.call(`/${created.id}`, {
        action: "uphold",
        reason: "My own review.",
      })
    ).status,
  ).toBe(403);
  const mod = await (
    await h.call(`/${created.id}`, undefined, otherToken)
  ).json();
  expect(mod.mayDecide).toBe(true);
  expect(
    (
      await h.call(
        `/${created.id}`,
        { action: "uphold", reason: "The retained date needs correction." },
        otherToken,
      )
    ).status,
  ).toBe(200);
  const resolved = await (await h.call(`/${created.id}`)).json();
  expect(resolved.resolution).toBe("upheld");
  expect(resolved.resolutionReason).toBe("The retained date needs correction.");
  expect(
    h.sqlite.query("SELECT COUNT(*) AS n FROM points_revisions").get(),
  ).toEqual({ n: 2 });
  expect(
    (
      await h.call(
        `/${created.id}`,
        { action: "deny", reason: "Changed decision." },
        otherToken,
      )
    ).status,
  ).toBe(409);
});

test("the recipient sees its own notice, while revoked moderator access is refused", async () => {
  const h = await fixture();
  const created = await (
    await h.call("", { revisionId: h.revision.id, reason: "Please review." })
  ).json();
  await escalateAppeal(
    h.db,
    created.id,
    "Source needs review",
    new Set([moderator.githubId]),
    "points_disputes",
  );
  const notifications = await handleNotificationsApi(
    new Request("https://slop.cash/api/v1/notifications"),
    {
      db: h.db,
      now: () => new Date(NOW),
      sessionActor: async () => owner,
    },
  );
  expect(notifications?.status).toBe(200);
  if (!notifications) throw new Error("Notification route missing");
  expect((await notifications.json()).notifications).toHaveLength(1);
  const list = await (await h.call()).json();
  expect(list.awards[0].revisionId).toBe(h.revision.id);
  expect(list.awards[0].disputeId).toBe(created.id);
});

test("unregistered historical work remains reviewable without a fabricated repository or model call", async () => {
  const { processPointsDispute } = await import(
    "../../workers/slopbot/points-disputes"
  );
  const h = await fixture();
  const created = await (
    await h.call("", {
      revisionId: h.revision.id,
      reason: "The old manual credit needs review.",
    })
  ).json();
  await processPointsDispute(
    {
      SLOPBOT_DB: h.db,
      SLOPBOT_APP_ID: "unused",
      SLOPBOT_APP_PRIVATE_KEY: "unused",
      PROJECT_MODERATOR_GITHUB_IDS: moderator.githubId,
    },
    created.id,
  );
  const detail = await (
    await h.call(`/${created.id}`, undefined, otherToken)
  ).json();
  expect(detail.state).toBe("review");
  expect(detail.draft).toBeNull();
  expect(detail.mayDecide).toBe(true);
  expect(
    h.sqlite.query("SELECT COUNT(*) AS n FROM slopbot_costs").get(),
  ).toEqual({ n: 0 });
  expect(
    h.sqlite.query("SELECT COUNT(*) AS n FROM slopbot_appeals").get(),
  ).toEqual({ n: 0 });
  expect(() =>
    h.sqlite.query("UPDATE points_disputes SET statement='other'").run(),
  ).toThrow("immutable");
  expect(() => h.sqlite.query("DELETE FROM points_disputes").run()).toThrow(
    "permanent",
  );
});

test("a concurrent triage lease is respected and an expired one can recover", async () => {
  const { processPointsDispute } = await import(
    "../../workers/slopbot/points-disputes"
  );
  const h = await fixture();
  const created = await (
    await h.call("", {
      revisionId: h.revision.id,
      reason: "Review after interruption.",
    })
  ).json();
  const env = {
    SLOPBOT_DB: h.db,
    SLOPBOT_APP_ID: "unused",
    SLOPBOT_APP_PRIVATE_KEY: "unused",
    PROJECT_MODERATOR_GITHUB_IDS: moderator.githubId,
  };
  h.sqlite
    .query(
      "UPDATE points_disputes SET claim_token='other',claim_until='2099-01-01T00:00:00.000Z'",
    )
    .run();
  await processPointsDispute(env, created.id);
  expect((await (await h.call(`/${created.id}`)).json()).state).toBe("triage");
  h.sqlite
    .query("UPDATE points_disputes SET claim_until='2000-01-01T00:00:00.000Z'")
    .run();
  await processPointsDispute(env, created.id);
  expect((await (await h.call(`/${created.id}`)).json()).state).toBe("review");
  expect(
    h.sqlite.query("SELECT claim_token,claim_until FROM points_disputes").get(),
  ).toEqual({ claim_token: null, claim_until: null });
});

test.each(["before restart", "after the initial restart read"])(
  "a draft saved %s resumes moderator escalation without another model call",
  async (timing) => {
    const { processPendingPointsDisputes } = await import(
      "../../workers/slopbot/points-disputes"
    );
    const { recordDraft } = await import("../../workers/slopbot/appeals");
    const h = await fixture();
    const created = await (
      await h.call("", {
        revisionId: h.revision.id,
        reason: "The manual award needs a date correction.",
      })
    ).json();
    const manifest = JSON.stringify(
      applicationManifest("alpha", "example/alpha", {
        status: "active",
        rewardAsset: {
          network: "ethereum",
          kind: "stablecoin",
          address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
          symbol: "USDC",
          chainId: "1",
          cluster: null,
          decimals: 6,
          verifiedAt: NOW,
        },
      }),
    );
    const digest = createHash("sha256").update(manifest).digest("hex");
    h.sqlite
      .query(
        "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES('alpha',1,?,?,'recovery fixture',?)",
      )
      .run(manifest, digest, NOW);
    h.sqlite
      .query(
        "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES('alpha','active',1,?,?,?,?)",
      )
      .run(manifest, digest, NOW, NOW);
    h.sqlite
      .query(
        "INSERT INTO project_repositories(repository_key,project_id) VALUES('example/alpha','alpha')",
      )
      .run();
    h.sqlite
      .query(
        "UPDATE points_disputes SET claim_token='crashed-worker',claim_until='2099-01-01T00:00:00.000Z'",
      )
      .run();
    let draft: unknown;
    const saveDraftAndExpire = async () => {
      await recordDraft(h.db, created.id, "uphold", 0.7, "points_disputes", {
        claimToken: "crashed-worker",
      });
      draft = h.sqlite
        .query("SELECT draft,draft_confidence,drafted_at FROM points_disputes")
        .get();
      // The first worker stopped after the durable draft but before escalation.
      h.sqlite
        .query(
          "UPDATE points_disputes SET claim_until='2000-01-01T00:00:00.000Z'",
        )
        .run();
    };
    if (timing === "before restart") await saveDraftAndExpire();
    let savedAfterRead = false;
    const db: typeof h.db = {
      ...h.db,
      prepare(sql) {
        const statement = h.db.prepare(sql);
        if (!sql.includes("FROM points_disputes WHERE appeal_key = ?"))
          return statement;
        return {
          ...statement,
          bind(...values) {
            const bound = statement.bind(...values);
            return {
              ...bound,
              async first<T>() {
                const value = await bound.first<T>();
                if (timing !== "before restart" && !savedAfterRead) {
                  savedAfterRead = true;
                  await saveDraftAndExpire();
                }
                return value;
              },
            };
          },
        };
      },
    };
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const reads: string[] = [];
    const nativeFetch = globalThis.fetch;
    globalThis.fetch = (async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      expect(url.origin).toBe("https://api.github.com");
      reads.push(url.pathname);
      switch (url.pathname) {
        case "/repos/example/alpha/installation":
          return Response.json({ id: 1 });
        case "/app/installations/1/access_tokens":
          return Response.json({ token: "synthetic-read-token" });
        case "/repos/example/alpha":
          return Response.json({ id: 123456789 });
        case "/repos/example/alpha/collaborators/recipient/permission":
          return Response.json({ permission: "read", user: { id: 42 } });
        default:
          throw new Error("Unexpected request during retained-draft recovery");
      }
    }) as typeof fetch;
    try {
      const env = {
        SLOPBOT_DB: db,
        SLOPBOT_APP_ID: "1",
        SLOPBOT_APP_PRIVATE_KEY: privateKey,
        PROJECT_MODERATOR_GITHUB_IDS: moderator.githubId,
      };
      // Both scheduled workers see pending work, but only one may resume it.
      await Promise.all([
        processPendingPointsDisputes(env),
        processPendingPointsDisputes(env),
      ]);
      await processPendingPointsDisputes(env);
      const detail = await (
        await h.call(`/${created.id}`, undefined, otherToken)
      ).json();
      expect(detail).toMatchObject({
        state: "review",
        draft: "uphold",
        mayDecide: true,
      });
      expect(reads).toHaveLength(4);
      expect(
        h.sqlite
          .query(
            "SELECT draft,draft_confidence,drafted_at FROM points_disputes",
          )
          .get(),
      ).toEqual(draft);
      expect(
        h.sqlite
          .query(
            "SELECT claim_token,claim_until,escalation FROM points_disputes",
          )
          .get(),
      ).toEqual({
        claim_token: null,
        claim_until: null,
        escalation: "Original work evidence needs independent moderator review",
      });
      expect(
        h.sqlite
          .query(
            "SELECT COUNT(*) AS n FROM notifications WHERE recipient_github_id=?",
          )
          .get(moderator.githubId),
      ).toEqual({ n: 1 });
      expect(
        h.sqlite.query("SELECT COUNT(*) AS n FROM slopbot_costs").get(),
      ).toEqual({ n: 0 });
      expect(
        h.sqlite.query("SELECT COUNT(*) AS n FROM points_revisions").get(),
      ).toEqual({ n: 1 });
    } finally {
      globalThis.fetch = nativeFetch;
    }
  },
);

test("signed-out and cross-origin requests cannot create a dispute", async () => {
  const h = await fixture();
  expect(
    (
      await h.call(
        "",
        { revisionId: h.revision.id, reason: "Review" },
        "invalid",
      )
    ).status,
  ).toBe(401);
  const response = await handlePointsApi(
    new Request("https://slop.cash/api/v1/points/disputes", {
      method: "POST",
      headers: {
        origin: "https://attacker.example",
        cookie: `__Host-slop_points=${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ revisionId: h.revision.id, reason: "Review" }),
    }),
    {
      db: h.db,
      now: () => new Date(NOW),
      rateLimitSecret: "s".repeat(64),
      identity: { fetch: async () => Response.json({}) },
    },
  );
  expect(response.status).toBe(403);
  expect(
    h.sqlite.query("SELECT COUNT(*) AS n FROM points_disputes").get(),
  ).toEqual({ n: 0 });
});

test("a final decision creates one new unread notice after the receipt was read", async () => {
  const h = await fixture();
  const created = await (
    await h.call("", {
      revisionId: h.revision.id,
      reason: "Review a manual award.",
    })
  ).json();
  h.sqlite
    .query("UPDATE notifications SET read_at=? WHERE recipient_github_id=?")
    .run(NOW, owner.githubId);
  await escalateAppeal(
    h.db,
    created.id,
    "Independent review",
    new Set([moderator.githubId]),
    "points_disputes",
  );
  const decision = {
    action: "uphold",
    reason: "Append a date correction; keep the recorded award.",
  };
  expect((await h.call(`/${created.id}`, decision, otherToken)).status).toBe(
    200,
  );
  expect((await h.call(`/${created.id}`, decision, otherToken)).status).toBe(
    200,
  );
  const response = await handleNotificationsApi(
    new Request("https://slop.cash/api/v1/notifications"),
    {
      db: h.db,
      now: () => new Date(NOW),
      sessionActor: async () => owner,
    },
  );
  if (!response) throw new Error("Notification route missing");
  const inbox = await response.json();
  expect(inbox.unread).toBe(1);
  expect(inbox.notifications).toHaveLength(2);
  const final = inbox.notifications.find((n: { eventKey: string }) =>
    n.eventKey.endsWith(":resolved"),
  );
  expect(final.kind).toBe("slopbot_appeal_resolved");
  expect(final.readAt).toBeNull();
  expect(final.detail).toBeNull();
  expect(
    h.sqlite
      .query(
        "SELECT COUNT(*) AS n FROM notifications WHERE event_key LIKE '%:resolved'",
      )
      .get(),
  ).toEqual({ n: 1 });
});

test("racing moderator decisions retain one result, reason and final notice", async () => {
  const h = await fixture();
  const created = await (
    await h.call("", {
      revisionId: h.revision.id,
      reason: "Review a manual award.",
    })
  ).json();
  await escalateAppeal(
    h.db,
    created.id,
    "Independent review",
    new Set([moderator.githubId]),
    "points_disputes",
  );
  const results = await Promise.all([
    h.call(
      `/${created.id}`,
      { action: "uphold", reason: "Correction needed." },
      otherToken,
    ),
    h.call(
      `/${created.id}`,
      { action: "deny", reason: "Record is supported." },
      otherToken,
    ),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(
    h.sqlite
      .query(
        "SELECT COUNT(*) AS n FROM notifications WHERE event_key LIKE '%:resolved'",
      )
      .get(),
  ).toEqual({ n: 1 });
  const row = h.sqlite
    .query("SELECT resolution,resolution_reason FROM points_disputes")
    .get() as { resolution: string; resolution_reason: string };
  expect(row.resolution_reason).toBe(
    row.resolution === "upheld" ? "Correction needed." : "Record is supported.",
  );
});

test("a replaced worker lease cannot escalate or notify after its source read", async () => {
  const { processPointsDispute } = await import(
    "../../workers/slopbot/points-disputes"
  );
  const h = await fixture();
  const created = await (
    await h.call("", {
      revisionId: h.revision.id,
      reason: "Review after a worker restart.",
    })
  ).json();
  const wrapped: typeof h.db = {
    ...h.db,
    prepare(sql) {
      const statement = h.db.prepare(sql);
      if (sql !== "SELECT manifest FROM projects WHERE id=?") return statement;
      return {
        ...statement,
        bind(...values) {
          const bound = statement.bind(...values);
          return {
            ...bound,
            async first<T>() {
              h.sqlite
                .query(
                  "UPDATE points_disputes SET claim_token='replacement',claim_until='2099-01-01T00:00:00.000Z' WHERE appeal_key=?",
                )
                .run(created.id);
              return bound.first<T>();
            },
          };
        },
      };
    },
  };
  await processPointsDispute(
    {
      SLOPBOT_DB: wrapped,
      SLOPBOT_APP_ID: "unused",
      SLOPBOT_APP_PRIVATE_KEY: "unused",
      PROJECT_MODERATOR_GITHUB_IDS: moderator.githubId,
    },
    created.id,
  );
  expect(
    h.sqlite
      .query("SELECT claim_token,escalated_at,draft FROM points_disputes")
      .get(),
  ).toEqual({ claim_token: "replacement", escalated_at: null, draft: null });
  expect(
    h.sqlite
      .query(
        "SELECT COUNT(*) AS n FROM notifications WHERE recipient_github_id=?",
      )
      .get(moderator.githubId),
  ).toEqual({ n: 0 });
});

test("a stale or expired worker cannot write a draft or escalation at the database boundary", async () => {
  const { recordDraft } = await import("../../workers/slopbot/appeals");
  const h = await fixture();
  const created = await (
    await h.call("", {
      revisionId: h.revision.id,
      reason: "Review after a race.",
    })
  ).json();
  h.sqlite
    .query(
      "UPDATE points_disputes SET claim_token='replacement',claim_until='2099-01-01T00:00:00.000Z'",
    )
    .run();
  const stale = { claimToken: "old-worker" };
  expect(
    (
      await recordDraft(
        h.db,
        created.id,
        "uphold",
        0.7,
        "points_disputes",
        stale,
      )
    ).draft,
  ).toBeNull();
  expect(
    await escalateAppeal(
      h.db,
      created.id,
      "Stale worker",
      new Set([moderator.githubId]),
      "points_disputes",
      stale,
    ),
  ).toBe(false);
  h.sqlite
    .query("UPDATE points_disputes SET claim_until='2000-01-01T00:00:00.000Z'")
    .run();
  expect(
    (
      await recordDraft(h.db, created.id, "uphold", 0.7, "points_disputes", {
        claimToken: "replacement",
      })
    ).draft,
  ).toBeNull();
  expect(
    await escalateAppeal(
      h.db,
      created.id,
      "Expired worker",
      new Set([moderator.githubId]),
      "points_disputes",
      { claimToken: "replacement" },
    ),
  ).toBe(false);
  expect(
    h.sqlite
      .query(
        "SELECT COUNT(*) AS n FROM notifications WHERE recipient_github_id=?",
      )
      .get(moderator.githubId),
  ).toEqual({ n: 0 });
});
