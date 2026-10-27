// A wallet rotation waits until every older-wallet payment attempt is
// reconciled. Once a finalized payout of the award is indexed, an attempt left
// without that transaction (a lost executor response, or a payout made by
// another pay() call) can no longer pay anything, and the recovery and
// reconcile steps skip paid awards. It must not hold the rotation forever.
import type { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import type { D1TransactionalDatabase as D1Database } from "../../backend/d1";
import { dispatchPayment } from "../../backend/payments/dispatch";
import {
  type FinalizedPaymentEvent,
  indexPaymentEvent,
} from "../../backend/payments/ledger";
import { buildPaymentWalletMessage } from "../../backend/payments/possession";
import { MIGRATIONS, sqliteD1 } from "../../tests/sqlite-d1";
import { authorizeWalletRotation } from "./core";

const registered = "2026-10-01T00:00:00.000Z";
const vault = `0x${"1".repeat(40)}`;
const oldWallet = privateKeyToAccount(`0x${"8".repeat(64)}`);
const newWallet = privateKeyToAccount(`0x${"9".repeat(64)}`);
const oldDigest = "a".repeat(64);
const newDigest = "f".repeat(64);
const firstAward = `0x${"c".repeat(64)}`;
const laterAward = `0x${"d".repeat(64)}`;
const paidTransaction = `0x${"77".repeat(32)}`;

function open() {
  const { db, sqlite: sql } = sqliteD1(MIGRATIONS);
  // The ledger takes the award asset from the finalized vault snapshot.
  sql.exec(
    `INSERT INTO vault_snapshots(project_id,network,chain,vault,asset_address,asset_decimals,total_deposited,total_paid,total_payout_fees,total_gross_withdrawn,total_withdrawal_fees,total_service_fees,block_number,block_time,observed_at) VALUES('project-1','base-sepolia','base','${vault}','0x036cbd53842c5426634e7929541ec2318f3dcf7e',6,'0','0','0','0','0','0','1','${registered}','${registered}')`,
  );
  return { sql, db: db as unknown as D1Database };
}

async function registerWallet(
  sql: Database,
  id: string,
  wallet: typeof oldWallet,
  digest: string,
  supersedes: string | null,
) {
  sql
    .query(
      "INSERT INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,supersedes_claim_id,created_at,chain) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      id,
      "101",
      "alice",
      wallet.address,
      "d1_registry",
      digest,
      registered,
      digest,
      supersedes,
      registered,
      "base",
    );
  const expiresAt = "2026-10-01T00:15:00.000Z";
  const message = buildPaymentWalletMessage({
    actorId: "101",
    chain: "base",
    address: wallet.address,
    claimId: id,
    claimDigest: digest,
    nonce: `challenge-${id}`,
    expiresAt,
  });
  sql
    .query(
      "INSERT INTO payment_wallet_challenges(id,claim_id,github_user_id,message,expires_at,consumed_at) VALUES(?,?,?,?,?,?)",
    )
    .run(`challenge-${id}`, id, "101", message, expiresAt, registered);
  sql
    .query(
      "INSERT INTO payment_wallet_authorizations(claim_id,github_user_id,authorized_at,challenge_id,signature) VALUES(?,?,?,?,?)",
    )
    .run(
      id,
      "101",
      registered,
      `challenge-${id}`,
      await wallet.signMessage({ message }),
    );
}

function chainEvent(
  db: D1Database,
  kind: "reserved" | "paid",
  obligationId: string,
  transactionId: string,
) {
  const event: FinalizedPaymentEvent = {
    kind,
    transactionId,
    eventIndex: 0,
    blockId: `0x${"ab".repeat(32)}`,
    obligationId,
    projectId: "project-1",
    network: "base-sepolia",
    chain: "base",
    vault,
    githubUserId: "101",
    grossMicro: "100000000",
    netMicro: "98000000",
    feeMicro: "2000000",
    sourceDigest: obligationId.slice(2),
    ...(kind === "paid" ? { destination: oldWallet.address } : {}),
  };
  return indexPaymentEvent(
    db,
    { verifyFinalized: async () => event },
    { transactionId, eventIndex: 0, kind, obligationId },
    registered,
  );
}

/** Dispatches the first award to the old wallet and indexes its payout, then
 * rotates to a new wallet and dispatches a later award, whose executor must
 * authorize the rotation before it binds the new wallet. Returns the later
 * dispatch result or the reason it was refused. */
async function rotateAfterFirstAward(
  submit: () => Promise<{ transactionId: string }>,
  paidBy: string | null,
) {
  const { sql, db } = open();
  try {
    await registerWallet(sql, "claim-old", oldWallet, oldDigest, null);
    await chainEvent(db, "reserved", firstAward, `0x${"01".repeat(32)}`);
    const firstDispatch = dispatchPayment(
      db,
      { submit },
      firstAward,
      new Date(registered),
    );
    if (submit === lostResponse)
      await expect(firstDispatch).rejects.toThrow(
        "Payment execution service rejected request",
      );
    else expect(await firstDispatch).toBe("submitted");
    if (paidBy) await chainEvent(db, "paid", firstAward, paidBy);
    await registerWallet(sql, "claim-new", newWallet, newDigest, "claim-old");
    await chainEvent(db, "reserved", laterAward, `0x${"02".repeat(32)}`);
    return await dispatchPayment(
      db,
      {
        async submit(input) {
          await authorizeWalletRotation(
            { PAYMENTS_DB: db },
            input,
            `0x${oldDigest}`,
          );
          return { transactionId: `0x${"88".repeat(32)}` };
        },
      },
      laterAward,
      new Date(),
    ).catch((error: Error) => error.message);
  } finally {
    sql.close();
  }
}

const lostResponse = async (): Promise<{ transactionId: string }> => {
  throw new Error("Payment execution service rejected request");
};

test("rotates after the award was paid by the attempt's own transaction", async () => {
  expect(
    await rotateAfterFirstAward(
      async () => ({ transactionId: paidTransaction }),
      paidTransaction,
    ),
  ).toBe("submitted");
});

test("rotates after a paid award whose attempt lost its executor response", async () => {
  expect(await rotateAfterFirstAward(lostResponse, paidTransaction)).toBe(
    "submitted",
  );
});

test("rotates after a paid award whose attempt was outpaid by another transaction", async () => {
  expect(
    await rotateAfterFirstAward(
      async () => ({ transactionId: `0x${"66".repeat(32)}` }),
      paidTransaction,
    ),
  ).toBe("submitted");
});

test("still holds the rotation while an unpaid award's attempt is uncertain", async () => {
  expect(await rotateAfterFirstAward(lostResponse, null)).toBe(
    "Wallet rotation held until earlier payment attempts are reconciled",
  );
});
