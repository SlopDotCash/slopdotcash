import type { EscrowDeployment } from "../../src/lib/escrow-policy.mjs";
import type { EvmImplementationReview } from "./adapter";

/** Public network infrastructure, not a project or payment inventory. */
export type ReviewedEvmFactory = Pick<
  EscrowDeployment,
  | "network"
  | "sourceCommit"
  | "codeSha256"
  | "bindingDelaySeconds"
  | "identityAuthority"
  | "feeRecipient"
> & {
  factory: string;
  factoryCodeSha256: string;
  registrar: string;
  evmUpgrade: EvmImplementationReview;
};

/**
 * Add a network only from reviewed, finalized deployment/upgrade evidence.
 * An unsigned upgrade kit or a local fork is not a live implementation pin.
 * The finalized upgrades are recorded in contracts/DEPLOY-MAINNET.md section 4.
 * Project deployments remain exclusively in D1 and are appended after exact
 * finalized owner creation. Each network needs its own finalized review.
 */
/** The merged development commit that contains PR #1271 (DEPLOY-MAINNET.md section 4). */
const SOURCE_COMMIT = "7fdedd3507c3f79217ccc896ace0e0b7472ca092";
/** ERC-1967 proxy runtime, shared by the factory proxy and every vault proxy. */
const VAULT_PROXY_CODE_SHA256 =
  "afb62459ccdd87d344b8bfa367c8dc49586323316bb8a51f1dfbe753336c0509";
/** Section 4.3 implementations, the same CREATE2 addresses on every chain. */
const MONTHLY_RESERVE_V2: EvmImplementationReview = {
  authority: "0x2ad20afa352ec70e43a6d0e7794cf305c9cbe35d",
  vaultImplementation: "0x90c46e3e5be35b1048cd69403d1402feed1240d8",
  vaultImplementationCodeSha256:
    "155c7ea2fdeeaeccfd6daac64b6105e968c1927092f8761f34090a8b42e15bfc",
  factoryImplementation: "0x9f27aec70559d8f4ca1a62398e673a25b1ce3e2f",
  factoryImplementationCodeSha256:
    "976208154ce5e58f59d826e58273d917adc226109bf95ab4894b9cf144e4a1dd",
};

export const REVIEWED_EVM_FACTORIES: readonly ReviewedEvmFactory[] = [
  {
    network: "base-mainnet",
    sourceCommit: SOURCE_COMMIT,
    codeSha256: VAULT_PROXY_CODE_SHA256,
    bindingDelaySeconds: "0",
    identityAuthority: "0x31b87d13f9091bc3b8a5cb6f45c8b3cb99ed6d70",
    feeRecipient: "0x8f77c37d8650776bfe73c9b12b15209ee15d9b86",
    factory: "0xe51abf8c6dbb3ca6e9ad09f2dc6ef141d7364aab",
    factoryCodeSha256: VAULT_PROXY_CODE_SHA256,
    registrar: "0xd64f35ac87d9a1fb8ebd44e745c24436b606cf60",
    evmUpgrade: MONTHLY_RESERVE_V2,
  },
  {
    network: "ethereum",
    sourceCommit: SOURCE_COMMIT,
    codeSha256: VAULT_PROXY_CODE_SHA256,
    bindingDelaySeconds: "0",
    identityAuthority: "0x31b87d13f9091bc3b8a5cb6f45c8b3cb99ed6d70",
    feeRecipient: "0x8f77c37d8650776bfe73c9b12b15209ee15d9b86",
    factory: "0xe51abf8c6dbb3ca6e9ad09f2dc6ef141d7364aab",
    factoryCodeSha256: VAULT_PROXY_CODE_SHA256,
    registrar: "0xd64f35ac87d9a1fb8ebd44e745c24436b606cf60",
    evmUpgrade: MONTHLY_RESERVE_V2,
  },
  {
    network: "robinhood-mainnet",
    sourceCommit: SOURCE_COMMIT,
    codeSha256: VAULT_PROXY_CODE_SHA256,
    bindingDelaySeconds: "0",
    identityAuthority: "0x31b87d13f9091bc3b8a5cb6f45c8b3cb99ed6d70",
    feeRecipient: "0x8f77c37d8650776bfe73c9b12b15209ee15d9b86",
    factory: "0xe51abf8c6dbb3ca6e9ad09f2dc6ef141d7364aab",
    factoryCodeSha256: VAULT_PROXY_CODE_SHA256,
    registrar: "0xd64f35ac87d9a1fb8ebd44e745c24436b606cf60",
    evmUpgrade: MONTHLY_RESERVE_V2,
  },
];
