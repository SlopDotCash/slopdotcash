import type { EscrowDeployment } from "../../src/lib/escrow-policy.mjs";
import type { SolanaProgramConfig } from "./adapter";

/** Public infrastructure only. Project vaults are registered in D1 after creation. */
export type ReviewedSolanaProgram = Pick<
  EscrowDeployment,
  "network" | "sourceCommit"
> &
  Omit<SolanaProgramConfig, "rpcUrl" | "genesisHash" | "executedAtSlot">;

/**
 * #901 finalized upgrade at slot 461493344, independently verified code and Config.
 * This pin permits owner setup only on configured networks; it does not enable
 * wallet binding, attester signing, payments or a keeper.
 */
export const REVIEWED_SOLANA_PROGRAMS: readonly ReviewedSolanaProgram[] = [
  {
    network: "solana-mainnet",
    sourceCommit: "83827c042c7f28479f7d6a959d7ee5a64652fe85",
    programId: "7E5ZRh5y6Xgg7k3kdS75CMiTE2efoq9PqNWR5fCVDavQ",
    codeSha256:
      "38c8d776e9d4d763f16c834d76aa0497ba1c3f2a3b8bbe17a60067268782005d",
    upgradeAuthority: "EmMRRFhjZmr2SN5RdhV98WPnUhgJxKMoE1itSwUsU8tr",
    identityAuthority: "Eq6tYrPnkhj3hLmSZUL9xUWjkZ3Y5j3naBAJyQyKMYzS",
    feeRecipient: "9EyxVhhnCJH4QL5bDsRyukrkHFyitFMuf45UDdLxm4BY",
    rotationAuthority: "2tAA47aavW2mqtCAxbn21ZqLb8xZTeq8XvkRR9emduiy",
    // New mainnet projects use SHA-256("slop-escrow:solana-mainnet").
    // Existing project domains remain pinned by their D1 deployment.
    networkDomain:
      "9153d7c5242e94d5db756dc24bb60b5eca792c7bc7b9e847c05c9ce004b66a8f",
    bindingDelaySeconds: "0",
    rotationDelaySeconds: "0",
  },
];
