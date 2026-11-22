/**
 * The signed-in trace licensing routes, on the real migrations and the real
 * session cookie lookup: the trace list, the account setting and opt-in.
 */
import { expect, test } from "bun:test";
import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import {
  TRACE_LICENCES_API,
  TRACE_LICENSING_API,
  TRACES_ME_API,
} from "../../src/lib/trace-licensing";
import { seedParticipationBan } from "../../tests/participation-ban.fixture";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { sessionGithubActor } from "../points/handler";
import { handleTraceLicensing } from "./handler";

const origin = "https://slop.cash";
const ALICE = "900000100";
const BOB = "900000200";
const NOW = "2026-11-22T12:00:00.000Z";
const SESSION_COOKIE = "__Host-slop_points";

type Body = Record<string, unknown> & { error?: string };

async function harness() {
  const { db, sqlite } = sqliteD1();
  let clock = Date.parse(NOW);
  const tokens = new Map<string, string>();
  for (const [githubId, login] of [
    [ALICE, "alice-gh"],
    [BOB, "bob-gh"],
  ] as const) {
    sqlite
      .query(
        "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES(?,?,?,'2026-11-01T00:00:00.000Z',1)",
      )
      .run(`U_${githubId}`, githubId, login);
    const token = `session-${githubId}-${"x".repeat(40)}`;
    sqlite
      .query(
        "INSERT INTO points_sessions(token_hash,actor_id,expires_at) VALUES(?,?,'2027-01-01T00:00:00.000Z')",
      )
      .run(await sha256Hex(token), `U_${githubId}`);
    tokens.set(githubId, token);
  }
  let sequence = 0;
  /** A run of `githubId`; finalized unless `finalized` is false. */
  const run = (
    githubId: string,
    options: {
      finalized?: boolean;
      termsVersion?: string | null;
      pullRequestUrl?: string;
    } = {},
  ) => {
    sequence += 1;
    const id = `run-${githubId}-${String(sequence).padStart(3, "0")}`;
    const digest = sequence.toString(16).padStart(8, "0").repeat(8);
    const finalized = options.finalized !== false;
    const finalizedAt = new Date(
      Date.parse("2026-11-01T00:00:00.000Z") + sequence * 60_000,
    ).toISOString();
    sqlite
      .query(
        `INSERT INTO trace_runs (id, client_run_id, github_user_id, github_login, project_id,
           repository, project_policy_revision, provider, model, client, client_version,
           state, trace_sha256, created_at, finalized_at, create_idempotency_key, terms_version)
         VALUES (?, ?, ?, 'login', 'slopdotcash', 'SlopDotCash/slopdotcash', 'rev-1',
           'anthropic', 'claude-opus-5-5', 'claude-code', '1.0.0', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        `client-${id}`,
        githubId,
        finalized ? "finalized" : "awaiting_trace",
        finalized ? digest : null,
        "2026-11-01T00:00:00.000Z",
        finalized ? finalizedAt : null,
        `create-${id}`,
        options.termsVersion === undefined
          ? "private-trace-v2"
          : options.termsVersion,
      );
    if (options.pullRequestUrl)
      sqlite
        .query(
          `INSERT INTO run_progress_events (id, run_id, github_user_id, kind, occurred_at,
             source, github_object_id, github_url, head_sha, created_at, idempotency_key)
           VALUES (?, ?, ?, 'pull_request_opened', '2026-11-01T00:00:00.000Z', 'agent',
             NULL, ?, NULL, '2026-11-01T00:00:00.000Z', ?)`,
        )
        .run(
          `event-${id}`,
          id,
          githubId,
          options.pullRequestUrl,
          `event-${id}`,
        );
    return id;
  };
  /** Runs once just before the next batch: a write that lands mid-request. */
  let beforeBatch: (() => void) | null = null;
  const racingDb = Object.assign(Object.create(db), {
    batch: (statements: Parameters<typeof db.batch>[0]) => {
      const hook = beforeBatch;
      beforeBatch = null;
      hook?.();
      return db.batch(statements);
    },
  }) as typeof db;
  const deps = {
    db: racingDb,
    sessionActor: (request: Request) =>
      sessionGithubActor(request, db, new Date(clock).toISOString()),
    now: () => new Date(clock),
  };
  const call = async (
    actor: string | null,
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const cookie: Record<string, string> =
      actor === null
        ? {}
        : { cookie: `${SESSION_COOKIE}=${tokens.get(actor)}` };
    const response = await handleTraceLicensing(
      new Request(`${origin}${path}`, {
        method,
        headers: {
          origin,
          "content-type": "application/json",
          ...cookie,
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      deps,
    );
    if (response === null) throw new Error("Route did not match");
    const text = await response.text();
    return { status: response.status, text, body: JSON.parse(text) as Body };
  };
  const count = (sql: string, ...params: string[]) =>
    (sqlite.query(sql).get(...params) as { n: number }).n;
  const history = () => ({
    account: count("SELECT count(*) AS n FROM trace_licensing_events"),
    licence: count("SELECT count(*) AS n FROM trace_licence_events"),
  });
  return {
    sqlite,
    run,
    call,
    count,
    history,
    raceNextBatch: (hook: () => void) => {
      beforeBatch = hook;
    },
    tick: (ms = 1000) => {
      clock += ms;
    },
    get: (actor: string | null, cursor?: string) =>
      call(
        actor,
        "GET",
        cursor === undefined
          ? TRACES_ME_API
          : `${TRACES_ME_API}?cursor=${encodeURIComponent(cursor)}`,
      ),
    setting: (actor: string | null, body: unknown) =>
      call(actor, "PUT", TRACE_LICENSING_API, body),
    optIn: (actor: string | null, body: unknown) =>
      call(actor, "POST", TRACE_LICENCES_API, body),
  };
}

const ENABLE = { enabled: true, providerTermsConfirmed: true };

test("routes outside trace licensing are not handled", async () => {
  const { db } = sqliteD1();
  const response = await handleTraceLicensing(
    new Request(`${origin}/api/v1/traces/runs`),
    { db, sessionActor: async () => null, now: () => new Date(NOW) },
  );
  expect(response).toBeNull();
});

test("every route needs a signed-in session", async () => {
  const h = await harness();
  expect((await h.get(null)).status).toBe(401);
  expect((await h.setting(null, ENABLE)).status).toBe(401);
  expect((await h.optIn(null, { runIds: ["x"] })).status).toBe(401);
  expect(h.history()).toEqual({ account: 0, licence: 0 });
});

test("writes refuse a cross-site request", async () => {
  const h = await harness();
  const response = await h.call(ALICE, "PUT", TRACE_LICENSING_API, ENABLE, {
    origin: "https://evil.example",
  });
  expect(response.status).toBe(403);
  expect(response.body.error).toBe("origin_forbidden");
  expect(h.history().account).toBe(0);
});

test("the trace list starts off, newest first, with totals and pull request links", async () => {
  const h = await harness();
  const old = h.run(ALICE, { termsVersion: null });
  const v1 = h.run(ALICE, { termsVersion: "private-trace-v1" });
  const withPr = h.run(ALICE, {
    pullRequestUrl: "https://github.com/SlopDotCash/slopdotcash/pull/1",
  });
  h.run(ALICE, { finalized: false });
  h.run(BOB);
  const response = await h.get(ALICE);
  expect(response.status).toBe(200);
  expect(response.body.setting).toEqual({
    enabled: false,
    since: null,
    providerTermsConfirmed: false,
  });
  expect(response.body.totals).toEqual({
    traces: 3,
    licensed: 0,
    eligible: 3,
  });
  const traces = response.body.traces as Array<Record<string, unknown>>;
  expect(traces.map((t) => t.runId)).toEqual([withPr, v1, old]);
  expect(traces[0]).toEqual({
    runId: withPr,
    finalizedAt: expect.any(String),
    projectId: "slopdotcash",
    repository: "SlopDotCash/slopdotcash",
    provider: "anthropic",
    model: "claude-opus-5-5",
    client: "claude-code",
    termsVersion: "private-trace-v2",
    licence: "none",
    pullRequestUrl: "https://github.com/SlopDotCash/slopdotcash/pull/1",
  });
  // A run finalized during the release window without a stamp reads as v1.
  expect(traces[2]?.termsVersion).toBe("private-trace-v1");
  expect(traces[2]?.pullRequestUrl).toBeNull();
  expect(response.body.nextCursor).toBeNull();
});

test("the trace list never returns a trace digest", async () => {
  const h = await harness();
  for (let i = 0; i < 3; i += 1) h.run(ALICE);
  await h.setting(ALICE, ENABLE);
  await h.optIn(ALICE, { all: true, expectedCount: 3 });
  const response = await h.get(ALICE);
  expect(response.status).toBe(200);
  expect(response.text).not.toMatch(/[0-9a-f]{64}/iu);
  const digests = h.sqlite
    .query("SELECT trace_sha256 FROM trace_runs WHERE github_user_id = ?")
    .all(ALICE) as Array<{ trace_sha256: string }>;
  for (const { trace_sha256 } of digests)
    expect(response.text).not.toContain(trace_sha256);
});

test("the trace list pages 100 at a time with a cursor", async () => {
  const h = await harness();
  const ids: string[] = [];
  for (let i = 0; i < 205; i += 1) ids.push(h.run(ALICE));
  ids.reverse();
  const seen: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 3; page += 1) {
    const response = await h.get(ALICE, cursor);
    expect(response.status).toBe(200);
    const traces = response.body.traces as Array<{ runId: string }>;
    seen.push(...traces.map((t) => t.runId));
    cursor = (response.body.nextCursor as string | null) ?? undefined;
    if (page < 2) expect(traces).toHaveLength(100);
  }
  expect(cursor).toBeUndefined();
  expect(seen).toEqual(ids);
  expect((await h.get(ALICE, "not-a-cursor")).status).toBe(400);
});

test("enabling needs the provider terms confirmation", async () => {
  const h = await harness();
  const refused = await h.setting(ALICE, { enabled: true });
  expect(refused.status).toBe(422);
  expect(refused.body.error).toBe("provider_terms_unconfirmed");
  const unticked = await h.setting(ALICE, {
    enabled: true,
    providerTermsConfirmed: false,
  });
  expect(unticked.status).toBe(422);
  expect(h.history().account).toBe(0);
  expect((await h.setting(ALICE, { enabled: "yes" })).status).toBe(400);
  expect((await h.setting(ALICE, { enabled: true, extra: 1 })).status).toBe(
    400,
  );
});

test("turning on records the setting and one account event", async () => {
  const h = await harness();
  const response = await h.setting(ALICE, ENABLE);
  expect(response.status).toBe(200);
  expect(response.body.setting).toEqual({
    enabled: true,
    since: NOW,
    providerTermsConfirmed: true,
  });
  expect(
    h.sqlite
      .query(
        "SELECT github_id, kind, terms_version, affected_count, at FROM trace_licensing_events",
      )
      .all(),
  ).toEqual([
    {
      github_id: ALICE,
      kind: "enabled",
      terms_version: "private-trace-v2",
      affected_count: 0,
      at: NOW,
    },
  ]);
  expect((await h.get(ALICE)).body.setting).toEqual(response.body.setting);
});

test("turning on twice or off twice is idempotent and writes no extra history", async () => {
  const h = await harness();
  h.run(ALICE);
  await h.setting(ALICE, ENABLE);
  await h.optIn(ALICE, { all: true, expectedCount: 1 });
  h.tick();
  const again = await h.setting(ALICE, ENABLE);
  expect(again.status).toBe(200);
  expect(again.body.setting).toEqual({
    enabled: true,
    since: NOW,
    providerTermsConfirmed: true,
  });
  expect(h.history()).toEqual({ account: 2, licence: 1 });

  const off = await h.setting(ALICE, { enabled: false });
  expect(off.status).toBe(200);
  expect(h.history()).toEqual({ account: 3, licence: 2 });
  h.tick();
  const offAgain = await h.setting(ALICE, { enabled: false });
  expect(offAgain.status).toBe(200);
  expect(offAgain.body.setting).toEqual(off.body.setting);
  expect(h.history()).toEqual({ account: 3, licence: 2 });

  // Off on an account that never turned licensing on writes nothing.
  const bobOff = await h.setting(BOB, { enabled: false });
  expect(bobOff.status).toBe(200);
  expect(bobOff.body.setting).toEqual({
    enabled: false,
    since: null,
    providerTermsConfirmed: false,
  });
  expect(h.history()).toEqual({ account: 3, licence: 2 });
});

test("turning off withdraws every licensed trace with one event each", async () => {
  const h = await harness();
  const a = h.run(ALICE);
  const b = h.run(ALICE);
  const c = h.run(ALICE);
  const bobRun = h.run(BOB);
  await h.setting(ALICE, ENABLE);
  await h.setting(BOB, ENABLE);
  await h.optIn(ALICE, { runIds: [a, b] });
  await h.optIn(BOB, { runIds: [bobRun] });
  h.tick();
  const off = await h.setting(ALICE, { enabled: false });
  expect(off.status).toBe(200);
  expect(off.body.setting).toEqual({
    enabled: false,
    since: null,
    providerTermsConfirmed: true,
  });
  const disable = h.sqlite
    .query(
      "SELECT id, affected_count FROM trace_licensing_events WHERE kind = 'disabled'",
    )
    .get() as { id: number; affected_count: number };
  expect(disable.affected_count).toBe(2);
  expect(
    h.sqlite
      .query(
        `SELECT run_id, github_id, reason, account_event_id FROM trace_licence_events
          WHERE kind = 'withdrawn' ORDER BY run_id`,
      )
      .all(),
  ).toEqual([
    {
      run_id: a,
      github_id: ALICE,
      reason: "setting_off",
      account_event_id: disable.id,
    },
    {
      run_id: b,
      github_id: ALICE,
      reason: "setting_off",
      account_event_id: disable.id,
    },
  ]);
  expect(
    h.sqlite
      .query("SELECT run_id, state FROM trace_licences ORDER BY run_id")
      .all(),
  ).toEqual(
    [
      { run_id: a, state: "withdrawn" },
      { run_id: b, state: "withdrawn" },
      { run_id: bobRun, state: "licensed" },
    ].sort((x, y) => x.run_id.localeCompare(y.run_id)),
  );
  const list = await h.get(ALICE);
  expect(list.body.totals).toEqual({ traces: 3, licensed: 0, eligible: 3 });
  const licences = Object.fromEntries(
    (list.body.traces as Array<{ runId: string; licence: string }>).map((t) => [
      t.runId,
      t.licence,
    ]),
  );
  expect(licences).toEqual({ [a]: "withdrawn", [b]: "withdrawn", [c]: "none" });
});

test("opting in while the setting is off is refused", async () => {
  const h = await harness();
  const a = h.run(ALICE);
  const response = await h.optIn(ALICE, { runIds: [a] });
  expect(response.status).toBe(409);
  expect(response.body.error).toBe("licensing_off");
  const all = await h.optIn(ALICE, { all: true, expectedCount: 1 });
  expect(all.status).toBe(409);
  expect(all.body.error).toBe("licensing_off");
  expect(h.history()).toEqual({ account: 0, licence: 0 });
});

test("opting in chosen traces licenses them with one account event and one event each", async () => {
  const h = await harness();
  const a = h.run(ALICE);
  const b = h.run(ALICE);
  h.run(ALICE);
  await h.setting(ALICE, ENABLE);
  const response = await h.optIn(ALICE, { runIds: [a, b, a] });
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ licensed: 2 });
  const event = h.sqlite
    .query(
      "SELECT id, affected_count, terms_version FROM trace_licensing_events WHERE kind = 'opted_in'",
    )
    .get() as { id: number; affected_count: number; terms_version: string };
  expect(event.affected_count).toBe(2);
  expect(event.terms_version).toBe("private-trace-v2");
  expect(
    h.sqlite
      .query(
        "SELECT run_id, kind, reason, account_event_id FROM trace_licence_events ORDER BY run_id",
      )
      .all(),
  ).toEqual([
    {
      run_id: a,
      kind: "granted",
      reason: "opt_in",
      account_event_id: event.id,
    },
    {
      run_id: b,
      kind: "granted",
      reason: "opt_in",
      account_event_id: event.id,
    },
  ]);
  expect(
    h.sqlite
      .query("SELECT run_id, state, basis FROM trace_licences ORDER BY run_id")
      .all(),
  ).toEqual([
    { run_id: a, state: "licensed", basis: "opt_in" },
    { run_id: b, state: "licensed", basis: "opt_in" },
  ]);
  // Already licensed traces are skipped, not licensed twice.
  h.tick();
  const repeat = await h.optIn(ALICE, { runIds: [a] });
  expect(repeat.status).toBe(200);
  expect(repeat.body).toEqual({ licensed: 0 });
  expect(h.history()).toEqual({ account: 2, licence: 2 });
});

test("a withdrawn trace can be opted in again", async () => {
  const h = await harness();
  const a = h.run(ALICE);
  await h.setting(ALICE, ENABLE);
  await h.optIn(ALICE, { runIds: [a] });
  h.tick();
  await h.setting(ALICE, { enabled: false });
  h.tick();
  await h.setting(ALICE, ENABLE);
  h.tick();
  const response = await h.optIn(ALICE, { all: true, expectedCount: 1 });
  expect(response.body).toEqual({ licensed: 1 });
  expect(
    h.sqlite.query("SELECT state, basis FROM trace_licences").get(),
  ).toEqual({ state: "licensed", basis: "opt_in" });
  expect(
    h.sqlite
      .query("SELECT kind, reason FROM trace_licence_events ORDER BY id")
      .all(),
  ).toEqual([
    { kind: "granted", reason: "opt_in" },
    { kind: "withdrawn", reason: "setting_off" },
    { kind: "granted", reason: "opt_in" },
  ]);
});

test("bulk opt-in licenses every eligible trace when the count matches", async () => {
  const h = await harness();
  const ids = [
    h.run(ALICE),
    h.run(ALICE),
    h.run(ALICE, { termsVersion: null }),
  ];
  h.run(ALICE, { finalized: false });
  h.run(BOB);
  await h.setting(ALICE, ENABLE);
  const response = await h.optIn(ALICE, { all: true, expectedCount: 3 });
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ licensed: 3 });
  expect(
    (
      h.sqlite
        .query(
          "SELECT run_id FROM trace_licences WHERE state = 'licensed' ORDER BY run_id",
        )
        .all() as Array<{ run_id: string }>
    ).map((r) => r.run_id),
  ).toEqual([...ids].sort());
  expect((await h.get(ALICE)).body.totals).toEqual({
    traces: 3,
    licensed: 3,
    eligible: 0,
  });
});

test("a bulk opt-in racing a new upload refuses with count_changed and licenses nothing", async () => {
  const h = await harness();
  h.run(ALICE);
  h.run(ALICE);
  await h.setting(ALICE, ENABLE);
  const seen = (await h.get(ALICE)).body.totals as { eligible: number };
  expect(seen.eligible).toBe(2);
  // A new trace is finalized between the list and the confirm.
  h.run(ALICE);
  const response = await h.optIn(ALICE, {
    all: true,
    expectedCount: seen.eligible,
  });
  expect(response.status).toBe(409);
  expect(response.body.error).toBe("count_changed");
  expect(h.count("SELECT count(*) AS n FROM trace_licences")).toBe(0);
  expect(h.history()).toEqual({ account: 1, licence: 0 });
});

test("an upload that lands inside the opt-in request still refuses the whole batch", async () => {
  const h = await harness();
  h.run(ALICE);
  h.run(ALICE);
  await h.setting(ALICE, ENABLE);
  h.raceNextBatch(() => h.run(ALICE));
  const response = await h.optIn(ALICE, { all: true, expectedCount: 2 });
  expect(response.status).toBe(409);
  expect(response.body.error).toBe("count_changed");
  expect(h.count("SELECT count(*) AS n FROM trace_licences")).toBe(0);
  expect(h.history()).toEqual({ account: 1, licence: 0 });
});

test("a ban or a turn-off that lands inside a request writes nothing", async () => {
  const h = await harness();
  const a = h.run(ALICE);
  await h.setting(ALICE, ENABLE);
  h.raceNextBatch(() =>
    h.sqlite
      .query(
        "UPDATE trace_licensing_settings SET enabled = 0 WHERE github_id = ?",
      )
      .run(ALICE),
  );
  const off = await h.optIn(ALICE, { runIds: [a] });
  expect(off.status).toBe(409);
  expect(off.body.error).toBe("licensing_off");
  h.raceNextBatch(() =>
    seedParticipationBan(
      h.sqlite,
      { githubId: BOB, githubLogin: "bob-gh" },
      { githubId: "900000900", githubLogin: "moderator" },
      NOW,
    ),
  );
  const banned = await h.setting(BOB, ENABLE);
  expect(banned.status).toBe(403);
  expect(banned.body.error).toBe("participation_banned");
  expect(h.history()).toEqual({ account: 1, licence: 0 });
  expect(h.count("SELECT count(*) AS n FROM trace_licences")).toBe(0);
  expect(
    h.count(
      "SELECT count(*) AS n FROM trace_licensing_settings WHERE github_id = ?",
      BOB,
    ),
  ).toBe(0);
});

test("another account's run id is refused and nothing is licensed", async () => {
  const h = await harness();
  const mine = h.run(ALICE);
  const theirs = h.run(BOB);
  const pending = h.run(ALICE, { finalized: false });
  await h.setting(ALICE, ENABLE);
  for (const runIds of [
    [mine, theirs],
    [mine, pending],
    [mine, "no-such-run"],
  ]) {
    const response = await h.optIn(ALICE, { runIds });
    expect(response.status).toBe(404);
    expect(response.body.error).toBe("run_not_found");
  }
  expect(h.count("SELECT count(*) AS n FROM trace_licences")).toBe(0);
  expect(h.history()).toEqual({ account: 1, licence: 0 });
});

test("opt-in bodies are bounded and exact", async () => {
  const h = await harness();
  await h.setting(ALICE, ENABLE);
  const tooMany = Array.from({ length: 501 }, (_, i) => `run-${i}`);
  expect((await h.optIn(ALICE, { runIds: tooMany })).status).toBe(422);
  expect((await h.optIn(ALICE, { runIds: [] })).status).toBe(422);
  expect((await h.optIn(ALICE, { runIds: [1] })).status).toBe(422);
  expect((await h.optIn(ALICE, { all: true })).status).toBe(400);
  expect((await h.optIn(ALICE, { all: true, expectedCount: -1 })).status).toBe(
    422,
  );
  expect((await h.optIn(ALICE, { all: false, expectedCount: 0 })).status).toBe(
    422,
  );
  expect(
    (await h.optIn(ALICE, { runIds: ["a"], all: true, expectedCount: 1 }))
      .status,
  ).toBe(400);
  expect(h.history()).toEqual({ account: 1, licence: 0 });
});

test("500 run ids in one request are accepted", async () => {
  const h = await harness();
  const ids: string[] = [];
  for (let i = 0; i < 500; i += 1) ids.push(h.run(ALICE));
  await h.setting(ALICE, ENABLE);
  const response = await h.optIn(ALICE, { runIds: ids });
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ licensed: 500 });
});

test("a participation-banned account cannot turn licensing on or opt in, and keeps its licences", async () => {
  const h = await harness();
  const a = h.run(ALICE);
  const b = h.run(ALICE);
  await h.setting(ALICE, ENABLE);
  await h.optIn(ALICE, { runIds: [a] });
  seedParticipationBan(
    h.sqlite,
    { githubId: ALICE, githubLogin: "alice-gh" },
    { githubId: "900000900", githubLogin: "moderator" },
    NOW,
  );
  const optIn = await h.optIn(ALICE, { runIds: [b] });
  expect(optIn.status).toBe(403);
  expect(optIn.body.error).toBe("participation_banned");
  expect(h.history()).toEqual({ account: 2, licence: 1 });
  expect(h.sqlite.query("SELECT state FROM trace_licences").all()).toEqual([
    { state: "licensed" },
  ]);

  seedParticipationBan(
    h.sqlite,
    { githubId: BOB, githubLogin: "bob-gh" },
    { githubId: "900000900", githubLogin: "moderator" },
    NOW,
  );
  const enable = await h.setting(BOB, ENABLE);
  expect(enable.status).toBe(403);
  expect(enable.body.error).toBe("participation_banned");
  expect(
    h.count(
      "SELECT count(*) AS n FROM trace_licensing_events WHERE github_id = ?",
      BOB,
    ),
  ).toBe(0);
});

test("a closed account with a live session cookie is refused on every route and nothing is written", async () => {
  const h = await harness();
  const a = h.run(ALICE);
  await h.setting(ALICE, ENABLE);
  const before = h.history();
  h.sqlite
    .query(
      "UPDATE points_members SET closed_at = ?, public = 0 WHERE github_id = ?",
    )
    .run(NOW, ALICE);
  for (const response of [
    await h.get(ALICE),
    await h.setting(ALICE, { enabled: false }),
    await h.setting(ALICE, ENABLE),
    await h.optIn(ALICE, { runIds: [a] }),
    await h.optIn(ALICE, { all: true, expectedCount: 1 }),
  ]) {
    expect(response.status).toBe(403);
    expect(response.body.error).toBe("account_closed");
  }
  expect(h.history()).toEqual(before);
  expect(h.count("SELECT count(*) AS n FROM trace_licences")).toBe(0);
});

test("an expected-actor header for another account is refused", async () => {
  const h = await harness();
  const response = await h.call(ALICE, "PUT", TRACE_LICENSING_API, ENABLE, {
    "x-slop-expected-github-id": BOB,
  });
  expect(response.status).toBe(403);
  expect(response.body.error).toBe("actor_changed");
  expect(h.history().account).toBe(0);
});

test("other methods on the routes are refused", async () => {
  const h = await harness();
  expect((await h.call(ALICE, "POST", TRACES_ME_API, {})).status).toBe(405);
  expect((await h.call(ALICE, "GET", TRACE_LICENSING_API)).status).toBe(405);
  expect((await h.call(ALICE, "GET", TRACE_LICENCES_API)).status).toBe(405);
});
