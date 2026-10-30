import { REVIEWED_EVM_FACTORIES } from "../../contracts/evm/factories";
import { solanaRpc } from "../../contracts/solana/adapter";
import { REVIEWED_SOLANA_PROGRAMS } from "../../contracts/solana/programs";
import {
  ESCROW_NETWORKS,
  EVM_NATIVE_ASSET,
} from "../../src/lib/escrow-policy.mjs";
import {
  type SecurityBountyTerms,
  securityBountySplit,
} from "../../src/lib/security-bounty.mjs";
import { NETWORK_DEFINITIONS } from "../../workers/fee-converter/config";
import type {
  ExpiryCoverage,
  ExpiryCoverageStore,
} from "../../workers/fee-converter/solana-expiry";
import type { D1QueryStatement, D1TransactionalDatabase } from "../d1";
import { chunked, fail } from "../http";
import {
  type AwardAssetTerms,
  awardAsset,
  sameAssetAddress,
} from "./award-asset";
import {
  type DirectTransfer,
  evmDirectHead,
  evmDirectTransactions,
  evmFinalizedNonce,
  evmPayerCode,
  evmPendingNonce,
  verifyEvmDirect,
  verifyEvmDirectCancellation,
} from "./direct-evm";
import {
  assertNativeProofAvailable,
  assertTokenProofAvailable,
  PaymentProofUnavailable,
} from "./direct-evm-balances";
import { prepareSolanaDirect, verifySolanaDirect } from "./direct-solana";
import { retireSolanaPlans } from "./direct-solana-recovery";

type Database = D1TransactionalDatabase<D1QueryStatement>;
export interface DirectPaymentConfig {
  rpcUrl: string;
  recoveryRpcUrl?: string;
  feeRecipient: string;
  chainId?: string;
  genesisHash?: string;
}
export type DirectPaymentConfiguration = (
  network: string,
) => DirectPaymentConfig | null;
export interface DirectIntent {
  protocolVersion?: 2;
  preparedAt: string;
  afterBlock: string;
  afterBlocks?: string[];
  rail: "direct";
  network: string;
  chain: string;
  asset: { address: string; decimals: number; symbol: string };
  payer: { id: string; address: string; digest: string };
  recipient: { id: string; address: string; digest: string };
  grossBase: string;
  feeBase: string;
  netBase: string;
  transfers: DirectTransfer[];
  transactions?: ReturnType<typeof evmDirectTransactions>;
  solana?: Awaited<ReturnType<typeof prepareSolanaDirect>>;
}

