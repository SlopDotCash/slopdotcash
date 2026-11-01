import { expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import { evmBindingTypedData } from "../../contracts/evm/adapter";
import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { handlePaymentsApi } from "./handler";

const wallet = privateKeyToAccount(`0x${"0".repeat(63)}1`);
const VAULT = "0x2222222222222222222222222222222222222222";
const CLAIM_DIGEST = "b".repeat(64);
const TOKEN = "a".repeat(43);

async function seeded() {
  const { db, sqlite } = sqliteD1();
  const at = new Date().toISOString();
  sqlite
    .prepare(
      "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES('alice','123','alice',?,0)",
    )
    .run(at);
  sqlite
    .prepare("INSERT INTO points_sessions VALUES(?,?,?)")
    .run(
      await sha256Hex(TOKEN),
      "alice",
      new Date(Date.now() + 3600_000).toISOString(),
    );
  sqlite
    .prepare(
      "INSERT INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,created_at,chain) VALUES('claim','123','alice',?,'d1_registry',?,?,?,?,'base')",
    )
    .run(wallet.address, "a".repeat(64), at, CLAIM_DIGEST, at);
  return { db, sqlite };
}

function call(db: unknown, path: string, body: Record<string, unknown>) {
  return handlePaymentsApi(
    new Request(`https://slop.cash/api/v1/payments${path}`, {
      method: "POST",
      headers: {
        cookie: `__Host-slop_points=${TOKEN}`,
        origin: "https://slop.cash",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    {
      db: db as never,
      paymentDeployments: [
        {
          network: "base-mainnet",
          chain: "base",
          vault: VAULT,
          chainId: "8453",
        },
      ],
      bindingVersion: async () => "0",
    },
  );
}

function signBinding(expiresAt: string) {
  const typedData = evmBindingTypedData(8453n, VAULT, {
    githubUserId: "123",
    destination: wallet.address,
    expectedVersion: "0",
    claimDigest: `0x${CLAIM_DIGEST}`,
    expiresAt,
  });
  const { EIP712Domain: _d, ...types } = typedData.types;
  return wallet.signTypedData({
    domain: {
      ...typedData.domain,
      chainId: Number(typedData.domain.chainId),
      verifyingContract: typedData.domain.verifyingContract as `0x${string}`,
    },
    types,
    primaryType: typedData.primaryType,
    message: typedData.message,
  } as never);
}

async function authorize(
  db: unknown,
  expiresAt: string,
): Promise<{ status: number; body: string }> {
  const res = await call(db, "/wallets/bind-authorize", {
    claimId: "claim",
    network: "base-mainnet",
    vault: VAULT,
    expectedVersion: "0",
    expiresAt,
    signature: await signBinding(expiresAt),
  });
  return { status: res.status, body: await res.text() };
}

test("bind-authorize refuses a consent expiring past the issued lifetime", async () => {
  const { db, sqlite } = await seeded();
  // Confirm the wallet claim first (challenge + authorize).
  const challenge = (await (
    await call(db, "/wallets/challenge", { claimId: "claim" })
  ).json()) as { message: string; challengeId: string };
  const walletAuthorized = await call(db, "/wallets/authorize", {
    claimId: "claim",
    challengeId: challenge.challengeId,
    signature: await wallet.signMessage({ message: challenge.message }),
  });
  expect(walletAuthorized.status).toBe(200);

  // The challenge itself only ever issues a 90-day consent.
  const bindChallenge = (await (
    await call(db, "/wallets/bind-challenge", {
      claimId: "claim",
      network: "base-mainnet",
      vault: VAULT,
      expectedVersion: "0",
    })
  ).json()) as { typedData: { message: { expiresAt: string } } };
  const issued = Number(bindChallenge.typedData.message.expiresAt);
  const nowSeconds = Math.floor(Date.now() / 1000);
  expect(issued - nowSeconds).toBeGreaterThan(89 * 86400);
  expect(issued - nowSeconds).toBeLessThanOrEqual(90 * 86400 + 60);

  // The issued consent is accepted and stored.
  const ok = await authorize(db, String(issued));
  expect(ok.status).toBe(200);

  // An expiry inside the submission window is still refused as too soon.
  const soon = await authorize(db, String(nowSeconds + 300));
  expect(soon.status).toBe(400);
  expect(soon.body).toContain("authorization_expires_too_soon");

  // A consent expiring ~100 years out is refused and never stored: the
  // challenge never issued it, so it cannot become a stored authorization.
  const far = String(nowSeconds + 100 * 365 * 86400);
  const tooLate = await authorize(db, far);
  expect(tooLate.status).toBe(400);
  expect(tooLate.body).toContain("authorization_expires_too_late");
  const stored = sqlite
    .query(
      "SELECT expires_at FROM payment_binding_authorizations ORDER BY expires_at",
    )
    .all() as { expires_at: string }[];
  expect(stored).toEqual([{ expires_at: String(issued) }]);
});
