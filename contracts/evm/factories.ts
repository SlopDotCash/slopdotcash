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
 * Base's finalized upgrade is recorded in contracts/DEPLOY-MAINNET.md.
 * Project deployments remain exclusively in D1 and are appended after exact
 * finalized owner creation. Other networks need their own finalized review.
 */
export const REVIEWED_EVM_FACTORIES: readonly ReviewedEvmFactory[] = [
  {
    network: "base-mainnet",
    sourceCommit: "208fbf5ba2896d7db6452fa8df83a2e0e7fc1f52",
    codeSha256:
      "afb62459ccdd87d344b8bfa367c8dc49586323316bb8a51f1dfbe753336c0509",
    bindingDelaySeconds: "0",
    identityAuthority: "0x31B87d13f9091bC3b8A5cb6F45C8b3cB99Ed6d70",
    feeRecipient: "0x8f77C37D8650776bFe73c9b12B15209eE15D9b86",
    factory: "0xe51AbF8c6Dbb3Ca6E9AD09F2dc6EF141d7364aAb",
    factoryCodeSha256:
      "afb62459ccdd87d344b8bfa367c8dc49586323316bb8a51f1dfbe753336c0509",
    registrar: "0xd64F35aC87D9a1FB8eBD44e745c24436B606cF60",
    evmUpgrade: {
      authority: "0x2Ad20Afa352Ec70E43A6d0E7794cf305c9Cbe35D",
      vaultImplementation: "0x6A79B8970E980159c362d11F37dC8BFFbF2da027",
      vaultImplementationCodeSha256:
        "112ea2575a1d699cb128105bf5ba7ec78a0e22f8b83051bc2114d60567a5b1e3",
      factoryImplementation: "0x9f27aec70559D8f4CA1A62398e673A25B1cE3e2f",
      factoryImplementationCodeSha256:
        "976208154ce5e58f59d826e58273d917adc226109bf95ab4894b9cf144e4a1dd",
    },
  },
];