/** Reuses reviewed public fee recipients; no project vault or signing key is needed. */
export function defaultDirectPaymentConfiguration(
  rpcOverrides: Partial<Record<string, string>> = {},
  recoveryOverrides: Partial<Record<string, string>> = {},
): DirectPaymentConfiguration {
  return (network) => {
    const definition = ESCROW_NETWORKS[network as keyof typeof ESCROW_NETWORKS];
    if (!definition || definition.testnet) return null;
    const reviewed =
      definition.family === "solana"
        ? REVIEWED_SOLANA_PROGRAMS.filter((p) => p.network === network)
        : REVIEWED_EVM_FACTORIES.filter((p) => p.network === network);
    const recipients = [...new Set(reviewed.map((p) => p.feeRecipient))];
    if (recipients.length !== 1) return null;
    return {
      rpcUrl:
        rpcOverrides[network] ??
        NETWORK_DEFINITIONS[definition.chain].defaultRpcUrl,
      feeRecipient: recipients[0],
      ...(recoveryOverrides[network]
        ? { recoveryRpcUrl: recoveryOverrides[network] }
        : {}),
      ...(definition.chainId ? { chainId: definition.chainId } : {}),
      ...(definition.genesisHash
        ? { genesisHash: definition.genesisHash }
        : {}),
    };
  };
}
export function directPaymentNetworks(
  terms: AwardAssetTerms,
  config: DirectPaymentConfiguration,
) {
  return Object.keys(ESCROW_NETWORKS).filter(
    (network) =>
      awardAsset(terms, network) !== null && config(network) !== null,
  );
}
async function wallet(db: Database, actor: string, chain: string) {
  const found = await db
    .prepare(
      "SELECT w.id,w.wallet_address address,w.record_sha256 digest FROM effective_payment_wallet_claims w JOIN payment_wallet_authorizations a ON a.claim_id=w.id AND a.github_user_id=w.github_user_id WHERE w.github_user_id=? AND w.chain=? AND w.source='d1_registry'",
    )
    .bind(actor, chain)
    .all<{ id: string; address: string; digest: string }>();
  if (found.results?.length !== 1)
    fail(
      409,
      "payment_wallet_required",
      "Confirm a payout wallet for this network in Settings first",
    );
  return found.results[0];
}
export async function directConsent(
  db: Database,
  terms: AwardAssetTerms,
  network: string,
  reporter: string,
  config: DirectPaymentConfiguration,
) {
  const asset = awardAsset(terms, network),
    definition = ESCROW_NETWORKS[network as keyof typeof ESCROW_NETWORKS];
  if (!asset || !definition || !config(network))
    fail(
      409,
      "rail_unavailable",
      "No reviewed direct payment route exists for this asset and network",
    );
  return {
    rail: "direct" as const,
    network,
    asset,
    recipient: await wallet(db, reporter, definition.chain),
  };
}
async function reserveNextNonces(
  db: Database,
  network: string,
  payer: string,
  count: number,
  settings: DirectPaymentConfig,
  chainId: string,
) {
  let nonce = BigInt(await evmPendingNonce({ ...settings, chainId, payer }));
  const prior = await db
    .prepare(
      "SELECT nonce FROM security_direct_nonce_reservations WHERE network=? AND payer=? ORDER BY length(nonce) DESC,nonce DESC LIMIT 1",
    )
    .bind(network, payer.toLowerCase())
    .first<{ nonce: string }>();
  if (prior && BigInt(prior.nonce) >= nonce) nonce = BigInt(prior.nonce) + 1n;
  if (nonce + BigInt(count) > BigInt(Number.MAX_SAFE_INTEGER))
    fail(
      409,
      "payment_nonce_unavailable",
      "The payer nonce is outside the supported range",
    );
  return Array.from({ length: count }, (_, index) =>
    (nonce + BigInt(index)).toString(),
  );
}
export async function prepareDirectIntent(
  db: Database,
  input: {
    caseId: string;
    projectId: string;
    reporterId: string;
    payerId: string;
    terms: AwardAssetTerms;
    grossBase: string;
    split: SecurityBountyTerms["split"];
    network: string;
    at: string;
  },
  config: DirectPaymentConfiguration,
): Promise<DirectIntent> {
  const consent = await directConsent(
    db,
    input.terms,
    input.network,
    input.reporterId,
    config,
  );
  if (
    !(await db
      .prepare(
        "SELECT 1 ok FROM security_payment_consents WHERE case_id=? AND reporter_github_id=? AND deployment=?",
      )
      .bind(input.caseId, input.reporterId, JSON.stringify(consent))
      .first())
  )
    fail(
      409,
      "payment_consent_required",
      "The reporter must accept this exact wallet and public chain visibility",
    );
  const network =
      ESCROW_NETWORKS[input.network as keyof typeof ESCROW_NETWORKS],
    settings = config(input.network);
  if (!settings) fail(409, "rail_unavailable", "Direct payment is unavailable");
  const payer = await wallet(db, input.payerId, network.chain);
  const amounts = securityBountySplit(input.grossBase, input.split);
  if (
    sameAssetAddress(input.network, payer.address, consent.recipient.address) ||
    (amounts.slopMinor !== "0" &&
      (sameAssetAddress(input.network, payer.address, settings.feeRecipient) ||
        sameAssetAddress(
          input.network,
          consent.recipient.address,
          settings.feeRecipient,
        )))
  )
    fail(
      409,
      "payment_wallet_conflict",
      "Payer, reporter and platform fee wallets must be distinct",
    );
  const transfers = [
    {
      recipient: consent.recipient.address,
      amountBase: amounts.researcherMinor,
    },
    ...(amounts.slopMinor === "0"
      ? []
      : [{ recipient: settings.feeRecipient, amountBase: amounts.slopMinor }]),
  ];
  const intent: DirectIntent = {
    protocolVersion: 2,
    preparedAt: input.at,
    afterBlock: "0",
    rail: "direct",
    network: input.network,
    chain: network.chain,
    asset: consent.asset,
    payer,
    recipient: consent.recipient,
    grossBase: amounts.grossMinor,
    feeBase: amounts.slopMinor,
    netBase: amounts.researcherMinor,
    transfers,
  };
  if (network.family === "evm") {
    try {
      if (intent.asset.address.toLowerCase() === EVM_NATIVE_ASSET)
        await assertNativeProofAvailable(settings.rpcUrl, payer.address);
      else
        await assertTokenProofAvailable(
          settings.rpcUrl,
          intent.asset.address,
          payer.address,
        );
    } catch {
      fail(
        409,
        "payment_proof_unavailable",
        "Payment verification is unavailable. Retry after the RPC is configured.",
      );
    }
    intent.afterBlock = await evmDirectHead({
      ...settings,
      chainId: network.chainId as string,
    });
    const nonces = await reserveNextNonces(
      db,
      input.network,
      payer.address,
      transfers.length,
      settings,
      network.chainId as string,
    );
    intent.afterBlocks = transfers.map(() => intent.afterBlock);
    intent.transactions = evmDirectTransactions({
      ...settings,
      chainId: network.chainId as string,
      payer: payer.address,
      asset: intent.asset,
      transfers,
      nonces: nonces.length === 2 ? [nonces[1], nonces[0]] : nonces,
    });
  } else {
    intent.solana = await prepareSolanaDirect({
      rpcUrl: settings.rpcUrl,
      genesisHash: settings.genesisHash ?? (network.genesisHash as string),
      payer: payer.address,
      asset: intent.asset,
      transfers,
    });
    intent.afterBlock = intent.solana.afterSlot;
  }
  return intent;
}
export function insertDirectIntent(
  db: Database,
  caseId: string,
  revision: number,
  key: string,
  intent: DirectIntent,
  at: string,
) {
  return db
    .prepare(
      "INSERT INTO security_direct_payments(case_id,network,intent,prepared_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM security_case_events WHERE case_id=? AND case_revision=? AND idempotency_key=? AND kind='prepare-payment')",
    )
    .bind(
      caseId,
      intent.network,
      JSON.stringify(intent),
      at,
      caseId,
      revision,
      key,
    );
}
export async function issuedSolanaPlans(
  db: Database,
  caseId: string,
  generation: number,
  intent: DirectIntent,
) {
  const rows = await db
    .prepare(
      "SELECT plan FROM security_direct_payment_plans WHERE case_id=? AND generation=? ORDER BY case_revision",
    )
    .bind(caseId, generation)
    .all<{ plan: string }>();
  const plans = [
    ...(intent.solana ? [intent.solana] : []),
    ...rows.results.map(
      (row) => JSON.parse(row.plan) as NonNullable<DirectIntent["solana"]>,
    ),
  ];
  return [
    ...new Map(
      plans.map((plan) => [plan.messageId ?? plan.transaction, plan]),
    ).values(),
  ];
}
/** An append-only compare-and-swap journal lets bounded history scans resume safely. */
export function directRecoveryStore(
  db: Database,
  caseId: string,
  generation: number,
  at: string,
): ExpiryCoverageStore {
  return {
    async read(txId, operator) {
      const row = await db
        .prepare(
          "SELECT scan_json FROM security_direct_recovery_scans WHERE case_id=? AND generation=? AND transaction_id=? AND operator=? ORDER BY revision DESC LIMIT 1",
        )
        .bind(caseId, generation, txId, operator)
        .first<{ scan_json: string }>();
      return row ? (JSON.parse(row.scan_json) as ExpiryCoverage) : null;
    },
    async save(previous, next, page) {
      if (next.revision !== (previous?.revision ?? 0) + 1)
        throw new Error("Recovery history revision must advance exactly once");
      const result = await db
        .prepare(
          "INSERT INTO security_direct_recovery_scans(case_id,generation,transaction_id,operator,revision,scan_json,page_json,created_at) SELECT ?,?,?,?,?,?,?,? WHERE COALESCE((SELECT MAX(revision) FROM security_direct_recovery_scans WHERE case_id=? AND generation=? AND transaction_id=? AND operator=?),0)=?",
        )
        .bind(
          caseId,
          generation,
          next.txId,
          next.operator,
          next.revision,
          JSON.stringify(next),
          JSON.stringify(page),
          at,
          caseId,
          generation,
          next.txId,
          next.operator,
          previous?.revision ?? 0,
        )
        .run();
      if (result.meta?.changes !== 1)
        fail(
          409,
          "recovery_progress_changed",
          "Recovery history advanced in another request; check again",
        );
    },
  };
}
/** Refresh an expired unsigned message without changing the single payment obligation. */
export async function refreshDirectIntent(
  db: Database,
  input: {
    caseId: string;
    revision: number;
    key: string;
    network: string;
    at: string;
  },
  config: DirectPaymentConfiguration,
) {
  const stored = await db
    .prepare(
      "SELECT p.intent,p.generation FROM security_direct_current_payments p LEFT JOIN security_direct_payment_receipts r ON r.case_id=p.case_id WHERE p.case_id=? AND r.case_id IS NULL",
    )
    .bind(input.caseId)
    .first<{ intent: string; generation: number }>();
  if (!stored)
    fail(
      409,
      "payment_not_pending",
      "There is no pending direct payment to refresh",
    );
  const intent = JSON.parse(stored.intent) as DirectIntent;
  const researcherPaid = await db
    .prepare(
      "SELECT 1 ok FROM security_direct_transfer_receipts WHERE case_id=? AND leg_index=0",
    )
    .bind(input.caseId)
    .first();
  if (
    !researcherPaid &&
    !(await db
      .prepare(
        "SELECT 1 ok FROM effective_payment_wallet_claims WHERE id=? AND record_sha256=?",
      )
      .bind(intent.recipient.id, intent.recipient.digest)
      .first())
  )
    fail(
      409,
      "payment_wallet_changed",
      "The reporter changed wallets. Ask a maintainer to review the frozen payment before sending.",
    );
  if (intent.network !== input.network)
    fail(
      409,
      "payment_network_changed",
      "Refresh the approved payment on its original network",
    );
  const settings = config(intent.network);
  if (!settings) fail(409, "rail_unavailable", "Direct payment is unavailable");
  const network =
    ESCROW_NETWORKS[intent.network as keyof typeof ESCROW_NETWORKS];
  // EVM transfer requests have no expiring blockhash. Their original bounds remain valid.
  if (network.family === "evm") return null;
  const plans = await issuedSolanaPlans(
    db,
    input.caseId,
    stored.generation,
    intent,
  );
  const plan = plans.at(-1);
  if (!plan)
    fail(
      409,
      "payment_recovery_required",
      "The original Solana request is unavailable for safe refresh",
    );
  const state = (await solanaRpc(
    { rpcUrl: settings.rpcUrl },
    "isBlockhashValid",
    [plan.blockhash, { commitment: "finalized" }],
  )) as { value: boolean };
  if (state.value === true) return null;
  fail(
    409,
    "payment_recovery_required",
    "Prove the expired request was not paid before preparing another transaction",
  );
}
const TRANSFER_RECEIPTS =
  "(SELECT json_group_array(json_object('legIndex',leg_index,'evidence',json(evidence))) FROM (SELECT leg_index,evidence FROM security_direct_transfer_receipts WHERE case_id=p.case_id ORDER BY leg_index))";
