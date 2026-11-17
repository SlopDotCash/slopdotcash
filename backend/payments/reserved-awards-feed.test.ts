/**
 * The private reserved-awards feed (operator decision, 17 November 2026; PRD
 * section 9), against real migrated SQLite and the deployed Pages router.
 */
import type { Database as Sqlite } from "bun:sqlite";
import { expect, test } from "bun:test";
import { onRequest } from "../../functions/api/v1/[[path]]";
import { sqliteD1 } from "../../tests/sqlite-d1";
import type { D1Database, D1QueryStatement } from "../d1";
import {
  handleReservedAwardsFeed,
  MINIMUM_FEED_TOKEN_LENGTH,
  RESERVED_AWARDS_PATH,
  type ReservedAward,
  readReservedAwards,
} from "./reserved-awards-feed";

const AT = "2026-11-17T12:00:00.000Z";
const TOKEN = "feed-token-0123456789abcdef0123456789abcdef";
const URL_ = `https://slop.cash${RESERVED_AWARDS_PATH}`;
const EVM_VAULT = `0x${"3".repeat(40)}`;
const EVM_ASSET = `0x${"2".repeat(40)}`;
const SOLANA_VAULT = "So1anaVau1t1111111111111111111111111111111";
const SOLANA_ASSET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const NO_TEAM: ReadonlySet<string> = new Set();

let sequence = 0;
const digest = () => (++sequence).toString(16).padStart(64, "0");

type Award = {
  actor: string;
  project?: string;
  network?: "robinhood-mainnet" | "solana-mainnet" | "base-sepolia";
  state?: "reserved" | "paid";
};

function fixture() {
  const { db, sqlite } = sqliteD1();
  const database = db as unknown as D1Database<D1QueryStatement>;
  const seen = new Set<string>();
  /** One award in the project's vault; returns its obligation id. */
  function award({
    actor,
    project = "feed",
    network = "solana-mainnet",
    state = "reserved",
  }: Award): string {
    const id = digest();
    const solana = network === "solana-mainnet";
    sqlite
      .query(
        `INSERT INTO payment_obligations
           (id,project_id,github_user_id,network,chain,vault,asset_address,
            asset_decimals,gross_base,fee_base,source_digest,state,created_at,
            paid_transaction)
         VALUES (?,?,?,?,?,?,?,6,'107560000','2150000',?,?,?,?)`,
      )
      .run(
        id,
        project,
        actor,
        network,
        solana ? "solana" : network === "base-sepolia" ? "base" : "robinhood",
        solana ? SOLANA_VAULT : EVM_VAULT,
        solana ? SOLANA_ASSET : EVM_ASSET,
        digest(),
        state,
        AT,
        state === "paid" ? `tx-${id}` : null,
      );
    if (!seen.has(project)) {
      seen.add(project);
      const manifest = JSON.stringify({
        id: project,
        name: project === "feed" ? "Feed" : "The Network",
      });
      sqlite
        .query(
          "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES (?,1,?,?,?,?)",
        )
        .run(project, manifest, "0".repeat(64), "test fixture", AT);
      sqlite
        .query(
          "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES (?,'active',1,?,?,?,?)",
        )
        .run(project, manifest, "0".repeat(64), AT, AT);
    }
    return id;
  }
  /** A registered wallet claim; `confirmed` adds the signed authorization. */
  function wallet(
    actor: string,
    chain: "solana" | "robinhood" | "base",
    { confirmed = true, login = `login-${actor}` } = {},
  ): string {
    const id = `claim-${digest().slice(-8)}`;
    sqlite
      .query(
        `INSERT INTO wallet_claims
           (id,github_user_id,github_login,wallet_address,source,
            source_body_sha256,observed_at,record_sha256,created_at,chain)
         VALUES (?,?,?,?,'d1_registry',?,?,?,?,?)`,
      )
      .run(
        id,
        actor,
        login,
        chain === "solana"
          ? "Wa11et11111111111111111111111111111111111111"
          : `0x${"a".repeat(40)}`,
        digest(),
        AT,
        digest(),
        AT,
        chain,
      );
    if (confirmed) {
      sqlite
        .query(
          "INSERT INTO payment_wallet_challenges(id,claim_id,github_user_id,message,expires_at,consumed_at) VALUES (?,?,?,?,?,?)",
        )
        .run(`challenge-${id}`, id, actor, "message", AT, AT);
      sqlite
        .query(
          "INSERT INTO payment_wallet_authorizations(claim_id,github_user_id,authorized_at,challenge_id,signature) VALUES (?,?,?,?,?)",
        )
        .run(id, actor, AT, `challenge-${id}`, "signature");
    }
    return id;
  }
  function member(actor: string, login: string, closed = false) {
    sqlite
      .query(
        "INSERT INTO points_members(actor_id,github_id,login,joined_at,public,closed_at) VALUES (?,?,?,?,0,?)",
      )
      .run(`node-${actor}`, actor, login, AT, closed ? AT : null);
  }
  /** The login a closed month recorded for this contributor's award. */
  function monthlyLogin(actor: string, project: string, login: string) {
    // The month's run and base rows are not part of this read.
    sqlite.run("PRAGMA foreign_keys = OFF");
    sqlite
      .query(
        `INSERT INTO monthly_payment_obligations
           (project_id,period,github_user_id,github_login,gross_base,fee_base,
            source_digest,network,vault,created_at)
         VALUES (?,'2026-10',?,?,'107560000','2150000',?,'solana-mainnet',?,?)`,
      )
      .run(project, actor, login, digest(), SOLANA_VAULT, AT);
    sqlite.run("PRAGMA foreign_keys = ON");
  }
  const read = (team: ReadonlySet<string> = NO_TEAM, tier = "production") =>
    readReservedAwards(database, { tier, teamGithubIds: team });
  return { database, sqlite, award, wallet, member, monthlyLogin, read };
}

