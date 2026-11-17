// spec/frontend/projections.md, "Ordinary public payment rows require finalized evidence and a public account"
import { assetUrl, type ExplorerAsset, transactionUrl } from "./explorers.ts";
import { vectors } from "./vectors.ts";

export const transactionsLinkToTheirNetworkExplorer = vectors<readonly [string, string | null], string | undefined>([
  [["base-sepolia", "0xab"], "https://sepolia.basescan.org/tx/0xab"],
  [["base-mainnet", "0xab"], "https://basescan.org/tx/0xab"],
  [["solana-mainnet", "5sig"], "https://explorer.solana.com/tx/5sig"],
  [["solana-devnet", "5sig"], "https://explorer.solana.com/tx/5sig?cluster=devnet"],
  [["solana-testnet", "5sig"], "https://explorer.solana.com/tx/5sig?cluster=testnet"],
  [["ethereum", "0xab"], "https://etherscan.io/tx/0xab"],
  [["ethereum-sepolia", "0xab"], "https://sepolia.etherscan.io/tx/0xab"],
  [["robinhood-mainnet", "0xab"], "https://robinhoodchain.blockscout.com/tx/0xab"],
  [["robinhood-testnet", "0xab"], "https://explorer.testnet.chain.robinhood.com/tx/0xab"],
  [["base-mainnet", "a/b"], "https://basescan.org/tx/a%2Fb"],
  [["base-mainnet", null], undefined],
  [["base-mainnet", ""], undefined],
  [["anvil", "0xab"], undefined],
], ([network, id]) => transactionUrl(network, id));

export const assetsLinkToTheirExplorerPage = vectors<ExplorerAsset, string>([
  [{ kind: "native", network: "solana", address: "11111111111111111111111111111111" }, "https://solscan.io/"],
  [{ kind: "token", network: "solana", address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" }, "https://solscan.io/token/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"],
  [{ kind: "token", network: "solana", address: "Abcpump" }, "https://pump.fun/coin/Abcpump"],
  [{ kind: "native", network: "robinhood", address: "0x0000000000000000000000000000000000000000" }, "https://robinhoodchain.blockscout.com/"],
  [{ kind: "token", network: "ethereum", address: "0xabc" }, "https://etherscan.io/token/0xabc"],
], assetUrl);
