import { isFundingAddress, isSolanaTransactionId } from "./funding-address.mjs";

/** Technical network definitions only. Projects and deployments live in project.json. */
export const ESCROW_NETWORKS = Object.freeze({
  "base-sepolia": {
    chain: "base",
    testnet: true,
    chainId: "84532",
    asset: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  },
  "base-mainnet": {
    chain: "base",
    testnet: false,
    chainId: "8453",
    asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  },
  "solana-devnet": {
    chain: "solana",
    testnet: true,
    asset: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  },
  "solana-testnet": { chain: "solana", testnet: true, asset: null },
  "solana-mainnet": {
    chain: "solana",
    testnet: false,
    asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  },
});
/** Production destination bindings activate no sooner than 48 hours. */
export const MIN_PRODUCTION_BINDING_DELAY = 48 * 60 * 60;
function keys(value, expected) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join() !== expected.sort().join()
  )
    throw new TypeError("Invalid escrow policy fields");
}
export function assertEscrowPolicy(value) {
  keys(value, [
    "schemaVersion",
    "effectiveCycle",
    "chain",
    "feeBasisPoints",
    "withdrawalFeeBasisPoints",
    "feeMode",
    "deployments",
  ]);
  if (
    value.schemaVersion !== "1" ||
    !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value.effectiveCycle) ||
    !["base", "solana"].includes(value.chain) ||
    value.feeBasisPoints !== 200 ||
    value.withdrawalFeeBasisPoints !== 1000 ||
    value.feeMode !== "deduct-from-gross" ||
    !Array.isArray(value.deployments)
  )
    throw new TypeError("Invalid escrow chain or fee policy");
  const networks = new Set();
  for (const deployment of value.deployments) {
    keys(deployment, [
      "network",
      "vault",
      "programId",
      "upgradeAuthority",
      "projectPda",
      "networkDomain",
      "asset",
      "owner",
      "identityAuthority",
      "feeRecipient",
      "deploymentTransaction",
      "sourceCommit",
      "codeSha256",
      "bindingDelaySeconds",
    ]);
    const network = ESCROW_NETWORKS[deployment.network];
    if (
      !network ||
      network.chain !== value.chain ||
      networks.has(deployment.network)
    )
      throw new TypeError("A project has one chain and one escrow per network");
    networks.add(deployment.network);
    if (
      ![
        deployment.vault,
        deployment.asset,
        deployment.owner,
        deployment.identityAuthority,
        deployment.feeRecipient,
      ].every((address) => isFundingAddress(value.chain, address))
    )
      throw new TypeError("Invalid escrow address");
    if (
      (network.asset && deployment.asset !== network.asset) ||
      (value.chain === "base"
        ? deployment.programId !== null ||
          deployment.upgradeAuthority !== null ||
          deployment.projectPda !== null ||
          deployment.networkDomain !== null
        : (deployment.upgradeAuthority !== null &&
            !isFundingAddress("solana", deployment.upgradeAuthority)) ||
          !isFundingAddress("solana", deployment.programId) ||
          !isFundingAddress("solana", deployment.projectPda) ||
          !/^[0-9a-f]{64}$/.test(deployment.networkDomain))
    )
      throw new TypeError("Escrow asset or program does not match the network");
    if (
      deployment.network === "solana-mainnet" &&
      deployment.upgradeAuthority !== null
    )
      throw new TypeError(
        "Production Solana escrow requires revoked upgrade authority before activation",
      );
    // A new or rotated destination binding waits this long before it can pay,
    // so the owner can cancel a binding made with a stolen identity key.
    if (
      typeof deployment.bindingDelaySeconds !== "string" ||
      !/^(0|[1-9][0-9]{0,9})$/.test(deployment.bindingDelaySeconds) ||
      (!network.testnet &&
        Number(deployment.bindingDelaySeconds) < MIN_PRODUCTION_BINDING_DELAY)
    )
      throw new TypeError(
        "Escrow binding delay is missing or below the production minimum",
      );
    if (
      deployment.owner === deployment.identityAuthority ||
      deployment.vault === deployment.owner ||
      deployment.vault === deployment.feeRecipient ||
      deployment.vault === deployment.identityAuthority
    )
      throw new TypeError("Escrow authorities must have separate roles");
    if (
      !/^[0-9a-f]{40}$/.test(deployment.sourceCommit) ||
      !/^[0-9a-f]{64}$/.test(deployment.codeSha256) ||
      !(value.chain === "base"
        ? /^0x[0-9a-f]{64}$/.test(deployment.deploymentTransaction)
        : isSolanaTransactionId(deployment.deploymentTransaction))
    )
      throw new TypeError(
        "Escrow deployment requires immutable source and transaction evidence",
      );
  }
  return value;
}
export function assertEscrowTransition(previous, next) {
  if (!previous) return;
  if (
    !next ||
    previous.chain !== next.chain ||
    previous.effectiveCycle !== next.effectiveCycle ||
    previous.feeMode !== next.feeMode ||
    previous.feeBasisPoints !== next.feeBasisPoints ||
    previous.withdrawalFeeBasisPoints !== next.withdrawalFeeBasisPoints
  )
    throw new TypeError(
      "An escrow project's settlement chain and fee policy cannot change",
    );
  for (const deployment of previous.deployments) {
    const successor = next.deployments.find(
      (candidate) => candidate.network === deployment.network,
    );
    if (
      !successor ||
      Object.keys(deployment).some((key) => deployment[key] !== successor[key])
    )
      throw new TypeError("Historical escrow deployments are immutable");
  }
}