function row(patch: Partial<ReservedAward>): ReservedAward {
  return {
    githubId: 101,
    login: "login-101",
    projectId: "feed",
    projectName: "Feed",
    network: "solana-mainnet",
    needs: "wallet",
    ...patch,
  };
}

/** Closes the fixture database after the test body. */
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

test("a reserved award with no wallet, or an unconfirmed one, needs a wallet", () =>
  withFixture(async (f) => {
    f.award({ actor: "101" });
    f.member("101", "alice");
    f.award({ actor: "102" });
    f.wallet("102", "solana", { confirmed: false });
    // A confirmed wallet on another network does not count for this vault.
    f.award({
      actor: "103",
      project: "thenetwork",
      network: "robinhood-mainnet",
    });
    f.wallet("103", "solana");
    expect(await f.read()).toEqual([
      row({ githubId: 101, login: "alice" }),
      row({ githubId: 102, login: "login-102" }),
      row({
        githubId: 103,
        login: "login-103",
        projectId: "thenetwork",
        projectName: "The Network",
        network: "robinhood-mainnet",
      }),
    ]);
  }));

test("a confirmed wallet with no payout binding needs the authorize step", () =>
  withFixture(async (f) => {
    f.award({ actor: "101" });
    f.wallet("101", "solana");
    f.award({
      actor: "104",
      project: "thenetwork",
      network: "robinhood-mainnet",
    });
    f.wallet("104", "robinhood");
    expect(await f.read()).toEqual([
      row({ githubId: 101, needs: "authorize" }),
      row({
        githubId: 104,
        login: "login-104",
        projectId: "thenetwork",
        projectName: "The Network",
        network: "robinhood-mainnet",
        needs: "authorize",
      }),
    ]);
  }));

