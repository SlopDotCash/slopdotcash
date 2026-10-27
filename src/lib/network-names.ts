// Network names only: each amount names its own vault asset.
const NETWORK_LABELS: Record<string, string> = {
  "base-mainnet": "Base",
  "base-sepolia": "Base Sepolia (test)",
  "solana-mainnet": "Solana",
  "solana-devnet": "Solana Devnet (test)",
  "solana-testnet": "Solana Testnet (test)",
  "robinhood-mainnet": "Robinhood Chain",
  "robinhood-testnet": "Robinhood Chain Testnet (test)",
  ethereum: "Ethereum",
  "ethereum-sepolia": "Ethereum Sepolia (test)",
  anvil: "Local EVM test",
};

/** Display name of a registry network; an unlisted id is shown as recorded. */
export function networkLabel(network: string): string {
  return Object.hasOwn(NETWORK_LABELS, network)
    ? NETWORK_LABELS[network]
    : network;
}
