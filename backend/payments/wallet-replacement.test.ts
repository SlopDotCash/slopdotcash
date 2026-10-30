import { expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import {
  contributorAllocation,
  contributorAllocationState,
} from "../../src/lib/contributor-allocation";
import type { PaymentsAccount } from "../../src/lib/payments/contracts";
import { sqliteD1 } from "../../tests/sqlite-d1";
import {
  type JournalStore,
  retireUnsignedAttempt,
} from "../../workers/payment-executor/core";
import type { D1TransactionalDatabase } from "../d1";
import { dispatchPayment } from "./dispatch";
import { handlePaymentsApi } from "./handler";

const first = privateKeyToAccount(`0x${"8".repeat(64)}`);
const second = privateKeyToAccount(`0x${"9".repeat(64)}`);
const third = privateKeyToAccount(`0x${"7".repeat(64)}`);
const now = new Date("2026-10-27T00:00:00.000Z");

async function fixture() {
  const { db, sqlite } = sqliteD1();
  const database = db as unknown as D1TransactionalDatabase;
  let clock = now;
  sqlite
    .query(
      "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES('node','123','alice',?,0)",
    )
    .run(now.toISOString());
  sqlite
    .query("INSERT INTO points_sessions VALUES(?,?,?)")
    .run(
      await sha256Hex("a".repeat(43)),
      "node",
      new Date(Date.now() + 86400000).toISOString(),
    );
  async function call(path: string, body?: unknown) {
    const response = await handlePaymentsApi(
      new Request(`https://slop.cash/api/v1/payments/${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          cookie: `__Host-slop_points=${"a".repeat(43)}`,
          origin: "https://slop.cash",
          "content-type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      { db: database, now: () => clock },
    );
    return {
      status: response.status,
      body: (await response.json()) as {
        claimId: string;
        challengeId: string;
        message: string;
        wallets: PaymentsAccount["wallets"];
      },
    };
  }
  async function register(wallet: typeof first) {
    const result = await call("wallets/register", {
      chain: "base",
      address: wallet.address.toLowerCase(),
    });
    expect(result.status).toBe(200);
    return result.body.claimId as string;
  }
  async function consent(id: string, wallet: typeof first) {
    const challenge = await call("wallets/challenge", { claimId: id });
    expect(challenge.status).toBe(200);
    return {
      claimId: id,
      challengeId: challenge.body.challengeId,
      signature: await wallet.signMessage({ message: challenge.body.message }),
    };
  }
  async function current() {
    const result = await call("me");
    expect(result.status).toBe(200);
    return result.body.wallets;
  }
  function award(id: string) {
    sqlite
      .query(
        "INSERT INTO payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at,paid_transaction) VALUES(?,'project','123','base-sepolia','base',?,'0x036cbd53842c5426634e7929541ec2318f3dcf7e',6,'100000000','2000000',?,'reserved',?,NULL)",
      )
      .run(id, `0x${"1".repeat(40)}`, id.padEnd(64, "a"), now.toISOString());
    sqlite
      .query(
        "INSERT INTO payment_outbox(obligation_id,state,updated_at) VALUES(?,'ready',?)",
      )
      .run(id, now.toISOString());
  }
  return {
    sqlite,
    database,
    call,
    register,
    consent,
    current,
    award,
    advance() {
      clock = new Date(clock.getTime() + 16 * 60000);
    },
  };
}

test("unsigned replacements preserve the authorized wallet and dispatch, then valid signature switches once", async () => {
  const f = await fixture();
  try {
    const a = await f.register(first);
    expect(await f.current()).toEqual([
      {
        chain: "base",
        claimId: a,
        address: first.address.toLowerCase(),
        authorized: false,
        firstAuthorizedAt: null,
      },
    ]);
    expect(
      (await f.call("wallets/authorize", await f.consent(a, first))).status,
    ).toBe(200);
    const b = await f.register(second);
    const bConsent = await f.consent(b, second);
    expect(
      (
        await f.call("wallets/authorize", {
          ...bConsent,
          signature: await first.signMessage({ message: "wrong" }),
        })
      ).status,
    ).toBe(403);
    expect(await f.current()).toEqual([
      {
        chain: "base",
        claimId: a,
        address: first.address.toLowerCase(),
        authorized: true,
        firstAuthorizedAt: now.toISOString(),
      },
    ]);
    f.award("old-destination");
    let destination = "";
    expect(
      await dispatchPayment(
        f.database,
        {
          async submit(input) {
            destination = input.destination;
            return { transactionId: "old-attempt" };
          },
        },
        "old-destination",
        now,
      ),
    ).toBe("submitted");
    expect(destination).toBe(first.address.toLowerCase());
    const c = await f.register(third);
    expect((await f.call("wallets/authorize", bConsent)).status).toBe(403);
    expect((await f.current())[0].claimId).toBe(a);
    const cConsent = await f.consent(c, third);
    expect((await f.call("wallets/authorize", cConsent)).status).toBe(200);
    expect((await f.current())[0].claimId).toBe(c);
    expect((await f.call("wallets/authorize", cConsent)).status).toBe(403);
    f.award("new-destination");
    expect(
      await dispatchPayment(
        f.database,
        {
          async submit(input) {
            destination = input.destination;
            return { transactionId: "new-attempt" };
          },
        },
        "new-destination",
        now,
      ),
    ).toBe("submitted");
    expect(destination).toBe(third.address.toLowerCase());
    expect(
      f.sqlite.query("SELECT count(*) n FROM wallet_claims").get(),
    ).toEqual({ n: 3 });
    expect(
      f.sqlite
        .query(
          "SELECT claim_id FROM payment_attempts WHERE obligation_id='old-destination'",
        )
        .get(),
    ).toEqual({ claim_id: a });
  } finally {
    f.sqlite.close();
  }
});

test("allocation registration uses the first signed wallet confirmation, including after replacement", async () => {
  const allocation = contributorAllocation({
    distribution: {
      network: "base-mainnet",
      token: {
        symbol: "SLOP",
        address: `0x${"1".repeat(40)}`,
        decimals: 18,
      },
      registrationClosesAt: "2026-10-27T00:08:00.000Z",
      closed: false,
      recipients: [{ githubId: "123", amountBase: "100", transactionId: null }],
    },
  });
  if (!allocation) throw new Error("Expected allocation");
  const afterDeadline = Date.parse("2026-10-27T00:16:00.000Z");
  const onTime = await fixture();
  const late = await fixture();
  try {
    const original = await onTime.register(first);
    expect(
      (
        await onTime.call(
          "wallets/authorize",
          await onTime.consent(original, first),
        )
      ).status,
    ).toBe(200);
    onTime.advance();
    const replacement = await onTime.register(second);
    expect(
      (
        await onTime.call(
          "wallets/authorize",
          await onTime.consent(replacement, second),
        )
      ).status,
    ).toBe(200);
    const onTimeWallets = await onTime.current();
    expect(onTimeWallets[0]).toMatchObject({
      claimId: replacement,
      firstAuthorizedAt: now.toISOString(),
    });
    expect(
      contributorAllocationState(
        allocation,
        allocation.recipients[0],
        onTimeWallets,
        afterDeadline,
      ),
    ).toBe("scheduled");

    late.advance();
    const lateClaim = await late.register(third);
    expect(
      (
        await late.call(
          "wallets/authorize",
          await late.consent(lateClaim, third),
        )
      ).status,
    ).toBe(200);
    const lateWallets = await late.current();
    expect(lateWallets[0].firstAuthorizedAt).toBe("2026-10-27T00:16:00.000Z");
    expect(
      contributorAllocationState(
        allocation,
        allocation.recipients[0],
        lateWallets,
        afterDeadline,
      ),
    ).toBe("unclaimed");
  } finally {
    onTime.sqlite.close();
    late.sqlite.close();
  }
});

test("first unsigned registration cannot dispatch and retired operator proposals cannot write", async () => {
  const f = await fixture();
  try {
    await f.register(first);
    f.award("unsigned");
    expect(
      await dispatchPayment(
        f.database,
        {
          async submit() {
            throw new Error("unsigned wallet dispatched");
          },
        },
        "unsigned",
        now,
      ),
    ).toBe("unavailable");
    const result = await f.call("admin/wallet-proposals", {
      githubUserId: "123",
      chain: "base",
      address: second.address.toLowerCase(),
      reason: "recovery",
    });
    expect(result.status).toBe(404);
    expect(
      f.sqlite.query("SELECT count(*) n FROM payment_wallet_proposals").get(),
    ).toEqual({ n: 0 });
  } finally {
    f.sqlite.close();
  }
});

test("an expired replacement challenge leaves the previous verified destination active", async () => {
  const f = await fixture();
  try {
    const a = await f.register(first);
    expect(
      (await f.call("wallets/authorize", await f.consent(a, first))).status,
    ).toBe(200);
    const b = await f.register(second);
    const consent = await f.consent(b, second);
    f.advance();
    expect((await f.call("wallets/authorize", consent)).status).toBe(403);
    expect((await f.current())[0].claimId).toBe(a);
  } finally {
    f.sqlite.close();
  }
});

test("unsigned registration cannot retire an old attempt, but a signed descendant can", async () => {
  const f = await fixture();
  const values = new Map<string, unknown>();
  const journal: JournalStore = {
    async get<T>(key: string) {
      return values.get(key) as T | undefined;
    },
    async put<T>(key: string, value: T) {
      values.set(key, value);
    },
    async transaction<T>(callback: (store: JournalStore) => Promise<T>) {
      return callback(journal);
    },
  };
  try {
    const a = await f.register(first);
    expect(
      (await f.call("wallets/authorize", await f.consent(a, first))).status,
    ).toBe(200);
    f.award("held");
    f.sqlite
      .query(
        "INSERT INTO payment_attempts(id,obligation_id,claim_id,created_at,state) VALUES('attempt','held',?,?,'unknown')",
      )
      .run(a, now.toISOString());
    await f.register(second);
    const input = {
      idempotencyKey: "attempt",
      obligationId: "held",
      network: "base-sepolia",
      vault: `0x${"1".repeat(40)}`,
    };
    const env = { PAYMENTS_DB: f.database, JOURNAL: journal };
    await expect(retireUnsignedAttempt(env, input)).rejects.toThrow(
      "Signed successor authorization required",
    );
    expect(values.size).toBe(0);
    const c = await f.register(third);
    expect(
      (await f.call("wallets/authorize", await f.consent(c, third))).status,
    ).toBe(200);
    expect(await retireUnsignedAttempt(env, input)).toEqual({
      retired: true,
      transactionId: null,
    });
    expect(values.get("retired:base-sepolia:attempt")).toEqual({
      obligationId: "held",
      claimId: a,
      successorClaimId: c,
    });
    values.set("pay:attempt", { ...input, transactionId: "0x1234" });
    expect(await retireUnsignedAttempt(env, input)).toEqual({
      retired: false,
      transactionId: "0x1234",
    });
  } finally {
    f.sqlite.close();
  }
});
