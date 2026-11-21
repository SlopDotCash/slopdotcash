/**
 * The private protected-point-months route (operator decision, 21 November
 * 2026; PRD section 7), against real migrated SQLite and the deployed Pages
 * router. Its answer is compared with the Points import's own predicate for
 * every kind of protecting record.
 */
import type { Database as Sqlite } from "bun:sqlite";
import { expect, spyOn, test } from "bun:test";
import { onRequest } from "../../functions/api/v1/[[path]]";
import {
  pointProtectionQuery,
  protectedPointAwardSql,
} from "../../scripts/points-protection-sql";
import { sqliteD1 } from "../../tests/sqlite-d1";
import type { D1Database, D1QueryStatement } from "../d1";
import {
  handleProtectedPointMonths,
  PROTECTED_POINT_MONTHS_PATH,
  type ProtectedPointMonths,
  readProtectedPointMonths,
} from "./protected-point-months";
import {
  MINIMUM_FEED_TOKEN_LENGTH,
  RESERVED_AWARDS_PATH,
} from "./reserved-awards-feed";

const AT = "2026-11-21T12:00:00.000Z";
const TOKEN = "protection-token-0123456789abcdef0123456789";
const URL_ = `https://slop.cash${PROTECTED_POINT_MONTHS_PATH}`;
const ACTOR = "424242";
const LOGIN = "private-login";
const AMOUNT = "107560000";
const FEE = "2150000";
const RECIPIENT = "Wa11et11111111111111111111111111111111111111";
const BLOCK = "block-31337";
const ASSET = `0x${"2".repeat(40)}`;
// The one reviewed Base qualification payment the predicate leaves out.
const QUALIFICATION = {
  id: "0xe63ed9a7de8b38d1e847c4d850c7cb08d15ca429615c933eaefd9683b6367c4c",
  vault: "0x6c1297c3b96a00347cb501f572cb5811c2a8ed36",
  source: "991cdcc980c86dee602eccb30c79290a51a67f4569b2292efad7211d62086ee3",
  transaction:
    "0x4b9290966d9bacbe77d0e936ccb749cc8c0b9622331bf8f4a42b965c1fa704d8",
};

let sequence = 0;
const digest = () => (++sequence).toString(16).padStart(64, "0");

function fixture() {
  const { db, sqlite } = sqliteD1();
  const database = db as unknown as D1Database<D1QueryStatement>;
  // Reward bases, base rows and project rows are not part of this read.
  sqlite.run("PRAGMA foreign_keys = OFF");
  /** A frozen monthly payment run. */
  function run(project: string, period: string) {
    sqlite
      .query(
        `INSERT INTO monthly_payment_runs
           (project_id,period,trigger,actor_id,allocation_sequence,snapshot,
            snapshot_sha256,network,vault,total_gross_base,frozen_at)
         VALUES (?,?,'automatic',NULL,0,'{}',?,'solana-mainnet',?,?,?)`,
      )
      .run(project, period, digest(), `vault-${project}`, AMOUNT, AT);
  }
  /** An owner's allocation change before the month is frozen. */
  function change(project: string, period: string) {
    sqlite
      .query(
        `INSERT INTO monthly_allocation_changes
           (project_id,period,sequence,github_user_id,gross_base,actor_id,created_at)
         VALUES (?,?,1,?,?,?,?)`,
      )
      .run(project, period, ACTOR, AMOUNT, ACTOR, AT);
  }
  /** A payment sent outside the vault flow for a contribution month. */
  function direct(project: string, period: string) {
    sqlite
      .query(
        `INSERT INTO payment_direct_transfers
           (network,transaction_id,project_id,contribution_month,github_user_id,
            github_node_id,github_login,chain,recipient,amount_micro,block_time,
            block_id,source_path,imported_at)
         VALUES ('solana-mainnet',?,?,?,?,?,?,'solana',?,?,?,?,?,?)`,
      )
      .run(
        `transfer-${digest()}`,
        project,
        period,
        ACTOR,
        `node-${ACTOR}`,
        LOGIN,
        RECIPIENT,
        AMOUNT,
        AT,
        BLOCK,
        "disclosures/private.json",
        AT,
      );
  }
  /** A vault obligation; returns the digest a monthly row would map it by. */
  function obligation(
    project: string,
    over: Partial<{
      id: string;
      network: string;
      vault: string;
      source: string;
      state: "reserved" | "paid";
      transaction: string | null;
    }> = {},
  ) {
    const source = over.source ?? digest();
    const state = over.state ?? "reserved";
    sqlite
      .query(
        `INSERT INTO payment_obligations
           (id,project_id,github_user_id,network,chain,vault,asset_address,
            asset_decimals,gross_base,fee_base,source_digest,state,created_at,
            paid_transaction)
         VALUES (?,?,?,?,'base',?,?,6,?,?,?,?,?,?)`,
      )
      .run(
        over.id ?? `obligation-${digest()}`,
        project,
        ACTOR,
        over.network ?? "base-mainnet",
        over.vault ?? `vault-${project}`,
        ASSET,
        AMOUNT,
        FEE,
        source,
        state,
        AT,
        over.transaction === undefined
          ? state === "paid"
            ? `paid-${source}`
            : null
          : over.transaction,
      );
    return source;
  }
  /** The monthly allocation row that accounts for an obligation. */
  function mapped(project: string, period: string, source: string) {
    sqlite
      .query(
        `INSERT INTO monthly_payment_obligations
           (project_id,period,github_user_id,github_login,gross_base,fee_base,
            source_digest,network,vault,created_at)
         VALUES (?,?,?,?,?,?,?,'base-mainnet',?,?)`,
      )
      .run(
        project,
        period,
        ACTOR,
        LOGIN,
        AMOUNT,
        FEE,
        source,
        `vault-${project}`,
        AT,
      );
  }
  /** The finalized payment evidence of the Base qualification payment. */
  function qualificationEvidence(project: string) {
    sqlite
      .query(
        `INSERT INTO payment_events
           (network,transaction_id,event_index,block_id,kind,obligation_id,
            evidence_json,observed_at)
         VALUES ('base-mainnet',?,982,?,'paid',?,?,?)`,
      )
      .run(
        QUALIFICATION.transaction,
        BLOCK,
        QUALIFICATION.id,
        JSON.stringify({ projectId: project }),
        AT,
      );
  }
  return {
    database,
    sqlite,
    run,
    change,
    direct,
    obligation,
    mapped,
    qualificationEvidence,
    read: () => readProtectedPointMonths(database),
  };
}