const CURRENT_RECIPIENT =
  "EXISTS(SELECT 1 FROM effective_payment_wallet_claims w JOIN payment_wallet_authorizations a ON a.claim_id=w.id AND a.github_user_id=w.github_user_id WHERE w.id=json_extract(p.intent,'$.recipient.id') AND w.record_sha256=json_extract(p.intent,'$.recipient.digest'))";
export async function directSettlementView(db: Database, caseId: string) {
  const row = await db
    .prepare(
      `SELECT p.intent,p.generation,r.evidence,${CURRENT_RECIPIENT} recipient_current,${TRANSFER_RECEIPTS} transfer_receipts,(SELECT plan FROM security_direct_payment_plans WHERE case_id=p.case_id AND generation=p.generation ORDER BY case_revision DESC LIMIT 1) plan FROM security_direct_current_payments p LEFT JOIN security_direct_payment_receipts r ON r.case_id=p.case_id WHERE p.case_id=?`,
    )
    .bind(caseId)
    .first<{
      intent: string;
      generation: number;
      evidence: string | null;
      recipient_current: number;
      transfer_receipts: string;
      plan: string | null;
    }>();
  return row ? directView(row) : null;
}
export async function directSettlementViews(
  db: Database,
  caseIds: readonly string[],
) {
  const result = new Map<string, ReturnType<typeof directView>>();
  for (const part of chunked(caseIds)) {
    const rows = await db
      .prepare(
        `SELECT p.case_id,p.intent,p.generation,r.evidence,${CURRENT_RECIPIENT} recipient_current,${TRANSFER_RECEIPTS} transfer_receipts,(SELECT plan FROM security_direct_payment_plans WHERE case_id=p.case_id AND generation=p.generation ORDER BY case_revision DESC LIMIT 1) plan FROM security_direct_current_payments p LEFT JOIN security_direct_payment_receipts r ON r.case_id=p.case_id WHERE p.case_id IN (${part.map(() => "?").join(",")})`,
      )
      .bind(...part)
      .all<{
        case_id: string;
        intent: string;
        generation: number;
        evidence: string | null;
        recipient_current: number;
        transfer_receipts: string;
        plan: string | null;
      }>();
    for (const row of rows.results ?? [])
      result.set(row.case_id, directView(row));
  }
  return result;
}
function directView(row: {
  intent: string;
  generation: number;
  evidence: string | null;
  recipient_current: number;
  transfer_receipts: string;
  plan: string | null;
}) {
  const intent = JSON.parse(row.intent) as DirectIntent;
  const evidence = row.evidence
    ? (JSON.parse(row.evidence) as { transactionId: string }[])
    : null;
  const confirmed = JSON.parse(row.transfer_receipts) as {
    legIndex: number;
    evidence: { transactionId: string };
  }[];
  const indexes = new Set(confirmed.map((entry) => entry.legIndex));
  const remainingTransfers = intent.transfers.flatMap((transfer, index) =>
    indexes.has(intent.chain === "solana" ? 0 : index)
      ? []
      : [
          {
            ...transfer,
            role: index === 0 ? ("researcher" as const) : ("fee" as const),
          },
        ],
  );
  const walletReviewRequired =
    !evidence && !indexes.has(0) && row.recipient_current !== 1;
  const orderedRemaining = intent.transactions
    ?.map((transaction, index) => ({
      transaction,
      transfer: {
        ...intent.transfers[index],
        role: index === 0 ? ("researcher" as const) : ("fee" as const),
      },
      index,
    }))
    .filter(
      (item) =>
        !indexes.has(item.index) &&
        (!walletReviewRequired ||
          (intent.protocolVersion === 2 && item.index !== 0)),
    )
    .sort((a, b) =>
      a.transaction.nonce && b.transaction.nonce
        ? BigInt(a.transaction.nonce) < BigInt(b.transaction.nonce)
          ? -1
          : 1
        : 0,
    );
  const confirmedTransactionIds = confirmed.map(
    (entry) => entry.evidence.transactionId,
  );
  return {
    rail: "direct" as const,
    state: evidence ? "paid" : "awaiting-external-payment",
    network: intent.network,
    generation: row.generation,
    asset: intent.asset.address,
    grossBase: intent.grossBase,
    feeBase: intent.feeBase,
    netBase: intent.netBase,
    transactionIds: confirmedTransactionIds,
    confirmedTransactionIds,
    remainingTransfers,
    transactionId: confirmedTransactionIds.join(", ") || null,
    submittedTransactionId: null,
    walletReviewRequired,
    privacyNotice: walletReviewRequired
      ? "The reporter's wallet changed. Payment is held. Existing exact transfers can still be verified."
      : "The external wallet signs and sends these transfers. Chain records reveal the payer, recipients, asset and amounts. Slop verifies final receipts and never signs or broadcasts.",
    ownerRequest:
      evidence || (walletReviewRequired && !orderedRemaining?.length)
        ? null
        : {
            ...intent,
            transfers: orderedRemaining
              ? orderedRemaining.map((item) => item.transfer)
              : remainingTransfers,
            ...(orderedRemaining
              ? {
                  transactions: orderedRemaining.map(
                    (item) => item.transaction,
                  ),
                }
              : {}),
            ...(row.plan
              ? {
                  solana: JSON.parse(row.plan) as NonNullable<
                    DirectIntent["solana"]
                  >,
                }
              : {}),
          },
  };
}
export async function verifyDirectPayment(
  db: Database,
  input: {
    caseId: string;
    revision: number;
    key: string;
    transactionIds: string[];
    at: string;
  },
  config: DirectPaymentConfiguration,
) {
  const stored = await db
    .prepare(
      "SELECT intent,generation FROM security_direct_current_payments WHERE case_id=?",
    )
    .bind(input.caseId)
    .first<{ intent: string; generation: number }>();
  if (!stored)
    fail(409, "payment_not_prepared", "Prepare the exact payment first");
  if (
    await db
      .prepare(
        "SELECT 1 ok FROM security_direct_payment_receipts WHERE case_id=?",
      )
      .bind(input.caseId)
      .first()
  )
    fail(409, "payment_already_verified", "This payment is already verified");
  const intent = JSON.parse(stored.intent) as DirectIntent,
    settings = config(intent.network),
    network = ESCROW_NETWORKS[intent.network as keyof typeof ESCROW_NETWORKS];
  if (!settings)
    fail(409, "rail_unavailable", "Receipt verification is unavailable");
  let proofs: {
    legIndex: number;
    transactionId: string;
    blockHash: string;
    blockNumber: string;
  }[];
  try {
    if (
      network.family === "evm" &&
      intent.protocolVersion === 2 &&
      (intent.transactions?.length !== intent.transfers.length ||
        intent.transactions.some((transaction) => !transaction.nonce))
    )
      throw new Error("The reserved transfer nonces are unavailable");
    if (network.family === "evm")
      proofs = await verifyEvmDirect({
        ...settings,
        chainId: network.chainId as string,
        payer: intent.payer.address,
        asset: intent.asset,
        transfers: intent.transfers,
        ...(intent.protocolVersion === 2
          ? { nonces: intent.transactions?.map((tx) => tx.nonce as string) }
          : {}),
        transactionIds: input.transactionIds,
        afterBlock: intent.afterBlock,
        afterBlocks: intent.afterBlocks,
      });
    else {
      if (input.transactionIds.length !== 1)
        throw new Error("Provide the single Solana transaction signature");
      proofs = [
        {
          ...(await verifySolanaDirect({
            ...settings,
            ...(intent.protocolVersion === 2
              ? {
                  allowedMessages: (
                    await issuedSolanaPlans(
                      db,
                      input.caseId,
                      stored.generation,
                      intent,
                    )
                  ).map((plan) => plan.transaction),
                }
              : {}),
            genesisHash:
              settings.genesisHash ?? (network.genesisHash as string),
            payer: intent.payer.address,
            asset: intent.asset,
            transfers: intent.transfers,
            transactionId: input.transactionIds[0],
            notBefore: intent.preparedAt,
            afterSlot: intent.afterBlock,
          })),
          legIndex: 0,
        },
      ];
    }
  } catch (error) {
    if (error instanceof PaymentProofUnavailable)
      fail(
        409,
        "payment_proof_unavailable",
        "Payment verification is unavailable. Retry after the RPC is configured.",
      );
    fail(
      409,
      "payment_unverified",
      "Finalized transfers are unavailable or do not match the approved payment",
    );
  }
  for (const proof of proofs) {
    const used = await db
      .prepare(
        "SELECT case_id,leg_index FROM security_direct_transfer_receipts WHERE network=? AND transaction_id=?",
      )
      .bind(intent.network, proof.transactionId)
      .first<{ case_id: string; leg_index: number }>();
    const ordinary = await db
      .prepare(
        "SELECT 1 ok FROM payment_direct_transfers WHERE network=? AND CASE WHEN network LIKE 'solana%' THEN transaction_id=? ELSE lower(transaction_id)=lower(?) END",
      )
      .bind(intent.network, proof.transactionId, proof.transactionId)
      .first();
    if (ordinary)
      fail(
        409,
        "payment_replay",
        "This transfer is already credited to another payment",
      );
    if (used)
      fail(
        409,
        "payment_replay",
        "This transfer is already recorded; send only the remaining payment legs",
      );
    if (
      await db
        .prepare(
          "SELECT 1 ok FROM security_direct_transfer_receipts WHERE case_id=? AND leg_index=?",
        )
        .bind(input.caseId, proof.legIndex)
        .first()
    )
      fail(
        409,
        "payment_leg_already_verified",
        "This award leg is already paid; send only the remaining transfer",
      );
  }
  const guard =
    "EXISTS(SELECT 1 FROM security_case_events WHERE case_id=? AND case_revision=? AND idempotency_key=? AND kind='verify-payment')";
  const expected = intent.chain === "solana" ? 1 : intent.transfers.length;
  return [
    ...proofs.map((proof) =>
      db
        .prepare(
          `INSERT INTO security_direct_transfer_receipts(case_id,leg_index,network,transaction_id,evidence,verified_at) SELECT ?,?,?,?,?,? WHERE ${guard}`,
        )
        .bind(
          input.caseId,
          proof.legIndex,
          intent.network,
          proof.transactionId,
          JSON.stringify(proof),
          input.at,
          input.caseId,
          input.revision,
          input.key,
        ),
    ),
    db
      .prepare(`INSERT INTO security_direct_payment_receipts(case_id,evidence,verified_at)
      SELECT ?, (SELECT json_group_array(json(evidence)) FROM (SELECT evidence FROM security_direct_transfer_receipts WHERE case_id=? ORDER BY leg_index)), ?
      WHERE ${guard} AND (SELECT COUNT(*) FROM security_direct_transfer_receipts WHERE case_id=?)=?`)
      .bind(
        input.caseId,
        input.caseId,
        input.at,
        input.caseId,
        input.revision,
        input.key,
        input.caseId,
        expected,
      ),
    db
      .prepare(`INSERT INTO security_direct_transaction_uses(network,transaction_id,case_id)
      SELECT network,transaction_id,case_id FROM security_direct_transfer_receipts WHERE case_id=?
      AND EXISTS(SELECT 1 FROM security_direct_payment_receipts WHERE case_id=?) AND ${guard}`)
      .bind(
        input.caseId,
        input.caseId,
        input.caseId,
        input.revision,
        input.key,
      ),
  ];
}

