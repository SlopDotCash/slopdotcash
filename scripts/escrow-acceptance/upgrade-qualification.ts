/** The upgrade qualification record shared by its verification and payment reconciliation. */
import type { VaultStorage } from "../../contracts/evm/integration/upgrade";
import type { StepRecord } from "./shared";

export const UPGRADE_SCHEMA = "slop-escrow-upgrade-qualification:v1";

export interface VaultRecord extends VaultStorage {
  vault: string;
  observedAtBlock: string;
  implementation: string;
  codeSha256: string;
}

export interface PlannedTransaction {
  key: string;
  to: string;
  data: string;
  signer: "upgrade-authority";
  purpose: string;
}

export interface Qualification {
  schema: typeof UPGRADE_SCHEMA;
  network: string;
  mode: "public-testnet" | "local";
  rpcHost: string;
  chainId: string;
  sourceCommit: string;
  factory: string;
  plannedAt: string;
  plannedAtBlock: string;
  factoryDeploymentBlock: string;
  notice: string;
  roles: Record<string, string>;
  before: {
    factoryCodeSha256: string;
    factoryImplementation: string;
    factoryImplementationCodeSha256: string;
    vaultImplementation: string;
    vaultImplementationCodeSha256: string;
    factorySlots: string[];
    factoryInitialized: string;
    vaults: VaultRecord[];
  };
  review: {
    salt: string;
    create2Deployer: string;
    vaultImplementation: string;
    vaultImplementationCodeSha256: string;
    factoryImplementation: string;
    factoryImplementationCodeSha256: string;
  };
  transactions: PlannedTransaction[];
  steps: Record<string, StepRecord>;
  stragglers: string[];
  verification: Record<string, unknown> | null;
  status:
    | "planned"
    | "executing"
    | "waiting"
    | "executed"
    | "passed"
    | "failed";
  /** One entry per command run: a refused or failed attempt stays on record. */
  history: { command: string; at: string; status: string; error?: string }[];
}
