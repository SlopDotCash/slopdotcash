import type { D1TransactionalDatabase as D1Database } from "../../backend/d1";
import {
  dispatchPayment,
  type PaymentExecutor,
} from "../../backend/payments/dispatch";
import { evmPaymentAdapter } from "../../backend/payments/evm-adapter";
import {
  indexPaymentEvent,
  type PaymentChainAdapter,
} from "../../backend/payments/ledger";
import {
  automaticMonthlyPayment,
  coordinateMonthlyPayments,
} from "../../backend/payments/monthly";
import {
  refreshVaultSnapshots,
  type VaultTotals,
} from "../../backend/payments/vault-snapshots";
import {
  CloudflareProjectPersistence,
  type ProjectD1Database,
} from "../../backend/projects/cloudflare-persistence";
import { publicRestrictionOf } from "../../backend/projects/enforcement";
import {
  securityLedgerPolicy,
  securityPaymentNotices,
} from "../../backend/security/payments";
import {
  readVaultTotals as readEvmVaultTotals,
  verifyEvmDeployment,
} from "../../contracts/evm/adapter";
import {
  readVaultTotals as readSolanaVaultTotals,
  solanaPaymentAdapter,
} from "../../contracts/solana/adapter";
import {
  chainFamily,
  type PaymentDeploymentRecord,
} from "../../src/lib/escrow-policy.mjs";
import type { PayoutPolicy } from "../../src/lib/payments/contracts";
import {
  monthlyCutoff,
  parseMonthlySchedule,
  periodEnd,
} from "../../src/lib/payments/monthly-allocation";
import type { MonthlyAuthorization } from "../payment-executor/monthly";
import {
  loadRegistryPaymentDeployments,
  parsePaymentNetworks,
} from "./deployments";
import { reconcileFailedAttempts } from "./reconcile";
import { type ScanEvent, scanEvmPayments, scanSolanaPayments } from "./scanner";

/** One reviewed registry deployment; the private bounty Worker adds its payout policy. */
export type PaymentDeployment = PaymentDeploymentRecord & {
  payoutPolicy?: PayoutPolicy;
};
/** The fields one chain step reads. Local integration chains (Anvil, fixtures)
 * use network names outside the registry. */
export type DeploymentView<
  Fields extends keyof PaymentDeployment,
  OptionalFields extends keyof PaymentDeployment = never,
> = Pick<PaymentDeployment, Exclude<Fields, "network">> &
  Partial<Pick<PaymentDeployment, OptionalFields>> & { network: string };
