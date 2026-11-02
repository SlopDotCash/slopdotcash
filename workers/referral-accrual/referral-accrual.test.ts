import type { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  handleReferralsApi,
  REFERRAL_ACCRUALS_PATH,
} from "../../backend/referrals/handler";
import { seedParticipationBan } from "../../tests/participation-ban.fixture";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { parseConfig } from "./config";
import { LOCK_MS, runAccrual, windowEnd } from "./core";
import worker, { type Env, runOnce } from "./index";
import { leafHash } from "./merkle";
import { D1AccrualStore } from "./store";

const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const RATE = 3_000_000_000_000n; // 3 tokens per USDC with 18 decimals
const ONE_TOKEN = 10n ** 18n;

const REFERRER = { githubId: "900000100", githubLogin: "referrer-one" };
const SECOND = { githubId: "900000200", githubLogin: "referrer-two" };
const DREW = { githubId: "202660855", githubLogin: "drew-dot-com" };
const WALLET = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";

/** Test parameters only; production values come from the reviewed wrangler.toml. */
const VARS = {
  REFERRAL_ACCRUAL_MODE: "dry_run",
  REFERRAL_FIRST_PERIOD: "2026-11",
  REFERRAL_RATE_BASE_PER_MICRO: RATE.toString(),
  REFERRAL_TOKEN_DECIMALS: "18",
  REFERRAL_POOL_BASE: (2_000_000n * ONE_TOKEN).toString(),
  REFERRAL_PROJECT_CAP_BASE: (250_000n * ONE_TOKEN).toString(),
  REFERRAL_WINDOW_MONTHS: "12",
  REFERRAL_EXCLUDED_GITHUB_IDS: "18633264,202660855",
  ADMIN_GITHUB_IDS: "18633264,202660855",
  PROJECT_MODERATOR_GITHUB_IDS: "18633264,202660855",
};