async function withFixture(
  body: (f: ReturnType<typeof fixture>) => Promise<void>,
) {
  const f = fixture();
  try {
    await body(f);
  } finally {
    f.sqlite.close();
  }
}

const PROJECTS = [
  "runs",
  "changes",
  "direct",
  "legacy",
  "mapped",
  "qualified",
  "unqualified",
  "quiet",
];
const PERIODS = ["2026-08", "2026-09", "2026-10", "2026-11", "2026-12"];
const SCOPES = PROJECTS.flatMap((projectId) =>
  PERIODS.map((period) => ({ projectId, period })),
);
const key = (scope: { projectId: string; period: string }) =>
  `${scope.projectId} ${scope.period}`;

/** What the route's answer says about each scope. */
function routeProtects(answer: ProtectedPointMonths): Set<string> {
  const months = new Set(answer.months.map(key));
  const projects = new Set(answer.everyMonthProjects);
  return new Set(
    SCOPES.filter(
      (scope) => months.has(key(scope)) || projects.has(scope.projectId),
    ).map(key),
  );
}

/** What the import guard's predicate says about an award in each scope. */
function importProtects(sqlite: Sqlite): Set<string> {
  const guard = sqlite.query<{ protected: number }, [string]>(
    `SELECT ${protectedPointAwardSql("r.payload")} AS protected FROM (SELECT ? AS payload) r`,
  );
  return new Set(
    SCOPES.filter(
      (scope) =>
        guard.get(
          JSON.stringify({
            award: {
              projectId: scope.projectId,
              occurredAt: `${scope.period}-15T08:30:00.000Z`,
            },
          }),
        )?.protected === 1,
    ).map(key),
  );
}

/** The trusted preflight is the same predicate asked scope by scope. */
function preflightProtects(sqlite: Sqlite): Set<string> {
  return new Set(
    sqlite
      .query<{ project_id: string; period: string; protected: number }, []>(
        pointProtectionQuery(SCOPES),
      )
      .all()
      .filter((row) => row.protected === 1)
      .map((row) => key({ projectId: row.project_id, period: row.period })),
  );
}