export interface PaymentsWorkerEnvironment {
  /** Private worker only. Its entrypoint binds the separate private ledger. */
  PAYMENT_SCOPE?: "security-bounty";
  PAYMENTS_DB: D1Database;
  /**
   * The D1 project registry (the Pages `SLOP_DB`, `slop-private`), bound
   * separately from PAYMENTS_DB. The Worker only reads it.
   */
  REGISTRY_DB: D1Database;
  /**
   * JSON array of the registry networks this Worker serves. Their vaults come
   * from REGISTRY_DB on every run; no deployment list is copied into the
   * Worker configuration.
   */
  PAYMENT_NETWORKS: string;
  /** Private JSON map of network name to a finalized-capable RPC endpoint. */
  PAYMENT_RPC_URLS: string;
  PAYMENT_SOLANA_GENESIS?: string;
  /** A separate restricted execution service; no signer secrets in this worker. */
  EVM_PAYMENT_EXECUTOR?: { fetch(request: Request): Promise<Response> };
  SOLANA_PAYMENT_EXECUTOR?: { fetch(request: Request): Promise<Response> };
  /**
   * The owner-decided automatic monthly cutoff (backend/payments/monthly.ts).
   * Unset, the coordinator freezes no month automatically.
   */
  MONTHLY_PAYMENT_SCHEDULE?: string;
}
/** The served networks' reviewed vaults, read from the D1 project registry. */
export function registryDeployments(env: PaymentsWorkerEnvironment) {
  return loadRegistryPaymentDeployments(
    env.REGISTRY_DB,
    parsePaymentNetworks(env.PAYMENT_NETWORKS),
    env.PAYMENT_SCOPE,
  );
}
export async function recoverUncertainAttempts(
  env: PaymentsWorkerEnvironment,
): Promise<void> {
  const row = await env.PAYMENTS_DB.prepare(
    "SELECT json_group_array(json_object('idempotencyKey',a.id,'obligationId',o.id,'network',o.network,'vault',o.vault,'chain',o.chain)) items FROM payment_attempts a JOIN payment_obligations o ON o.id=a.obligation_id WHERE o.state='reserved' AND ((a.state IN ('unknown','prepared') AND a.transaction_id IS NULL) OR (o.chain='solana' AND a.state='submitted'))",
  ).first<{ items: string }>();
  const failures: unknown[] = [];
  for (const attempt of JSON.parse(row?.items ?? "[]") as {
    idempotencyKey: string;
    obligationId: string;
    network: string;
    vault: string;
    chain: string;
  }[]) {
    try {
      const service =
        chainFamily(attempt.chain) === "evm"
          ? env.EVM_PAYMENT_EXECUTOR
          : env.SOLANA_PAYMENT_EXECUTOR;
      if (!service) throw new Error("Attempt status service unavailable");
      const { chain: _chain, ...identity } = attempt;
      const response = await service.fetch(
        new Request("https://payments-executor.internal/v1/attempt-status", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(identity),
        }),
      );
      if (!response.ok) throw new Error("Attempt status reconciliation failed");
      const status = (await response.json()) as {
        transactionId: unknown;
        submitted?: unknown;
      };
      if (status.transactionId === null) {
        const successor = await env.PAYMENTS_DB.prepare(
          "SELECT w.id FROM payment_attempts a JOIN wallet_claims old ON old.id=a.claim_id JOIN effective_payment_wallet_claims w ON w.github_user_id=old.github_user_id AND w.chain=old.chain JOIN payment_wallet_authorizations consent ON consent.claim_id=w.id WHERE a.id=? AND w.id!=old.id",
        )
          .bind(attempt.idempotencyKey)
          .first<{ id: string }>();
        if (!successor) continue;
        const cancellation = await service.fetch(
          new Request(
            "https://payments-executor.internal/v1/cancel-unsubmitted",
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(identity),
            },
          ),
        );
        if (!cancellation.ok)
          throw new Error("Unsigned attempt retirement failed");
        const outcome = (await cancellation.json()) as {
          retired: boolean;
          transactionId: unknown;
          submitted?: unknown;
        };
        if (outcome.retired === true && outcome.transactionId === null) {
          await env.PAYMENTS_DB.batch([
            env.PAYMENTS_DB.prepare(
              "INSERT INTO payment_attempt_failures VALUES(?,NULL,?,?) ON CONFLICT(attempt_id) DO NOTHING",
            ).bind(
              attempt.idempotencyKey,
              new Date().toISOString(),
              JSON.stringify({
                kind: "unsigned-attempt-retired",
                successorClaimId: successor.id,
              }),
            ),
            env.PAYMENTS_DB.prepare(
              "UPDATE payment_attempts SET state='failed' WHERE id=? AND transaction_id IS NULL AND state IN ('prepared','unknown')",
            ).bind(attempt.idempotencyKey),
            // A dispatcher may be mid-submit under a live lease: keep it, so
            // its own completion batch still matches the token.
            env.PAYMENTS_DB.prepare(
              "UPDATE payment_outbox SET state='ready',lease_token=NULL,lease_until=NULL,updated_at=? WHERE obligation_id=? AND state!='paid' AND NOT (state='processing' AND lease_until IS NOT NULL AND lease_until > ?)",
            ).bind(
              new Date().toISOString(),
              attempt.obligationId,
              new Date().toISOString(),
            ),
          ]);
          continue;
        }
        if (outcome.retired !== false)
          throw new Error("Invalid retirement result");
        status.transactionId = outcome.transactionId;
        status.submitted = outcome.submitted;
      }
      if (typeof status.transactionId !== "string" || !status.transactionId)
        throw new Error("Invalid attempt transaction identity");
      if (typeof status.submitted !== "boolean")
        throw new Error("Missing submission observation");
      if (!status.submitted) {
        // Saved bytes the chain never saw were refused: a failed Solana
        // preflight, or an EVM broadcast the node rejected, which leaves its
        // nonce unfilled. Keep the attempt retryable so the dispatcher resends
        // the same bytes. Reopen an older falsely submitted Solana row too,
        // without retiring its signed bytes; the executor replaces them only
        // after it proves finalized expiry and rechecks the unpaid award.
        await env.PAYMENTS_DB.batch([
          env.PAYMENTS_DB.prepare(
            "UPDATE payment_attempts SET transaction_id=NULL,state='unknown' WHERE id=? AND state='submitted' AND transaction_id=? AND EXISTS(SELECT 1 FROM payment_obligations WHERE id=? AND state='reserved')",
          ).bind(
            attempt.idempotencyKey,
            status.transactionId,
            attempt.obligationId,
          ),
          env.PAYMENTS_DB.prepare(
            "UPDATE payment_outbox SET state='ready',lease_token=NULL,lease_until=NULL,updated_at=? WHERE obligation_id=? AND state='submitted' AND EXISTS(SELECT 1 FROM payment_attempts WHERE id=? AND state='unknown' AND transaction_id IS NULL) AND EXISTS(SELECT 1 FROM payment_obligations WHERE id=? AND state='reserved')",
          ).bind(
            new Date().toISOString(),
            attempt.obligationId,
            attempt.idempotencyKey,
            attempt.obligationId,
          ),
        ]);
        continue;
      }
      await env.PAYMENTS_DB.batch([
        env.PAYMENTS_DB.prepare(
          "UPDATE payment_attempts SET transaction_id=?,state='submitted' WHERE id=? AND transaction_id IS NULL AND state IN ('unknown','prepared')",
        ).bind(status.transactionId, attempt.idempotencyKey),
        env.PAYMENTS_DB.prepare(
          "UPDATE payment_outbox SET state='submitted',lease_token=NULL,lease_until=NULL,updated_at=? WHERE obligation_id=? AND state!='paid'",
        ).bind(new Date().toISOString(), attempt.obligationId),
      ]);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length)
    throw new AggregateError(failures, "Payment attempt recovery failures");
}
function executor(env: PaymentsWorkerEnvironment): PaymentExecutor {
  return {
    async submit(input) {
      const { deployments } = await registryDeployments(env);
      const matched = deployments.filter(
        (d) => d.network === input.network && d.vault === input.vault,
      );
      if (matched.length !== 1)
        throw new Error("Reviewed execution deployment unavailable");
      const service =
        chainFamily(matched[0].chain) === "evm"
          ? env.EVM_PAYMENT_EXECUTOR
          : env.SOLANA_PAYMENT_EXECUTOR;
      if (!service) throw new Error("Chain execution service unavailable");
      const response = await service.fetch(
        new Request("https://payments-executor.internal/v1/pay", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": input.idempotencyKey,
          },
          body: JSON.stringify(input),
        }),
      );
      if (!response.ok)
        throw new Error("Payment execution service rejected request");
      const result = (await response.json()) as { transactionId?: unknown };
      if (typeof result.transactionId !== "string" || !result.transactionId)
        throw new Error("Missing transaction identity");
      return { transactionId: result.transactionId };
    },
  };
}
export async function runPaymentDispatch(
  env: PaymentsWorkerEnvironment,
  now = new Date(),
): Promise<void> {
  if (!env.EVM_PAYMENT_EXECUTOR && !env.SOLANA_PAYMENT_EXECUTOR)
    throw new Error("Payment execution service unavailable");
  const rows = await env.PAYMENTS_DB.prepare(
    "SELECT json_group_array(obligation_id) ids FROM (SELECT obligation_id FROM payment_outbox WHERE state='ready' OR (state='processing' AND lease_until<?) ORDER BY updated_at LIMIT 50)",
  )
    .bind(now.toISOString())
    .first<{ ids: string }>();
  const failures: unknown[] = [];
  for (const id of JSON.parse(rows?.ids ?? "[]") as string[]) {
    try {
      await dispatchPayment(
        env.PAYMENTS_DB,
        executor(env),
        id,
        now,
        env.PAYMENT_SCOPE === "security-bounty"
          ? (id, at) => securityPaymentNotices(env.REGISTRY_DB, id, "held", at)
          : undefined,
      );
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length)
    throw new AggregateError(failures, "Payment dispatch failures");
}
/**
 * The monthly coordinator for ordinary project vaults: freeze months due at
 * the configured cutoff, then create funded obligations once. Never runs for
 * private bounty programs. It reads the registry and enforcement records
 * from REGISTRY_DB and keeps its records in PAYMENTS_DB with the vault
 * snapshots and the chain projection it checks.
 */
export async function runMonthlyCoordinator(
  env: PaymentsWorkerEnvironment,
  now = new Date(),
) {
  if (env.PAYMENT_SCOPE === "security-bounty") return null;
  const registry = new CloudflareProjectPersistence(
    env.REGISTRY_DB as ProjectD1Database,
  );
  const report = await coordinateMonthlyPayments({
    db: env.PAYMENTS_DB,
    projects: {
      getProject: (id) => registry.getProject(id),
      restricted: async (project) =>
        publicRestrictionOf(project, await registry.listEnforcements())
          .state !== "clear",
    },
    networks: parsePaymentNetworks(env.PAYMENT_NETWORKS),
    schedule: parseMonthlySchedule(env.MONTHLY_PAYMENT_SCHEDULE),
    now,
  });
  if (report.failures.length)
    throw new AggregateError(report.failures, "Monthly coordinator failures");
  return report;
}
/** Submit published ordinary allocations through the separately operated executor.
 * A submission only wakes the finalized scanner; it never writes a reserve/payment.
 */
export async function runMonthlyCommitments(
  env: PaymentsWorkerEnvironment,
  now = new Date(),
) {
  if (env.PAYMENT_SCOPE === "security-bounty") return;
  const schedule = parseMonthlySchedule(env.MONTHLY_PAYMENT_SCHEDULE);
  if (!schedule) return;
  const shifted = new Date(
    now.getTime() - schedule.cutoffSecondsAfterPeriodEnd * 1000,
  );
  const activePeriod = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() - 1, 1),
  )
    .toISOString()
    .slice(0, 7);
  const registry = await registryDeployments(env);
  const deployments = registry.deployments;
  const failures: unknown[] = [...registry.failures];
  const rows = await env.PAYMENTS_DB.prepare(
    "SELECT json_group_array(authorization) items FROM (SELECT a.authorization FROM monthly_payment_current_authorizations a LEFT JOIN monthly_payment_execution x ON x.project_id=a.project_id AND x.period=a.period AND x.network=a.network WHERE coalesce(x.complete,0)=0 AND (a.period=? OR json_extract(a.authorization,'$.plan.family')='solana' OR json_extract(a.authorization,'$.plan.evmReservation.version')=2) AND a.network IN (SELECT value FROM json_each(?)) ORDER BY coalesce(x.last_attempt,''),a.period,a.project_id LIMIT 50)",
  )
    .bind(activePeriod, env.PAYMENT_NETWORKS)
    .first<{ items: string }>();
  // Newest period first: only the newest month can be admitting, so its reservation is sent before
  // any older month's leaf in this pass. A leaf mined first would advance ordinarySourceSequence
  // and revert the signed reservation with MonthlySourceChanged.
  const period = (encoded: string) => {
    try {
      return String(JSON.parse(encoded).plan.request.period);
    } catch {
      return "";
    }
  };
  const items = (JSON.parse(rows?.items ?? "[]") as string[]).sort((a, b) =>
    period(b).localeCompare(period(a)),
  );
  for (const encoded of items) {
    try {
      const authorization = JSON.parse(encoded) as MonthlyAuthorization;
      const { plan } = authorization;
      await env.PAYMENTS_DB.prepare(
        "INSERT INTO monthly_payment_execution(project_id,period,network,last_attempt) VALUES(?,?,?,?) ON CONFLICT(project_id,period,network) DO UPDATE SET last_attempt=excluded.last_attempt",
      )
        .bind(
          plan.request.projectId,
          plan.request.period,
          plan.request.network,
          now.toISOString(),
        )
        .run();
      const automatic = await automaticMonthlyPayment(
        env.PAYMENTS_DB,
        plan.request.projectId,
      );
      const cutoff = monthlyCutoff(schedule, plan.request.period);
      const closes = monthlyCutoff(
        schedule,
        periodEnd(plan.request.period).toISOString().slice(0, 7),
      );
      const admit =
        automatic && !!cutoff && !!closes && now >= cutoff && now < closes;
      const resumable = plan.family === "solana" || !!plan.evmReservation;
      if (!admit && !resumable) continue;
      const matches = deployments.filter(
        (d) =>
          d.projectId === plan.request.projectId &&
          d.network === plan.request.network &&
          d.vault === plan.deployment.vault,
      );
      if (matches.length !== 1)
        throw new Error("Monthly deployment is no longer served");
      const service =
        chainFamily(matches[0].chain) === "evm"
          ? env.EVM_PAYMENT_EXECUTOR
          : env.SOLANA_PAYMENT_EXECUTOR;
      if (!service) throw new Error("Monthly executor unavailable");
      const response = await service.fetch(
        new Request(
          `https://payments-executor.internal/v1/commit-monthly?admit=${admit}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(authorization),
          },
        ),
      );
      if (!response.ok) throw new Error("Monthly executor rejected commitment");
      const result = (await response.json()) as {
        transactionId?: unknown;
        alreadyCommitted?: unknown;
        notAdmitted?: unknown;
        complete?: unknown;
      };
      if (
        !admit &&
        resumable &&
        result.notAdmitted === true &&
        result.transactionId === null &&
        result.alreadyCommitted === false
      )
        continue;
      if (
        !(
          (result.alreadyCommitted === true && result.transactionId === null) ||
          // V2 leaves for an admitted reserve: the root is on chain and this run submitted leaves.
          ((result.alreadyCommitted === false ||
            (plan.evmReservation && result.alreadyCommitted === true)) &&
            typeof result.transactionId === "string" &&
            result.transactionId.length > 0)
        )
      )
        throw new Error("Monthly executor returned no submission evidence");
      if (plan.evmReservation && typeof result.complete !== "boolean")
        throw new Error("Monthly executor returned no completion evidence");
      // A legacy month stays open while the executor's re-sent journaled nonce is unmined.
      if (
        plan.evmReservation
          ? result.complete
          : result.alreadyCommitted === true && result.complete !== false
      ) {
        await env.PAYMENTS_DB.prepare(
          "UPDATE monthly_payment_execution SET complete=1 WHERE project_id=? AND period=? AND network=?",
        )
          .bind(
            plan.request.projectId,
            plan.request.period,
            plan.request.network,
          )
          .run();
      }
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length)
    throw new AggregateError(failures, "Monthly commitment failures");
}
export async function ingestPaymentEvent(
  env: PaymentsWorkerEnvironment,
  message: ScanEvent,
  now: Date,
  reviewed: readonly PaymentDeployment[],
): Promise<void> {
  if (
    !message ||
    typeof message.projectId !== "string" ||
    typeof message.transactionId !== "string" ||
    typeof message.obligationId !== "string" ||
    !Number.isSafeInteger(message.eventIndex) ||
    message.eventIndex < 0 ||
    (message.kind !== "reserved" && message.kind !== "paid")
  )
    throw new Error("Invalid chain event request");
  const matches = reviewed.filter(
    (d) => d.projectId === message.projectId && d.network === message.network,
  );
  if (matches.length !== 1)
    throw new Error("Reviewed deployment unavailable or ambiguous");
  const deployment = matches[0];
  const family = chainFamily(deployment.chain);
  if (
    !(family === "evm" ? /^0x[0-9a-f]{64}$/ : /^[0-9a-f]{64}$/).test(
      message.obligationId,
    )
  )
    throw new Error("Noncanonical obligation identity");
  const rpcUrls = JSON.parse(env.PAYMENT_RPC_URLS) as Record<string, string>;
  const rpcUrl = rpcUrls[deployment.network];
  if (!rpcUrl) throw new Error("Private RPC configuration unavailable");
  let adapter: PaymentChainAdapter;
  if (
    family === "evm" &&
    deployment.chainId &&
    deployment.factory &&
    deployment.factoryCodeSha256 &&
    deployment.registrar
  ) {
    adapter = evmPaymentAdapter(env.PAYMENTS_DB, {
      ...deployment,
      rpcUrl,
      chainId: BigInt(deployment.chainId),
      factory: deployment.factory,
      factoryCodeSha256: deployment.factoryCodeSha256,
      registrar: deployment.registrar,
    });
  } else if (
    family === "solana" &&
    deployment.programId &&
    deployment.projectPda &&
    deployment.asset &&
    deployment.networkDomain &&
    deployment.rotationDelaySeconds &&
    deployment.rotationAuthority
  ) {
    const genesis = (
      JSON.parse(env.PAYMENT_SOLANA_GENESIS ?? "{}") as Record<string, string>
    )[deployment.network];
    if (!genesis) throw new Error("Solana genesis trust root unavailable");
    adapter = solanaPaymentAdapter({
      ...deployment,
      rpcUrl,
      genesisHash: genesis,
      programId: deployment.programId,
      projectPda: deployment.projectPda,
      mint: deployment.asset,
      networkDomain: deployment.networkDomain,
      rotationDelaySeconds: deployment.rotationDelaySeconds,
      rotationAuthority: deployment.rotationAuthority,
    });
  } else throw new Error("Reviewed chain deployment incomplete");
  await indexPaymentEvent(
    env.PAYMENTS_DB,
    adapter,
    message,
    now.toISOString(),
    env.PAYMENT_SCOPE === "security-bounty"
      ? securityLedgerPolicy(env.REGISTRY_DB)
      : undefined,
  );
}
/**
 * Reads the vault counters at the finalized block through the chain adapter
 * (EVM `finalized` tag, Solana `finalized` commitment). Pages never read the
 * chain; they read the vault_snapshots row that the cron writes from this.
 */
export async function readDeploymentVaultTotals(
  deployment: DeploymentView<
    | "chain"
    | "vault"
    | "asset"
    | "owner"
    | "identityAuthority"
    | "feeRecipient"
    | "codeSha256"
    | "bindingDelaySeconds"
    | "evmUpgrade",
    | "chainId"
    | "factory"
    | "factoryCodeSha256"
    | "registrar"
    | "programId"
    | "projectPda"
  >,
  rpcUrl: string,
): Promise<VaultTotals> {
  if (chainFamily(deployment.chain) === "evm") {
    if (
      !deployment.chainId ||
      !deployment.factory ||
      !deployment.factoryCodeSha256 ||
      !deployment.registrar
    )
      throw new Error("Reviewed chain deployment incomplete");
    const chainId = BigInt(deployment.chainId);
    // The counters mean what the reviewed code says only for that code.
    await verifyEvmDeployment({
      ...deployment,
      rpcUrl,
      chainId,
      factory: deployment.factory,
      factoryCodeSha256: deployment.factoryCodeSha256,
      registrar: deployment.registrar,
    });
    return readEvmVaultTotals({
      rpcUrl,
      network: deployment.network,
      vault: deployment.vault,
      chainId,
    });
  }
  if (!deployment.programId || !deployment.projectPda)
    throw new Error("Solana project deployment missing");
  return readSolanaVaultTotals({
    rpcUrl,
    network: deployment.network,
    programId: deployment.programId,
    projectPda: deployment.projectPda,
  });
}
/**
 * The cron's chain read: discover the served networks' vaults in the D1
 * registry, store each vault's finalized counters in vault_snapshots, then
 * scan its finalized payment events. Failures are returned, not thrown, so
 * one vault never stops the others or the payout steps.
 */
export async function syncRegistryVaults(env: PaymentsWorkerEnvironment) {
  const registry = await registryDeployments(env);
  const deployments = registry.deployments;
  const rpcUrls = JSON.parse(env.PAYMENT_RPC_URLS) as Record<string, string>;
  const failures: unknown[] = [...registry.failures];
  // The ledger takes each award's asset and decimals from this snapshot,
  // so it runs before the event scan.
  try {
    await refreshVaultSnapshots(
      env.PAYMENTS_DB,
      deployments,
      rpcUrls,
      readDeploymentVaultTotals,
    );
  } catch (error) {
    failures.push(error);
  }
  for (const deployment of deployments) {
    try {
      const index = (event: ScanEvent) =>
        ingestPaymentEvent(env, event, new Date(), deployments);
      if (chainFamily(deployment.chain) === "evm")
        await scanEvmPayments(
          env.PAYMENTS_DB,
          deployment,
          rpcUrls[deployment.network],
          index,
        );
      else
        await scanSolanaPayments(
          env.PAYMENTS_DB,
          deployment,
          rpcUrls[deployment.network],
          index,
        );
    } catch (error) {
      failures.push(error);
    }
  }
  return { deployments, rpcUrls, failures };
}
export default {
  async scheduled(_controller: unknown, env: PaymentsWorkerEnvironment) {
    // One failing deployment or step must not stop scanning or payouts elsewhere.
    const { deployments, rpcUrls, failures } = await syncRegistryVaults(env);
    for (const step of [
      () => recoverUncertainAttempts(env),
      () =>
        reconcileFailedAttempts(
          env.PAYMENTS_DB,
          deployments,
          rpcUrls,
          JSON.parse(env.PAYMENT_SOLANA_GENESIS ?? "{}") as Record<
            string,
            string
          >,
        ),
      () => runMonthlyCoordinator(env),
      () => runMonthlyCommitments(env),
      () => runPaymentDispatch(env),
    ]) {
      try {
        await step();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length)
      throw new AggregateError(failures, "Payment worker failures");
  },
};
