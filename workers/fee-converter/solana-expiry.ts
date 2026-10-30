import { sha256 } from "@noble/hashes/sha2.js";
/** Owner-approved #905 policy: two independent, history-qualified RPC observations. */
export type RecoveryRpc = <T>(method: string, params: unknown[]) => Promise<T>;
const MAINNET = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export interface CoverageBlock {
  slot: number;
  blockhash: string;
  previousBlockhash: string;
  parentSlot: number;
  signatureCount: number;
  signaturesSha256: string;
}
export interface ExpiryCoverage {
  txId: string;
  operator: string;
  blockhash: string;
  blockhashSlot: number;
  tipSlot: number;
  tipHash: string;
  nextSlot: number;
  expectedHash: string;
  blocks: number;
  digest: string;
  complete: boolean;
  revision: number;
}
/** Both retained complete histories must describe the same finalized chain. */
export function matchingCompletedCoverage(
  a?: ExpiryCoverage,
  b?: ExpiryCoverage,
): boolean {
  return (
    !!a?.complete &&
    !!b?.complete &&
    a.blocks > 0 &&
    a.txId === b.txId &&
    a.blockhash === b.blockhash &&
    a.blockhashSlot === b.blockhashSlot &&
    a.tipSlot === b.tipSlot &&
    a.tipHash === b.tipHash &&
    a.blocks === b.blocks &&
    a.digest === b.digest
  );
}
export interface ExpiryCoverageStore {
  read(txId: string, operator: string): Promise<ExpiryCoverage | null>;
  save(
    previous: ExpiryCoverage | null,
    next: ExpiryCoverage,
    page: CoverageBlock[],
  ): Promise<void>;
}
function digest(value: unknown) {
  return Array.from(
    sha256(new TextEncoder().encode(JSON.stringify(value))),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
interface HistoryBlock {
  blockhash: string;
  previousBlockhash: string;
  parentSlot: number;
  signatures: string[];
}
const blockOptions = {
  commitment: "finalized",
  transactionDetails: "signatures",
  rewards: false,
  maxSupportedTransactionVersion: 0,
};
function completeBlock(block: HistoryBlock | null): block is HistoryBlock {
  return (
    block !== null &&
    typeof block.blockhash === "string" &&
    block.blockhash.length > 0 &&
    typeof block.previousBlockhash === "string" &&
    block.previousBlockhash.length > 0 &&
    slot(block.parentSlot) &&
    Array.isArray(block.signatures) &&
    block.signatures.every((s) => typeof s === "string")
  );
}
export interface ExpiryProof {
  txId: string;
  blockhash: string;
  blockhashSlot: number;
  providers: {
    operator: string;
    firstAvailableSlot: number;
    finalizedContextSlot: number;
    signatureContextSlot: number;
    coverage?: ExpiryCoverage;
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
  store?: ExpiryCoverageStore,
  expectedGenesis = MAINNET,
): Promise<ExpiryProof | null> {
  if (
    !slot(blockhashSlot) ||
    providers.length !== 2 ||
    providers[0].operator === providers[1].operator
  )
    return null;
  const observations: ExpiryProof["providers"] = [];
  let horizonSlot: number | undefined, horizonHash: string | undefined;
  let allComplete = true;
  for (const provider of providers) {
    if ((await provider.rpc("getGenesisHash", [])) !== expectedGenesis)
      return null;
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
    const previous = (await store?.read(txId, provider.operator)) ?? null;
    if (
      previous &&
      (previous.txId !== txId ||
        previous.operator !== provider.operator ||
        previous.blockhash !== blockhash ||
        previous.blockhashSlot !== blockhashSlot)
    )
      return null;
    horizonSlot ??= previous?.tipSlot ?? expired.context.slot;
    if (
      expired.context.slot < horizonSlot ||
      (previous && previous.tipSlot !== horizonSlot)
    )
      return null;
    const tip = await provider.rpc<HistoryBlock | null>("getBlock", [
      horizonSlot,
      blockOptions,
    ]);
    if (!completeBlock(tip)) return null;
    horizonHash ??= previous?.tipHash ?? tip.blockhash;
    if (
      tip.blockhash !== horizonHash ||
      (previous && previous.tipHash !== horizonHash)
    )
      return null;
    const scan: ExpiryCoverage = previous
      ? { ...previous }
      : {
          txId,
          operator: provider.operator,
          blockhash,
          blockhashSlot,
          tipSlot: horizonSlot,
          tipHash: horizonHash,
          nextSlot: horizonSlot,
          expectedHash: horizonHash,
          blocks: 0,
          digest: digest({
            txId,
            blockhash,
            blockhashSlot,
            horizonSlot,
            horizonHash,
          }),
          complete: false,
          revision: 0,
        };
    const page: CoverageBlock[] = [];
    // Bound each cron's work, but persist the cursor and evidence to finish
    // arbitrarily long retained windows after restart without weakening proof.
    for (let count = 0; !scan.complete && count < 32; count++) {
      const current = scan.nextSlot;
      const block = await provider.rpc<HistoryBlock | null>("getBlock", [
        current,
        blockOptions,
      ]);
      if (
        !completeBlock(block) ||
        block.blockhash !== scan.expectedHash ||
        current < blockhashSlot ||
        block.signatures.includes(txId)
      )
        return null;
      if (current === blockhashSlot) {
        if (block.blockhash !== blockhash) return null;
        scan.complete = true;
      } else if (
        block.parentSlot >= current ||
        block.parentSlot < blockhashSlot
      )
        return null;
      const evidence = {
        slot: current,
        blockhash: block.blockhash,
        previousBlockhash: block.previousBlockhash,
        parentSlot: block.parentSlot,
        signatureCount: block.signatures.length,
        signaturesSha256: digest(block.signatures),
      };
      page.push(evidence);
      scan.digest = digest({ prior: scan.digest, block: evidence });
      scan.blocks++;
      if (!scan.complete) {
        scan.nextSlot = block.parentSlot;
        scan.expectedHash = block.previousBlockhash;
      }
    }
    if (page.length) {
      scan.revision++;
      await store?.save(previous, scan, page);
    }
    if (!scan.complete) allComplete = false;
    observations.push({
      operator: provider.operator,
      firstAvailableSlot: first,
      finalizedContextSlot: expired.context.slot,
      signatureContextSlot: signature.context.slot,
      coverage: scan,
    });
  }
  return allComplete &&
    matchingCompletedCoverage(
      observations[0]?.coverage,
      observations[1]?.coverage,
    )
    ? { txId, blockhash, blockhashSlot, providers: observations }
    : null;
}