test("the route agrees with the import guard for every kind of protecting record", () =>
  withFixture(async (f) => {
    const expected = new Set<string>();
    const agree = async () => {
      const answer = await f.read();
      const route = [...routeProtects(answer)].sort();
      expect(route).toEqual([...importProtects(f.sqlite)].sort());
      expect(route).toEqual([...preflightProtects(f.sqlite)].sort());
      expect(route).toEqual([...expected].sort());
      return answer;
    };
    const everyMonth = (project: string) => {
      for (const period of PERIODS) expected.add(`${project} ${period}`);
    };
    // Nothing is recorded: nothing is protected.
    expect(await agree()).toEqual({ months: [], everyMonthProjects: [] });

    // A frozen monthly run protects its own project month only.
    f.run("runs", "2026-10");
    expected.add("runs 2026-10");
    await agree();

    // So does an owner's allocation change, before any run exists.
    f.change("changes", "2026-11");
    expected.add("changes 2026-11");
    await agree();

    // And a direct transfer, by its contribution month.
    f.direct("direct", "2026-08");
    f.direct("direct", "2026-08");
    expected.add("direct 2026-08");
    await agree();

    // An obligation that no monthly allocation accounts for protects every
    // month of its project.
    f.obligation("legacy");
    everyMonth("legacy");
    await agree();

    // An obligation its month accounts for protects that month, through the
    // month's run, and no other.
    f.run("mapped", "2026-10");
    f.mapped("mapped", "2026-10", f.obligation("mapped", { state: "paid" }));
    expected.add("mapped 2026-10");
    await agree();

    // The Base qualification payment with its finalized evidence protects
    // nothing.
    f.obligation("qualified", {
      id: QUALIFICATION.id,
      vault: QUALIFICATION.vault,
      source: QUALIFICATION.source,
      state: "paid",
      transaction: QUALIFICATION.transaction,
    });
    everyMonth("qualified");
    await agree();
    f.qualificationEvidence("qualified");
    for (const period of PERIODS) expected.delete(`qualified ${period}`);
    await agree();

    // A paid obligation that is not that exact payment still protects every
    // month.
    f.obligation("unqualified", { state: "paid" });
    everyMonth("unqualified");
    const answer = await agree();

    // "quiet" has no record and stays unprotected in every month.
    expect(answer).toEqual({
      months: [
        { projectId: "changes", period: "2026-11" },
        { projectId: "direct", period: "2026-08" },
        { projectId: "mapped", period: "2026-10" },
        { projectId: "runs", period: "2026-10" },
      ],
      everyMonthProjects: ["legacy", "unqualified"],
    });
    expect([...routeProtects(answer)].some((s) => s.startsWith("quiet"))).toBe(
      false,
    );
  }));

test("the answer names project months and projects only", () =>
  withFixture(async (f) => {
    f.run("runs", "2026-10");
    f.change("changes", "2026-11");
    f.direct("direct", "2026-08");
    const source = f.obligation("legacy");
    const response = await handleProtectedPointMonths(
      new Request(URL_, { headers: { authorization: `Bearer ${TOKEN}` } }),
      { db: f.database, token: TOKEN, now: () => new Date(AT) },
    );
    expect(response?.status).toBe(200);
    expect(response?.headers.get("cache-control")).toBe("no-store");
    const text = await (response as Response).text();
    expect(JSON.parse(text)).toEqual({
      schema: "slop-protected-point-months-v1",
      generatedAt: AT,
      months: [
        { projectId: "changes", period: "2026-11" },
        { projectId: "direct", period: "2026-08" },
        { projectId: "runs", period: "2026-10" },
      ],
      everyMonthProjects: ["legacy"],
    });
    // No amount, recipient, account, vault, asset, transaction, source or
    // network, and nothing that says which kind of record protects a month.
    for (const hidden of [
      AMOUNT,
      FEE,
      ACTOR,
      LOGIN,
      RECIPIENT,
      BLOCK,
      ASSET,
      source,
      "vault-",
      "transfer-",
      "obligation-",
      "mainnet",
      "automatic",
      "disclosures",
      "reserved",
    ])
      expect(text).not.toContain(hidden);
  }));

test("a record whose month no award can carry protects nothing, here and in the import guard", () =>
  withFixture(async (f) => {
    f.run("runs", "2026-10");
    f.direct("direct", "October 2026");
    f.direct("direct", "2026-13");
    f.run("changes", "2026-1");
    const answer = await f.read();
    expect(answer).toEqual({
      months: [{ projectId: "runs", period: "2026-10" }],
      everyMonthProjects: [],
    });
    expect([...routeProtects(answer)]).toEqual(["runs 2026-10"]);
    expect([...importProtects(f.sqlite)]).toEqual(["runs 2026-10"]);
  }));

test("a failed read is the API's internal error, with a fixed log label and no detail", () =>
  withFixture(async (f) => {
    f.run("runs", "2026-10");
    const broken = {
      prepare() {
        throw new Error(`no such table: ${TOKEN} ${AMOUNT}`);
      },
    } as unknown as D1Database<D1QueryStatement>;
    const logged = spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await handleProtectedPointMonths(
        new Request(URL_, { headers: { authorization: `Bearer ${TOKEN}` } }),
        { db: broken, token: TOKEN },
      );
      expect(response?.status).toBe(500);
      expect(JSON.parse(await (response as Response).text())).toEqual({
        error: "internal_error",
        message: "Internal error",
      });
      expect(logged.mock.calls).toEqual([["protected point months failure"]]);
    } finally {
      logged.mockRestore();
    }
  }));