async function recoveryContext(db: Database, caseId: string) {
  const stored = await db
    .prepare(
      "SELECT intent,generation FROM security_direct_current_payments WHERE case_id=?",
    )
    .bind(caseId)
    .first<{ intent: string; generation: number }>();
  if (!stored) fail(409, "payment_not_prepared", "Prepare the payment first");
  const intent = JSON.parse(stored.intent) as DirectIntent;
  const owner = await db
    .prepare("SELECT github_user_id FROM wallet_claims WHERE id=?")
    .bind(intent.recipient.id)
    .first<{ github_user_id: string }>();
  if (!owner)
    fail(
      409,
      "payment_wallet_required",
      "The original reporter wallet record is unavailable",
    );
  const paid = await db
    .prepare(
      "SELECT leg_index FROM security_direct_transfer_receipts WHERE case_id=?",
    )
    .bind(caseId)
    .all<{ leg_index: number }>();
  const paidIndexes = new Set(paid.results.map((row) => row.leg_index));
  const researcherPaid = paidIndexes.has(0);
  const target = researcherPaid
    ? intent.recipient
    : await wallet(db, owner.github_user_id, intent.chain);
  const feePending = intent.transfers.length > 1 && !paidIndexes.has(1);
  const marker = {
    rail: "direct-recovery",
    network: intent.network,
    asset: intent.asset,
    recipient: target,
    generation: stored.generation,
  };
  const consented = !!(await db
    .prepare(
      "SELECT 1 ok FROM security_payment_consents WHERE case_id=? AND reporter_github_id=? AND deployment=?",
    )
    .bind(caseId, owner.github_user_id, JSON.stringify(marker))
    .first());
  return {
    intent,
    generation: stored.generation,
    target,
    reporterId: owner.github_user_id,
    researcherPaid,
    paidIndexes,
    feePending,
    marker,
    consented,
  };
}

