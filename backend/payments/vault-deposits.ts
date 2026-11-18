/**
 * Finalized vault deposits, as the "Funded by" list shows them (operator
 * decision, 18 November 2026, PRD section 6). The payments Worker records
 * each vault `Deposited` event once (workers/payments/deposits.ts); pages
 * read the stored rows and never a chain. The list is display evidence only:
 * balances and funded months still come from the vault counters.
 */
import { chainFamily, isEscrowChain } from "../../src/lib/escrow-policy.mjs";
import {
  isBaseUnits,
  type PaymentChain,
  type PublicVaultDeposit,
  transactionUrl,
} from "../../src/lib/payments/contracts";
import { isWalletAddress } from "../../src/lib/wallets";
import type { D1Database, D1Statement } from "../d1";

/** The newest deposits one page shows; the response carries the full count. */
export const VAULT_DEPOSIT_PAGE = 50;

export interface VaultDepositRecord {
  projectId: string;
  network: string;
  chain: PaymentChain;
  /** The reviewed deployment's vault, as `vault_snapshots` keys it. */
  vault: string;
  transactionId: string;
  eventIndex: number;
  depositor: string;
  /** Base units of the vault asset, above zero. */
  amount: string;
  blockNumber: string;
  blockTime: string;
}

/** Refuses a record that could not have come from a finalized deposit event. */
export function assertVaultDeposit(
  record: VaultDepositRecord,
): VaultDepositRecord {
  const evm =
    isEscrowChain(record.chain) && chainFamily(record.chain) === "evm";
  if (
    !isEscrowChain(record.chain) ||
    typeof record.projectId !== "string" ||
    !/^[a-z0-9][a-z0-9-]*$/u.test(record.projectId) ||
    typeof record.network !== "string" ||
    typeof record.vault !== "string" ||
    !isWalletAddress(evm ? "base" : "solana", record.depositor) ||
    !transactionUrl(record.network, record.transactionId) ||
    !(evm
      ? /^0x[0-9a-f]{64}$/u.test(record.transactionId)
      : /^[1-9A-HJ-NP-Za-km-z]{64,88}$/u.test(record.transactionId)) ||
    !Number.isSafeInteger(record.eventIndex) ||
    record.eventIndex < 0 ||
    !isBaseUnits(record.amount) ||
    BigInt(record.amount) <= 0n ||
    !/^(0|[1-9][0-9]{0,19})$/u.test(record.blockNumber) ||
    typeof record.blockTime !== "string" ||
    Number.isNaN(Date.parse(record.blockTime))
  )
    throw new Error("Invalid finalized vault deposit");
  return record;
}

/**
 * One idempotent insert. A deposit is keyed by its network, transaction and
 * event index, so a page read twice, or by two overlapping runs, adds nothing.
 */
export function vaultDepositInsert<S extends D1Statement>(
  db: D1Database<S>,
  record: VaultDepositRecord,
  recordedAt: string,
): S {
  const deposit = assertVaultDeposit(record);
  const evm = chainFamily(deposit.chain) === "evm";
  return db
    .prepare(
      "INSERT INTO vault_deposits(project_id,network,chain,vault,transaction_id,event_index,depositor,amount,block_number,block_time,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(network,transaction_id,event_index) DO NOTHING",
    )
    .bind(
      deposit.projectId,
      deposit.network,
      deposit.chain,
      deposit.vault,
      deposit.transactionId,
      deposit.eventIndex,
      evm ? deposit.depositor.toLowerCase() : deposit.depositor,
      deposit.amount,
      deposit.blockNumber,
      new Date(deposit.blockTime).toISOString(),
      recordedAt,
    ) as S;
}

type StoredDeposit = {
  network: string;
  chain: string;
  vault: string;
  transactionId: string;
  eventIndex: number;
  depositor: string;
  amount: string;
  blockTime: string;
  assetAddress: string;
  assetDecimals: number;
};
type StoredWallet = { chain: string; address: string; login: string };

