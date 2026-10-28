/**
 * Proposed public terms for slop.cash's own contract bounty (owner decision,
 * 28 October 2026; PRD section 8). These only prefill the owner bounty
 * editor for the platform project. Nothing is published until an authorized
 * owner reviews them and publishes an immutable D1 project revision; the
 * public pages read only that revision.
 */
import {
  isFullAwardSplit,
  SECURITY_FULL_AWARD_SPLIT,
  SECURITY_SPLIT,
  type SecurityBountySplitPolicy,
  type SecurityBountyTerms,
} from "./security-bounty.mjs";

/** The merged `development` commit of the deployed bundled EVM upgrade
 * (contracts/DEPLOY-MAINNET.md). The owner confirms it before publishing. */
export const PLATFORM_BOUNTY_SOURCE_COMMIT =
  "7fdedd3507c3f79217ccc896ace0e0b7472ca092";

const EVM_DEPLOYMENTS = [
  [
    "0xe51AbF8c6Dbb3Ca6E9AD09F2dc6EF141d7364aAb",
    "Factory proxy, runtime SHA-256 afb62459ccdd87d344b8bfa367c8dc49586323316bb8a51f1dfbe753336c0509",
  ],
  [
    "0x9f27aec70559D8f4CA1A62398e673A25B1cE3e2f",
    "Factory implementation, runtime SHA-256 976208154ce5e58f59d826e58273d917adc226109bf95ab4894b9cf144e4a1dd",
  ],
  [
    "0x90C46e3E5be35B1048cD69403d1402Feed1240D8",
    "Vault implementation, runtime SHA-256 155c7ea2fdeeaeccfd6daac64b6105e968c1927092f8761f34090a8b42e15bfc",
  ],
] as const;

/** Mainnet deployments recorded in contracts/DEPLOY-MAINNET.md. Every project
 * vault proxy created by the factory runs the vault implementation above. */
export const PLATFORM_BOUNTY_DEPLOYMENTS: SecurityBountyTerms["scope"]["deployments"] =
  [
    ...(["base-mainnet", "ethereum", "robinhood-mainnet"] as const).flatMap(
      (network) =>
        EVM_DEPLOYMENTS.map(([address, codeIdentity]) => ({
          network,
          address,
          codeIdentity,
        })),
    ),
    {
      network: "solana-mainnet",
      address: "7E5ZRh5y6Xgg7k3kdS75CMiTE2efoq9PqNWR5fCVDavQ",
      codeIdentity:
        "Slop Solana project vault program (contracts/solana/programs)",
    },
  ];

export const PLATFORM_BOUNTY_TEXT = {
  includedAssets: [
    "Slop EVM contracts in contracts/evm/src (project vaults, vault factory, monthly reserve) as deployed on Slop mainnet deployments.",
    "Slop Solana project vault program in contracts/solana/programs (project vaults, monthly reserve) as deployed on Solana mainnet.",
    "ReferralDistributor and any other contract in contracts/ once deployed to a Slop mainnet deployment from reviewed source.",
    "User, contributor, project-owner and bounty vault funds held by those deployments.",
  ],
  excludedDependencies: [
    "Third-party contracts and protocols, including token contracts (USDC), Squads, Sablier, bridges and wallets.",
    "Website, API, worker and other off-chain or frontend-only issues; report them privately without a paid award.",
    "Testnet-only and local deployments, and contracts not deployed to a Slop mainnet deployment.",
    "Issues already known to maintainers, already reported, or recorded in public reviews, advisories or issues.",
    "Losses that require a compromised owner, upgrade, identity or fee authority key, or intended owner actions such as withdrawing a vault's own unreserved funds.",
  ],
  testingPermission:
    "Test only on a local chain, local fork or isolated test deployment with synthetic accounts and funds. Never exploit a mainnet deployment, move or freeze anyone's funds, front-run or grief live transactions, expose credentials, disrupt service or publish exploit details. Report privately through the signed-in Slop security report on this page; never open a public issue, pull request or discussion.",
  severityRubric:
    "Paid scope is a distinct critical vulnerability with a reproducible path to loss of funds in an in-scope Slop mainnet deployment, reachable by an attacker without privileged keys. High, medium and low findings, gas optimizations, and theoretical issues without a working proof are welcome as private reports but carry no paid award. The maintainer confirms scope, impact, reproducibility, severity and first qualifying reporter status; automated screening is advisory.",
  lossDefinition:
    "Loss of funds means theft of user, contributor, project-owner or vault funds, or their permanent freezing (funds that can never again be paid out, withdrawn or released by their rightful party), caused by a vulnerability in in-scope Slop contract code. Show the loss safely with synthetic funds and state the attacker prerequisites. Actual loss is not required and must not be induced.",
  exhaustionRule:
    "No fixed award count. Each distinct first qualifying critical finding is considered separately. slop.cash funds approved awards after owner approval, not upfront. The owner may grant the published award or no award. An approved award is not payable until a full-award payment path is approved and released; verified funding alone does not make it payable.",
  dispute:
    "Use the private Slop case appeal path with supporting evidence. Slopbot triages the dispute first; an authorized human moderator decides escalated disputes.",
  disclosure:
    "Keep reports and exploit details confidential until the authorized maintainer approves the exact redacted disclosure and timing in the private case. A fix, an award, a payment or an expired deadline does not authorize publication.",
  safeHarbor:
    "Follow the published safe-testing rules and report in good faith through Slop private reporting. These terms do not authorize access to third-party systems or harmful live testing and promise nothing on behalf of third parties.",
} as const;

/**
 * The split the owner editor starts with. An existing program keeps its own
 * split; a new platform program defaults to the full award. Only the platform
 * project may choose the full award at all.
 */
export function initialSecuritySplit(
  platform: boolean,
  existing: Pick<SecurityBountyTerms, "split"> | undefined,
): SecurityBountySplitPolicy {
  if (existing)
    return platform && isFullAwardSplit(existing.split)
      ? SECURITY_FULL_AWARD_SPLIT
      : SECURITY_SPLIT;
  return platform ? SECURITY_FULL_AWARD_SPLIT : SECURITY_SPLIT;
}

/**
 * Whether the owner editor may offer the full-award split. The project API
 * keeps a registered bounty vault and its network unchanged (it refuses a
 * settlement change with `security_vault_restricted`), and a full-award
 * program cannot bind the 75/25 vault, so a program with a vault keeps 75/25.
 */
export function fullAwardSelectable(
  platform: boolean,
  existing: Pick<SecurityBountyTerms, "settlement"> | undefined,
): boolean {
  return platform && existing?.settlement === undefined;
}

/**
 * Fields of the existing terms carried into the next revision, before the
 * editor overwrites the fields it owns. The funding policy is always chosen
 * again. A registered bounty vault is always carried: the API never accepts
 * its removal, so the full award is refused rather than dropping it.
 */
export function carriedSecurityTerms(
  existing: SecurityBountyTerms | undefined,
  fullAward: boolean,
): Partial<Omit<SecurityBountyTerms, "fundingPolicy">> {
  if (!existing) return {};
  const { fundingPolicy: _fundingPolicy, ...previous } = existing;
  if (fullAward && previous.settlement !== undefined)
    throw new TypeError(
      "A program with a registered bounty vault keeps the 75/25 split",
    );
  return previous;
}
