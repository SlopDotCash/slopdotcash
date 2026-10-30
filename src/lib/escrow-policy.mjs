import { isFundingAddress, isSolanaTransactionId } from "./funding-address.mjs";

/** Asset identities for native vaults; never valid substitutes for a wallet. */
export const EVM_NATIVE_ASSET = "0x0000000000000000000000000000000000000000";
export const SOLANA_NATIVE_ASSET = "11111111111111111111111111111111";
export function isNativeAssetAddress(chain, address) {
  return chain === "solana"
    ? address === SOLANA_NATIVE_ASSET
    : ["base", "ethereum", "robinhood"].includes(chain) &&
        address === EVM_NATIVE_ASSET;
}

/** The largest base-unit amount supported by the vault accounting. */
export const MAX_BASE_UNITS = (1n << 128n) - 1n;
export function isBaseUnits(value) {
  return (
    typeof value === "string" &&
    /^(0|[1-9][0-9]{0,38})$/.test(value) &&
    BigInt(value) <= MAX_BASE_UNITS
  );
}

/**
 * Technical network definitions only. Projects and their deployments live in
 * the D1 project registry, one revision per manifest change. `family` selects
 * the adapter, executor and scanner implementation; `chain` is the wallet-claim
 * and consent identity. EVM networks also carry the executor gas ceiling (gas
 * units) and the scanner window (blocks per eth_getLogs page, inclusive), which
 * the generated deployment record copies so hosted workers never assume a value.
 * Solana clusters carry their genesis hash, the RPC identity every check compares.
 *
 * Escrow vaults accept native ETH/SOL and standard ERC-20 or classic SPL mints;
 * a deployment's asset is not limited to the list here. `assets`
 * lists the reference stablecoins each network knows, with their decimals and
 * the primary source that publishes the address. `asset`, `assetSymbol` and
 * `assetDecimals` repeat the first entry (the network's default stablecoin).
 */
const asset = (address, symbol, decimals, source) =>
  Object.freeze({ address, symbol, decimals, source });
export const ESCROW_PAYOUT_FEE_BASIS_POINTS = 200;
export const ESCROW_WITHDRAWAL_FEE_BASIS_POINTS = 200;

const CIRCLE_USDC_ADDRESSES =
  "https://developers.circle.com/stablecoins/usdc-contract-addresses";