/**
 * A project's newest finalized deposits with the asset of the vault they
 * entered. A depositor is named by GitHub login only when exactly one public,
 * open Slop account currently has that address registered (on Solana for a
 * Solana deposit, on any EVM network for an EVM deposit); a private or closed
 * account, or an address two accounts registered, shows the address alone. `includeTestnets` follows the deployment tier, as
 * the vault totals do.
 */
export async function projectVaultDeposits(
  db: D1Database,
  projectId: string,
  includeTestnets: boolean,
  isTestnet: (network: string) => boolean,
): Promise<{ deposits: PublicVaultDeposit[]; total: number }> {
  const row = await db
    .prepare(
      `SELECT (SELECT json_group_array(json_object('network',network,'chain',chain,'vault',vault,'transactionId',transaction_id,'eventIndex',event_index,'depositor',depositor,'amount',amount,'blockTime',block_time,'assetAddress',asset_address,'assetDecimals',asset_decimals)) FROM (
         SELECT d.network,d.chain,d.vault,d.transaction_id,d.event_index,d.depositor,d.amount,d.block_time,s.asset_address,s.asset_decimals
         FROM vault_deposits d
         JOIN vault_snapshots s ON s.project_id=d.project_id AND s.network=d.network AND s.vault=d.vault
         WHERE d.project_id=?1
         ORDER BY d.block_time DESC, d.network, d.transaction_id DESC, d.event_index DESC)) items,
       (SELECT json_group_array(json_object('chain',chain,'address',wallet_address,'login',github_login)) FROM (
         SELECT w.chain,w.wallet_address,w.github_login
         FROM effective_payment_wallet_claims w
         WHERE EXISTS (SELECT 1 FROM vault_deposits d WHERE d.project_id=?1
             AND ((d.chain='solana' AND w.chain='solana' AND d.depositor=w.wallet_address)
               OR (d.chain!='solana' AND w.chain!='solana' AND d.depositor=lower(w.wallet_address))))
           AND NOT EXISTS (SELECT 1 FROM points_members p WHERE p.github_id=w.github_user_id
             AND (p.public!=1 OR p.closed_at IS NOT NULL)))) wallets`,
    )
    .bind(projectId)
    .first<{ items: string; wallets: string }>();
  const stored = (JSON.parse(row?.items ?? "[]") as StoredDeposit[]).filter(
    (deposit) => includeTestnets || !isTestnet(deposit.network),
  );
  // An address is a name only when one account holds it.
  const logins = new Map<string, Set<string>>();
  // One EVM key signs on every EVM network, so an address registered for
  // any of them names its depositor on all of them.
  const key = (chain: string, address: string) =>
    chain === "solana" ? `solana\n${address}` : `evm\n${address.toLowerCase()}`;
  for (const wallet of JSON.parse(row?.wallets ?? "[]") as StoredWallet[]) {
    const names = logins.get(key(wallet.chain, wallet.address)) ?? new Set();
    names.add(wallet.login);
    logins.set(key(wallet.chain, wallet.address), names);
  }
  const deposits = stored.slice(0, VAULT_DEPOSIT_PAGE).map((deposit) => {
    if (
      !isEscrowChain(deposit.chain) ||
      !isBaseUnits(deposit.amount) ||
      !Number.isSafeInteger(deposit.assetDecimals) ||
      deposit.assetDecimals < 0 ||
      deposit.assetDecimals > 36 ||
      !transactionUrl(deposit.network, deposit.transactionId) ||
      Number.isNaN(Date.parse(deposit.blockTime))
    )
      throw new Error("Invalid stored vault deposit");
    const names = logins.get(key(deposit.chain, deposit.depositor));
    return {
      id: `${deposit.network}:${deposit.transactionId}:${deposit.eventIndex}`,
      projectId,
      network: deposit.network,
      chain: deposit.chain,
      vault: deposit.vault,
      depositor: deposit.depositor,
      githubLogin: names?.size === 1 ? ([...names][0] as string) : null,
      amountBase: deposit.amount,
      assetAddress: deposit.assetAddress,
      assetDecimals: deposit.assetDecimals,
      transactionId: deposit.transactionId,
      depositedAt: deposit.blockTime,
    } satisfies PublicVaultDeposit;
  });
  return { deposits, total: stored.length };
}
