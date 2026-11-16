import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import {
  contributorAllocation,
  contributorAllocationState,
} from "../../src/lib/contributor-allocation";
import type { PaymentsAccount } from "../../src/lib/payments/contracts";
import { sqliteD1 } from "../../tests/sqlite-d1";
import type { JournalStore } from "../../workers/payment-executor/binding-shared";
import { retireUnsignedAttempt } from "../../workers/payment-executor/core";
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
  async function call(
    path: string,
    body?: unknown,
    options: { token?: string; expectedActor?: string } = {},
  ) {
    const response = await handlePaymentsApi(
      new Request(`https://slop.cash/api/v1/payments/${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          cookie: `__Host-slop_points=${options.token ?? "a".repeat(43)}`,
          origin: "https://slop.cash",
          "content-type": "application/json",
          ...(options.expectedActor === undefined
            ? {}
            : { "x-slop-expected-github-id": options.expectedActor }),
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
        error?: string;
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

test("wallet account binding refuses a switched session before claims, challenges or authorization", async () => {
  const f = await fixture();
  try {
    const token = "b".repeat(43);
    f.sqlite
      .query(
        "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES('node-b','456','bob',?,0)",
      )
      .run(now.toISOString());
    f.sqlite
      .query("INSERT INTO points_sessions VALUES(?,?,?)")
      .run(
        await sha256Hex(token),
        "node-b",
        new Date(now.getTime() + 86400000).toISOString(),
      );
    const counts = () => ({
      claims: f.sqlite.query("SELECT COUNT(*) n FROM wallet_claims").get(),
      challenges: f.sqlite
        .query("SELECT COUNT(*) n FROM payment_wallet_challenges")
        .get(),
      authorizations: f.sqlite
        .query("SELECT COUNT(*) n FROM payment_wallet_authorizations")
        .get(),
    });
    const before = counts();
    const refused = await f.call(
      "wallets/register",
      { chain: "base", address: first.address.toLowerCase() },
      { token, expectedActor: "123" },
    );
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe("actor_changed");
    expect(counts()).toEqual(before);
    // Absence remains compatible; it still means the authenticated B, never A.
    const registered = await f.call(
      "wallets/register",
      { chain: "base", address: first.address.toLowerCase() },
      { token },
    );
    expect(registered.status).toBe(200);
    const claimId = registered.body.claimId;
    expect(
      f.sqlite
        .query("SELECT github_user_id FROM wallet_claims WHERE id=?")
        .get(claimId),
    ).toEqual({ github_user_id: "456" });
    const afterRegistration = counts();
    for (const [path, body] of [
      ["me", undefined],
      ["wallets/challenge", { claimId }],
    ] as const) {
      const response = await f.call(path, body, {
        token,
        expectedActor: "123",
      });
      expect(response.status).toBe(403);
      expect(response.body.error).toBe("actor_changed");
    }
    expect(counts()).toEqual(afterRegistration);
    const challenge = await f.call(
      "wallets/challenge",
      { claimId },
      { token, expectedActor: "456" },
    );
    expect(challenge.status).toBe(200);
    const authorization = {
      claimId,
      challengeId: challenge.body.challengeId,
      signature: await first.signMessage({ message: challenge.body.message }),
    };
    const rejectedAuthorization = await f.call(
      "wallets/authorize",
      authorization,
      { token, expectedActor: "123" },
    );
    expect(rejectedAuthorization.status).toBe(403);
    expect(rejectedAuthorization.body.error).toBe("actor_changed");
    expect(
      f.sqlite
        .query("SELECT consumed_at FROM payment_wallet_challenges WHERE id=?")
        .get(authorization.challengeId),
    ).toEqual({ consumed_at: null });
    expect(
      (
        await f.call("wallets/authorize", authorization, {
          token,
          expectedActor: "456",
        })
      ).status,
    ).toBe(200);
    const malformed = await f.call("me", undefined, {
      token,
      expectedActor: "invalid",
    });
    expect(malformed.status).toBe(400);
    expect(malformed.body.error).toBe("invalid_expected_actor");
  } finally {
    f.sqlite.close();
  }
});

test("generated Quint wallet histories match real registration, authorization and dispatch", async () => {
  const directory = mkdtempSync(join(tmpdir(), "slop-wallet-model-"));
  try {
    execFileSync(
      "node",
      [
        resolve("node_modules/@informalsystems/quint/dist/src/cli.js"),
        "run",
        "formal/models/payments/effective_wallet_history.qnt",
        "--backend=typescript",
        "--seed=20261107",
        "--max-samples=25",
        "--max-steps=12",
        "--n-traces=25",
        `--out-itf=${join(directory, "wallet-{seq}.json")}`,
      ],
      { stdio: "pipe" },
    );
    const wallets = [first, second, third];
    const paths = readdirSync(directory);
    expect(paths).toHaveLength(25);
    for (const [traceIndex, file] of paths.entries()) {
      const trace = JSON.parse(
        readFileSync(join(directory, file), "utf8"),
        (_key, value) =>
          value && typeof value === "object" && "#bigint" in value
            ? Number(value["#bigint"])
            : value,
      ) as {
        states: { s: { head: number; authorized: { "#set": number[] } } }[];
      };
      const f = await fixture();
      const claims: string[] = [];
      let previousHead = 0;
      let previousAuthorized: number[] = [];
      try {
        for (const { s } of trace.states) {
          const authorized = s.authorized["#set"];
          if (s.head !== previousHead) {
            expect(s.head).toBe(previousHead + 1);
            claims.push(await f.register(wallets[s.head - 1]));
          }
          const newlyAuthorized = authorized.filter(
            (id) => !previousAuthorized.includes(id),
          );
          for (const id of newlyAuthorized) {
            expect(id).toBe(s.head);
            expect(
              (
                await f.call(
                  "wallets/authorize",
                  await f.consent(claims[id - 1], wallets[id - 1]),
                )
              ).status,
            ).toBe(200);
          }
          const effective = authorized.length
            ? Math.max(...authorized)
            : s.head;
          const actual = await f.current();
          expect(actual).toHaveLength(effective > 0 ? 1 : 0);
          if (effective > 0) {
            expect(actual[0].claimId).toBe(claims[effective - 1]);
            expect(actual[0].authorized).toBe(authorized.length > 0);
          }
          previousHead = s.head;
          previousAuthorized = authorized;
        }
        const id = `quint-wallet-${traceIndex}`;
        f.award(id);
        let destination: string | undefined;
        const result = await dispatchPayment(
          f.database,
          {
            async submit(input) {
              destination = input.destination;
              return { transactionId: `quint-submission-${traceIndex}` };
            },
          },
          id,
          now,
        );
        expect(result).toBe(
          previousAuthorized.length ? "submitted" : "unavailable",
        );
        if (previousAuthorized.length)
          expect(destination).toBe(
            wallets[Math.max(...previousAuthorized) - 1].address.toLowerCase(),
          );
        else expect(destination).toBeUndefined();
        expect(
          f.sqlite.query("SELECT count(*) n FROM wallet_claims").get(),
        ).toEqual({ n: previousHead });
      } finally {
        f.sqlite.close();
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

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

test("a GitHub login rename reuses the existing wallet claim", async () => {
  const f = await fixture();
  try {
    const claimId = await f.register(first);
    expect(
      (await f.call("wallets/authorize", await f.consent(claimId, first)))
        .status,
    ).toBe(200);
    f.sqlite
      .query(
        "UPDATE points_members SET login='alice-renamed' WHERE github_id='123'",
      )
      .run();

    expect(await f.register(first)).toBe(claimId);
    expect(
      f.sqlite.query("SELECT count(*) AS n FROM wallet_claims").get(),
    ).toEqual({ n: 1 });
    expect(await f.current()).toEqual([
      {
        chain: "base",
        claimId,
        address: first.address.toLowerCase(),
        authorized: true,
        firstAuthorizedAt: now.toISOString(),
      },
    ]);
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
    await expect(retireUnsignedAttempt(env, input)).rejects.toThrow();
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

test("authorizing a replacement keeps a hold parked under another claim's uncertain attempt", async () => {
  const f = await fixture();
  const states = () =>
    Object.fromEntries(
      (
        f.sqlite
          .query("SELECT obligation_id id,state FROM payment_outbox ORDER BY 1")
          .all() as { id: string; state: string }[]
      ).map((row) => [row.id, row.state]),
    );
  try {
    const a = await f.register(first);
    expect(
      (await f.call("wallets/authorize", await f.consent(a, first))).status,
    ).toBe(200);
    f.award("uncertain");
    f.award("free");
    f.sqlite
      .query(
        "INSERT INTO payment_attempts(id,obligation_id,claim_id,created_at,state) VALUES('attempt','uncertain',?,?,'unknown')",
      )
      .run(a, now.toISOString());
    f.sqlite.query("UPDATE payment_outbox SET state='held'").run();
    const b = await f.register(second);
    expect(
      (await f.call("wallets/authorize", await f.consent(b, second))).status,
    ).toBe(200);
    // The unrelated hold is released. The hold under claim a's uncertain
    // attempt waits for recovery instead of flickering back through ready.
    expect(states()).toEqual({ free: "ready", uncertain: "held" });
    f.sqlite
      .query("UPDATE payment_attempts SET state='failed' WHERE id='attempt'")
      .run();
    const c = await f.register(third);
    expect(
      (await f.call("wallets/authorize", await f.consent(c, third))).status,
    ).toBe(200);
    expect(states()).toEqual({ free: "ready", uncertain: "ready" });
  } finally {
    f.sqlite.close();
  }
});
