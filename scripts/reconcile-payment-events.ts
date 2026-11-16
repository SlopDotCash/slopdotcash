/** Reviewed receipt indexing through the ordinary canonical verifier. Never signs. */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  type TransactionSerialized,
} from "viem";
import type {
  D1Result,
  D1Statement,
  D1TransactionalDatabase,
} from "../backend/d1";
import {
  CloudflareProjectPersistence,
  type ProjectD1Database,
} from "../backend/projects/cloudflare-persistence";
import {
  buildCommitAwardCalldata,
  buildPayCalldata,
  evmAwardId,
  verifyEvmDeployment,
  verifyPayment,
  verifyReserve,
} from "../contracts/evm/adapter";
import { canonicalJson } from "../src/lib/canonical-json";
import {
  assertEscrowPolicy,
  ESCROW_NETWORKS,
  paymentDeploymentRecord,
} from "../src/lib/escrow-policy.mjs";
import { escrowAwardOrigin } from "../src/lib/payments/escrow-cycle";
import type { MonthlyExecutionSnapshot } from "../src/lib/payments/monthly-allocation";
import { registryProjectDigest } from "../src/lib/vault-setup";
import { ingestPaymentEvent } from "../workers/payments/index";
import { readRegistryDatabase } from "../workers/payments/registry-database.mjs";

const hash = (bytes: string) =>
  createHash("sha256").update(bytes).digest("hex");
const sha = /^[a-f0-9]{64}$/u;
const uint = /^(0|[1-9][0-9]*)$/u;
class DatabaseFailure extends Error {
  constructor(readonly httpStatus: number) {
    super("Payment reconciliation database refused");
  }
}
type EventFacts = {
  transactionId: `0x${string}`;
  rawTransaction: `0x${string}`;
  eventIndex: number;
  obligationId: string;
  githubUserId: string;
  grossBase: string;
  feeBase: string;
  netBase: string;
  sourceDigest: string;
};
type EventReference = EventFacts &
  (
    | { kind?: "reserved" }
    | {
        kind: "paid";
        destination: string;
        claimId: string;
        payer: string;
        bindingVersion: string;
      }
  );
export type ReconciliationPacket = {
  schemaVersion: "reviewed-payment-events:v1";
  projectId: string;
  network: string;
  period: string;
  revision: number;
  manifestSha256: string;
  snapshotSha256: string;
  events: EventReference[];
};

export function readReconciliationPacket(
  bytes: string,
  expected: string,
): ReconciliationPacket {
  if (
    !sha.test(expected) ||
    hash(bytes) !== expected ||
    bytes.length > 48 * 1024
  )
    throw Error("Reviewed reconciliation packet changed");
  const packet = JSON.parse(bytes) as ReconciliationPacket;
  if (
    packet.schemaVersion !== "reviewed-payment-events:v1" ||
    !/^[a-z0-9][a-z0-9-]*$/u.test(packet.projectId) ||
    !/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(packet.period) ||
    !Number.isSafeInteger(packet.revision) ||
    packet.revision < 1 ||
    !sha.test(packet.manifestSha256) ||
    !sha.test(packet.snapshotSha256) ||
    !Array.isArray(packet.events) ||
    packet.events.length < 1 ||
    packet.events.length > 20 ||
    new Set(packet.events.map((event) => event.obligationId)).size !==
      packet.events.length
  )
    throw Error("Invalid reviewed reconciliation packet");
  for (const event of packet.events) {
    if (
      (event.kind !== undefined &&
        event.kind !== "reserved" &&
        event.kind !== "paid") ||
      (event.kind === "paid" &&
        (!/^0x[a-f0-9]{40}$/u.test(event.destination) ||
          BigInt(event.destination) === 0n ||
          !/^0x[a-f0-9]{40}$/u.test(event.payer) ||
          !/^[A-Za-z0-9:_-]{1,200}$/u.test(event.claimId) ||
          !/^[1-9][0-9]{0,19}$/u.test(event.bindingVersion))) ||
      !/^0x[a-f0-9]{64}$/u.test(event.transactionId) ||
      !/^0x(?:[a-fA-F0-9]{2})+$/u.test(event.rawTransaction) ||
      !/^0x[a-f0-9]{64}$/u.test(event.obligationId) ||
      !Number.isSafeInteger(event.eventIndex) ||
      event.eventIndex < 0 ||
      !/^[1-9][0-9]{0,19}$/u.test(event.githubUserId) ||
      ![event.grossBase, event.feeBase, event.netBase].every((value) =>
        uint.test(value),
      ) ||
      BigInt(event.grossBase) === 0n ||
      !sha.test(event.sourceDigest) ||
      BigInt(event.feeBase) !== (BigInt(event.grossBase) + 49n) / 50n ||
      BigInt(event.netBase) + BigInt(event.feeBase) !== BigInt(event.grossBase)
    )
      throw Error("Invalid reviewed payment reference");
  }
  return packet;
}

