// The "Funded by" record: finalized deposits stored once and served from D1.
import { expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { handlePaymentsApi } from "./handler";
import { type VaultDepositRecord, vaultDepositInsert } from "./vault-deposits";
import { storeVaultSnapshot, type VaultTotals } from "./vault-snapshots";

const VAULT = "0x2222222222222222222222222222222222222222";
const ASSET = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const FUNDER = "0xabcdef0123456789abcdef0123456789abcdef01";
const OTHER = `0x${"7".repeat(40)}`;
const at = "2026-11-18T10:05:00.000Z";

const totals = (network: string): VaultTotals => ({
  network,
  vault: VAULT,
  asset: ASSET,
  decimals: 6,
  blockNumber: "1000",
  blockTime: "2026-11-18T10:00:00Z",
  totalDeposited: "253000000",
  totalPaid: "0",
  totalPayoutFees: "0",
  totalGrossWithdrawn: "0",
  totalWithdrawalFees: "0",
  freeBalance: "253000000",
  reservedPrincipal: "0",
  reservedFees: "0",
  accruedFees: "0",
  reserved: null,
});
const deposit = (
  overrides: Partial<VaultDepositRecord> = {},
): VaultDepositRecord => ({
  projectId: "acme",
  network: "base-mainnet",
  chain: "base",
  vault: VAULT,
  transactionId: `0x${"a".repeat(64)}`,
  eventIndex: 3,
  depositor: FUNDER,
  amount: "253000000",
  blockNumber: "900",
  blockTime: "2026-11-14T12:10:00Z",
  ...overrides,
});
const read = async (db: unknown, tier: "production" | "staging") => {
  const response = await handlePaymentsApi(
    new Request(
      `https://${tier === "staging" ? "staging." : ""}slop.cash/api/v1/payments/projects/acme/deposits`,
    ),
    { db: db as never, now: () => new Date(at), tier },
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe(
    "public, max-age=60, s-maxage=60",
  );
  return (await response.json()) as {
    projectId: string;
    total: number;
    deposits: Record<string, unknown>[];
  };
};
const member = (
  sqlite: ReturnType<typeof sqliteD1>["sqlite"],
  id: string,
  login: string,
  isPublic: 0 | 1,
) =>
  sqlite
    .prepare(
      "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES(?,?,?,?,?)",
    )
    .run(login, id, login, at, isPublic);
const claim = (
  sqlite: ReturnType<typeof sqliteD1>["sqlite"],
  id: string,
  login: string,
  address: string,
  chain: string,
) =>
  sqlite
    .prepare(
      "INSERT INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,created_at,chain) VALUES(?,?,?,?,'d1_registry',?,?,?,?,?)",
    )
    .run(
      `claim-${id}-${chain}`,
      id,
      login,
      address,
      "a".repeat(64),
      at,
      `${id}${chain}`.padEnd(64, "0").slice(0, 64),
      at,
      chain,
    );
/** The wallet's own signature on a registration, as `/wallets/authorize` stores it. */
const sign = (
  sqlite: ReturnType<typeof sqliteD1>["sqlite"],
  id: string,
  chain: string,
) => {
  const claimId = `claim-${id}-${chain}`;
  sqlite
    .prepare(
      "INSERT INTO payment_wallet_challenges(id,claim_id,github_user_id,message,expires_at,consumed_at) VALUES(?,?,?,'fixture',?,?)",
    )
    .run(`challenge-${claimId}`, claimId, id, at, at);
  sqlite
    .prepare(
      "INSERT INTO payment_wallet_authorizations(claim_id,github_user_id,authorized_at,challenge_id,signature) VALUES(?,?,?,?,'fixture')",
    )
    .run(claimId, id, at, `challenge-${claimId}`);
};

test("a finalized deposit is stored once and never changes", async () => {
  const { db, sqlite } = sqliteD1();
  try {
    await vaultDepositInsert(db, deposit(), at).run();
    // The same event read again, even with other values, adds nothing.
    await vaultDepositInsert(db, deposit({ amount: "1" }), at).run();
    expect(
      sqlite
        .query("SELECT depositor,amount,block_time FROM vault_deposits")
        .all(),
    ).toEqual([
      {
        depositor: FUNDER,
        amount: "253000000",
        block_time: "2026-11-14T12:10:00.000Z",
      },
    ]);
    expect(() => sqlite.exec("UPDATE vault_deposits SET amount='2'")).toThrow(
      "vault deposit immutable",
    );
    expect(() => sqlite.exec("DELETE FROM vault_deposits")).toThrow(
      "vault deposit permanent",
    );
  } finally {
    sqlite.close();
  }
});

test("a record that no deposit event could produce is refused", () => {
  const { db, sqlite } = sqliteD1();
  try {
    for (const bad of [
      { amount: "0" },
      { amount: "-1" },
      { depositor: "0x1234" },
      { depositor: "0xAbCdEf0123456789aBcDeF0123456789abCDef01" },
      { transactionId: "0x1234" },
      { eventIndex: -1 },
      { blockTime: "soon" },
      { chain: "solana" as const },
    ])
      expect(() => vaultDepositInsert(db, deposit(bad), at)).toThrow(
        "Invalid finalized vault deposit",
      );
  } finally {
    sqlite.close();
  }
});

test("the public list names a funder only through one public registered wallet", async () => {
  const { db, sqlite } = sqliteD1();
  try {
    await storeVaultSnapshot(
      db,
      {
        projectId: "acme",
        network: "base-mainnet",
        chain: "base",
        vault: VAULT,
        asset: ASSET,
      },
      totals("base-mainnet"),
      at,
    );
    await vaultDepositInsert(db, deposit(), at).run();
    await vaultDepositInsert(
      db,
      deposit({
        transactionId: `0x${"b".repeat(64)}`,
        eventIndex: 0,
        depositor: OTHER,
        amount: "1000000",
        blockTime: "2026-11-17T09:00:00Z",
      }),
      at,
    ).run();
    // No registered wallet: both funders are addresses only.
    expect((await read(db, "production")).deposits).toMatchObject([
      { depositor: OTHER, githubLogin: null, amountBase: "1000000" },
      { depositor: FUNDER, githubLogin: null },
    ]);
    // A wallet registered for another EVM network names the same key holder.
    member(sqlite, "101", "funder", 1);
    claim(sqlite, "101", "funder", FUNDER, "robinhood");
    sign(sqlite, "101", "robinhood");
    // A private member's wallet is never turned into a name.
    member(sqlite, "102", "quiet", 0);
    claim(sqlite, "102", "quiet", OTHER, "base");
    sign(sqlite, "102", "base");
    const named = await read(db, "production");
    expect(named).toMatchObject({ projectId: "acme", total: 2 });
    expect(named.deposits).toEqual([
      {
        id: `base-mainnet:0x${"b".repeat(64)}:0`,
        projectId: "acme",
        network: "base-mainnet",
        chain: "base",
        vault: VAULT,
        depositor: OTHER,
        githubLogin: null,
        amountBase: "1000000",
        assetAddress: ASSET,
        assetDecimals: 6,
        transactionId: `0x${"b".repeat(64)}`,
        depositedAt: "2026-11-17T09:00:00.000Z",
      },
      {
        id: `base-mainnet:0x${"a".repeat(64)}:3`,
        projectId: "acme",
        network: "base-mainnet",
        chain: "base",
        vault: VAULT,
        depositor: FUNDER,
        githubLogin: "funder",
        amountBase: "253000000",
        assetAddress: ASSET,
        assetDecimals: 6,
        transactionId: `0x${"a".repeat(64)}`,
        depositedAt: "2026-11-14T12:10:00.000Z",
      },
    ]);
    // Two accounts with the same address: the address is not a name.
    member(sqlite, "103", "second", 1);
    claim(sqlite, "103", "second", FUNDER, "base");
    sign(sqlite, "103", "base");
    expect((await read(db, "production")).deposits[1]).toMatchObject({
      githubLogin: null,
    });
  } finally {
    sqlite.close();
  }
});

test("a registration the wallet did not sign neither names a funder nor hides one", async () => {
  const { db, sqlite } = sqliteD1();
  try {
    const wallet = privateKeyToAccount(`0x${"8".repeat(64)}`);
    const address = wallet.address.toLowerCase();
    await storeVaultSnapshot(
      db,
      {
        projectId: "acme",
        network: "base-mainnet",
        chain: "base",
        vault: VAULT,
        asset: ASSET,
      },
      totals("base-mainnet"),
      at,
    );
    await vaultDepositInsert(db, deposit({ depositor: address }), at).run();
    const session = async (id: string, login: string, token: string) => {
      member(sqlite, id, login, 1);
      sqlite
        .prepare("INSERT INTO points_sessions VALUES(?,?,?)")
        .run(
          await sha256Hex(token),
          login,
          new Date(Date.parse(at) + 86_400_000).toISOString(),
        );
      return async (path: string, body: unknown) => {
        const response = await handlePaymentsApi(
          new Request(`https://slop.cash/api/v1/payments/${path}`, {
            method: "POST",
            headers: {
              cookie: `__Host-slop_points=${token}`,
              origin: "https://slop.cash",
              "content-type": "application/json",
            },
            body: JSON.stringify(body),
          }),
          { db: db as never, now: () => new Date(at), tier: "production" },
        );
        expect(response.status).toBe(200);
        return (await response.json()) as Record<string, string>;
      };
    };
    // Any signed-in account can register an address it does not control.
    const stranger = await session("201", "stranger", "s".repeat(43));
    await stranger("wallets/register", { chain: "base", address });
    expect((await read(db, "production")).deposits).toMatchObject([
      { depositor: address, githubLogin: null },
    ]);
    // The key holder registers the address and signs the challenge.
    const funder = await session("202", "funder", "f".repeat(43));
    const { claimId } = await funder("wallets/register", {
      chain: "base",
      address,
    });
    const challenge = await funder("wallets/challenge", { claimId });
    await funder("wallets/authorize", {
      claimId,
      challengeId: challenge.challengeId,
      signature: await wallet.signMessage({ message: challenge.message }),
    });
    // The unsigned registration of the other account does not hide the name.
    expect((await read(db, "production")).deposits).toMatchObject([
      { depositor: address, githubLogin: "funder" },
    ]);
  } finally {
    sqlite.close();
  }
});

test("production leaves test-network deposits out; staging keeps them", async () => {
  const { db, sqlite } = sqliteD1();
  try {
    await storeVaultSnapshot(
      db,
      {
        projectId: "acme",
        network: "base-sepolia",
        chain: "base",
        vault: VAULT,
        asset: ASSET,
      },
      totals("base-sepolia"),
      at,
    );
    await vaultDepositInsert(
      db,
      deposit({ network: "base-sepolia" }),
      at,
    ).run();
    expect(await read(db, "production")).toMatchObject({
      total: 0,
      deposits: [],
    });
    expect(await read(db, "staging")).toMatchObject({
      total: 1,
      deposits: [{ network: "base-sepolia" }],
    });
  } finally {
    sqlite.close();
  }
});
