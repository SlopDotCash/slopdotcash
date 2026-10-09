import { basePaymentAdapter } from "../../backend/payments/base-adapter";
import {
  dispatchPayment,
  type PaymentExecutor,
} from "../../backend/payments/dispatch";
import {
  indexPaymentEvent,
  type PaymentChainAdapter,
} from "../../backend/payments/ledger";
import type { D1Database } from "../../backend/trace/cloudflare-persistence";
import { solanaPaymentAdapter } from "../../contracts/solana/adapter";
import { reconcileFailedAttempts } from "./reconcile";
import { scanBasePayments, scanSolanaPayments } from "./scanner";

export interface PaymentDeployment {
  projectId: string;
  network: string;
  chain: "base" | "solana";
  vault: string;
  programId?: string;
  projectPda?: string;
  asset: string;
  owner: string;
  identityAuthority: string;
  feeRecipient: string;
  codeSha256: string;
  bindingDelaySeconds: string;
  upgradeAuthority: string | null;
  networkDomain?: string;
  chainId?: string;
  deploymentTransaction?: string;
}
export interface PaymentsWorkerEnvironment {
  PAYMENTS_DB: D1Database;
  /** Generated only from reviewed project settlement manifests, not a second inventory. */
  PAYMENT_DEPLOYMENTS: string;
  PAYMENT_RPC_URLS: string;
  PAYMENT_SOLANA_GENESIS?: string;
  /** A separate restricted execution service; no signer secrets in this worker. */
  BASE_PAYMENT_EXECUTOR?: { fetch(request: Request): Promise<Response> };
  SOLANA_PAYMENT_EXECUTOR?: { fetch(request: Request): Promise<Response> };
}
export async function recoverUncertainAttempts(
  env: PaymentsWorkerEnvironment,
): Promise<void> {
  const row = await env.PAYMENTS_DB.prepare(
    "SELECT json_group_array(json_object('idempotencyKey',a.id,'obligationId',o.id,'network',o.network,'vault',o.vault,'chain',o.chain)) items FROM payment_attempts a JOIN payment_obligations o ON o.id=a.obligation_id WHERE a.state IN ('unknown','prepared') AND a.transaction_id IS NULL AND o.state='reserved'",
  ).first<{ items: string }>();
  for (const attempt of JSON.parse(row?.items ?? "[]") as {
    idempotencyKey: string;
    obligationId: string;
    network: string;
    vault: string;
    chain: string;
  }[]) {
    const service =
      attempt.chain === "base"
        ? env.BASE_PAYMENT_EXECUTOR
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
    const status = (await response.json()) as { transactionId: unknown };
    if (status.transactionId === null) {
      const successor = await env.PAYMENTS_DB.prepare(
        "SELECT w.id FROM payment_attempts a JOIN wallet_claims old ON old.id=a.claim_id JOIN wallet_claims w ON w.github_user_id=old.github_user_id AND w.chain=old.chain JOIN payment_wallet_authorizations consent ON consent.claim_id=w.id WHERE a.id=? AND w.id!=old.id AND NOT EXISTS(SELECT 1 FROM wallet_claims next WHERE next.supersedes_claim_id=w.id)",
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
          env.PAYMENTS_DB.prepare(
            "UPDATE payment_outbox SET state='ready',lease_token=NULL,lease_until=NULL,updated_at=? WHERE obligation_id=? AND state!='paid'",
          ).bind(new Date().toISOString(), attempt.obligationId),
        ]);
        continue;
      }
      if (outcome.retired !== false)
        throw new Error("Invalid retirement result");
      status.transactionId = outcome.transactionId;
    }
    if (typeof status.transactionId !== "string" || !status.transactionId)
      throw new Error("Invalid attempt transaction identity");
    await env.PAYMENTS_DB.batch([
      env.PAYMENTS_DB.prepare(
        "UPDATE payment_attempts SET transaction_id=?,state='submitted' WHERE id=? AND transaction_id IS NULL AND state IN ('unknown','prepared')",
      ).bind(status.transactionId, attempt.idempotencyKey),
      env.PAYMENTS_DB.prepare(
        "UPDATE payment_outbox SET state='submitted',lease_token=NULL,lease_until=NULL,updated_at=? WHERE obligation_id=? AND state!='paid'",
      ).bind(new Date().toISOString(), attempt.obligationId),
    ]);
  }
}
function executor(env: PaymentsWorkerEnvironment): PaymentExecutor {
  return {
    async submit(input) {
      const deployments = JSON.parse(
        env.PAYMENT_DEPLOYMENTS,
      ) as PaymentDeployment[];
      const matched = deployments.filter(
        (d) => d.network === input.network && d.vault === input.vault,
      );
      if (matched.length !== 1)
        throw new Error("Reviewed execution deployment unavailable");
      const service =
        matched[0].chain === "base"
          ? env.BASE_PAYMENT_EXECUTOR
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
  if (!env.BASE_PAYMENT_EXECUTOR && !env.SOLANA_PAYMENT_EXECUTOR)
    throw new Error("Payment execution service unavailable");
  const rows = await env.PAYMENTS_DB.prepare(
    "SELECT json_group_array(obligation_id) ids FROM (SELECT obligation_id FROM payment_outbox WHERE state='ready' OR (state='processing' AND lease_until<?) ORDER BY updated_at LIMIT 50)",
  )
    .bind(now.toISOString())
    .first<{ ids: string }>();
  const failures: unknown[] = [];
  for (const id of JSON.parse(rows?.ids ?? "[]") as string[]) {
    try {
      await dispatchPayment(env.PAYMENTS_DB, executor(env), id, now);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length)
    throw new AggregateError(failures, "Payment dispatch failures");
}
export interface PaymentEventMessage {
  projectId: string;
  network?: string;
  transactionId: string;
  eventIndex: number;
  kind: "reserved" | "paid";
  obligationId: string;
}
export async function ingestPaymentEvent(
  env: PaymentsWorkerEnvironment,
  message: PaymentEventMessage,
  now = new Date(),
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
  const deployments = JSON.parse(
    env.PAYMENT_DEPLOYMENTS,
  ) as PaymentDeployment[];
  const matches = deployments.filter(
    (d) =>
      d.projectId === message.projectId &&
      (message.network === undefined || d.network === message.network),
  );
  if (matches.length !== 1)
    throw new Error("Reviewed deployment unavailable or ambiguous");
  const deployment = matches[0];
  if (
    !(deployment.chain === "base" ? /^0x[0-9a-f]{64}$/ : /^[0-9a-f]{64}$/).test(
      message.obligationId,
    )
  )
    throw new Error("Noncanonical obligation identity");
  const rpcUrls = JSON.parse(env.PAYMENT_RPC_URLS) as Record<string, string>;
  const rpcUrl = rpcUrls[deployment.network];
  if (!rpcUrl) throw new Error("Private RPC configuration unavailable");
  let adapter: PaymentChainAdapter;
  if (deployment.chain === "base" && deployment.chainId) {
    adapter = basePaymentAdapter(env.PAYMENTS_DB, {
      ...deployment,
      rpcUrl,
      chainId: BigInt(deployment.chainId),
    });
  } else if (
    deployment.chain === "solana" &&
    deployment.programId &&
    deployment.projectPda &&
    deployment.asset &&
    deployment.networkDomain
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
    });
  } else throw new Error("Reviewed chain deployment incomplete");
  await indexPaymentEvent(env.PAYMENTS_DB, adapter, message, now.toISOString());
}
export default {
  async scheduled(_controller: unknown, env: PaymentsWorkerEnvironment) {
    const deployments = JSON.parse(
      env.PAYMENT_DEPLOYMENTS,
    ) as PaymentDeployment[];
    const rpcUrls = JSON.parse(env.PAYMENT_RPC_URLS) as Record<string, string>;
    // One failing deployment or step must not stop scanning or payouts elsewhere.
    const failures: unknown[] = [];
    for (const deployment of deployments) {
      try {
        if (deployment.chain === "base")
          await scanBasePayments(
            env.PAYMENTS_DB,
            deployment,
            rpcUrls[deployment.network],
            (event) => ingestPaymentEvent(env, event),
          );
        else
          await scanSolanaPayments(
            env.PAYMENTS_DB,
            deployment,
            rpcUrls[deployment.network],
            (event) => ingestPaymentEvent(env, event),
          );
      } catch (error) {
        failures.push(error);
      }
    }
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
  async queue(
    batch: {
      messages: { body: PaymentEventMessage; ack(): void; retry(): void }[];
    },
    env: PaymentsWorkerEnvironment,
  ) {
    for (const message of batch.messages) {
      try {
        await ingestPaymentEvent(env, message.body);
        message.ack();
      } catch {
        message.retry();
      }
    }
  },
};
