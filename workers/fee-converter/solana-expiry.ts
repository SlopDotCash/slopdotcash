/** Owner-approved #905 policy: two independent, history-qualified RPC observations. */
export type RecoveryRpc = <T>(method: string, params: unknown[]) => Promise<T>;
const MAINNET = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export interface ExpiryProof {
  txId: string;
  blockhash: string;
  blockhashSlot: number;
  providers: {
    operator: string;
    firstAvailableSlot: number;
    finalizedContextSlot: number;
    signatureContextSlot: number;
  }[];
}
export function recoveryOperator(endpoint: string): string | null {
  const url = new URL(endpoint);
  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  if (host === "api.mainnet-beta.solana.com") return "solana-public";
  if (host === "solana-rpc.publicnode.com") return "allnodes-publicnode";
  if (host.endsWith(".alchemy.com")) return "alchemy";
  if (host.endsWith(".helius-rpc.com")) return "helius";
  return null;
}
function slot(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
}
export async function proveSolanaExpiry(
  txId: string,
  blockhash: string,
  blockhashSlot: number,
  providers: readonly { operator: string; rpc: RecoveryRpc }[],
): Promise<ExpiryProof | null> {
  if (
    !slot(blockhashSlot) ||
    providers.length !== 2 ||
    providers[0].operator === providers[1].operator
  )
    return null;
  const observations: ExpiryProof["providers"] = [];
  for (const provider of providers) {
    if ((await provider.rpc("getGenesisHash", [])) !== MAINNET) return null;
    const first = await provider.rpc<number>("getFirstAvailableBlock", []);
    if (!slot(first) || first > blockhashSlot) return null;
    const anchor = await provider.rpc<{ blockhash: string } | null>(
      "getBlock",
      [
        blockhashSlot,
        {
          commitment: "finalized",
          transactionDetails: "none",
          rewards: false,
          maxSupportedTransactionVersion: 0,
        },
      ],
    );
    if (anchor?.blockhash !== blockhash) return null;
    const expired = await provider.rpc<{
      context: { slot: number };
      value: boolean;
    }>("isBlockhashValid", [
      blockhash,
      { commitment: "finalized", minContextSlot: blockhashSlot },
    ]);
    if (
      expired?.value !== false ||
      !slot(expired.context?.slot) ||
      expired.context.slot < blockhashSlot
    )
      return null;
    const signature = await provider.rpc<{
      context: { slot: number };
      value: unknown[];
    }>("getSignatureStatuses", [[txId], { searchTransactionHistory: true }]);
    if (
      !slot(signature?.context?.slot) ||
      signature.context.slot < expired.context.slot ||
      signature.value?.length !== 1 ||
      signature.value[0] !== null
    )
      return null;
    const transaction = await provider.rpc("getTransaction", [
      txId,
      {
        commitment: "finalized",
        encoding: "base64",
        maxSupportedTransactionVersion: 0,
      },
    ]);
    if (transaction !== null) return null;
    observations.push({
      operator: provider.operator,
      firstAvailableSlot: first,
      finalizedContextSlot: expired.context.slot,
      signatureContextSlot: signature.context.slot,
    });
  }
  return { txId, blockhash, blockhashSlot, providers: observations };
}