function sha(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

function addProject(
  sqlite: Database,
  id: string,
  referrer: { githubId: string; githubLogin: string } | null,
) {
  const manifest = JSON.stringify({ id, status: "active" });
  const digest = sha(manifest);
  sqlite
    .query(
      "INSERT INTO project_revisions (project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES (?,1,?,?,'test','2026-10-01T00:00:00.000Z')",
    )
    .run(id, manifest, digest);
  sqlite
    .query(
      "INSERT INTO projects (id,status,revision,manifest,manifest_sha256,created_at,updated_at,referrer_github_id,referrer_github_login) VALUES (?,'active',1,?,?,'2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z',?,?)",
    )
    .run(
      id,
      manifest,
      digest,
      referrer?.githubId ?? null,
      referrer?.githubLogin ?? null,
    );
}

let obligationCounter = 0;
/** One paid obligation with its finalized `paid` event observed at `paidAt`. */
function addPaid(
  sqlite: Database,
  projectId: string,
  grossBase: bigint,
  paidAt: string,
  options: {
    network?: string;
    chain?: string;
    asset?: string;
    decimals?: number;
  } = {},
) {
  obligationCounter += 1;
  const id = `0x${obligationCounter.toString(16).padStart(64, "0")}`;
  const transaction = `0xtx${obligationCounter.toString(16).padStart(61, "0")}`;
  const network = options.network ?? "base-mainnet";
  const chain = options.chain ?? "base";
  const asset = options.asset ?? USDC_BASE;
  sqlite
    .query(
      "INSERT INTO payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at,paid_transaction) VALUES(?,?,?,?,?,?,?,?,?,?,?,'paid',?,?)",
    )
    .run(
      id,
      projectId,
      "777000001",
      network,
      chain,
      `0x${"5".repeat(40)}`,
      asset,
      options.decimals ?? 6,
      grossBase.toString(),
      ((grossBase + 49n) / 50n).toString(),
      sha(id),
      paidAt,
      transaction,
    );
  sqlite
    .query("INSERT INTO payment_events VALUES(?,?,?,?,?,?,?,?)")
    .run(network, transaction, 0, "0xblock", "paid", id, "{}", paidAt);
  return { id, transaction };
}

function addWallet(
  sqlite: Database,
  account: { githubId: string; githubLogin: string },
  address: string,
  chain = "robinhood",
  options: { authorized?: boolean; supersedes?: string | null } = {},
) {
  const claimId = `claim_${account.githubId}_${chain}_${address.slice(-6)}`;
  sqlite
    .query(
      "INSERT INTO wallet_claims (id,github_user_id,github_login,wallet_address,source,issue_repository,issue_number,source_body_sha256,observed_at,record_sha256,supersedes_claim_id,created_at,chain) VALUES (?,?,?,?,'d1_registry',NULL,NULL,?,?,?,?,?,?)",
    )
    .run(
      claimId,
      account.githubId,
      account.githubLogin,
      address,
      sha(claimId),
      "2026-10-15T00:00:00.000Z",
      sha(`record ${claimId}`),
      options.supersedes ?? null,
      "2026-10-15T00:00:00.000Z",
      chain,
    );
  if (options.authorized !== false) {
    sqlite
      .query(
        "INSERT INTO payment_wallet_challenges (id,claim_id,github_user_id,message,expires_at,consumed_at) VALUES (?,?,?,'m','2026-10-15T01:00:00.000Z','2026-10-15T00:30:00.000Z')",
      )
      .run(`chal_${claimId}`, claimId, account.githubId);
    sqlite
      .query(
        "INSERT INTO payment_wallet_authorizations (claim_id,github_user_id,authorized_at,challenge_id,signature) VALUES (?,?,'2026-10-15T00:30:00.000Z',?,'sig')",
      )
      .run(claimId, account.githubId, `chal_${claimId}`);
  }
  return claimId;
}

function env(db: Env["REFERRAL_DB"], extra: Record<string, string> = {}): Env {
  return { REFERRAL_DB: db, ...VARS, ...extra };
}

const at = (iso: string) => () => new Date(iso);

function rows(sqlite: Database) {
  return sqlite
    .query(
      "SELECT obligation_id, period, project_id, referrer_github_id, accrued_base, computed_base, outcome, reason FROM referral_accruals ORDER BY period, paid_observed_at, obligation_id",
    )
    .all() as {
    obligation_id: string;
    period: string;
    project_id: string;
    referrer_github_id: string;
    accrued_base: string;
    computed_base: string;
    outcome: string;
    reason: string | null;
  }[];
}

function files(sqlite: Database) {
  return sqlite
    .query(
      "SELECT period, epoch, mode, body, body_sha256, merkle_root, tree_total_base, leaf_count FROM referral_accrual_files ORDER BY epoch",
    )
    .all() as {
    period: string;
    epoch: number;
    mode: string;
    body: string;
    body_sha256: string;
    merkle_root: string | null;
    tree_total_base: string;
    leaf_count: number;
  }[];
}

describe("atomic monthly filing and restart", () => {
  for (const table of [
    "referral_accruals",
    "referral_accrual_files",
    "referral_claim_wallets",
  ]) {
    test(`a failed ${table} insert leaves no partial month across restart`, async () => {
      const directory = mkdtempSync(join(tmpdir(), "slop-referral-filing-"));
      const filename = join(directory, "d1.sqlite");
      let { db, sqlite } = sqliteD1(undefined, filename);
      try {
        addProject(sqlite, "referred", REFERRER);
        const first = addPaid(
          sqlite,
          "referred",
          1_000_000n,
          "2026-11-05T00:00:00.000Z",
        );
        const second = addPaid(
          sqlite,
          "referred",
          2_000_000n,
          "2026-11-06T00:00:00.000Z",
        );
        const claim = addWallet(sqlite, REFERRER, WALLET);
        // The accrual control fails after the first row has executed; the
        // other controls fail after all accruals, or after the file as well.
        sqlite.exec(`CREATE TRIGGER fixture_interruption BEFORE INSERT ON ${table}
          ${table === "referral_accruals" ? `WHEN NEW.obligation_id = '${second.id}'` : ""}
          BEGIN SELECT RAISE(ABORT, 'fixture controlled interruption'); END`);
        await expect(
          runOnce(env(db), at("2026-12-01T00:00:00.000Z")),
        ).rejects.toThrow("fixture controlled interruption");
        expect(rows(sqlite)).toEqual([]);
        expect(files(sqlite)).toEqual([]);
        expect(
          sqlite.query("SELECT * FROM referral_claim_wallets").all(),
        ).toEqual([]);
        sqlite.close();
        ({ db, sqlite } = sqliteD1([], filename));
        expect(rows(sqlite)).toEqual([]);
        expect(files(sqlite)).toEqual([]);
        sqlite.exec("DROP TRIGGER fixture_interruption");
        const result = await runOnce(env(db), at("2026-12-01T00:00:00.000Z"));
        expect(result?.filed).toEqual([
          { period: "2026-11", epoch: 0, rows: 2, leafCount: 1 },
        ]);
        const filed = files(sqlite)[0];
        const body = JSON.parse(filed.body);
        expect(
          body.accruals.map(
            (row: { obligationId: string }) => row.obligationId,
          ),
        ).toEqual([first.id, second.id]);
        expect(body.totals.poolAccruedBase).toBe((9n * ONE_TOKEN).toString());
        expect(filed.body_sha256).toBe(sha(filed.body));
        expect(
          sqlite
            .query("SELECT wallet, pinned_period FROM referral_claim_wallets")
            .get(),
        ).toEqual({ wallet: WALLET, pinned_period: "2026-11" });

        // A later authorized wallet cannot move an already filed cumulative
        // entitlement. Recovery also keeps the original file byte-for-byte.
        addWallet(sqlite, REFERRER, `0x${"1".repeat(40)}`, "robinhood", {
          supersedes: claim,
        });
        await runOnce(env(db), at("2027-01-01T00:00:00.000Z"));
        expect(files(sqlite)[0]).toEqual(filed);
        expect(files(sqlite)[1].merkle_root).toBe(filed.merkle_root);
        expect(JSON.parse(files(sqlite)[1].body).referrers[0].wallet).toBe(
          WALLET,
        );
        expect(rows(sqlite)).toHaveLength(2);
      } finally {
        sqlite.close();
        rmSync(directory, { recursive: true, force: true });
      }
    });
  }

  test("a lost batch response resumes the already committed file without duplicate accruals", async () => {
    const directory = mkdtempSync(join(tmpdir(), "slop-referral-response-"));
    const filename = join(directory, "d1.sqlite");
    let { db, sqlite } = sqliteD1(undefined, filename);
    try {
      addProject(sqlite, "referred", REFERRER);
      addPaid(sqlite, "referred", 1_000_000n, "2026-11-05T00:00:00.000Z");
      const claim = addWallet(sqlite, REFERRER, WALLET);
      const batch = db.batch.bind(db);
      db.batch = async (statements) => {
        await batch(statements);
        throw new Error("fixture response lost after commit");
      };
      await expect(
        runOnce(env(db), at("2026-12-01T00:00:00.000Z")),
      ).rejects.toThrow("fixture response lost after commit");
      const filed = files(sqlite)[0];
      expect(rows(sqlite)).toHaveLength(1);
      expect(
        sqlite.query("SELECT wallet FROM referral_claim_wallets").get(),
      ).toEqual({ wallet: WALLET });
      sqlite.close();
      ({ db, sqlite } = sqliteD1([], filename));
      expect(
        (await runOnce(env(db), at("2026-12-01T00:00:00.000Z")))?.filed,
      ).toEqual([]);
      addWallet(sqlite, REFERRER, `0x${"2".repeat(40)}`, "robinhood", {
        supersedes: claim,
      });
      await runOnce(env(db), at("2027-01-01T00:00:00.000Z"));
      expect(files(sqlite)[0]).toEqual(filed);
      expect(files(sqlite)[1].merkle_root).toBe(filed.merkle_root);
      expect(rows(sqlite)).toHaveLength(1);
    } finally {
      sqlite.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  for (const replacement of [false, true]) {
    test(`a ${replacement ? "replaced" : "expired"} lease cannot file stale work`, async () => {
      const { db, sqlite } = sqliteD1();
      try {
        addProject(sqlite, "referred", REFERRER);
        addPaid(sqlite, "referred", 1_000_000n, "2026-11-05T00:00:00.000Z");
        addWallet(sqlite, REFERRER, WALLET);
        let now = new Date("2026-12-01T00:00:00.000Z");
        const store = new D1AccrualStore(db);
        await expect(
          runAccrual({
            config: parseConfig(VARS),
            store,
            now: () => now,
            randomId: () => "fixture_original",
            log: () => {},
            sha256: async (text) => {
              now = new Date(now.getTime() + LOCK_MS + 1);
              if (replacement)
                expect(
                  await store.acquireLock("rrun_fixture_successor", now),
                ).toBe(true);
              return sha(text);
            },
          }),
        ).rejects.toThrow(/NOT NULL/u);
        expect(rows(sqlite)).toEqual([]);
        expect(files(sqlite)).toEqual([]);
        expect(
          sqlite.query("SELECT * FROM referral_claim_wallets").all(),
        ).toEqual([]);
        if (replacement) {
          expect((await runOnce(env(db), () => now))?.status).toBe("locked");
          await store.releaseLock("rrun_fixture_successor", now);
        }
        expect((await runOnce(env(db), () => now))?.filed).toEqual([
          { period: "2026-11", epoch: 0, rows: 1, leafCount: 1 },
        ]);
      } finally {
        sqlite.close();
      }
    });
  }
});

describe("one accrual run", () => {
  test("files each closed month once, in order, with recomputable totals", async () => {
    const { db, sqlite } = sqliteD1();
    addProject(sqlite, "referred", REFERRER);
    addProject(sqlite, "unreferred", null);
    addProject(sqlite, "team-referred", DREW);
    addWallet(sqlite, REFERRER, WALLET);
    // November: two payouts on the referred project, one on the team-referred
    // project, one on a project nobody referred.
    const first = addPaid(
      sqlite,
      "referred",
      1_000_000_000n,
      "2026-11-05T12:00:00.000Z",
    );
    const second = addPaid(
      sqlite,
      "referred",
      250_000_000n,
      "2026-11-20T12:00:00.000Z",
    );
    const team = addPaid(
      sqlite,
      "team-referred",
      500_000_000n,
      "2026-11-21T12:00:00.000Z",
    );
    addPaid(sqlite, "unreferred", 900_000_000n, "2026-11-22T12:00:00.000Z");
    // December: one more on the referred project.
    const third = addPaid(
      sqlite,
      "referred",
      100_000_000n,
      "2026-12-03T12:00:00.000Z",
    );

    // Nothing has ended before 1 December.
    expect(await runOnce(env(db), at("2026-11-30T12:00:00.000Z"))).toEqual({
      status: "ran",
      filed: [],
    });
    expect(rows(sqlite)).toEqual([]);

    const november = await runOnce(env(db), at("2026-12-02T01:23:00.000Z"));
    expect(november).toEqual({
      status: "ran",
      filed: [{ period: "2026-11", epoch: 0, rows: 3, leafCount: 1 }],
    });
    const judged = rows(sqlite);
    expect(
      judged.map((row) => [row.obligation_id, row.outcome, row.accrued_base]),
    ).toEqual([
      [first.id, "accrued", (1_000_000_000n * RATE).toString()],
      [second.id, "accrued", (250_000_000n * RATE).toString()],
      [team.id, "referrer_excluded", "0"],
    ]);
    expect(judged[2].reason).toBe("team account");
    expect(judged[0].computed_base).toBe((3_000n * ONE_TOKEN).toString());

    const [file] = files(sqlite);
    expect(file.period).toBe("2026-11");
    expect(file.epoch).toBe(0);
    expect(file.mode).toBe("dry_run");
    expect(file.body_sha256).toBe(sha(file.body));
    expect(file.leaf_count).toBe(1);
    expect(file.tree_total_base).toBe((3_750n * ONE_TOKEN).toString());
    const body = JSON.parse(file.body);
    expect(body.schema).toBe("slop-referral-accrual-file-v1");
    expect(body.parameters.rateBasePerMicro).toBe(RATE.toString());
    expect(body.accruals).toHaveLength(3);
    expect(body.accruals[0].paidTransaction).toBe(first.transaction);
    // Only accounts with a judged accrual appear; an excluded referrer is
    // visible in the accruals list, not as a claimant.
    expect(body.referrers).toEqual([
      {
        githubId: REFERRER.githubId,
        githubLogin: REFERRER.githubLogin,
        cumulativeBase: (3_750n * ONE_TOKEN).toString(),
        wallet: WALLET,
        leaf: {
          hash: leafHash({
            address: WALLET,
            cumulativeBase: 3_750n * ONE_TOKEN,
          }),
          proof: [],
        },
      },
    ]);
    expect(body.merkle.root).toBe(file.merkle_root);
    expect(file.merkle_root).toBe(
      leafHash({ address: WALLET, cumulativeBase: 3_750n * ONE_TOKEN }),
    );

    // The same moment again files nothing and changes nothing.
    expect(await runOnce(env(db), at("2026-12-02T02:00:00.000Z"))).toEqual({
      status: "ran",
      filed: [],
    });
    expect(rows(sqlite)).toHaveLength(3);

    // January files December with the cumulative total.
    const december = await runOnce(env(db), at("2027-01-01T01:23:00.000Z"));
    expect(december?.filed).toEqual([
      { period: "2026-12", epoch: 1, rows: 1, leafCount: 1 },
    ]);
    expect(rows(sqlite).at(-1)).toMatchObject({
      obligation_id: third.id,
      period: "2026-12",
      outcome: "accrued",
      accrued_base: (300n * ONE_TOKEN).toString(),
    });
    const second_file = files(sqlite)[1];
    expect(second_file.tree_total_base).toBe((4_050n * ONE_TOKEN).toString());
    expect(JSON.parse(second_file.body).referrers[0].cumulativeBase).toBe(
      (4_050n * ONE_TOKEN).toString(),
    );
    expect(second_file.merkle_root).not.toBe(file.merkle_root);

    // Filed records are permanent.
    expect(() =>
      sqlite.exec("UPDATE referral_accruals SET accrued_base = '1'"),
    ).toThrow(/immutable/u);
    expect(() => sqlite.exec("DELETE FROM referral_accrual_files")).toThrow(
      /permanent/u,
    );
  });

  test("a late-observed payout joins the month it was observed in", async () => {
    const { db, sqlite } = sqliteD1();
    addProject(sqlite, "referred", REFERRER);
    addPaid(sqlite, "referred", 1_000_000n, "2026-11-05T12:00:00.000Z");
    await runOnce(env(db), at("2026-12-02T00:00:00.000Z"));
    // A paid event observed in December for a November-created obligation.
    addPaid(sqlite, "referred", 2_000_000n, "2026-12-09T12:00:00.000Z");
    const result = await runOnce(env(db), at("2027-01-02T00:00:00.000Z"));
    expect(result?.filed).toEqual([
      { period: "2026-12", epoch: 1, rows: 1, leafCount: 0 },
    ]);
    expect(rows(sqlite).map((row) => row.period)).toEqual([
      "2026-11",
      "2026-12",
    ]);
  });

  test("project cap, pool cap, window, hold, ban and asset rules", async () => {
    const { db, sqlite } = sqliteD1();
    addProject(sqlite, "big", REFERRER);
    addProject(sqlite, "held", REFERRER);
    addProject(sqlite, "banned-ref", SECOND);
    addProject(sqlite, "token-paid", REFERRER);
    addProject(sqlite, "old", REFERRER);
    // 100,000 USDC gross = 300,000 tokens computed; the project cap is 250,000.
    const capped = addPaid(
      sqlite,
      "big",
      100_000_000_000n,
      "2026-11-02T00:00:00.000Z",
    );
    const afterCap = addPaid(
      sqlite,
      "big",
      1_000_000n,
      "2026-11-03T00:00:00.000Z",
    );
    sqlite
      .query(
        "INSERT INTO referral_holds (id,project_id,reason,actor_github_id,actor_github_login,created_at) VALUES ('rhold_test_0001','held','ELG-02 review case 7','202660855','drew-dot-com','2026-11-01T00:00:00.000Z')",
      )
      .run();
    const held = addPaid(
      sqlite,
      "held",
      5_000_000n,
      "2026-11-04T00:00:00.000Z",
    );
    seedParticipationBan(sqlite, SECOND, DREW, "2026-10-20T00:00:00.000Z");
    const banned = addPaid(
      sqlite,
      "banned-ref",
      5_000_000n,
      "2026-11-05T00:00:00.000Z",
    );
    const token = addPaid(
      sqlite,
      "token-paid",
      5_000_000_000_000_000_000n,
      "2026-11-06T00:00:00.000Z",
      {
        asset: `0x${"7".repeat(40)}`,
        decimals: 18,
      },
    );
    // The old project first paid in October 2025: its window closed before
    // the program's first period, so a November 2026 payout accrues nothing.
    addPaid(sqlite, "old", 1_000_000n, "2025-10-10T00:00:00.000Z");
    const late = addPaid(sqlite, "old", 1_000_000n, "2026-11-07T00:00:00.000Z");

    const result = await runOnce(env(db), at("2026-12-02T00:00:00.000Z"));
    expect(result?.filed).toEqual([
      { period: "2026-11", epoch: 0, rows: 6, leafCount: 0 },
    ]);
    const byId = new Map(rows(sqlite).map((row) => [row.obligation_id, row]));
    expect(byId.get(capped.id)).toMatchObject({
      outcome: "project_cap",
      computed_base: (300_000n * ONE_TOKEN).toString(),
      accrued_base: (250_000n * ONE_TOKEN).toString(),
      reason: "project lifetime cap reached",
    });
    expect(byId.get(afterCap.id)).toMatchObject({
      outcome: "project_cap",
      accrued_base: "0",
    });
    expect(byId.get(held.id)).toMatchObject({
      outcome: "held",
      accrued_base: "0",
      reason: "rhold_test_0001: ELG-02 review case 7",
    });
    expect(byId.get(banned.id)).toMatchObject({
      outcome: "referrer_excluded",
      reason: "participation ban",
    });
    expect(byId.get(token.id)).toMatchObject({
      outcome: "asset_not_eligible",
      computed_base: "0",
    });
    expect(byId.get(late.id)?.outcome).toBe("window_closed");
    expect(byId.get(late.id)?.reason).toContain("2026-10-10T00:00:00.000Z");
    // Only the one old pre-program payout stays unjudged: it is before the
    // first period and never becomes a row.
    expect(rows(sqlite)).toHaveLength(6);

    // Pool cap: a second referred project hits the remaining pool.
    const { db: db2, sqlite: s2 } = sqliteD1();
    addProject(s2, "p1", REFERRER);
    addProject(s2, "p2", SECOND);
    addPaid(s2, "p1", 50_000_000_000n, "2026-11-02T00:00:00.000Z"); // 150,000 tokens
    const pooled = addPaid(
      s2,
      "p2",
      50_000_000_000n,
      "2026-11-03T00:00:00.000Z",
    );
    await runOnce(
      env(db2, {
        REFERRAL_POOL_BASE: (200_000n * ONE_TOKEN).toString(),
        REFERRAL_PROJECT_CAP_BASE: (200_000n * ONE_TOKEN).toString(),
      }),
      at("2026-12-02T00:00:00.000Z"),
    );
    expect(
      rows(s2).find((row) => row.obligation_id === pooled.id),
    ).toMatchObject({
      outcome: "pool_cap",
      accrued_base: (50_000n * ONE_TOKEN).toString(),
      reason: "program pool exhausted",
    });
  });

  test("the wallet is the current authorized claim on the claim chain only", async () => {
    const { db, sqlite } = sqliteD1();
    addProject(sqlite, "a", REFERRER);
    addProject(sqlite, "b", SECOND);
    addPaid(sqlite, "a", 1_000_000n, "2026-11-02T00:00:00.000Z");
    addPaid(sqlite, "b", 1_000_000n, "2026-11-03T00:00:00.000Z");
    // Referrer one: a Base wallet (wrong chain) and a superseded Robinhood wallet
    // whose successor is the current one.
    addWallet(sqlite, REFERRER, `0x${"1".repeat(40)}`, "base");
    const old = addWallet(sqlite, REFERRER, `0x${"2".repeat(40)}`);
    addWallet(sqlite, REFERRER, `0x${"3".repeat(40)}`, "robinhood", {
      supersedes: old,
    });
    // Referrer two: a Robinhood claim that was never authorized.
    addWallet(sqlite, SECOND, `0x${"4".repeat(40)}`, "robinhood", {
      authorized: false,
    });
    await runOnce(env(db), at("2026-12-02T00:00:00.000Z"));
    const body = JSON.parse(files(sqlite)[0].body);
    expect(
      body.referrers.map((r: { githubId: string; wallet: string | null }) => [
        r.githubId,
        r.wallet,
      ]),
    ).toEqual([
      [REFERRER.githubId, `0x${"3".repeat(40)}`],
      [SECOND.githubId, null],
    ]);
    expect(body.merkle.leafCount).toBe(1);
  });

  test("a wallet is pinned once it enters a tree, so a leaf never moves", async () => {
    const { db, sqlite } = sqliteD1();
    addProject(sqlite, "a", REFERRER);
    addPaid(sqlite, "a", 1_000_000n, "2026-11-02T00:00:00.000Z");
    addPaid(sqlite, "a", 1_000_000n, "2026-12-02T00:00:00.000Z");
    const first = addWallet(sqlite, REFERRER, WALLET);
    await runOnce(env(db), at("2026-12-02T00:00:00.000Z"));
    expect(
      sqlite
        .query(
          "SELECT referrer_github_id, wallet, pinned_period FROM referral_claim_wallets",
        )
        .all(),
    ).toEqual([
      {
        referrer_github_id: REFERRER.githubId,
        wallet: WALLET,
        pinned_period: "2026-11",
      },
    ]);
    // The referrer rotates to a new wallet in the registry; the file keeps the pinned one.
    addWallet(sqlite, REFERRER, `0x${"9".repeat(40)}`, "robinhood", {
      supersedes: first,
    });
    await runOnce(env(db), at("2027-01-02T00:00:00.000Z"));
    const december = JSON.parse(files(sqlite)[1].body);
    expect(december.referrers[0].wallet).toBe(WALLET);
    expect(december.referrers[0].cumulativeBase).toBe(
      (6n * ONE_TOKEN).toString(),
    );
    expect(() =>
      sqlite.exec("UPDATE referral_claim_wallets SET wallet = '0x1'"),
    ).toThrow(/pinned/u);
    // A second account cannot take a pinned wallet, even in a later tree.
    addProject(sqlite, "b", SECOND);
    addPaid(sqlite, "b", 1_000_000n, "2027-01-02T00:00:00.000Z");
    addWallet(sqlite, SECOND, WALLET);
    await runOnce(env(db), at("2027-02-02T00:00:00.000Z"));
    const january = JSON.parse(files(sqlite)[2].body);
    expect(
      january.referrers.map(
        (r: { githubId: string; wallet: string | null }) => [
          r.githubId,
          r.wallet,
        ],
      ),
    ).toEqual([
      [REFERRER.githubId, WALLET],
      [SECOND.githubId, null],
    ]);
  });

  test("two accounts on one wallet keep one leaf and the file says which", async () => {
    const { db, sqlite } = sqliteD1();
    addProject(sqlite, "a", REFERRER);
    addProject(sqlite, "b", SECOND);
    addPaid(sqlite, "a", 1_000_000n, "2026-11-02T00:00:00.000Z");
    addPaid(sqlite, "b", 1_000_000n, "2026-11-03T00:00:00.000Z");
    addWallet(sqlite, REFERRER, WALLET);
    addWallet(sqlite, SECOND, WALLET);
    const logs: Record<string, unknown>[] = [];
    const log = console.log;
    console.log = (line: string) => logs.push(JSON.parse(line));
    try {
      await runOnce(env(db), at("2026-12-02T00:00:00.000Z"));
    } finally {
      console.log = log;
    }
    const body = JSON.parse(files(sqlite)[0].body);
    expect(
      body.referrers.map((r: { wallet: string | null }) => r.wallet),
    ).toEqual([WALLET, null]);
    expect(body.totals.treeTotalBase).toBe((3n * ONE_TOKEN).toString());
    expect(
      logs.find((entry) => entry.event === "referral_wallet_shared"),
    ).toMatchObject({
      keptGithubId: REFERRER.githubId,
      droppedGithubId: SECOND.githubId,
    });
  });

  test("a held lease blocks a second run and lapses afterwards", async () => {
    const { db, sqlite } = sqliteD1();
    sqlite
      .query(
        "INSERT INTO referral_accrual_locks (scope, run_id, expires_at) VALUES ('accrual', 'rrun_other', '2026-12-02T00:09:00.000Z')",
      )
      .run();
    expect(await runOnce(env(db), at("2026-12-02T00:00:00.000Z"))).toEqual({
      status: "locked",
      filed: [],
    });
    expect(await runOnce(env(db), at("2026-12-02T00:10:00.000Z"))).toEqual({
      status: "ran",
      filed: [{ period: "2026-11", epoch: 0, rows: 0, leafCount: 0 }],
    });
    expect(
      sqlite.query("SELECT COUNT(*) n FROM referral_accrual_locks").get(),
    ).toEqual({ n: 0 });
  });

  test("only the daily schedule files accruals and the Worker serves no route", async () => {
    const { db, sqlite } = sqliteD1();
    const settled: Promise<unknown>[] = [];
    const start = new Date();
    start.setUTCMonth(start.getUTCMonth() - 2, 1);
    const firstPeriod = start.toISOString().slice(0, 7);
    const currentEnv = env(db, { REFERRAL_FIRST_PERIOD: firstPeriod });
    // A delayed trigger must use execution time for filing and gas budgets.
    await worker.scheduled(
      {
        scheduledTime: Date.parse("2001-01-02T01:15:00Z"),
        cron: "*/15 * * * *",
      },
      currentEnv,
      { waitUntil: (promise) => settled.push(promise) },
    );
    await Promise.all(settled);
    expect(files(sqlite)).toEqual([]);
    settled.length = 0;
    await worker.scheduled(
      { scheduledTime: Date.parse("2001-01-02T01:23:00Z"), cron: "23 1 * * *" },
      currentEnv,
      { waitUntil: (promise) => settled.push(promise) },
    );
    await Promise.all(settled);
    expect(files(sqlite).map((file) => file.period)).toEqual(
      [0, 1].map((offset) =>
        new Date(
          Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + offset, 1),
        )
          .toISOString()
          .slice(0, 7),
      ),
    );
    expect((await worker.fetch()).status).toBe(404);
  });
});

describe("referral window end", () => {
  test("a first payout on a day the end month lacks closes on that month's last day", () => {
    expect(windowEnd("2027-01-31T10:00:00.000Z", 1)).toBe(
      "2027-02-28T10:00:00.000Z",
    );
    expect(windowEnd("2027-08-31T10:00:00.000Z", 6)).toBe(
      "2028-02-29T10:00:00.000Z",
    );
    expect(windowEnd("2028-02-29T10:00:00.000Z", 12)).toBe(
      "2029-02-28T10:00:00.000Z",
    );
    expect(windowEnd("2026-11-15T08:30:00.000Z", 12)).toBe(
      "2027-11-15T08:30:00.000Z",
    );
    expect(windowEnd("2026-12-31T23:59:59.999Z", 2)).toBe(
      "2027-02-28T23:59:59.999Z",
    );
  });
});

describe("public accrual route", () => {
  test("lists filed epochs and serves the exact filed bytes", async () => {
    const { db, sqlite } = sqliteD1();
    addProject(sqlite, "referred", REFERRER);
    addPaid(sqlite, "referred", 1_000_000n, "2026-11-02T00:00:00.000Z");
    await runOnce(env(db), at("2026-12-02T00:00:00.000Z"));
    const deps = { db };
    expect(
      await handleReferralsApi(
        new Request("https://slop.cash/api/v1/projects"),
        deps,
      ),
    ).toBeNull();
    const index = await handleReferralsApi(
      new Request(`https://slop.cash${REFERRAL_ACCRUALS_PATH}`),
      deps,
    );
    expect(index?.status).toBe(200);
    expect(index?.headers.get("cache-control")).toBe("public, max-age=300");
    const listed = await index?.json();
    expect(listed.files).toHaveLength(1);
    expect(listed.files[0]).toMatchObject({
      period: "2026-11",
      epoch: 0,
      mode: "dry_run",
      url: `${REFERRAL_ACCRUALS_PATH}/2026-11`,
    });
    const file = await handleReferralsApi(
      new Request(`https://slop.cash${REFERRAL_ACCRUALS_PATH}/2026-11.json`),
      deps,
    );
    expect(file?.status).toBe(200);
    const text = await file?.text();
    expect(text).toBe(files(sqlite)[0].body);
    expect(file?.headers.get("x-slop-sha256")).toBe(sha(text as string));
    expect(
      (
        await handleReferralsApi(
          new Request(`https://slop.cash${REFERRAL_ACCRUALS_PATH}/2026-12`),
          deps,
        )
      )?.status,
    ).toBe(404);
    expect(
      (
        await handleReferralsApi(
          new Request(`https://slop.cash${REFERRAL_ACCRUALS_PATH}/nope`),
          deps,
        )
      )?.status,
    ).toBe(404);
    expect(
      (
        await handleReferralsApi(
          new Request(`https://slop.cash${REFERRAL_ACCRUALS_PATH}`, {
            method: "POST",
          }),
          deps,
        )
      )?.status,
    ).toBe(405);
  });
});