/** Fresh consent is bound to the exact successor wallet and prior generation. */
export async function directRecoveryConsent(
  db: Database,
  caseId: string,
  reporterId: string,
  _config: DirectPaymentConfiguration,
) {
  const context = await recoveryContext(db, caseId);
  if (context.reporterId !== reporterId)
    fail(403, "forbidden", "Only the reporter may consent to this destination");
  if (context.researcherPaid)
    fail(
      409,
      "payment_already_verified",
      "The researcher payment is already verified",
    );
  if (
    sameAssetAddress(
      context.intent.network,
      context.target.address,
      context.intent.payer.address,
    ) ||
    context.intent.transfers
      .slice(1)
      .some((t) =>
        sameAssetAddress(
          context.intent.network,
          t.recipient,
          context.target.address,
        ),
      )
  )
    fail(
      409,
      "payment_wallet_conflict",
      "Reporter, payer and fee wallets must remain distinct",
    );
  return context.marker;
}

async function evmRecoveryState(
  c: Awaited<ReturnType<typeof recoveryContext>>,
  config?: DirectPaymentConfiguration,
) {
  const transactions = c.intent.transactions;
  const unpaid =
    transactions
      ?.map((tx, index) => ({ tx, index }))
      .filter(({ index }) => !c.paidIndexes.has(index)) ?? [];
  let finalized: bigint | undefined;
  let payerReview = true;
  const settings = config?.(c.intent.network);
  if (settings)
    try {
      const input = {
        ...settings,
        chainId: ESCROW_NETWORKS[
          c.intent.network as keyof typeof ESCROW_NETWORKS
        ].chainId as string,
        payer: c.intent.payer.address,
      };
      const [nonce, code] = await Promise.all([
        evmFinalizedNonce(input),
        evmPayerCode(input),
      ]);
      finalized = BigInt(nonce);
      payerReview = !!code && code !== "0x";
    } catch {
      /* A read failure must not invite a self-call through unknown code. */
    }
  const finalNonce = finalized;
  const spent =
    finalNonce === undefined
      ? []
      : unpaid.filter(({ tx }) => tx.nonce && BigInt(tx.nonce) < finalNonce);
  spent.sort((a, b) =>
    BigInt(a.tx.nonce as string) < BigInt(b.tx.nonce as string) ? -1 : 1,
  );
  const legIndex =
    spent[0]?.index ??
    (!c.researcherPaid && c.target.id !== c.intent.recipient.id ? 0 : null);
  const nonce = legIndex === null ? undefined : transactions?.[legIndex]?.nonce;
  const blockedByLower =
    nonce !== undefined &&
    unpaid.some(
      ({ tx, index }) =>
        index !== legIndex &&
        tx.nonce &&
        BigInt(tx.nonce) < BigInt(nonce) &&
        (finalized === undefined || BigInt(tx.nonce) >= finalized),
    );
  return {
    legIndex,
    nonce,
    consumed: spent.some(({ index }) => index === legIndex),
    payerReview,
    blockedByLower,
  };
}

