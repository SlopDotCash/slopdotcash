import { expect, test } from "bun:test";
import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import {
  ME,
  OTHER,
  seedAccountClosure,
} from "../../tests/account-closure-fixture";
import type { PointsDependencies } from "../points/dependencies";
import { handlePointsApi } from "../points/handler";

const NOW = "2026-11-22T12:00:00.000Z";
const ASSERTION = `slop_assert_v1_${"a".repeat(48)}`;

async function harness() {
  const seeded = await seedAccountClosure(NOW, false);
  const { db, sqlite, tokens } = seeded;
  const deps: PointsDependencies = {
    db,
    now: () => new Date(NOW),
    rateLimitSecret: "fixture-closure-secret".repeat(4),
    identity: {
      fetch: async () =>
        Response.json({
          audience: "slop-points-web",
          githubActorId: ME.github,
          githubNodeId: ME.actor,
          githubLogin: ME.login,
        }),
    },
  };
  let sequence = 0;
  const run = (githubId: string) => {
    sequence += 1;
    const id = `run-${githubId}-${sequence}`;
    sqlite
      .query(
        `INSERT INTO trace_runs (id, client_run_id, github_user_id, github_login, project_id,
           repository, project_policy_revision, provider, model, client, client_version,
           state, trace_sha256, created_at, finalized_at, create_idempotency_key, terms_version)
         VALUES (?, ?, ?, 'login', 'slopdotcash', 'SlopDotCash/slopdotcash', 'rev-1',
           'anthropic', 'claude-opus-5-5', 'claude-code', '1.0.0', 'finalized', ?, ?, ?, ?, 'private-trace-v2')`,
      )
      .run(
        id,
        `client-${id}`,
        githubId,
        sequence.toString(16).padStart(8, "0").repeat(8),
        NOW,
        NOW,
        `create-${id}`,
      );
    return id;
  };
  const licence = (id: string, githubId: string) =>
    sqlite
      .query(
        "INSERT INTO trace_licences (run_id, github_id, state, basis, updated_at) VALUES (?, ?, 'licensed', 'upload', ?)",
      )
      .run(id, githubId, NOW);
  const setting = (githubId: string) =>
    sqlite
      .query(
        "INSERT INTO trace_licensing_settings (github_id, enabled, provider_terms_confirmed, changed_at) VALUES (?, 1, 1, ?)",
      )
      .run(githubId, NOW);
  const close = (token: string, login = ME.login) =>
    handlePointsApi(
      new Request("https://slop.cash/api/v1/points/account/close", {
        method: "POST",
        headers: {
          origin: "https://slop.cash",
          "content-type": "application/json",
          cookie: `__Host-slop_points=${token}`,
        },
        body: JSON.stringify({ login }),
      }),
      deps,
    );
  const reopen = () =>
    handlePointsApi(
      new Request("https://slop.cash/api/v1/points/join", {
        method: "POST",
        headers: {
          origin: "https://slop.cash",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          assertion: ASSERTION,
          public: true,
          reopen: true,
        }),
      }),
      deps,
    );
  const rows = (sql: string, ...args: string[]) =>
    sqlite.query(sql).all(...args);
  return { sqlite, tokens, run, licence, setting, close, reopen, rows };
}

