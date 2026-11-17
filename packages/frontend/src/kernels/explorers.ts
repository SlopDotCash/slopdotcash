// spec/frontend/views.md, "A project card shows one reward variant per registry policy, and a paid bounty-only program replaces ordinary work on cards"; spec/frontend/projections.md, "Ordinary public payment rows require finalized evidence and a public account"
import type { Chain } from "@repo/settlement/kernels/networks";
import type { AssetKind } from "./assetText.ts";

export interface ExplorerAsset {
  readonly kind: AssetKind;
  readonly network: Chain;
  readonly address: string;
}

const EVM_EXPLORER_ORIGIN = Object.freeze({
  base: "https://basescan.org",
  robinhood: "https://robinhoodchain.blockscout.com",
  ethereum: "https://etherscan.io",
} as const satisfies Record<Exclude<Chain, "solana">, string>);

const TRANSACTION_PREFIX: Readonly<Record<string, string>> = Object.freeze({
  "base-sepolia": "https://sepolia.basescan.org/tx/",
  "base-mainnet": `${EVM_EXPLORER_ORIGIN.base}/tx/`,
  "solana-mainnet": "https://explorer.solana.com/tx/",
  "solana-devnet": "https://explorer.solana.com/tx/",
  "solana-testnet": "https://explorer.solana.com/tx/",
  ethereum: `${EVM_EXPLORER_ORIGIN.ethereum}/tx/`,
  "ethereum-sepolia": "https://sepolia.etherscan.io/tx/",
  "robinhood-mainnet": `${EVM_EXPLORER_ORIGIN.robinhood}/tx/`,
  "robinhood-testnet": "https://explorer.testnet.chain.robinhood.com/tx/",
});

const CLUSTER_SUFFIX: Readonly<Record<string, string>> = Object.freeze({
  "solana-devnet": "?cluster=devnet",
  "solana-testnet": "?cluster=testnet",
});

/** @throws {never} */
export function evmExplorerOrigin(network: string): string {
  return network === "base" || network === "robinhood" ? EVM_EXPLORER_ORIGIN[network] : EVM_EXPLORER_ORIGIN.ethereum;
}

/** @throws {never} */
export function transactionUrl(network: string, id: string | null | undefined): string | undefined {
  const prefix = TRANSACTION_PREFIX[network];
  return id && prefix ? `${prefix}${encodeURIComponent(id)}${CLUSTER_SUFFIX[network] ?? ""}` : undefined;
}

/** @throws {never} */
export function assetUrl({ kind, network, address }: ExplorerAsset): string {
  if (network === "solana") {
    if (kind === "native") return "https://solscan.io/";
    return address.endsWith("pump") ? `https://pump.fun/coin/${address}` : `https://solscan.io/token/${address}`;
  }
  return kind === "native" ? `${evmExplorerOrigin(network)}/` : `${evmExplorerOrigin(network)}/token/${address}`;
}