function network(definition, assets) {
  const first = assets[0];
  return Object.freeze({
    ...definition,
    asset: first?.address ?? null,
    assetSymbol: first?.symbol ?? "TEST",
    assetDecimals: first?.decimals ?? null,
    assets: Object.freeze(assets),
  });
}
export const ESCROW_NETWORKS = Object.freeze({
  "base-sepolia": network(
    {
      chain: "base",
      family: "evm",
      testnet: true,
      chainId: "84532",
      gasCeiling: "500000",
      scanPageBlocks: "2000",
    },
    [
      asset(
        "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
        "USDC",
        6,
        CIRCLE_USDC_ADDRESSES,
      ),
    ],
  ),
  "base-mainnet": network(
    {
      chain: "base",
      family: "evm",
      testnet: false,
      chainId: "8453",
      gasCeiling: "500000",
      scanPageBlocks: "2000",
    },
    [
      asset(
        "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        "USDC",
        6,
        CIRCLE_USDC_ADDRESSES,
      ),
    ],
  ),
  "solana-devnet": network(
    {
      chain: "solana",
      family: "solana",
      testnet: true,
      genesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
    },
    [
      asset(
        "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
        "USDC",
        6,
        CIRCLE_USDC_ADDRESSES,
      ),
    ],
  ),
  "solana-testnet": network(
    {
      chain: "solana",
      family: "solana",
      testnet: true,
      genesisHash: "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY",
    },
    [],
  ),
  "solana-mainnet": network(
    {
      chain: "solana",
      family: "solana",
      testnet: false,
      genesisHash: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
    },
    [
      asset(
        "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        "USDC",
        6,
        CIRCLE_USDC_ADDRESSES,
      ),
    ],
  ),
  "robinhood-testnet": network(
    {
      chain: "robinhood",
      family: "evm",
      testnet: true,
      chainId: "46630",
      gasCeiling: "2000000",
      scanPageBlocks: "9000",
    },
    [
      /** Paxos testnet USDG, listed by the Paxos USDG testnet guide and read back on chain (design record). */
      asset(
        "0x7e955252e15c84f5768b83c41a71f9eba181802f",
        "USDG",
        6,
        "https://docs.paxos.com/guides/stablecoin/usdg/testnet",
      ),
    ],
  ),
  "robinhood-mainnet": network(
    {
      chain: "robinhood",
      family: "evm",
      testnet: false,
      chainId: "4663",
      /** eth_estimateGas on Arbitrum Nitro includes the Ethereum data-posting fee. */
      gasCeiling: "2000000",
      scanPageBlocks: "9000",
    },
    [
      /** Paxos USDG, listed by the Robinhood and Paxos docs and read back on chain (design record). */
      asset(
        "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
        "USDG",
        6,
        "https://docs.robinhood.com/chain/contracts",
      ),
    ],
  ),
  "ethereum-sepolia": network(
    {
      chain: "ethereum",
      family: "evm",
      testnet: true,
      chainId: "11155111",
      // The deployed test USDC payout estimates 681836 gas; the executor
      // adds a 20% margin. Keep a bounded allowance above that live estimate.
      gasCeiling: "1000000",
      scanPageBlocks: "2000",
    },
    [
      /** Circle test USDC; read back on chain 18 October 2026 (symbol USDC, 6 decimals, chain 11155111). */
      asset(
        "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238",
        "USDC",
        6,
        CIRCLE_USDC_ADDRESSES,
      ),
    ],
  ),
  ethereum: network(
    {
      chain: "ethereum",
      family: "evm",
      testnet: false,
      chainId: "1",
      gasCeiling: "500000",
      scanPageBlocks: "2000",
    },
    [
      /** Circle USDC; read back on chain 18 October 2026 (symbol USDC, 6 decimals, chain 1). */
      asset(
        "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        "USDC",
        6,
        CIRCLE_USDC_ADDRESSES,
      ),
    ],
  ),
});
/**
 * The worker record for one reviewed escrow deployment: the manifest fields
 * plus the registry's chain, chain id, executor gas ceiling and scanner page
 * size. Every payment worker and generator derives its records here, so no
 * worker assumes a network value.
 */
export function paymentDeploymentRecord(projectId, deployment) {
  const network = Object.hasOwn(ESCROW_NETWORKS, deployment?.network)
    ? ESCROW_NETWORKS[deployment.network]
    : undefined;
  if (!network)
    throw new TypeError(
      `Unknown escrow network: ${String(deployment?.network)}`,
    );
  return {
    projectId,
    ...deployment,
    chain: network.chain,
    ...(network.chainId ? { chainId: network.chainId } : {}),
    ...(network.gasCeiling ? { gasCeiling: network.gasCeiling } : {}),
    ...(network.scanPageBlocks
      ? { scanPageBlocks: network.scanPageBlocks }
      : {}),
  };
}
/** Canonical positive uint256 native base units; never a floating-point amount. */
export function isMaxNativeCostWei(value) {
  return (
    typeof value === "string" &&
    /^[1-9][0-9]{0,77}$/.test(value) &&
    BigInt(value) <= (1n << 256n) - 1n
  );
}
/** Chains a policy may name, in registry order; each maps to exactly one family. */
export const ESCROW_CHAINS = Object.freeze([
  ...new Set(Object.values(ESCROW_NETWORKS).map((network) => network.chain)),
]);
export function isEscrowChain(value) {
  return ESCROW_CHAINS.includes(value);
}
/** The execution family of a chain. Unknown chains throw; nothing may default to a family. */
export function chainFamily(chain) {
  const network = Object.values(ESCROW_NETWORKS).find(
    (candidate) => candidate.chain === chain,
  );
  if (!network) throw new TypeError(`Unknown escrow chain: ${String(chain)}`);
  return network.family;
}
/** Chains whose wallets are EVM accounts (personal_sign consent, EIP-712 bindings). */
export const EVM_CHAINS = Object.freeze(
  ESCROW_CHAINS.filter((chain) => chainFamily(chain) === "evm"),
);
/** Solana token amounts are u64; EVM vault accounting supports MAX_BASE_UNITS. */
export const SOLANA_MAX_BASE_UNITS = (1n << 64n) - 1n;
/** The largest base-unit amount one payment may carry on a chain. */
export function maxBaseUnitsForChain(chain) {
  return chainFamily(chain) === "solana"
    ? SOLANA_MAX_BASE_UNITS
    : MAX_BASE_UNITS;
}
/** New production deployments may pay committed awards immediately. */
export const MIN_PRODUCTION_BINDING_DELAY = 0;
/** New production deployments may rotate an authorized identity key immediately. */
export const MIN_PRODUCTION_ROTATION_DELAY = 0;
const MAX_U64 = (1n << 64n) - 1n;
const EVM_IMPLEMENTATION_REVIEW_KEYS = [
  "authority",
  "vaultImplementation",
  "vaultImplementationCodeSha256",
  "factoryImplementation",
  "factoryImplementationCodeSha256",
];
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
  return validateEscrowPolicy(value, ESCROW_PAYOUT_FEE_BASIS_POINTS);
}