test("closing withdraws all licences and turns licensing off; reopening restores nothing", async () => {
  const h = await harness();
  try {
    const a = h.run(ME.github);
    const b = h.run(ME.github);
    const other = h.run(OTHER.github);
    h.setting(ME.github);
    h.setting(OTHER.github);
    h.licence(a, ME.github);
    h.licence(b, ME.github);
    h.licence(other, OTHER.github);

    expect((await h.close(h.tokens.me)).status).toBe(200);

    expect(
      h.rows(
        "SELECT run_id, state FROM trace_licences WHERE github_id = ? ORDER BY run_id",
        ME.github,
      ),
    ).toEqual([
      { run_id: a, state: "withdrawn" },
      { run_id: b, state: "withdrawn" },
    ]);
    expect(
      h.rows(
        "SELECT enabled FROM trace_licensing_settings WHERE github_id = ?",
        ME.github,
      ),
    ).toEqual([{ enabled: 0 }]);
    const events = h.rows(
      "SELECT id, kind, affected_count FROM trace_licensing_events WHERE github_id = ?",
      ME.github,
    ) as { id: number; kind: string; affected_count: number }[];
    expect(events.map((e) => [e.kind, e.affected_count])).toEqual([
      ["account_closed", 2],
    ]);
    const licenceEvents = h.rows(
      "SELECT kind, reason, account_event_id FROM trace_licence_events WHERE github_id = ?",
      ME.github,
    );
    expect(licenceEvents).toEqual([
      {
        kind: "withdrawn",
        reason: "account_closed",
        account_event_id: events[0].id,
      },
      {
        kind: "withdrawn",
        reason: "account_closed",
        account_event_id: events[0].id,
      },
    ]);
    // Another account is untouched.
    expect(
      h.rows(
        "SELECT state FROM trace_licences WHERE github_id = ?",
        OTHER.github,
      ),
    ).toEqual([{ state: "licensed" }]);
    expect(
      h.rows(
        "SELECT enabled FROM trace_licensing_settings WHERE github_id = ?",
        OTHER.github,
      ),
    ).toEqual([{ enabled: 1 }]);

    // Reopening changes none of the licensing state.
    const before = JSON.stringify([
      h.rows("SELECT * FROM trace_licences ORDER BY run_id"),
      h.rows("SELECT * FROM trace_licensing_settings ORDER BY github_id"),
      h.rows("SELECT * FROM trace_licensing_events ORDER BY id"),
      h.rows("SELECT * FROM trace_licence_events ORDER BY id"),
    ]);
    expect((await h.reopen()).status).toBe(200);
    expect(
      h.rows(
        "SELECT closed_at FROM points_members WHERE github_id = ?",
        ME.github,
      ),
    ).toEqual([{ closed_at: null }]);
    expect(
      JSON.stringify([
        h.rows("SELECT * FROM trace_licences ORDER BY run_id"),
        h.rows("SELECT * FROM trace_licensing_settings ORDER BY github_id"),
        h.rows("SELECT * FROM trace_licensing_events ORDER BY id"),
        h.rows("SELECT * FROM trace_licence_events ORDER BY id"),
      ]),
    ).toBe(before);
  } finally {
    h.sqlite.close();
  }
});

test("an account that never touched licensing gets no licensing rows on close", async () => {
  const h = await harness();
  try {
    expect((await h.close(h.tokens.me)).status).toBe(200);
    expect(h.rows("SELECT * FROM trace_licensing_events")).toEqual([]);
    expect(h.rows("SELECT * FROM trace_licence_events")).toEqual([]);
    expect(h.rows("SELECT * FROM trace_licensing_settings")).toEqual([]);
  } finally {
    h.sqlite.close();
  }
});

test("closing an account with the setting on but no licences records the closure", async () => {
  const h = await harness();
  try {
    h.setting(ME.github);
    expect((await h.close(h.tokens.me)).status).toBe(200);
    expect(
      h.rows(
        "SELECT kind, affected_count FROM trace_licensing_events WHERE github_id = ?",
        ME.github,
      ),
    ).toEqual([{ kind: "account_closed", affected_count: 0 }]);
    expect(
      h.rows(
        "SELECT enabled FROM trace_licensing_settings WHERE github_id = ?",
        ME.github,
      ),
    ).toEqual([{ enabled: 0 }]);
  } finally {
    h.sqlite.close();
  }
});

test("a repeated close writes no second closure event", async () => {
  const h = await harness();
  try {
    h.setting(ME.github);
    h.licence(h.run(ME.github), ME.github);
    expect((await h.close(h.tokens.me)).status).toBe(200);
    // Closing deleted every session; give the closed member a fresh one so
    // the second request reaches the close batch itself.
    const again = "z".repeat(48);
    h.sqlite
      .query(
        "INSERT INTO points_sessions(token_hash,actor_id,expires_at) VALUES(?,?,'2027-01-01T00:00:00.000Z')",
      )
      .run(await sha256Hex(again), ME.actor);
    const second = await h.close(again);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ closed: true });
    expect(
      h.rows(
        "SELECT kind FROM trace_licensing_events WHERE github_id = ?",
        ME.github,
      ),
    ).toEqual([{ kind: "account_closed" }]);
    expect(h.rows("SELECT * FROM trace_licence_events")).toHaveLength(1);
  } finally {
    h.sqlite.close();
  }
});
