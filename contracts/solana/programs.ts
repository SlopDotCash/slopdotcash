import type { EscrowDeployment } from "../../src/lib/escrow-policy.mjs";
import type { SolanaProgramConfig } from "./adapter";

/** Public infrastructure only. Project vaults are registered in D1 after creation. */
export type ReviewedSolanaProgram = Pick<
  EscrowDeployment,
  "network" | "sourceCommit"
> &
  Omit<SolanaProgramConfig, "rpcUrl" | "genesisHash" | "executedAtSlot">;

/**
 * Owner-approved Token-2022 upgrade at slot 462466131; code and Config verified.
 * This pin permits owner setup only on configured networks; it does not enable
 * wallet binding, attester signing, payments or a keeper.
 */
export const REVIEWED_SOLANA_PROGRAMS: readonly ReviewedSolanaProgram[] = [
  {
    network: "solana-mainnet",
    sourceCommit: "c9564479a65523756fd2998e04d192be3f88579a",
    programId: "7E5ZRh5y6Xgg7k3kdS75CMiTE2efoq9PqNWR5fCVDavQ",
    codeSha256:
      "f250228d87493c024737de9dea4290ed0d28ed777eaddf17b874d493b77274a6",
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
