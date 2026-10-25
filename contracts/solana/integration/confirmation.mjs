import anchor from "@coral-xyz/anchor";
import {
  Connection,
  TransactionExpiredBlockheightExceededError,
  TransactionExpiredTimeoutError,
} from "@solana/web3.js";

/** Test confirmation uses the exact receipt, without depending on notifications. */
export class ReceiptConnection extends Connection {
  async confirmTransaction(strategy, commitment) {
    const level = commitment ?? this.commitment ?? "finalized";
    if (level !== "confirmed" && level !== "finalized")
      throw new Error(
        "The integration requires confirmed or finalized receipts",
      );
    const signature =
      typeof strategy === "string" ? strategy : strategy.signature;
    if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature))
      throw new Error("Invalid confirmation signature");
    const heightBound = typeof strategy !== "string";
    if (heightBound && !Number.isSafeInteger(strategy.lastValidBlockHeight))
      throw new Error("The integration requires a blockheight expiry bound");
    // Keep web3.js's existing legacy deadlines. Blockheight strategies retain
    // their signed expiry and caller abort signal, without a new wait window.
    const timeoutMs = level === "confirmed" ? 30_000 : 60_000;
    const signal = heightBound
      ? strategy.abortSignal
      : AbortSignal.timeout(timeoutMs);
    let requestId = 0;
    const read = async (method, params) => {
      signal?.throwIfAborted();
      const id = ++requestId;
      const response = await fetch(this.rpcEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal,
      });
      if (!response.ok) throw new Error("Receipt confirmation RPC unavailable");
      const body = await response.json();
      if (body.id !== id || body.error || !("result" in body))
        throw new Error("Receipt confirmation RPC failed");
      return body.result;
    };
    const receipt = async () => {
      const value = await read("getTransaction", [
        signature,
        { commitment: level, maxSupportedTransactionVersion: 0 },
      ]);
      if (value === null) return null;
      if (
        value.transaction?.signatures?.[0] !== signature ||
        !Number.isSafeInteger(value.slot) ||
        !value.meta ||
        !("err" in value.meta) ||
        (heightBound &&
          value.transaction.message.recentBlockhash !== strategy.blockhash)
      )
        throw new Error(
          "Confirmation receipt does not match the signed attempt",
        );
      return { context: { slot: value.slot }, value: { err: value.meta.err } };
    };
    try {
      while (true) {
        const observed = await receipt();
        if (observed) return observed;
        if (
          heightBound &&
          (await read("getBlockHeight", [{ commitment: level }])) >
            strategy.lastValidBlockHeight
        ) {
          // A receipt can appear between the first read and the height read.
          const finalRead = await receipt();
          if (finalRead) return finalRead;
          throw new TransactionExpiredBlockheightExceededError(signature);
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    } catch (error) {
      if (signal?.aborted) {
        if (!heightBound)
          throw new TransactionExpiredTimeoutError(signature, timeoutMs / 1000);
        // Do not expose TimeoutError: Anchor treats that name as permission
        // to submit again. A caller abort remains a terminal confirmation error.
        const aborted = new Error("Transaction confirmation aborted");
        aborted.name = "AbortError";
        throw aborted;
      }
      throw error;
    }
  }
}

export function receiptProvider() {
  const provider = anchor.AnchorProvider.env();
  return new anchor.AnchorProvider(
    new ReceiptConnection(
      provider.connection.rpcEndpoint,
      provider.opts.commitment,
    ),
    provider.wallet,
    provider.opts,
  );
}