/** Read-only recovery controls. No absent transaction is treated as a cancellation. */
export async function directRecoveryView(
  db: Database,
  caseId: string,
  config?: DirectPaymentConfiguration,
) {
  let c: Awaited<ReturnType<typeof recoveryContext>>;
  try {
    c = await recoveryContext(db, caseId);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "payment_wallet_required"
    ) {
      const current = await db
        .prepare(
          "SELECT generation FROM security_direct_current_payments WHERE case_id=?",
        )
        .bind(caseId)
        .first<{ generation: number }>();
      return {
        generation: current?.generation ?? 0,
        mode: "wallet-required",
        target: null,
        consented: false,
      };
    }
    throw error;
  }
  const evm = c.intent.chain !== "solana";
  if (c.researcherPaid && (!evm || !c.feePending)) return null;
  const legacy =
    c.intent.protocolVersion !== 2 ||
    (evm && !c.intent.transactions?.every((tx) => tx.nonce));
  const state = evm && !legacy ? await evmRecoveryState(c, config) : null;
  if (evm && !legacy && state?.legIndex === null) return null;
  if (
    evm &&
    legacy &&
    (c.researcherPaid || c.target.id === c.intent.recipient.id)
  )
    return null;
  const legIndex = state?.legIndex ?? 0;
  const original = sameAssetAddress(
    c.intent.network,
    c.target.address,
    c.intent.recipient.address,
  );
  const consented =
    legIndex === 1 || c.consented || c.target.id === c.intent.recipient.id;
  const event = !evm
    ? await db
        .prepare(
          "SELECT detail FROM security_case_events WHERE case_id=? AND kind='recover-payment' ORDER BY case_revision DESC LIMIT 1",
        )
        .bind(caseId)
        .first<{ detail: string }>()
    : null;
  const progress = event
    ? (JSON.parse(event.detail) as {
        generation: number;
        targetId: string;
        state?: string;
        messages?: { messageId: string; message: string }[];
        transactionIds?: string[];
      })
    : null;
  const currentProgress =
    progress?.generation === c.generation && progress.targetId === c.target.id
      ? progress
      : null;
  const mode =
    !evm && !legacy && consented
      ? (currentProgress?.state ?? "expiry-required")
      : legacy
        ? original
          ? "resume-original"
          : "legacy-manual"
        : !consented
          ? "consent-required"
          : state?.blockedByLower
            ? "fee-pending"
            : state?.consumed
              ? "retirement-required"
              : original
                ? "resume-original"
                : state?.payerReview
                  ? "payer-review"
                  : "cancellation-required";
  return {
    generation: c.generation,
    target:
      legIndex === 1 ? { address: c.intent.transfers[1].recipient } : c.target,
    payer: c.intent.payer.address,
    legIndex,
    role: legIndex === 0 ? "researcher" : "fee",
    consented,
    mode,
    ...(state?.consumed ? { retirementNonce: state.nonce } : {}),
    ...(!evm && currentProgress
      ? {
          ...(currentProgress.messages
            ? { messages: currentProgress.messages }
            : {}),
          ...(currentProgress.transactionIds
            ? { transactionIds: currentProgress.transactionIds }
            : {}),
        }
      : {}),
    ...(mode === "cancellation-required"
      ? {
          cancellationRequest: {
            chainId: c.intent.transactions?.[legIndex]?.chainId,
            from: c.intent.payer.address,
            to: c.intent.payer.address,
            nonce: state?.nonce,
            value: "0x0",
            data: "0x",
          },
        }
      : {}),
  };
}

