import type {
  D1QueryStatement,
  D1TransactionalDatabase,
  D1TransactionalDatabase as Database,
} from "../d1";
import type { PaymentLedgerPolicy } from "../payments/ledger";

/** Payment changes use the same restricted inbox and verified-recipient outbox.
 * The public payment templates must never receive a private obligation. */
export async function securityPaymentNotices(
  db: Database,
  obligationId: string,
  state: string,
  at: string,
) {
  return [
    db
      .prepare(`INSERT INTO notifications
    (event_key,recipient_github_id,kind,subject,detail,action_path,source_at,created_at)
    SELECT 'security-payment:' || s.obligation_id || ':' || ?, recipients.github_id,
      'security_case',s.case_id,NULL,'/security',?,?
    FROM security_settlements s JOIN (
      SELECT id case_id,reporter_github_id github_id FROM security_cases
      UNION
      SELECT c.id,json_extract(a.value,'$.githubId') FROM security_cases c
        JOIN projects p ON p.id=c.project_id,
        json_each(p.manifest,'$.securityBounty.approvers.financial') a
      UNION
      SELECT c.id,json_extract(a.value,'$.githubId') FROM security_cases c
        JOIN projects p ON p.id=c.project_id,
        json_each(p.manifest,'$.securityBounty.approvers.technical') a
    ) recipients ON recipients.case_id=s.case_id
    WHERE s.obligation_id=?
    ON CONFLICT(event_key,recipient_github_id) DO NOTHING`)
      .bind(state, at, at, obligationId),
  ];
}

export function securityLedgerPolicy(db: Database): PaymentLedgerPolicy {
  return {
    payoutPolicy: "security-bounty",
    async authorize(event, asset) {
      const intent = await db
        .prepare(`SELECT s.*,c.award_state FROM security_settlements s
        JOIN security_cases c ON c.id=s.case_id WHERE s.obligation_id=?`)
        .bind(event.obligationId)
        .first<{
          award_state: string;
          network: string;
          vault: string;
          asset: string;
          asset_decimals: number;
          gross_base: string;
          fee_base: string;
          reporter_github_id: string;
          source_digest: string;
          deployment: string;
        }>();
      if (
        intent?.award_state !== "approved" ||
        intent.network !== event.network ||
        intent.vault !== event.vault ||
        intent.asset !== asset.asset_address ||
        intent.asset_decimals !== asset.asset_decimals ||
        intent.gross_base !== event.grossMicro ||
        intent.fee_base !== event.feeMicro ||
        intent.reporter_github_id !== event.githubUserId ||
        intent.source_digest !== event.sourceDigest ||
        JSON.parse(intent.deployment).projectId !== event.projectId
      )
        throw new Error(
          "Finalized bounty differs from the private approved settlement",
        );
    },
    notices: (event, at) =>
      securityPaymentNotices(db, event.obligationId, event.kind, at),
  };
}

import {
  buildCommitAwardCalldata,
  evmAwardId,
} from "../../contracts/evm/adapter";
import { solanaAwardId } from "../../contracts/solana/adapter";
import { bytesToHex } from "../../src/lib/byte-encoding";
import {
  chainFamily,
  type EscrowDeployment,
  paymentDeploymentRecord,
} from "../../src/lib/escrow-policy.mjs";
import { payoutFee } from "../../src/lib/payments/contracts";
import { chunked, fail } from "../http";

/** A private vault snapshot older than this does not prove free funds. */
export const VAULT_SNAPSHOT_MAX_AGE_MS = 30 * 60_000;

export async function prepareSecuritySettlement(
  db: Database<D1QueryStatement>,
  input: {
    caseId: string;
    idempotencyKey: string;
    projectId: string;
    reporterId: string;
    approverId: string;
    revision: number;
    grossMinor: string;
    decimals: number;
    currency: string;
    chain: string | null;
    deployment: EscrowDeployment;
    at: string;
  },
) {
  const deployment = {
    ...paymentDeploymentRecord(input.projectId, input.deployment),
    payoutPolicy: "security-bounty",
  };
  if (input.currency !== "USDC" || input.chain !== deployment.chain)
    fail(
      409,
      "payment_terms_mismatch",
      "The approved award must use this rail and asset",
    );
  const consent = await db
    .prepare(
      "SELECT 1 ok FROM security_payment_consents WHERE case_id=? AND reporter_github_id=? AND deployment=?",
    )
    .bind(input.caseId, input.reporterId, JSON.stringify(deployment))
    .first();
  if (!consent)
    fail(
      409,
      "payment_consent_required",
      "The reporter must accept public chain visibility for this payment rail",
    );
  const existing = await db
    .prepare("SELECT case_id FROM security_settlements WHERE case_id=?")
    .bind(input.caseId)
    .first();
  if (existing)
    fail(
      409,
      "settlement_exists",
      "Use the existing settlement; never prepare a second transfer",
    );
  const snapshot = await db
    .prepare(`SELECT asset_address,asset_decimals,observed_at,free_balance
    FROM security_vault_snapshots WHERE project_id=? AND network=? AND vault=?`)
    .bind(input.projectId, deployment.network, deployment.vault)
    .first<{
      asset_address: string;
      asset_decimals: number;
      observed_at: string;
      free_balance: string | null;
    }>();
  if (
    !snapshot ||
    snapshot.asset_address !== deployment.asset ||
    snapshot.asset_decimals !== input.decimals ||
    Date.parse(input.at) - Date.parse(snapshot.observed_at) >
      VAULT_SNAPSHOT_MAX_AGE_MS
  )
    fail(
      409,
      "payment_vault_unverified",
      "A current finalized private vault snapshot is required",
    );
  if (
    snapshot.free_balance === null ||
    BigInt(snapshot.free_balance) < BigInt(input.grossMinor)
  )
    fail(
      409,
      "payment_funds_unavailable",
      "The finalized private vault balance does not cover this award",
    );
  // Public chain IDs are random commitments, never hashes of private evidence.
  const sourceDigest = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const obligationId =
    chainFamily(deployment.chain) === "evm"
      ? evmAwardId(
          BigInt(deployment.chainId ?? "0"),
          deployment.vault,
          `0x${sourceDigest}`,
        )
      : solanaAwardId(deployment.projectPda ?? "", sourceDigest);
  const fee = payoutFee(BigInt(input.grossMinor), "security-bounty").toString();
  return db
    .prepare(`INSERT INTO security_settlements
    (case_id,obligation_id,source_digest,network,vault,asset,asset_decimals,gross_base,fee_base,reporter_github_id,approved_by,approved_at,case_revision,deployment)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (
      SELECT 1 FROM security_cases c JOIN security_case_events e ON e.case_id=c.id AND e.case_revision=c.revision WHERE c.id=? AND c.revision=? AND c.award_state='approved' AND e.idempotency_key=? AND e.kind='prepare-payment')`)
    .bind(
      input.caseId,
      obligationId,
      sourceDigest,
      deployment.network,
      deployment.vault,
      deployment.asset,
      input.decimals,
      input.grossMinor,
      fee,
      input.reporterId,
      input.approverId,
      input.at,
      input.revision,
      JSON.stringify(deployment),
      input.caseId,
      input.revision,
      input.idempotencyKey,
    );
}