test("an award whose wallet is confirmed and bound is being paid and is left out", () =>
  withFixture(async (f) => {
    // Solana: a binding attempt that did not fail, for this wallet and vault.
    const solana = f.award({ actor: "101" });
    const claim = f.wallet("101", "solana");
    f.sqlite
      .query(
        "INSERT INTO payment_attempts(id,obligation_id,claim_id,created_at,state) VALUES ('attempt-1',?,?,?,'prepared')",
      )
      .run(solana, claim, AT);
    // EVM: the wallet's signed binding authorization for this vault.
    f.award({
      actor: "104",
      project: "thenetwork",
      network: "robinhood-mainnet",
    });
    const evm = f.wallet("104", "robinhood");
    f.sqlite
      .query(
        "INSERT INTO payment_binding_authorizations(claim_id,github_user_id,network,vault,chain_id,expected_version,expires_at,signature,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      )
      .run(
        evm,
        "104",
        "robinhood-mainnet",
        EVM_VAULT.toUpperCase().replace("0X", "0x"),
        "4663",
        "0",
        AT,
        "signature",
        AT,
      );
    expect(await f.read()).toEqual([]);
    // A failed binding attempt is not a binding.
    f.sqlite.run("UPDATE payment_attempts SET state='failed'");
    expect(await f.read()).toEqual([
      row({ githubId: 101, needs: "authorize" }),
    ]);
  }));

test("several months are one row, and a paid award is never listed", () =>
  withFixture(async (f) => {
    f.award({ actor: "101" });
    f.award({ actor: "101" });
    f.award({ actor: "105", state: "paid" });
    // An account that never signed in is named by the closed month's record.
    f.monthlyLogin("101", "feed", "month-login");
    expect(await f.read()).toEqual([
      row({ githubId: 101, login: "month-login" }),
    ]);
  }));

test("team accounts, closed accounts and production test networks are left out", () =>
  withFixture(async (f) => {
    f.award({ actor: "101" });
    f.award({ actor: "18633264" });
    f.award({ actor: "202660855" });
    f.award({ actor: "106" });
    f.member("106", "closed-account", true);
    f.award({ actor: "107", project: "testnet", network: "base-sepolia" });
    const team = new Set(["18633264", "202660855"]);
    // No record names this account's login.
    expect(await f.read(team)).toEqual([row({ githubId: 101, login: null })]);
    expect(
      (await f.read(team, "staging")).map((award) => award.githubId),
    ).toEqual([101, 107]);
    // Without the team list both team accounts would be named.
    expect((await f.read()).map((award) => award.githubId)).toEqual([
      101, 18633264, 202660855,
    ]);
  }));

test("the answer names accounts only: no amount, wallet address, award id or month", () =>
  withFixture(async (f) => {
    const id = f.award({ actor: "101" });
    f.wallet("101", "solana");
    const response = await handleReservedAwardsFeed(
      new Request(URL_, { headers: { authorization: `Bearer ${TOKEN}` } }),
      {
        db: f.database,
        token: TOKEN,
        tier: "production",
        teamGithubIds: NO_TEAM,
        now: () => new Date(AT),
      },
    );
    expect(response?.status).toBe(200);
    expect(response?.headers.get("cache-control")).toBe("no-store");
    const text = await (response as Response).text();
    expect(JSON.parse(text)).toEqual({
      schema: "slop-reserved-awards-v1",
      generatedAt: AT,
      awards: [row({ githubId: 101, needs: "authorize" })],
    });
    for (const secret of [
      "107560000",
      "2150000",
      "Wa11et",
      SOLANA_VAULT,
      SOLANA_ASSET,
      id,
      "claim-",
    ])
      expect(text).not.toContain(secret);
  }));

test("only the exact bearer token of a configured secret opens the route", () =>
  withFixture(async (f) => {
    f.award({ actor: "101" });
    const ask = (
      token: string | undefined,
      authorization?: string,
      method = "GET",
    ) =>
      handleReservedAwardsFeed(
        new Request(URL_, {
          method,
          headers: authorization ? { authorization } : {},
        }),
        {
          db: f.database,
          token,
          tier: "production",
          teamGithubIds: NO_TEAM,
        },
      );
    // Not this route: no secret, no header, a wrong or reshaped token.
    expect(await ask(undefined, `Bearer ${TOKEN}`)).toBeNull();
    expect(await ask("", "Bearer ")).toBeNull();
    expect(await ask(TOKEN)).toBeNull();
    expect(await ask(TOKEN, `Bearer ${TOKEN}x`)).toBeNull();
    expect(await ask(TOKEN, `Bearer ${TOKEN.slice(0, -1)}`)).toBeNull();
    expect(await ask(TOKEN, `bearer ${TOKEN}`)).toBeNull();
    expect(await ask(TOKEN, TOKEN)).toBeNull();
    expect(await ask(TOKEN, `Bearer ${TOKEN}`, "POST")).toMatchObject({
      status: 405,
    });
    expect(await ask(TOKEN, "Bearer wrong", "POST")).toBeNull();
    // A secret shorter than the minimum is treated as unset.
    const short = "s".repeat(MINIMUM_FEED_TOKEN_LENGTH - 1);
    expect(await ask(short, `Bearer ${short}`)).toBeNull();
    // The stand-in used for an unset secret never authorizes.
    expect(
      await ask(undefined, `Bearer ${"x".repeat(MINIMUM_FEED_TOKEN_LENGTH)}`),
    ).toBeNull();
    expect((await ask(TOKEN, `Bearer ${TOKEN}`))?.status).toBe(200);
    // Another path is never answered, even with the token.
    expect(
      await handleReservedAwardsFeed(
        new Request(`${URL_}/extra`, {
          headers: { authorization: `Bearer ${TOKEN}` },
        }),
        {
          db: f.database,
          token: TOKEN,
          tier: "production",
          teamGithubIds: NO_TEAM,
        },
      ),
    ).toBeNull();
  }));

/** The deployed Pages router with real migrated SQLite. */
async function routed(
  sqlite: { db: unknown; sqlite: Sqlite },
  path: string,
  env: Record<string, string>,
  authorization?: string,
) {
  const response = await onRequest({
    request: new Request(`https://slop.cash${path}`, {
      headers: authorization ? { authorization } : {},
    }),
    env: {
      SLOP_DB: sqlite.db,
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

test("through the router, a wrong or missing token is the same answer as a path that does not exist", async () => {
  const d1 = sqliteD1();
  try {
    const unknown = await routed(d1, "/api/v1/operator/no-such-route", {});
    expect(unknown.status).toBe(404);
    const env = { OPERATOR_FEED_TOKEN: TOKEN };
    for (const answer of [
      await routed(d1, RESERVED_AWARDS_PATH, {}),
      await routed(d1, RESERVED_AWARDS_PATH, {}, `Bearer ${TOKEN}`),
      await routed(d1, RESERVED_AWARDS_PATH, env),
      await routed(d1, RESERVED_AWARDS_PATH, env, "Bearer wrong"),
    ])
      expect(answer).toEqual(unknown);
    const feed = await routed(
      d1,
      RESERVED_AWARDS_PATH,
      { ...env, ADMIN_GITHUB_IDS: "202660855" },
      `Bearer ${TOKEN}`,
    );
    expect(feed.status).toBe(200);
    expect(JSON.parse(feed.body)).toMatchObject({
      schema: "slop-reserved-awards-v1",
      awards: [],
    });
    expect(feed.headers).toContainEqual(["cache-control", "no-store"]);
  } finally {
    d1.sqlite.close();
  }
});

test("the router leaves administrators and moderators out", async () => {
  const f = fixture();
  try {
    f.award({ actor: "101" });
    f.award({ actor: "18633264" });
    f.award({ actor: "202660855" });
    const feed = await routed(
      { db: f.database, sqlite: f.sqlite },
      RESERVED_AWARDS_PATH,
      {
        OPERATOR_FEED_TOKEN: TOKEN,
        ADMIN_GITHUB_IDS: "18633264",
        PROJECT_MODERATOR_GITHUB_IDS: "18633264,202660855",
      },
      `Bearer ${TOKEN}`,
    );
    expect(
      (JSON.parse(feed.body) as { awards: ReservedAward[] }).awards,
    ).toEqual([row({ githubId: 101, login: null })]);
  } finally {
    f.sqlite.close();
  }
});
