// spec/settlement/ownerTransactions.md, "A request is reviewed against current authority and becomes a fixed plan"
import type { NetworkKey } from "../../kernels/networks.ts";

export interface ReviewedSolanaProgram {
  readonly network: NetworkKey;
  readonly sourceCommit: string;
  readonly programId: string;
  readonly codeSha256: string;
  readonly upgradeAuthority: string;
  readonly identityAuthority: string;
  readonly feeRecipient: string;
  readonly rotationAuthority: string;
  readonly networkDomain: string;
  readonly bindingDelaySeconds: bigint;
  readonly rotationDelaySeconds: bigint;
}

export const REVIEWED_SOLANA_PROGRAMS: ReadonlyArray<ReviewedSolanaProgram> = [
  {
    network: "solana-mainnet",
    sourceCommit: "c9564479a65523756fd2998e04d192be3f88579a",
    programId: "7E5ZRh5y6Xgg7k3kdS75CMiTE2efoq9PqNWR5fCVDavQ",
    codeSha256: "f250228d87493c024737de9dea4290ed0d28ed777eaddf17b874d493b77274a6",
    upgradeAuthority: "EmMRRFhjZmr2SN5RdhV98WPnUhgJxKMoE1itSwUsU8tr",
    identityAuthority: "Eq6tYrPnkhj3hLmSZUL9xUWjkZ3Y5j3naBAJyQyKMYzS",
    feeRecipient: "9EyxVhhnCJH4QL5bDsRyukrkHFyitFMuf45UDdLxm4BY",
    rotationAuthority: "2tAA47aavW2mqtCAxbn21ZqLb8xZTeq8XvkRR9emduiy",
    networkDomain: "9153d7c5242e94d5db756dc24bb60b5eca792c7bc7b9e847c05c9ce004b66a8f",
    bindingDelaySeconds: 0n,
    rotationDelaySeconds: 0n,
  },
];