test("only the exact bearer token of a configured secret opens the route", () =>
  withFixture(async (f) => {
    f.run("runs", "2026-10");
    const ask = (
      token: string | undefined,
      authorization?: string,
      method = "GET",
      url = URL_,
    ) =>
      handleProtectedPointMonths(
        new Request(url, {
          method,
          headers: authorization ? { authorization } : {},
        }),
        { db: f.database, token },
      );
    // Not this route: no secret, no header, a wrong or reshaped token.
    expect(await ask(undefined, `Bearer ${TOKEN}`)).toBeNull();
    expect(await ask("", "Bearer ")).toBeNull();
    expect(await ask(TOKEN)).toBeNull();
    expect(await ask(TOKEN, `Bearer ${TOKEN}x`)).toBeNull();
    expect(await ask(TOKEN, `Bearer ${TOKEN.slice(0, -1)}`)).toBeNull();
    expect(await ask(TOKEN, `bearer ${TOKEN}`)).toBeNull();
    expect(await ask(TOKEN, TOKEN)).toBeNull();
    expect(await ask(TOKEN, "Bearer wrong", "POST")).toBeNull();
    // A configured secret shorter than the minimum is treated as unset.
    const short = "s".repeat(MINIMUM_FEED_TOKEN_LENGTH - 1);
    expect(await ask(short, `Bearer ${short}`)).toBeNull();
    // The stand-in used for an unset secret never authorizes.
    expect(
      await ask(undefined, `Bearer ${"x".repeat(MINIMUM_FEED_TOKEN_LENGTH)}`),
    ).toBeNull();
    // The right token: an answer, a trailing slash, and no other method.
    expect((await ask(TOKEN, `Bearer ${TOKEN}`))?.status).toBe(200);
    expect(
      (await ask(TOKEN, `Bearer ${TOKEN}`, "GET", `${URL_}/`))?.status,
    ).toBe(200);
    expect(await ask(TOKEN, `Bearer ${TOKEN}`, "POST")).toMatchObject({
      status: 405,
    });
    // Another path is never answered, even with the token.
    expect(
      await ask(TOKEN, `Bearer ${TOKEN}`, "GET", `${URL_}/extra`),
    ).toBeNull();
  }));

/** The deployed Pages router with real migrated SQLite. */
async function routed(
  d1: { db: unknown },
  path: string,
  env: Record<string, string>,
  authorization?: string,
) {
  const response = await onRequest({
    request: new Request(`https://slop.cash${path}`, {
      headers: authorization ? { authorization } : {},
    }),
    env: {
      SLOP_DB: d1.db,
      PAYMENT_NETWORKS: "[]",
      TRACE_AUTH_SECRET: "test-only-trace-rate-limit-secret-long-enough",
      ...env,
    },
  } as never);
  return {
    status: response.status,
    body: await response.text(),
    headers: [...response.headers].sort(),
  };
}

test("through the router, a wrong or missing token is the same answer as a path that does not exist", () =>
  withFixture(async (f) => {
    f.run("runs", "2026-10");
    f.obligation("legacy");
    const d1 = { db: f.database };
    const unknown = await routed(d1, "/api/v1/operator/no-such-route", {});
    expect(unknown.status).toBe(404);
    const env = { POINTS_PROTECTION_TOKEN: TOKEN };
    for (const answer of [
      await routed(d1, PROTECTED_POINT_MONTHS_PATH, {}),
      await routed(d1, PROTECTED_POINT_MONTHS_PATH, {}, `Bearer ${TOKEN}`),
      await routed(d1, PROTECTED_POINT_MONTHS_PATH, env),
      await routed(d1, PROTECTED_POINT_MONTHS_PATH, env, "Bearer wrong"),
      // The reserved-awards secret is a different secret: it opens neither
      // this route when only it is set, nor its own route with this token.
      await routed(
        d1,
        PROTECTED_POINT_MONTHS_PATH,
        { OPERATOR_FEED_TOKEN: TOKEN },
        `Bearer ${TOKEN}`,
      ),
      await routed(d1, RESERVED_AWARDS_PATH, env, `Bearer ${TOKEN}`),
    ])
      expect(answer).toEqual(unknown);
    const answer = await routed(
      d1,
      PROTECTED_POINT_MONTHS_PATH,
      env,
      `Bearer ${TOKEN}`,
    );
    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.body)).toMatchObject({
      schema: "slop-protected-point-months-v1",
      months: [{ projectId: "runs", period: "2026-10" }],
      everyMonthProjects: ["legacy"],
    });
    expect(answer.headers).toContainEqual(["cache-control", "no-store"]);
  }));
