import type { D1Database } from "../../backend/trace/cloudflare-persistence";
import { chainFamily } from "../../src/lib/escrow-policy.mjs";
import type { PaymentDeployment } from "./index";

async function rpc(
  url: string,
  method: string,
  params: unknown[],
): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error("Reconciliation RPC unavailable");
  const body = (await response.json()) as { error?: unknown; result?: unknown };
  if (body.error || !("result" in body))
    throw new Error("Reconciliation RPC failed");
  return body.result;
}
/** Reuse the same canonical finalized-revert proof for payout and binding retries. */
export async function finalizedEvmRevert(
  url: string,
  chainId: string | undefined,
  transactionId: string,
  chain: string,
) {
  if (
    !chainId ||
    BigInt((await rpc(url, "eth_chainId", [])) as string) !== BigInt(chainId)
  )
    throw new Error("Reconciliation chain mismatch");
  const receipt = (await rpc(url, "eth_getTransactionReceipt", [
    transactionId,
  ])) as {
    status: string;
    transactionHash: string;
    blockHash: string;
    blockNumber: string;
  } | null;
  if (receipt?.status !== "0x0") return null;
  const head = (await rpc(url, "eth_getBlockByNumber", [
    "finalized",
    false,
  ])) as { number: string } | null;
  const block = (await rpc(url, "eth_getBlockByNumber", [
    receipt.blockNumber,
    false,
  ])) as { hash: string } | null;
  if (
    !head ||
    !block ||
    BigInt(receipt.blockNumber) > BigInt(head.number) ||
    receipt.transactionHash.toLowerCase() !== transactionId.toLowerCase() ||
    receipt.blockHash !== block.hash
  )
    return null;
  return {
    chain,
    transactionId,
    blockHash: block.hash,
    status: "reverted",
    finality: "finalized",
  };
}

/** Finalized reverted transactions are safe to retry with a fresh attempt. Missing
 * receipts and uncertain submissions remain held; absence is not failure proof. */
export async function reconcileFailedAttempts(
  db: D1Database,
  deployments: PaymentDeployment[],
  rpcUrls: Record<string, string>,
  genesisHashes: Record<string, string> = {},
  now = new Date(),
): Promise<void> {
  const result = await db
    .prepare(
      "SELECT json_group_array(json_object('id',a.id,'obligationId',o.id,'network',o.network,'vault',o.vault,'transactionId',a.transaction_id)) items FROM payment_attempts a JOIN payment_obligations o ON o.id=a.obligation_id WHERE a.state IN ('submitted','unknown') AND a.transaction_id IS NOT NULL AND o.state='reserved'",
    )
    .first<{ items: string }>();
  // One attempt's failure must not stop reconciliation of the others (PAY-07).
  const failures: unknown[] = [];
  for (const attempt of JSON.parse(result?.items ?? "[]") as {
    id: string;
    obligationId: string;
    network: string;
    vault: string;
    transactionId: string;
  }[]) {
    try {
      const matches = deployments.filter(
        (d) => d.network === attempt.network && d.vault === attempt.vault,
      );
      if (matches.length !== 1)
        throw new Error("Reviewed deployment missing for reconciliation");
      const deployment = matches[0],
        url = rpcUrls[deployment.network];
      let proof: unknown;
      if (chainFamily(deployment.chain) === "evm") {
        proof = await finalizedEvmRevert(
          url,
          deployment.chainId,
          attempt.transactionId,
          deployment.chain,
        );
        if (!proof) continue;
      } else {
        if (
          !genesisHashes[deployment.network] ||
          (await rpc(url, "getGenesisHash", [])) !==
            genesisHashes[deployment.network]
        )
          throw new Error("Reconciliation genesis mismatch");
        const tx = (await rpc(url, "getTransaction", [
          attempt.transactionId,
          { commitment: "finalized", maxSupportedTransactionVersion: 0 },
        ])) as { slot: number; meta: { err: unknown } } | null;
        if (!tx) {
          // A signature the cluster does not know at any commitment was dropped,
          // and nothing else would retry it. Return the same attempt to dispatch:
          // the executor rebroadcasts its journaled bytes, and signs a replacement
          // only after finalized blockhash expiry. Absence is not failure proof,
          // so no failure is recorded and the attempt is kept.
          const status = (await rpc(url, "getSignatureStatuses", [
            [attempt.transactionId],
            { searchTransactionHistory: true },
          ])) as { value?: unknown[] } | null;
          if (!Array.isArray(status?.value) || status.value.length !== 1)
            throw new Error("Invalid signature status response");
          if (status.value[0] !== null) continue;
          await db
            .prepare(
              "UPDATE payment_outbox SET state='ready',updated_at=?,lease_token=NULL,lease_until=NULL WHERE obligation_id=? AND state='submitted' AND EXISTS(SELECT 1 FROM payment_obligations WHERE id=? AND state='reserved')",
            )
            .bind(now.toISOString(), attempt.obligationId, attempt.obligationId)
            .run();
          continue;
        }
        if (!tx.meta?.err) continue;
        proof = {
          chain: "solana",
          transactionId: attempt.transactionId,
          slot: tx.slot,
          error: tx.meta.err,
          finality: "finalized",
        };
      }
      await db.batch([
        db
          .prepare(
            "INSERT INTO payment_attempt_failures VALUES(?,?,?,?) ON CONFLICT(attempt_id) DO NOTHING",
          )
          .bind(
            attempt.id,
            attempt.transactionId,
            now.toISOString(),
            JSON.stringify(proof),
          ),
        db
          .prepare(
            "UPDATE payment_attempts SET state='failed' WHERE id=? AND state IN ('submitted','unknown')",
          )
          .bind(attempt.id),
        db
          .prepare(
            "UPDATE payment_outbox SET state='ready',updated_at=?,lease_token=NULL,lease_until=NULL WHERE obligation_id=? AND state IN ('submitted','held') AND EXISTS(SELECT 1 FROM payment_obligations WHERE id=? AND state='reserved')",
          )
          .bind(now.toISOString(), attempt.obligationId, attempt.obligationId),
      ]);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length)
    throw new AggregateError(failures, "Payment reconciliation failures");
}