/** SEC-05: same reviewed rails, with the separately approved exact 75/25 split. */
export function assertSecurityEscrowPolicy(value) {
  return validateEscrowPolicy(value, 2500);
}

function validateEscrowPolicy(value, feeBasisPoints) {
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
    !isEscrowChain(value.chain) ||
    value.feeBasisPoints !== feeBasisPoints ||
    // Escrow v2 (PRD section 6): the unused-fund withdrawal fee equals the
    // 2% payout fee, ceil(gross / 50) per withdrawal (#907). The contracts
    // enforce both.
    value.withdrawalFeeBasisPoints !== ESCROW_WITHDRAWAL_FEE_BASIS_POINTS ||
    value.feeMode !== "deduct-from-gross" ||
    !Array.isArray(value.deployments)
  )
    throw new TypeError("Invalid escrow chain or fee policy");
  const networks = new Set();
  for (const deployment of value.deployments) {
    keys(deployment, [
      ...(deployment.evmUpgrade === undefined ? [] : ["evmUpgrade"]),
      ...(deployment.maxNativeCostWei === undefined
        ? []
        : ["maxNativeCostWei"]),
      ...(deployment.bindingConsentNonceLimit === undefined
        ? []
        : ["bindingConsentNonceLimit"]),
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
      ...(chainFamily(value.chain) === "solana" ? ["rotationAuthority"] : []),
      "deploymentTransaction",
      "sourceCommit",
      "codeSha256",
      "bindingDelaySeconds",
      "rotationDelaySeconds",
      "factory",
      "factoryCodeSha256",
      "registrar",
    ]);
    if (
      deployment.maxNativeCostWei !== undefined &&
      (chainFamily(value.chain) !== "evm" ||
        !isMaxNativeCostWei(deployment.maxNativeCostWei))
    )
      throw new TypeError("Invalid EVM native cost limit");
    if (
      deployment.bindingConsentNonceLimit !== undefined &&
      (chainFamily(value.chain) !== "evm" ||
        deployment.bindingConsentNonceLimit !== 1)
    )
      throw new TypeError("Invalid binding consent nonce limit");
    if (deployment.evmUpgrade !== undefined) {
      const upgrade = deployment.evmUpgrade;
      keys(upgrade, [
        ...EVM_IMPLEMENTATION_REVIEW_KEYS,
        ...(upgrade?.history === undefined ? [] : ["history"]),
      ]);
      const history = upgrade.history ?? [];
      if (
        chainFamily(value.chain) !== "evm" ||
        (upgrade.history !== undefined &&
          (!Array.isArray(history) || history.length === 0))
      )
        throw new TypeError("Invalid reviewed EVM upgrade");
      for (const review of [upgrade, ...history]) {
        if (review !== upgrade)
          keys(review, [
            ...EVM_IMPLEMENTATION_REVIEW_KEYS,
            "supersededAtBlock",
          ]);
        if (
          ![
            review.authority,
            review.vaultImplementation,
            review.factoryImplementation,
          ].every((address) => isFundingAddress(value.chain, address)) ||
          ![
            review.vaultImplementationCodeSha256,
            review.factoryImplementationCodeSha256,
          ].every((hash) => /^[0-9a-f]{64}$/.test(hash)) ||
          [deployment.identityAuthority, deployment.feeRecipient].some(
            (address) =>
              address.toLowerCase() === review.authority.toLowerCase(),
          )
        )
          throw new TypeError("Invalid reviewed EVM upgrade");
      }
      // Each entry applies only to events before the block at which it was
      // superseded. Bounds strictly increase, so no entry repeats.
      let bound = 0n;
      for (const review of history) {
        if (
          typeof review.supersededAtBlock !== "string" ||
          !/^[1-9][0-9]{0,19}$/.test(review.supersededAtBlock) ||
          BigInt(review.supersededAtBlock) > MAX_U64 ||
          BigInt(review.supersededAtBlock) <= bound
        )
          throw new TypeError(
            "Reviewed EVM upgrade history needs increasing supersession blocks",
          );
        bound = BigInt(review.supersededAtBlock);
      }
    }
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
        deployment.owner,
        deployment.identityAuthority,
        deployment.feeRecipient,
      ].every((address) => isFundingAddress(value.chain, address)) ||
      !(
        isNativeAssetAddress(value.chain, deployment.asset) ||
        isFundingAddress(value.chain, deployment.asset)
      )
    )
      throw new TypeError("Invalid escrow address");
    if (
      chainFamily(value.chain) === "solana" &&
      (!isFundingAddress(value.chain, deployment.rotationAuthority) ||
        [
          deployment.owner,
          deployment.identityAuthority,
          deployment.feeRecipient,
          deployment.vault,
        ].includes(deployment.rotationAuthority))
    )
      throw new TypeError("Solana requires an independent rotation authority");
    // Any standard token is allowed (TOK-01); the adapter reads its decimals
    // from chain and rejects a vault whose token differs from the manifest.
    if (
      chainFamily(value.chain) === "evm"
        ? deployment.programId !== null ||
          deployment.upgradeAuthority !== null ||
          deployment.projectPda !== null ||
          deployment.networkDomain !== null ||
          deployment.rotationDelaySeconds !== null ||
          !isFundingAddress(value.chain, deployment.factory) ||
          !isFundingAddress(value.chain, deployment.registrar) ||
          !/^[0-9a-f]{64}$/.test(deployment.factoryCodeSha256)
        : deployment.factory !== null ||
          deployment.factoryCodeSha256 !== null ||
          deployment.registrar !== null ||
          (deployment.upgradeAuthority !== null &&
            !isFundingAddress("solana", deployment.upgradeAuthority)) ||
          !isFundingAddress("solana", deployment.programId) ||
          !isFundingAddress("solana", deployment.projectPda) ||
          !/^[0-9a-f]{64}$/.test(deployment.networkDomain)
    )
      throw new TypeError("Escrow program does not match the network");
    // The owner proposes and the rotation authority confirms a new identity
    // authority. The production rotation delay is zero (PRD section 11,
    // "Contract timelocks"), so a rotation gives no veto window for bindings
    // made with a stolen key. EVM contracts fix it at zero.
    if (
      chainFamily(value.chain) === "solana" &&
      (typeof deployment.rotationDelaySeconds !== "string" ||
        !/^(0|[1-9][0-9]{0,9})$/.test(deployment.rotationDelaySeconds) ||
        (!network.testnet &&
          Number(deployment.rotationDelaySeconds) <
            MIN_PRODUCTION_ROTATION_DELAY))
    )
      throw new TypeError(
        "Escrow rotation delay is missing or below the production minimum",
      );
    // A new or rotated destination binding waits this long before it can pay.
    // The production minimum is zero (PRD section 11, "Contract timelocks"),
    // so a binding made with a stolen identity key can pay before the owner
    // cancels it.
    if (
      typeof deployment.bindingDelaySeconds !== "string" ||
      !/^(0|[1-9][0-9]{0,9})$/.test(deployment.bindingDelaySeconds) ||
      (!network.testnet &&
        Number(deployment.bindingDelaySeconds) < MIN_PRODUCTION_BINDING_DELAY)
    )
      throw new TypeError(
        "Escrow binding delay is missing or below the production minimum",
      );
    // Retain the reviewed deployment delay relationship. Wallet activation is immediate;
    // this bound does not guarantee time to cancel an eligible payment.
    if (
      chainFamily(value.chain) === "solana" &&
      Number(deployment.bindingDelaySeconds) > 0 &&
      Number(deployment.rotationDelaySeconds) >=
        4 * Number(deployment.bindingDelaySeconds)
    )
      throw new TypeError(
        "Escrow rotation delay must be shorter than four binding delays",
      );
    if (
      deployment.owner === deployment.identityAuthority ||
      deployment.owner === deployment.feeRecipient ||
      deployment.identityAuthority === deployment.feeRecipient ||
      deployment.vault === deployment.owner ||
      deployment.vault === deployment.feeRecipient ||
      deployment.vault === deployment.identityAuthority ||
      (chainFamily(value.chain) === "evm" &&
        [
          deployment.owner,
          deployment.identityAuthority,
          deployment.feeRecipient,
          deployment.vault,
        ].includes(deployment.registrar))
    )
      throw new TypeError("Escrow authorities must have separate roles");
    if (
      !/^[0-9a-f]{40}$/.test(deployment.sourceCommit) ||
      !/^[0-9a-f]{64}$/.test(deployment.codeSha256) ||
      !(chainFamily(value.chain) === "evm"
        ? /^0x[0-9a-f]{64}$/.test(deployment.deploymentTransaction)
        : isSolanaTransactionId(deployment.deploymentTransaction))
    )
      throw new TypeError(
        "Escrow deployment requires immutable source and transaction evidence",
      );
  }
  return value;
}
/** The reviewed authority and implementations of an EVM upgrade, without its history. */
function implementationReview(review) {
  return JSON.stringify(
    EVM_IMPLEMENTATION_REVIEW_KEYS.map((key) => review[key].toLowerCase()),
  );
}
/**
 * EVM upgrade history is append-only. When the reviewed authority or an
 * implementation changes, exactly the outgoing review is appended with the
 * block at which it was superseded (validation keeps bounds increasing), so
 * events from before the upgrade still verify at their own block. Existing
 * history entries never change or disappear.
 */