type SettlementRow = {
  case_id: string;
  obligation_id: string;
  source_digest: string;
  deployment: string;
  gross_base: string;
  fee_base: string;
  reporter_github_id: string;
  state: string | null;
  queue_state: string | null;
  attempt_state: string | null;
  paid_transaction: string | null;
  submitted_transaction: string | null;
};

/** The settlement columns of one case, or of a bounded `IN (...)` batch. */
const settlementSelect = (
  placeholders: string,
) => `SELECT s.*,o.state,o.paid_transaction,q.state queue_state,
      (SELECT state FROM security_payment_attempts a WHERE a.obligation_id=s.obligation_id ORDER BY created_at DESC LIMIT 1) attempt_state,
      (SELECT transaction_id FROM security_payment_attempts a WHERE a.obligation_id=s.obligation_id
       ORDER BY created_at DESC LIMIT 1) submitted_transaction
    FROM security_settlements s LEFT JOIN security_payment_obligations o ON o.id=s.obligation_id
    LEFT JOIN security_payment_outbox q ON q.obligation_id=s.obligation_id WHERE s.case_id IN (${placeholders})`;

export async function securitySettlementView(db: Database, caseId: string) {
  const row = await db
    .prepare(settlementSelect("?"))
    .bind(caseId)
    .first<SettlementRow>();
  return row ? settlementView(row) : null;
}

/** One settlement read per case, in a fixed number of statements. */
export async function securitySettlementViews(
  db: D1TransactionalDatabase<D1QueryStatement>,
  caseIds: readonly string[],
) {
  const views = new Map<
    string,
    Awaited<ReturnType<typeof securitySettlementView>>
  >();
  for (const caseId of caseIds) views.set(caseId, null);
  for (const part of chunked(caseIds)) {
    const rows = await db
      .prepare(settlementSelect(part.map(() => "?").join(",")))
      .bind(...part)
      .all<SettlementRow>();
    for (const row of rows.results ?? [])
      views.set(row.case_id, settlementView(row));
  }
  return views;
}

function settlementView(row: SettlementRow) {
  const deployment = JSON.parse(row.deployment) as ReturnType<
    typeof paymentDeploymentRecord
  >;
  return {
    state:
      row.state === "paid"
        ? "paid"
        : row.state === null
          ? "awaiting-owner-commitment"
          : ["unknown", "prepared"].includes(row.attempt_state ?? "")
            ? "uncertain"
            : (row.queue_state ?? "needs-wallet"),
    obligationId: row.obligation_id,
    network: deployment.network,
    asset: deployment.asset,
    grossBase: row.gross_base,
    feeBase: row.fee_base,
    netBase: (BigInt(row.gross_base) - BigInt(row.fee_base)).toString(),
    transactionId: row.paid_transaction,
    submittedTransactionId: row.submitted_transaction,
    privacyNotice:
      "Chain transactions reveal the vault, GitHub actor number, destination, time and amounts. Never include report data in a transaction.",
    ownerRequest:
      row.state === null
        ? chainFamily(deployment.chain) === "evm"
          ? {
              network: deployment.network,
              from: deployment.owner,
              to: deployment.vault,
              data: buildCommitAwardCalldata({
                obligationId: row.obligation_id,
                githubUserId: row.reporter_github_id,
                grossMicro: row.gross_base,
                sourceDigest: `0x${row.source_digest}`,
                payoutPolicy: "security-bounty",
              }),
              value: "0x0",
            }
          : {
              network: deployment.network,
              programId: deployment.programId,
              operation: "commit-bounty",
              deployment,
              awards: [
                {
                  awardId: row.obligation_id,
                  sourceDigest: row.source_digest,
                  githubUserId: row.reporter_github_id,
                  grossMicro: row.gross_base,
                },
              ],
            }
        : null,
  };
}
