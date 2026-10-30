// Self-service account closure against the real migrations (PRD section 3,
// ACC-05): one confirmed request ends every session, removes the optional
// connections and activity email, and keeps the identity, claims, awards,
// obligations and inbox. Only an explicit reopen signs the account in again.
import { expect, test } from "bun:test";
import { handleEmailPreferences } from "../backend/notifications/email";
import { verificationTokenHash } from "../backend/notifications/email-destinations";
import { handlePointsApi, sessionGithubActor } from "../backend/points/handler";
import {
  ME,
  OTHER,
  seedAccountClosure,
} from "../tests/account-closure-fixture";
import { sqliteD1 } from "../tests/sqlite-d1";

const NOW = "2026-10-23T12:00:00.000Z";
const LATER = "2026-10-23T13:00:00.000Z";

async function harness() {
  const { db, sqlite, tokens } = await seedAccountClosure(NOW);
  let clock = NOW;
  const identity = { login: ME.login };
  const call = async (path: string, token: string | null, body?: unknown) => {
    const response = await handlePointsApi(
      new Request(`https://slop.cash/api/v1/points/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          ...(token ? { cookie: `__Host-slop_points=${token}` } : {}),
          ...(body === undefined
            ? {}
            : {
                origin: "https://slop.cash",
                "content-type": "application/json",
              }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      {
        db,
        now: () => new Date(clock),
        rateLimitSecret: "test-only-rate-secret".repeat(4),
        identity: {
          fetch: async () =>
            Response.json({
              audience: "slop-points-web",
              githubActorId: ME.github,
              githubNodeId: ME.actor,
              githubLogin: identity.login,
            }),
        },
      },
    );
    return {
      status: response.status,
      cookie: response.headers.get("set-cookie"),
      body: await response.json(),
    };
  };
  const count = (sql: string, ...values: string[]) =>
    (sqlite.query(sql).get(...values) as { n: number }).n;
  return {
    db,
    sqlite,
    tokens,
    call,
    count,
    setClock: (at: string) => {
      clock = at;
    },
  };
}

test("closing an account ends every session, removes optional connections and keeps records", async () => {
  const { sqlite, tokens, call, count } = await harness();
  try {
    sqlite.exec(`INSERT INTO activity_notification_outbox
      (event_key,recipient_github_id,essential,destination_version,next_attempt_at,created_at,updated_at)
      VALUES ('payout-held:obligation-1:${NOW}','${ME.github}',0,'${"d".repeat(64)}','${NOW}','${NOW}','${NOW}'),
             ('wallet-claim:claim-1','${ME.github}',1,NULL,'${NOW}','${NOW}','${NOW}')`);
    // The confirmation must name this account; a mismatch changes nothing.
    const refused = await call("account/close", tokens.me, {
      login: OTHER.login,
    });
    expect(refused).toMatchObject({
      status: 400,
      body: { error: "confirmation_mismatch" },
    });
    expect(
      count(
        "SELECT count(*) n FROM points_sessions WHERE actor_id=?",
        ME.actor,
      ),
    ).toBe(2);
    // Closure changes only the membership, its optional connections, its
    // sessions, its email preference and the optional mail queue. The wallet,
    // the unpaid obligation, the private case and every other record stay
    // exactly as they were.
    const changed = new Set([
      "points_members",
      "points_sessions",
      "points_x_links",
      "points_x_flows",
      "points_telegram_links",
      "points_telegram_flows",
      "notification_email_preferences",
      "activity_notification_outbox",
      // The request limiter counts the closure request itself.
      "identity_rate_limits",
    ]);
    const snapshot = () =>
      Object.fromEntries(
        (
          sqlite
            .query(
              "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
            )
            .all() as { name: string }[]
        )
          .filter(({ name }) => !changed.has(name))
          .map(({ name }) => [
            name,
            sqlite.query(`SELECT * FROM "${name}" ORDER BY rowid`).all(),
          ]),
      );
    const before = snapshot();
    expect(before.wallet_claims).toHaveLength(1);
    expect(before.payment_obligations).toHaveLength(1);
    expect(before.security_cases).toHaveLength(1);

    const closed = await call("account/close", tokens.me, {
      login: "closing-member",
    });
    expect(closed.status).toBe(200);
    expect(closed.body).toEqual({ closed: true, closedAt: NOW });
    expect(closed.cookie).toContain("Max-Age=0");
    expect(snapshot()).toEqual(before);
    // A repeated attempt has no session left to act with.
    expect(
      (await call("account/close", tokens.me, { login: ME.login })).status,
    ).toBe(401);
    // Both of this account's sessions end; another account keeps its own.
    expect((await call("sessions", tokens.me)).status).toBe(401);
    expect((await call("sessions", tokens.meOther)).status).toBe(401);
    expect((await call("sessions", tokens.other)).status).toBe(200);
    expect(
      sqlite
        .query(
          "SELECT public, closed_at, welcome FROM points_members WHERE actor_id=?",
        )
        .get(ME.actor),
    ).toEqual({ public: 0, closed_at: NOW, welcome: 5 });
    for (const table of [
      "points_x_links",
      "points_x_flows",
      "points_telegram_links",
      "points_telegram_flows",
    ])
      expect(
        count(`SELECT count(*) n FROM ${table} WHERE actor_id=?`, ME.actor),
      ).toBe(0);
    // Claims keep each X and Telegram ID reserved; awards and inbox stay.
    for (const table of [
      "points_x_claims",
      "points_x_awards",
      "points_telegram_claims",
    ])
      expect(
        count(`SELECT count(*) n FROM ${table} WHERE actor_id=?`, ME.actor),
      ).toBe(1);
    expect(
      count(
        "SELECT count(*) n FROM notifications WHERE recipient_github_id=?",
        ME.github,
      ),
    ).toBe(1);
    // Both activity and security email consent end, including queued mail.
    expect(
      sqlite
        .query(
          "SELECT enabled FROM notification_email_preferences WHERE github_id=?",
        )
        .get(ME.github),
    ).toEqual({ enabled: 0 });
    expect(
      sqlite
        .query(
          "SELECT essential, state, count(*) n FROM activity_notification_outbox GROUP BY essential, state ORDER BY essential",
        )
        .all(),
    ).toEqual([
      { essential: 0, state: "suppressed", n: 2 },
      { essential: 1, state: "suppressed", n: 1 },
    ]);
    // The closed membership leaves people lists and the public profile.
    const people = await call("people", null);
    expect(
      people.body.people.map((p: { actor: { id: string } }) => p.actor.id),
    ).toEqual([OTHER.actor]);
    expect((await call(`member?login=${ME.login}`, null)).body).toBeNull();
    // The database itself refuses a session or public visibility while closed.
    expect(() =>
      sqlite
        .prepare(
          "INSERT INTO points_sessions(token_hash,actor_id,expires_at) VALUES('x',?,?)",
        )
        .run(ME.actor, LATER),
    ).toThrow("a closed account has no sessions");
    expect(() =>
      sqlite
        .prepare("UPDATE points_members SET public=1 WHERE actor_id=?")
        .run(ME.actor),
    ).toThrow("a closed account is not public");
  } finally {
    sqlite.close();
  }
});

test("a closed account signs in again only through an explicit reopen", async () => {
  const { db, sqlite, tokens, call, count, setClock } = await harness();
  try {
    const version = "e".repeat(64),
      token = "f".repeat(64);
    sqlite
      .query(
        "UPDATE notification_email_preferences SET enabled=0,security_enabled=1,destination_version=? WHERE github_id=?",
      )
      .run(version, ME.github);
    sqlite
      .query(
        "INSERT INTO notification_email_destinations(github_id,email,destination_version,verified_at) VALUES(?,?,?,?)",
      )
      .run(ME.github, "closed-account@example.com", version, NOW);
    sqlite
      .query(
        "INSERT INTO notification_email_verifications(id,github_id,request_key,email,address_key,token_hash,activity_enabled,security_enabled,created_at,expires_at) VALUES('pending-close',?,'pending-close-key','pending@example.com',?,?,1,1,?,?)",
      )
      .run(
        ME.github,
        "a".repeat(64),
        await verificationTokenHash(token),
        NOW,
        "2026-10-23T14:00:00.000Z",
      );
    expect(
      (await call("account/close", tokens.me, { login: ME.login })).status,
    ).toBe(200);
    setClock(LATER);
    const assertion = `slop_assert_v1_${"a".repeat(48)}`;
    const ordinary = await call("join", null, { assertion, public: true });
    expect(ordinary).toMatchObject({
      status: 409,
      body: { error: "account_closed", closedAt: NOW },
    });
    expect(ordinary.cookie).toBeNull();
    expect(
      count(
        "SELECT count(*) n FROM points_sessions WHERE actor_id=?",
        ME.actor,
      ),
    ).toBe(0);
    // `reopen` accepts only true.
    expect(
      (await call("join", null, { assertion, public: false, reopen: false }))
        .status,
    ).toBe(400);
    const reopened = await call("join", null, {
      assertion,
      public: false,
      reopen: true,
    });
    expect(reopened.status).toBe(200);
    expect(reopened.body).toMatchObject({
      actor: { id: ME.actor, login: ME.login },
      public: true,
      socialPoints: 10,
    });
    expect(reopened.cookie).toContain("Max-Age=3600");
    expect(
      sqlite
        .query(
          "SELECT enabled,security_enabled,destination_version FROM notification_email_preferences WHERE github_id=?",
        )
        .get(ME.github),
    ).toEqual({ enabled: 0, security_enabled: 0, destination_version: "" });
    expect(
      sqlite
        .query(
          "SELECT cancelled_at,consumed_at FROM notification_email_verifications WHERE id='pending-close'",
        )
        .get(),
    ).toEqual({ cancelled_at: NOW, consumed_at: null });
    expect(
      sqlite
        .query(
          "SELECT email,destination_version FROM notification_email_destinations WHERE github_id=?",
        )
        .get(ME.github),
    ).toEqual({
      email: "closed-account@example.com",
      destination_version: version,
    });
    const oldVerification = await handleEmailPreferences(
      new Request("https://slop.cash/api/v1/notifications/email/verify", {
        method: "POST",
        headers: {
          origin: "https://slop.cash",
          "content-type": "application/json",
          cookie: reopened.cookie as string,
        },
        body: JSON.stringify({ token }),
      }),
      {
        db,
        now: () => new Date(LATER),
        sessionActor: (request) => sessionGithubActor(request, db, LATER),
        eligibility: async () => ({ available: false }),
      },
    );
    expect(oldVerification?.status).toBe(409);
    expect(
      sqlite
        .query(
          "SELECT enabled,security_enabled FROM notification_email_preferences WHERE github_id=?",
        )
        .get(ME.github),
    ).toEqual({ enabled: 0, security_enabled: 0 });
    expect(
      sqlite
        .query("SELECT public, closed_at FROM points_members WHERE actor_id=?")
        .get(ME.actor),
    ).toEqual({ public: 1, closed_at: null });
    // Removed connections stay removed until the person connects again.
    expect(
      count("SELECT count(*) n FROM points_x_links WHERE actor_id=?", ME.actor),
    ).toBe(0);
    // An open account ignores the reopen flag.
    expect(
      (await call("join", null, { assertion, public: false, reopen: true }))
        .status,
    ).toBe(200);
  } finally {
    sqlite.close();
  }
});

test("closure needs a signed-in session and a same-origin JSON request, and a repeat is safe", async () => {
  const { sqlite, tokens, call, count, setClock } = await harness();
  try {
    expect(
      (await call("account/close", null, { login: ME.login })).status,
    ).toBe(401);
    expect(
      (await call("account/close", "z".repeat(48), { login: ME.login })).status,
    ).toBe(401);
    const crossSite = await handlePointsApi(
      new Request("https://slop.cash/api/v1/points/account/close", {
        method: "POST",
        headers: {
          cookie: `__Host-slop_points=${tokens.me}`,
          origin: "https://attacker.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({ login: ME.login }),
      }),
      {
        db: sqliteD1([]).db,
        rateLimitSecret: "test-only-rate-secret".repeat(4),
        identity: { fetch: async () => new Response(null, { status: 500 }) },
      },
    );
    expect(crossSite.status).toBe(403);
    // A second request that read its session before a concurrent closure
    // committed reports that same closure instead of failing.
    sqlite.exec(
      `UPDATE points_members SET closed_at='${NOW}', public=0 WHERE actor_id='${ME.actor}'`,
    );
    setClock(LATER);
    const raced = await call("account/close", tokens.meOther, {
      login: ME.login,
    });
    expect(raced).toMatchObject({
      status: 200,
      body: { closed: true, closedAt: NOW },
    });
    expect(
      count(
        "SELECT count(*) n FROM points_sessions WHERE actor_id=?",
        ME.actor,
      ),
    ).toBe(0);
  } finally {
    sqlite.close();
  }
});

test("retired Telegram routes reveal no links and preserve historical records", async () => {
  const { sqlite, tokens, call } = await harness();
  const history = () =>
    [
      "points_telegram_claims",
      "points_telegram_links",
      "points_telegram_flows",
    ].map((table) =>
      sqlite.query(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    );
  try {
    const before = history();
    for (const [path, body] of [
      ["telegram/me", undefined],
      [`telegram/profile?actor=${ME.actor}`, undefined],
      ["telegram/start", { public: true }],
      ["telegram/visibility", { public: true }],
      ["telegram/disconnect", {}],
      ["telegram/cancel", {}],
      ["telegram/webhook", { update_id: 1 }],
    ] as const) {
      const response = await call(path, tokens.me, body);
      expect(response.status).toBe(404);
    }
    const people = await call("people", tokens.me);
    expect(people.status).toBe(200);
    expect(people.body.people.length).toBeGreaterThan(0);
    expect(
      people.body.people.every(
        (person: unknown) => !Object.hasOwn(person as object, "telegram"),
      ),
    ).toBe(true);
    expect(history()).toEqual(before);
  } finally {
    sqlite.close();
  }
});