/** D1's documented batch request, one request for the complete canonical batch. */
export function reconciliationDatabase(input: {
  account: string;
  token: string;
  databaseId: string;
  apply: boolean;
  request?: typeof fetch;
}): D1TransactionalDatabase {
  const request = input.request ?? fetch;
  const statements = new WeakMap<
    D1Statement,
    { sql: string; params: unknown[] }
  >();
  async function query(
    batch: { sql: string; params: unknown[] }[],
    writes: boolean,
  ) {
    if (writes && !input.apply)
      throw Error("Preview cannot write payment events");
    const response = await request(
      `https://api.cloudflare.com/client/v4/accounts/${input.account}/d1/database/${input.databaseId}/query`,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(30000),
        headers: {
          authorization: `Bearer ${input.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(
          batch.length === 1 && !writes ? batch[0] : { batch },
        ),
      },
    );
    const body = (await response.json().catch(() => null)) as {
      success?: boolean;
      result?: D1Result[];
    } | null;
    if (
      !response.ok ||
      !body?.success ||
      body.result?.length !== batch.length ||
      body.result.some((result) => !result.success)
    )
      throw new DatabaseFailure(response.status);
    return body.result;
  }
  function prepare(sql: string, params: unknown[] = []): D1Statement {
    const statement: D1Statement = {
      bind: (...values) => prepare(sql, values),
      async first<T>() {
        if (!/^\s*SELECT\b/iu.test(sql)) throw Error("Canonical read required");
        return ((await query([{ sql, params }], false))[0].results?.[0] ??
          null) as T | null;
      },
      run: async () => {
        throw Error("Single payment writes are unavailable");
      },
    };
    statements.set(statement, { sql, params });
    return statement;
  }
  return {
    prepare,
    async batch(items) {
      const batch = items.map((statement) => {
        const value = statements.get(statement);
        if (
          !value ||
          !(
            /^\s*INSERT INTO (?:payment_events|payment_obligations|payment_outbox|notifications)\b/iu.test(
              value.sql,
            ) ||
            [
              "UPDATE payment_obligations SET state='paid',paid_transaction=? WHERE id=? AND state='reserved'",
              "UPDATE payment_outbox SET state='paid',lease_token=NULL,lease_until=NULL,updated_at=? WHERE obligation_id=?",
              "UPDATE payment_attempts SET state='finalized' WHERE obligation_id=? AND transaction_id=?",
            ].includes(value.sql)
          )
        )
          throw Error("Only canonical payment indexing statements are allowed");
        return value;
      });
      return query(batch, true);
    },
  };
}

export async function verifyReviewedPaymentEvents(input: {
  packet: ReconciliationPacket;
  db: D1TransactionalDatabase;
  rpcUrl: string;
  verify?: typeof verifyReserve;
  verifyPaid?: typeof verifyPayment;
  verifyDeployment?: typeof verifyEvmDeployment;
}) {
  const { packet, db } = input;
  const network =
    ESCROW_NETWORKS[packet.network as keyof typeof ESCROW_NETWORKS];
  if (network?.family !== "evm" || network.testnet || !network.chainId)
    throw Error("Registered mainnet EVM network required");
  const project = await new CloudflareProjectPersistence(
    db as ProjectD1Database,
  ).getProject(packet.projectId);
  if (
    !project ||
    project.revision !== packet.revision ||
    project.manifestSha256 !== packet.manifestSha256
  )
    throw Error("Reviewed project revision changed");
  assertEscrowPolicy(project.manifest.escrow);
  const matches = project.manifest.escrow?.deployments.filter(
    (deployment) => deployment.network === packet.network,
  );
  if (matches?.length !== 1)
    throw Error("Unique registered deployment required");
  const deployment = paymentDeploymentRecord(packet.projectId, matches[0]);
  if (
    !deployment.factory ||
    !deployment.factoryCodeSha256 ||
    !deployment.registrar
  )
    throw Error("Reviewed factory binding required");
  const config = {
    ...deployment,
    rpcUrl: input.rpcUrl,
    chainId: BigInt(network.chainId),
    factory: deployment.factory,
    factoryCodeSha256: deployment.factoryCodeSha256,
    registrar: deployment.registrar,
  };
  await (input.verifyDeployment ?? verifyEvmDeployment)(config, "finalized", {
    expectedProjectId: `0x${registryProjectDigest(packet.projectId)}`,
  });
  const run = await db
    .prepare(
      "SELECT snapshot,snapshot_sha256,network,vault,obligations_created_at FROM monthly_payment_runs WHERE project_id=? AND period=?",
    )
    .bind(packet.projectId, packet.period)
    .first<{
      snapshot: string;
      snapshot_sha256: string;
      network: string;
      vault: string;
      obligations_created_at: string | null;
    }>();
  if (
    !run?.obligations_created_at ||
    run.snapshot_sha256 !== packet.snapshotSha256 ||
    hash(run.snapshot) !== packet.snapshotSha256 ||
    run.network !== packet.network ||
    run.vault !== deployment.vault
  )
    throw Error("Frozen funded allocation changed");
  const snapshot = JSON.parse(run.snapshot) as MonthlyExecutionSnapshot;
  if (
    snapshot.schemaVersion !== "1" ||
    snapshot.kind !== "monthly-execution-snapshot" ||
    snapshot.network !== packet.network ||
    snapshot.vault !== deployment.vault ||
    snapshot.asset !== deployment.asset ||
    snapshot.projectId !== packet.projectId ||
    snapshot.period !== packet.period ||
    snapshot.manifestSha256 !== packet.manifestSha256
  )
    throw Error("Frozen allocation identity differs");
  const verified = [];
  for (const event of packet.events) {
    const expectedSource = escrowAwardOrigin(
      packet.projectId,
      packet.period,
      event.githubUserId,
    );
    const award = snapshot.awards.find(
      (item) => item.githubUserId === event.githubUserId,
    );
    const monthly = await db
      .prepare(
        "SELECT gross_base,fee_base,source_digest FROM monthly_payment_obligations WHERE project_id=? AND period=? AND github_user_id=?",
      )
      .bind(packet.projectId, packet.period, event.githubUserId)
      .first<{ gross_base: string; fee_base: string; source_digest: string }>();
    if (
      !award ||
      !monthly ||
      award.grossBase !== event.grossBase ||
      award.feeBase !== event.feeBase ||
      award.netBase !== event.netBase ||
      award.sourceDigest !== event.sourceDigest ||
      monthly.gross_base !== event.grossBase ||
      monthly.fee_base !== event.feeBase ||
      monthly.source_digest !== event.sourceDigest ||
      expectedSource !== event.sourceDigest
    )
      throw Error("Reviewed award differs from frozen allocation");
    const intent = {
      obligationId: event.obligationId,
      githubUserId: event.githubUserId,
      sourceDigest: `0x${event.sourceDigest}`,
      grossMicro: event.grossBase,
    };
    if (event.kind === "paid") {
      const reserved = await db
        .prepare("SELECT * FROM payment_obligations WHERE id=?")
        .bind(event.obligationId)
        .first<{
          project_id: string;
          network: string;
          vault: string;
          chain: string;
          github_user_id: string;
          gross_base: string;
          fee_base: string;
          source_digest: string;
          state: string;
          paid_transaction: string | null;
          asset_address: string;
        }>();
      const recorded = await db
        .prepare(
          "SELECT evidence_json FROM payment_events WHERE obligation_id=? AND kind='reserved' ORDER BY observed_at LIMIT 1",
        )
        .bind(event.obligationId)
        .first<{ evidence_json: string }>();
      const prior = recorded ? JSON.parse(recorded.evidence_json) : null;
      const wallet = await db
        .prepare(
          "SELECT w.wallet_address FROM wallet_claims w JOIN payment_wallet_authorizations a ON a.claim_id=w.id AND a.github_user_id=w.github_user_id WHERE w.id=? AND w.github_user_id=? AND w.chain=?",
        )
        .bind(event.claimId, event.githubUserId, deployment.chain)
        .first<{ wallet_address: string }>();
      // Historical authorized claims remain valid evidence for already finalized payments.
      // The canonical ledger independently repeats wallet authorization at ingestion.
      if (
        !reserved ||
        reserved.project_id !== packet.projectId ||
        reserved.network !== packet.network ||
        reserved.vault !== deployment.vault ||
        reserved.chain !== deployment.chain ||
        reserved.github_user_id !== event.githubUserId ||
        reserved.gross_base !== event.grossBase ||
        reserved.fee_base !== event.feeBase ||
        reserved.source_digest !== event.sourceDigest ||
        reserved.asset_address.toLowerCase() !==
          deployment.asset.toLowerCase() ||
        !(
          reserved.state === "reserved" ||
          (reserved.state === "paid" &&
            reserved.paid_transaction === event.transactionId)
        ) ||
        !prior ||
        prior.kind !== "reserved" ||
        prior.obligationId !== event.obligationId ||
        prior.projectId !== packet.projectId ||
        prior.network !== packet.network ||
        prior.vault !== deployment.vault ||
        prior.githubUserId !== event.githubUserId ||
        prior.sourceDigest !== event.sourceDigest ||
        prior.grossMicro !== event.grossBase ||
        prior.feeMicro !== event.feeBase ||
        prior.netMicro !== event.netBase ||
        wallet?.wallet_address.toLowerCase() !== event.destination
      )
        throw Error("Indexed reservation or authorized destination differs");
    }
    const raw = event.rawTransaction as TransactionSerialized;
    const decoded = parseTransaction(raw);
    if (
      keccak256(event.rawTransaction) !== event.transactionId ||
      (
        await recoverTransactionAddress({ serializedTransaction: raw })
      ).toLowerCase() !==
        (event.kind === "paid"
          ? event.payer
          : deployment.owner.toLowerCase()) ||
      decoded.chainId !== Number(network.chainId) ||
      decoded.to?.toLowerCase() !== deployment.vault.toLowerCase() ||
      (decoded.value ?? 0n) !== 0n ||
      decoded.data !==
        (event.kind === "paid"
          ? buildPayCalldata(event.obligationId, event.bindingVersion)
          : buildCommitAwardCalldata(intent)) ||
      event.obligationId !==
        evmAwardId(
          BigInt(network.chainId),
          deployment.vault,
          `0x${event.sourceDigest}`,
        )
    )
      throw Error("Retained payment signature or calldata differs");
    const evidence = await (event.kind === "paid"
      ? (input.verifyPaid ?? verifyPayment)
      : (input.verify ?? verifyReserve))(
      config,
      event.transactionId,
      event.eventIndex,
      event.obligationId,
    );
    if (
      evidence.githubUserId !== event.githubUserId ||
      evidence.grossMicro !== event.grossBase ||
      evidence.feeMicro !== event.feeBase ||
      evidence.netMicro !== event.netBase ||
      (event.kind === "paid"
        ? evidence.destination !== event.destination ||
          evidence.bindingVersion !== event.bindingVersion
        : evidence.sourceDigest !== `0x${event.sourceDigest}`)
    )
      throw Error("Finalized payment event differs from reviewed award");
    verified.push({ reference: event, blockId: evidence.blockId });
  }
  return { deployment, verified };
}

export async function reconcileReviewedPaymentEvents(input: {
  packet: ReconciliationPacket;
  db: D1TransactionalDatabase;
  rpcUrl: string;
  apply: boolean;
  ingest?: typeof ingestPaymentEvent;
  verify?: typeof verifyReserve;
  verifyPaid?: typeof verifyPayment;
  verifyDeployment?: typeof verifyEvmDeployment;
}) {
  const prepared = await verifyReviewedPaymentEvents(input);
  if (!input.apply)
    return {
      verified: prepared.verified.length,
      indexed: 0,
      replayVerified: false,
    };
  const env = {
    PAYMENTS_DB: input.db,
    REGISTRY_DB: input.db,
    PAYMENT_NETWORKS: JSON.stringify([input.packet.network]),
    PAYMENT_RPC_URLS: JSON.stringify({ [input.packet.network]: input.rpcUrl }),
  };
  for (const { reference, blockId } of prepared.verified) {
    const event = {
      projectId: input.packet.projectId,
      network: input.packet.network,
      transactionId: reference.transactionId,
      eventIndex: reference.eventIndex,
      kind: reference.kind ?? "reserved",
      obligationId: reference.obligationId,
    };
    await (input.ingest ?? ingestPaymentEvent)(env, event, new Date(), [
      prepared.deployment,
    ]);
    const before = await input.db
      .prepare(
        "SELECT evidence_json FROM payment_events WHERE network=? AND transaction_id=? AND event_index=?",
      )
      .bind(event.network, event.transactionId, event.eventIndex)
      .first<{ evidence_json: string }>();
    await (input.ingest ?? ingestPaymentEvent)(env, event, new Date(), [
      prepared.deployment,
    ]);
    const after = await input.db
      .prepare(
        "SELECT evidence_json FROM payment_events WHERE network=? AND transaction_id=? AND event_index=?",
      )
      .bind(event.network, event.transactionId, event.eventIndex)
      .first<{ evidence_json: string }>();
    const obligation = await input.db
      .prepare(
        "SELECT state,paid_transaction FROM payment_obligations WHERE id=?",
      )
      .bind(event.obligationId)
      .first<{ state: string; paid_transaction: string | null }>();
    if (
      event.kind === "paid" &&
      (obligation?.state !== "paid" ||
        obligation.paid_transaction !== event.transactionId)
    )
      throw Error("Canonical paid obligation readback differs");
    const stored = before ? JSON.parse(before.evidence_json) : null;
    if (
      !stored ||
      stored.kind !== event.kind ||
      stored.transactionId !== reference.transactionId ||
      stored.eventIndex !== reference.eventIndex ||
      stored.blockId !== blockId ||
      stored.obligationId !== reference.obligationId ||
      stored.projectId !== input.packet.projectId ||
      stored.network !== input.packet.network ||
      stored.vault !== prepared.deployment.vault ||
      stored.githubUserId !== reference.githubUserId ||
      stored.grossMicro !== reference.grossBase ||
      stored.feeMicro !== reference.feeBase ||
      stored.netMicro !== reference.netBase ||
      stored.sourceDigest !== reference.sourceDigest ||
      (reference.kind === "paid" &&
        stored.destination !== reference.destination)
    )
      throw Error("Canonical stored event readback differs");
    if (!before || canonicalJson(before) !== canonicalJson(after))
      throw Error("Canonical indexing replay changed evidence");
  }
  return {
    verified: prepared.verified.length,
    indexed: prepared.verified.length,
    replayVerified: true,
  };
}

let executionStage = "trusted-context";
async function main() {
  if (
    process.env.GITHUB_ACTIONS !== "true" ||
    process.env.GITHUB_REPOSITORY !== "SlopDotCash/slopdotcash" ||
    process.env.GITHUB_REF !== "refs/heads/main" ||
    process.env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    process.env.GITHUB_WORKFLOW_REF !==
      "SlopDotCash/slopdotcash/.github/workflows/payment-event-reconciliation.yml@refs/heads/main"
  )
    throw Error("Trusted manual main reconciliation required");
  const checkout = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  if (
    checkout !== process.env.GITHUB_SHA ||
    execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
      encoding: "utf8",
    }).trim()
  )
    throw Error("Exact clean reconciliation checkout required");
  const bytes = process.env.SLOP_PAYMENT_RECONCILIATION_PACKET ?? "";
  executionStage = "reviewed-packet";
  const packet = readReconciliationPacket(
    bytes,
    process.env.SLOP_PAYMENT_RECONCILIATION_SHA256 ?? "",
  );
  const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
    token = process.env.CLOUDFLARE_API_TOKEN ?? "";
  const rpcUrls = JSON.parse(process.env.PAYMENT_RPC_URLS ?? "{}");
  if (
    !/^[a-f0-9]{32}$/u.test(account) ||
    !token ||
    typeof rpcUrls[packet.network] !== "string" ||
    new URL(rpcUrls[packet.network]).protocol !== "https:"
  )
    throw Error("Protected reconciliation configuration required");
  const registry = await readRegistryDatabase();
  const apply = process.env.SLOP_PAYMENT_RECONCILIATION_APPLY === "true";
  const db = reconciliationDatabase({
    account,
    token,
    databaseId: registry.database_id,
    apply,
  });
  executionStage = "canonical-reconciliation";
  const result = await reconcileReviewedPaymentEvents({
    packet,
    db,
    rpcUrl: rpcUrls[packet.network],
    apply,
  });
  const report = {
    checkedAt: new Date().toISOString(),
    sourceCommit: checkout,
    packetSha256: hash(bytes),
    apply,
    ...result,
    cursorChangedByRunner: false,
  };
  writeFileSync(
    join(process.env.RUNNER_TEMP ?? ".", "payment-event-reconciliation.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    { mode: 0o600 },
  );
  console.log(JSON.stringify(report));
}
if (import.meta.main)
  await main().catch((error) => {
    const report = {
      status: "failed",
      stage: executionStage,
      ...(error instanceof DatabaseFailure
        ? { httpStatus: error.httpStatus }
        : {}),
    };
    if (process.env.RUNNER_TEMP)
      writeFileSync(
        join(process.env.RUNNER_TEMP, "payment-event-reconciliation.json"),
        `${JSON.stringify(report)}\n`,
        { mode: 0o600 },
      );
    console.error(JSON.stringify(report));
    process.exitCode = 1;
  });
