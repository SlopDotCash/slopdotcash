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
  authority: "0x2Ad20Afa352Ec70E43A6d0E7794cf305c9Cbe35D",
  vaultImplementation: "0x90C46e3E5be35B1048cD69403d1402Feed1240D8",
  vaultImplementationCodeSha256:
    "155c7ea2fdeeaeccfd6daac64b6105e968c1927092f8761f34090a8b42e15bfc",
  factoryImplementation: "0x9f27aec70559D8f4CA1A62398e673A25B1cE3e2f",
  factoryImplementationCodeSha256:
    "976208154ce5e58f59d826e58273d917adc226109bf95ab4894b9cf144e4a1dd",
};

export const REVIEWED_EVM_FACTORIES: readonly ReviewedEvmFactory[] = [
  {
    network: "base-mainnet",
    sourceCommit: SOURCE_COMMIT,
    codeSha256: VAULT_PROXY_CODE_SHA256,
    bindingDelaySeconds: "0",
    identityAuthority: "0x31B87d13f9091bC3b8A5cb6F45C8b3cB99Ed6d70",
    feeRecipient: "0x8f77C37D8650776bFe73c9b12B15209eE15D9b86",
    factory: "0xe51AbF8c6Dbb3Ca6E9AD09F2dc6EF141d7364aAb",
    factoryCodeSha256: VAULT_PROXY_CODE_SHA256,
    registrar: "0xd64F35aC87D9a1FB8eBD44e745c24436B606cF60",
    evmUpgrade: MONTHLY_RESERVE_V2,
  },
  {
    network: "ethereum",
    sourceCommit: SOURCE_COMMIT,
    codeSha256: VAULT_PROXY_CODE_SHA256,
    bindingDelaySeconds: "0",
    identityAuthority: "0x31B87d13f9091bC3b8A5cb6F45C8b3cB99Ed6d70",
    feeRecipient: "0x8f77C37D8650776bFe73c9b12B15209eE15D9b86",
    factory: "0xe51AbF8c6Dbb3Ca6E9AD09F2dc6EF141d7364aAb",
    factoryCodeSha256: VAULT_PROXY_CODE_SHA256,
    registrar: "0xd64F35aC87D9a1FB8eBD44e745c24436B606cF60",
    evmUpgrade: MONTHLY_RESERVE_V2,
  },
  {
    network: "robinhood-mainnet",
    sourceCommit: SOURCE_COMMIT,
    codeSha256: VAULT_PROXY_CODE_SHA256,
    bindingDelaySeconds: "0",
    identityAuthority: "0x31B87d13f9091bC3b8A5cb6F45C8b3cB99Ed6d70",
    feeRecipient: "0x8f77C37D8650776bFe73c9b12B15209eE15D9b86",
    factory: "0xe51AbF8c6Dbb3Ca6E9AD09F2dc6EF141d7364aAb",
    factoryCodeSha256: VAULT_PROXY_CODE_SHA256,
    registrar: "0xd64F35aC87D9a1FB8eBD44e745c24436B606cF60",
    evmUpgrade: MONTHLY_RESERVE_V2,
  },
];