/** Append a successor only after the old request is proven unable to pay. */
export async function recoverDirectIntent(
  db: Database,
  input: {
    caseId: string;
    payerId: string;
    revision: number;
    key: string;
    at: string;
    cancellationTransactionId?: string;
    signatures?: { messageId: string; signature: string }[];
  },
  config: DirectPaymentConfiguration,
) {
  const c = await recoveryContext(db, input.caseId);
  if (c.researcherPaid && (c.intent.chain === "solana" || !c.feePending))
    fail(409, "payment_already_verified", "This payment is already verified");
  const originalPayer = await db
    .prepare("SELECT github_user_id FROM wallet_claims WHERE id=?")
    .bind(c.intent.payer.id)
    .first<{ github_user_id: string }>();
  const payer = await wallet(db, input.payerId, c.intent.chain);
  if (
    originalPayer?.github_user_id !== input.payerId ||
    !sameAssetAddress(c.intent.network, payer.address, c.intent.payer.address)
  )
    fail(
      409,
      "original_payer_required",
      "The original verified payer must confirm recovery",
    );
  const settings = config(c.intent.network);
  if (!settings)
    fail(409, "rail_unavailable", "Payment recovery is unavailable");
  const state =
    c.intent.chain !== "solana" && c.intent.protocolVersion === 2
      ? await evmRecoveryState(c, config)
      : null;
  const legIndex = state?.legIndex ?? (c.researcherPaid ? 1 : 0);
  if (c.paidIndexes.has(legIndex))
    fail(409, "payment_already_verified", "This transfer is already verified");
  if (legIndex === 0) {
    if (!c.consented && c.target.id !== c.intent.recipient.id)
      fail(
        409,
        "payment_consent_required",
        "The reporter must consent to the successor wallet first",
      );
    await directRecoveryConsent(db, input.caseId, c.reporterId, config);
  }
  const original =
    legIndex === 1 ||
    sameAssetAddress(
      c.intent.network,
      c.target.address,
      c.intent.recipient.address,
    );
  const next: DirectIntent = {
    ...c.intent,
    recipient: legIndex === 0 ? c.target : c.intent.recipient,
    transfers: c.intent.transfers.map((t, index) =>
      legIndex === 0 && index === 0 ? { ...t, recipient: c.target.address } : t,
    ),
  };
  const retireEvm =
    c.intent.protocolVersion === 2 &&
    c.intent.chain !== "solana" &&
    (!original ||
      !!input.cancellationTransactionId ||
      state?.consumed ||
      c.target.id === c.intent.recipient.id);
  let retirement: unknown = { kind: "consent-renewal" };
  if (c.intent.chain === "solana" && c.intent.protocolVersion === 2) {
    const plans = await issuedSolanaPlans(
      db,
      input.caseId,
      c.generation,
      c.intent,
    );
    if (
      plans.some(
        (plan) => !plan.messageId || !Number.isSafeInteger(plan.blockhashSlot),
      )
    )
      fail(
        409,
        "legacy_payment_review_required",
        "An issued Solana request lacks its retained block anchor; manual review is required",
      );
    const previous = await db
      .prepare(
        "SELECT detail FROM security_case_events WHERE case_id=? AND kind='recover-payment' ORDER BY case_revision DESC LIMIT 1",
      )
      .bind(input.caseId)
      .first<{ detail: string }>();
    const old = previous
      ? (JSON.parse(previous.detail) as {
          generation: number;
          targetId: string;
          signatures?: { messageId: string; signature: string }[];
          messages?: { messageId: string; message: string }[];
        })
      : null;
    const prior =
      old?.generation === c.generation && old.targetId === c.target.id
        ? old
        : null;
    if (
      input.signatures &&
      (new Set(input.signatures.map((entry) => entry.messageId)).size !==
        input.signatures.length ||
        input.signatures.some(
          (entry) => !/^[1-9A-HJ-NP-Za-km-z]{1,88}$/u.test(entry.signature),
        ))
    )
      fail(400, "invalid_request", "Each expired request needs one signature");
    const signatures = [
      ...new Map(
        [...(prior?.signatures ?? []), ...(input.signatures ?? [])].map(
          (entry) => [entry.messageId, entry],
        ),
      ).values(),
    ];
    let result: Awaited<ReturnType<typeof retireSolanaPlans>>;
    try {
      result = await retireSolanaPlans({
        ...settings,
        genesisHash:
          settings.genesisHash ??
          (ESCROW_NETWORKS["solana-mainnet"].genesisHash as string),
        payer: c.intent.payer.address,
        plans,
        signatures,
        store: directRecoveryStore(db, input.caseId, c.generation, input.at),
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "Invalid Solana recovery signature"
      )
        fail(
          400,
          "invalid_request",
          "Sign the exact expired requests with the original payer wallet",
        );
      throw error;
    }
    if (result.state !== "retired")
      return {
        after: [] as D1QueryStatement[],
        detail: {
          generation: c.generation,
          targetId: c.target.id,
          state: result.state,
          ...(result.state === "signature-required"
            ? { messages: result.challenges }
            : prior?.messages
              ? { messages: prior.messages }
              : {}),
          ...(signatures.length ? { signatures } : {}),
          ...(result.state === "payment-found"
            ? { transactionIds: result.transactionIds }
            : {}),
        },
      };
    next.solana = await prepareSolanaDirect({
      ...settings,
      genesisHash:
        settings.genesisHash ??
        (ESCROW_NETWORKS["solana-mainnet"].genesisHash as string),
      payer: c.intent.payer.address,
      asset: c.intent.asset,
      transfers: next.transfers,
    });
    next.afterBlock = next.solana.afterSlot;
    retirement = { kind: "solana-expired", proof: result.proof };
  } else if (!original || retireEvm) {
    if (c.intent.protocolVersion !== 2)
      fail(
        409,
        "legacy_payment_review_required",
        "This legacy request has no retirement proof; only its original address can resume",
      );
    if (c.intent.chain === "solana")
      fail(
        409,
        "expiry_proof_required",
        "Every issued Solana request needs expiry and retained-history proof",
      );
    if (state?.blockedByLower)
      fail(
        409,
        "fee_payment_pending",
        "Finish the earlier wallet transfer before cancelling this nonce",
      );
    const nonce = c.intent.transactions?.[legIndex]?.nonce;
    if (!nonce || !input.cancellationTransactionId)
      fail(
        409,
        "cancellation_required",
        "Verify a finalized cancellation at the reserved researcher nonce",
      );
    try {
      retirement = await verifyEvmDirectCancellation({
        ...settings,
        chainId: ESCROW_NETWORKS[
          c.intent.network as keyof typeof ESCROW_NETWORKS
        ].chainId as string,
        payer: c.intent.payer.address,
        nonce,
        transactionId: input.cancellationTransactionId,
        afterBlock: c.intent.afterBlocks?.[legIndex] ?? c.intent.afterBlock,
      });
    } catch {
      fail(
        409,
        "cancellation_unverified",
        "The old request is not proven retired. Verify any approved payment that landed; another successful transfer needs manual review.",
      );
    }
    const chainId = ESCROW_NETWORKS[
      c.intent.network as keyof typeof ESCROW_NETWORKS
    ].chainId as string;
    const [replacementNonce] = await reserveNextNonces(
      db,
      c.intent.network,
      c.intent.payer.address,
      1,
      settings,
      chainId,
    );
    const head = await evmDirectHead({ ...settings, chainId });
    const transaction = evmDirectTransactions({
      ...settings,
      chainId,
      payer: c.intent.payer.address,
      asset: c.intent.asset,
      transfers: [next.transfers[legIndex]],
      nonces: [replacementNonce],
    })[0];
    next.transactions = c.intent.transactions?.map((tx, index) =>
      index === legIndex ? transaction : tx,
    );
    next.afterBlocks = c.intent.transfers.map((_, index) =>
      index === legIndex
        ? head
        : (c.intent.afterBlocks?.[index] ?? c.intent.afterBlock),
    );
    retirement = { ...(retirement as Record<string, unknown>), legIndex };
  }
  return {
    detail: {
      generation: c.generation + 1,
      legIndex,
      retirement:
        c.intent.chain === "solana" && c.intent.protocolVersion === 2
          ? "expired-and-unpaid"
          : (retirement as { kind: string }).kind === "consent-renewal"
            ? "consent-renewal"
            : "finalized-cancellation",
    },
    after: [
      db
        .prepare(
          "INSERT INTO security_direct_payment_revisions(case_id,generation,prior_generation,intent,retirement,actor_github_id,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM security_case_events WHERE case_id=? AND case_revision=? AND idempotency_key=? AND kind='recover-payment')",
        )
        .bind(
          input.caseId,
          c.generation + 1,
          c.generation,
          JSON.stringify(next),
          JSON.stringify(retirement),
          input.payerId,
          input.at,
          input.caseId,
          input.revision,
          input.key,
        ),
    ],
  };
}