function assertEvmUpgradeHistory(previous, next) {
  const before = previous.history ?? [];
  const after = next.history ?? [];
  const changed = implementationReview(previous) !== implementationReview(next);
  if (
    after.length !== before.length + (changed ? 1 : 0) ||
    before.some(
      (entry, index) => JSON.stringify(entry) !== JSON.stringify(after[index]),
    ) ||
    (changed &&
      implementationReview(after[before.length]) !==
        implementationReview(previous))
  )
    throw new TypeError(
      "Reviewed EVM upgrade history must append the outgoing implementation",
    );
}
export function assertEscrowTransition(
  previous,
  next,
  allowUnfundedChange = false,
) {
  // A deployment's first revision has no superseded reviews to record.
  for (const deployment of next?.deployments ?? [])
    if (
      deployment.evmUpgrade?.history !== undefined &&
      !previous?.deployments.some(
        (candidate) => candidate.network === deployment.network,
      )
    )
      throw new TypeError(
        "A new escrow deployment cannot carry reviewed EVM upgrade history",
      );
  if (!previous) return;
  if (
    !next ||
    ((!allowUnfundedChange || previous.deployments.length > 0) &&
      (previous.chain !== next.chain ||
        previous.effectiveCycle !== next.effectiveCycle)) ||
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
      Boolean(deployment.evmUpgrade) !== Boolean(successor.evmUpgrade) ||
      Object.keys(deployment).some((key) => {
        // This off-chain execution restriction is not historical chain evidence.
        // Every already-signed operation retains its own original bound.
        if (key === "maxNativeCostWei" || key === "bindingConsentNonceLimit")
          return false;
        // Owner revisions retain prior deployment evidence. Only an already
        // upgradeable deployment may update its reviewed implementation.
        const evmUpgrade = deployment.evmUpgrade && successor.evmUpgrade;
        const solanaUpgrade =
          deployment.programId && deployment.upgradeAuthority !== null;
        if (
          evmUpgrade &&
          ["evmUpgrade", "sourceCommit", "deploymentTransaction"].includes(key)
        )
          return false;
        if (
          solanaUpgrade &&
          [
            "codeSha256",
            "upgradeAuthority",
            "sourceCommit",
            "deploymentTransaction",
          ].includes(key)
        )
          return false;
        return key === "evmUpgrade"
          ? JSON.stringify(deployment[key]) !== JSON.stringify(successor[key])
          : deployment[key] !== successor[key];
      })
    )
      throw new TypeError("Historical escrow deployments are immutable");
    if (deployment.evmUpgrade)
      assertEvmUpgradeHistory(deployment.evmUpgrade, successor.evmUpgrade);
  }
}
