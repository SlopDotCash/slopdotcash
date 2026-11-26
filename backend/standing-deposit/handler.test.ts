import { expect, test } from "bun:test";
import { standingDepositItem } from "../../src/lib/standing-deposit.mjs";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { handleStandingDeposit } from "./handler";

const origin = "https://slop.cash";
const ALICE = "900000100";
const CONTRACT = "0x00000000000000000000000000000000005d0001";
const WHOLE = 10n ** 18n;
const slop = (whole: number) => (BigInt(whole) * WHOLE).toString();

function harness({ deployed = true } = {}) {
  const { db, sqlite } = sqliteD1();
  let now = new Date("2026-12-01T12:00:00.000Z");
  let ids = 0;
  const rate = (effectiveAt: string, slopPerUsd: string) =>
    sqlite
      .query("INSERT INTO submission_fee_rates VALUES (?, ?, 'test', ?)")
      .run(effectiveAt, slopPerUsd, effectiveAt);
  const call = async (
    actor: string | null,
    path: "" | "/withdraw",
    method: "GET" | "POST" = path === "" ? "GET" : "POST",
  ) => {
    const response = await handleStandingDeposit(
      new Request(`${origin}/api/v1/standing-deposit${path}`, {
        method,
        headers:
          method === "POST"
            ? { origin, "content-type": "application/json" }
            : {},
        body: method === "POST" ? "{}" : undefined,
      }),
      {
        db,
        sessionActor: async () => (actor === null ? null : { githubId: actor }),
        now: () => now,
        randomId: () =>
          `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
        deployment: deployed
          ? { contract: CONTRACT, startBlock: 100 }
          : { contract: null, startBlock: null },
      },
    );
    if (response === null) throw new Error("route not handled");
    return {
      status: response.status,
      // biome-ignore lint/suspicious/noExplicitAny: the test reads nested JSON fields.
      body: (await response.json()) as Record<string, any>,
    };
  };
  const row = () =>
    sqlite
      .query(
        "SELECT round, item, slop_amount, slop_per_usd, cancelled_at, withdraw_requested_at FROM standing_deposits WHERE github_id = ? ORDER BY round",
      )
      .all(Number(ALICE)) as Record<string, unknown>[];
  /** What the submission-fee Worker writes when it accepts a deposit. */
  const markPaid = (round: number) => {
    sqlite
      .query(
        `INSERT INTO submission_fee_deposits
           (network, deposit_id, item, payer, token, amount, kept_to, tx_hash,
            block_number, block_time, finalized_at, accepted, state)
         VALUES ('robinhood-standing', ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 1, 'open')`,
      )
      .run(
        round,
        standingDepositItem(ALICE, round),
        "0x00000000000000000000000000000000000000aa",
        "0xfeb4e36fa4a2a494ff25ae4a63491e4c584a67ae",
        slop(750),
        "0x000000000000000000000000000000000000dEaD",
        `0x${"ab".repeat(32)}`,
        now.toISOString(),
        now.toISOString(),
      );
    sqlite
      .query(
        `UPDATE standing_deposits SET paid_at = ?, paid_network = 'robinhood-standing', paid_deposit_id = ?
          WHERE github_id = ? AND round = ?`,
      )
      .run(now.toISOString(), round, Number(ALICE), round);
  };
  return {
    call,
    rate,
    row,
    markPaid,
    sqlite,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
  };
}

test("a signed-out caller gets 401 on every route", async () => {
  const h = harness();
  for (const [path, method] of [
    ["", "GET"],
    ["", "POST"],
    ["/withdraw", "POST"],
  ] as const) {
    const answer = await h.call(null, path, method);
    expect(answer.status).toBe(401);
    expect(answer.body.error).toBe("unauthorized");
  }
});

test("asking one refuses while the contract is not deployed", async () => {
  const h = harness({ deployed: false });
  h.rate("2026-11-20T00:00:00.000Z", "75");
  const asked = await h.call(ALICE, "", "POST");
  expect(asked.status).toBe(409);
  expect(asked.body.error).toBe("standing_deposit_not_deployed");
  expect(h.row()).toEqual([]);
  const read = await h.call(ALICE, "");
  expect(read.status).toBe(200);
  expect(read.body).toMatchObject({
    schema: "slop-standing-deposit-v1",
    deployed: false,
    contract: null,
    quote: null,
    deposit: null,
    covers: [],
  });
});

test("asking one refuses before the first SLOP rate", async () => {
  const h = harness();
  const asked = await h.call(ALICE, "", "POST");
  expect(asked.status).toBe(409);
  expect(asked.body.error).toBe("no_rate");
  expect(h.row()).toEqual([]);
});

test("asking one records 10 US dollars of SLOP at the rate in force, rounded up", async () => {
  const h = harness();
  h.rate("2026-11-20T00:00:00.000Z", "78.908929");
  const asked = await h.call(ALICE, "", "POST");
  expect(asked.status).toBe(200);
  expect(asked.body).toMatchObject({
    deployed: true,
    contract: CONTRACT,
    network: "robinhood-mainnet",
    chainId: 4663,
    symbol: "SLOP",
    decimals: 18,
    keptTo: "0x000000000000000000000000000000000000dEaD",
    quote: slop(790),
    deposit: {
      round: 1,
      item: standingDepositItem(ALICE, 1),
      amount: slop(790),
      paid: null,
      withdrawRequestedAt: null,
      outcome: null,
    },
  });
  expect(h.row()).toEqual([
    expect.objectContaining({
      round: 1,
      slop_amount: slop(790),
      slop_per_usd: "78.908929",
    }),
  ]);
});

test("asking again refreshes an unpaid deposit to the rate in force and never a paid one", async () => {
  const h = harness();
  h.rate("2026-11-20T00:00:00.000Z", "75");
  await h.call(ALICE, "", "POST");
  h.rate("2026-11-27T00:00:00.000Z", "100");
  h.advance(60_000);
  const refreshed = await h.call(ALICE, "", "POST");
  expect(refreshed.body.deposit.amount).toBe(slop(1000));
  expect(h.row()).toHaveLength(1);
  expect(h.row()[0]).toMatchObject({ round: 1, slop_per_usd: "100" });
  h.markPaid(1);
  h.rate("2026-11-30T00:00:00.000Z", "200");
  const again = await h.call(ALICE, "", "POST");
  expect(again.status).toBe(200);
  expect(again.body.deposit.amount).toBe(slop(1000));
  expect(again.body.deposit.paid).toMatchObject({
    network: "robinhood-mainnet",
    depositId: 1,
    finalized: true,
  });
  expect(h.row()).toHaveLength(1);
});

test("withdrawing an unpaid deposit cancels it; the next one is a new round", async () => {
  const h = harness();
  h.rate("2026-11-20T00:00:00.000Z", "75");
  await h.call(ALICE, "", "POST");
  const withdrawn = await h.call(ALICE, "/withdraw");
  expect(withdrawn.status).toBe(200);
  expect(withdrawn.body.deposit).toBeNull();
  expect(h.row()[0].cancelled_at).toBe("2026-12-01T12:00:00.000Z");
  expect((await h.call(ALICE, "/withdraw")).body.error).toBe("no_deposit");
  const next = await h.call(ALICE, "", "POST");
  expect(next.body.deposit).toMatchObject({
    round: 2,
    item: standingDepositItem(ALICE, 2),
  });
});

test("withdrawing a paid deposit records the request once", async () => {
  const h = harness();
  h.rate("2026-11-20T00:00:00.000Z", "75");
  await h.call(ALICE, "", "POST");
  h.markPaid(1);
  h.advance(3 * 24 * 60 * 60 * 1000);
  const withdrawn = await h.call(ALICE, "/withdraw");
  expect(withdrawn.status).toBe(200);
  expect(withdrawn.body.deposit.withdrawRequestedAt).toBe(
    "2026-12-04T12:00:00.000Z",
  );
  h.advance(60_000);
  const twice = await h.call(ALICE, "/withdraw");
  expect(twice.status).toBe(409);
  expect(twice.body.error).toBe("already_requested");
  expect(h.row()[0].withdraw_requested_at).toBe("2026-12-04T12:00:00.000Z");
  expect(h.row()[0].cancelled_at).toBeNull();
});

test("the read lists the deposit's covered pull requests", async () => {
  const h = harness();
  h.rate("2026-11-20T00:00:00.000Z", "75");
  await h.call(ALICE, "", "POST");
  h.markPaid(1);
  const id = (
    h.sqlite.query("SELECT id FROM standing_deposits").get() as { id: string }
  ).id;
  h.sqlite
    .query(
      `INSERT INTO standing_deposit_covers
         (repository_id, pull_number, deposit_id, github_id, project_id, installation_id,
          owner, repo, opened_at, window_start, covered_at, state, pr_open, updated_at)
       VALUES (7, 12, ?, ?, 'eliza', 1, 'elizaOS', 'eliza', ?, ?, ?, 'watch', 1, ?)`,
    )
    .run(
      id,
      Number(ALICE),
      "2026-12-01T12:00:00.000Z",
      "2026-12-01T12:00:00.000Z",
      "2026-12-01T12:00:00.000Z",
      "2026-12-01T12:00:00.000Z",
    );
  const read = await h.call(ALICE, "");
  expect(read.body.covers).toEqual([
    { repository: "elizaOS/eliza", pullNumber: 12, state: "watch", open: true },
  ]);
});

test("a cross-site write is refused before the session is read", async () => {
  const response = await handleStandingDeposit(
    new Request(`${origin}/api/v1/standing-deposit`, {
      method: "POST",
      headers: {
        origin: "https://evil.example",
        "content-type": "application/json",
      },
      body: "{}",
    }),
    {
      db: sqliteD1().db,
      sessionActor: async () => {
        throw new Error("session read");
      },
      now: () => new Date(),
      randomId: () => "x",
    },
  );
  expect(response?.status).toBe(403);
});
