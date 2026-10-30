/** Owner vault setup. Trust and RPCs come from the server; only the owner signs. */
import {
  type EvmFactoryConfig,
  EvmRpcUnavailable,
  type EvmVaultCreation,
  EvmVaultCreationFailed,
  prepareEvmVaultCreation,
  verifyEvmFactory,
  verifyEvmVaultCreation,
} from "../../contracts/evm/adapter";
import type { ReviewedEvmFactory } from "../../contracts/evm/factories";
import {
  type SolanaProgramConfig,
  SolanaRpcUnavailable,
} from "../../contracts/solana/adapter";
import {
  prepareSolanaVaultCreation,
  SolanaVaultCreationFailed,
  verifySolanaVaultCreation,
} from "../../contracts/solana/owner-creation";
import type { SolanaVaultCreation } from "../../contracts/solana/owner-instructions";
import type { ReviewedSolanaProgram } from "../../contracts/solana/programs";
import { SolanaWalletActionError } from "../../contracts/solana/wallet-transactions";
import {
  ESCROW_NETWORKS,
  type EscrowDeployment,
  isBaseUnits,
} from "../../src/lib/escrow-policy.mjs";
import type { PayoutPolicy } from "../../src/lib/payments/contracts";
import type {
  GithubActor,
  ProjectRecord,
} from "../../src/lib/project-contracts";
import type { ProjectDefinition } from "../../src/lib/projects.mjs";
import type {
  VaultSetupInput,
  VaultSetupReview,
} from "../../src/lib/vault-setup";
import { registryProjectDigest } from "../../src/lib/vault-setup";
import type { D1TransactionalDatabase } from "../d1";
import { fail } from "../http";

export interface OwnerVaultSetup {
  networks(
    project: ProjectRecord,
    payoutPolicy?: PayoutPolicy,
  ): Promise<string[]>;
  review(
    project: ProjectRecord,
    actor: GithubActor,
    input: VaultSetupInput,
  ): Promise<VaultSetupReview>;
  register(
    project: ProjectRecord,
    actor: GithubActor,
    input: VaultSetupInput,
    transactionId: string,
  ): Promise<EscrowDeployment | null>;
}

/**
 * The RPC gave no usable answer, so the chain state is unknown. This is not a
 * refusal of the factory or the transaction, and nothing needs review.
 */
function networkUnavailable(): never {
  fail(
    503,
    "vault_network_unavailable",
    "The network could not be read. Nothing needs review. Try again in a minute.",
  );
}

/**
 * A new vault's first record carries only the current implementation review.
 * Upgrade history is append-only and belongs to the template's own upgrades,
 * so it is never copied to a new deployment or used to verify its creation.
 */
function currentReview(template: EscrowDeployment): EscrowDeployment {
  // Another project's execution budget is not a factory or program trust pin.
  const {
    maxNativeCostWei: _nativeLimit,
    bindingConsentNonceLimit: _nonceLimit,
    ...infrastructure
  } = template;
  if (!infrastructure.evmUpgrade) return infrastructure;
  const { history: _history, ...current } = infrastructure.evmUpgrade;
  return { ...infrastructure, evmUpgrade: current };
}

export function ownerVaultSetupService(deps: {
  db: D1TransactionalDatabase;
  projects(): Promise<ProjectRecord[]>;
  networks(): string[];
  rpcUrl(network: string): string;
  factories?: readonly ReviewedEvmFactory[];
  programs?: readonly ReviewedSolanaProgram[];
}): OwnerVaultSetup {
  async function templates(
    project: ProjectRecord,
    payoutPolicy: PayoutPolicy = "ordinary",
  ) {
    let served: string[];
    try {
      served = deps.networks();
    } catch {
      fail(
        503,
        "vault_setup_unavailable",
        "Vault setup is not configured on this deployment.",
      );
    }
    const records = await deps.projects();
    return records
      .flatMap((p) => [
        ...(p.manifest.escrow?.deployments ?? []).map((deployment) => ({
          deployment,
          payoutPolicy: "ordinary" as const,
        })),
        ...(p.manifest.securityBounty?.settlement?.deployments ?? []).map(
          (deployment) => ({
            deployment,
            payoutPolicy: "security-bounty" as const,
          }),
        ),
      ])
      .filter(
        ({ deployment: d }) =>
          served.includes(d.network) &&
          ESCROW_NETWORKS[d.network].chain ===
            (payoutPolicy === "security-bounty"
              ? project.manifest.securityBounty?.amount.network
              : project.manifest.reward.chain),
      );
  }
  async function factories(
    project: ProjectRecord,
    payoutPolicy: PayoutPolicy = "ordinary",
  ) {
    const served = deps.networks();
    const chain =
      payoutPolicy === "security-bounty"
        ? project.manifest.securityBounty?.amount.network
        : project.manifest.reward.chain;
    const reviewed = (deps.factories ?? []).filter(
      (d) =>
        served.includes(d.network) &&
        ESCROW_NETWORKS[d.network]?.family === "evm" &&
        ESCROW_NETWORKS[d.network].chain === chain,
    );
    // Existing D1 deployments remain a valid source of reviewed infrastructure.
    // A new project never inherits their owner, asset, vault or upgrade history.
    for (const { deployment } of await templates(project, payoutPolicy)) {
      const d = currentReview(deployment);
      if (!d.factory || !d.factoryCodeSha256 || !d.registrar || !d.evmUpgrade)
        continue;
      reviewed.push({
        network: d.network,
        sourceCommit: d.sourceCommit,
        codeSha256: d.codeSha256,
        bindingDelaySeconds: d.bindingDelaySeconds,
        identityAuthority: d.identityAuthority,
        feeRecipient: d.feeRecipient,
        factory: d.factory,
        factoryCodeSha256: d.factoryCodeSha256,
        registrar: d.registrar,
        evmUpgrade: d.evmUpgrade,
      });
    }
    return reviewed;
  }
  async function programs(
    project: ProjectRecord,
    payoutPolicy: PayoutPolicy = "ordinary",
  ): Promise<ReviewedSolanaProgram[]> {
    const served = deps.networks();
    const chain =
      payoutPolicy === "security-bounty"
        ? project.manifest.securityBounty?.amount.network
        : project.manifest.reward.chain;
    const reviewed = (deps.programs ?? []).filter(
      (p) =>
        served.includes(p.network) &&
        ESCROW_NETWORKS[p.network]?.family === "solana" &&
        ESCROW_NETWORKS[p.network].chain === chain,
    );
    // Retain existing deployments as infrastructure sources, never as new project records.
    for (const { deployment: d } of await templates(project, payoutPolicy)) {
      if (
        !d.programId ||
        !d.networkDomain ||
        !d.rotationAuthority ||
        d.rotationDelaySeconds === null
      )
        continue;
      reviewed.push({
        network: d.network,
        sourceCommit: d.sourceCommit,
        programId: d.programId,
        networkDomain: d.networkDomain,
        codeSha256: d.codeSha256,
        upgradeAuthority: d.upgradeAuthority,
        identityAuthority: d.identityAuthority,
        feeRecipient: d.feeRecipient,
        rotationAuthority: d.rotationAuthority,
        bindingDelaySeconds: d.bindingDelaySeconds,
        rotationDelaySeconds: d.rotationDelaySeconds,
      });
    }
    return reviewed;
  }
  /** `prepareEvm` checks one reviewed factory for this creation; a refusal
   * skips to the next template. */
  async function resolve<EvmPrepared>(
    project: ProjectRecord,
    actor: GithubActor,
    input: VaultSetupInput,
    prepareEvm: (
      config: EvmFactoryConfig,
      creation: EvmVaultCreation,
    ) => Promise<EvmPrepared>,
    registrationOnly = false,
  ) {
    const network = ESCROW_NETWORKS[input.network];
    const reward = project.manifest.reward;
    const bounty = input.payoutPolicy === "security-bounty";
    const program = project.manifest.securityBounty;
    if (
      !network ||
      (bounty
        ? program?.amount.currency !== "USDC" ||
          network.chain !== program.amount.network ||
          input.automatic
        : !project.manifest.escrow ||
          reward.kind !== "monthly-pool" ||
          network.chain !== reward.chain ||
          !isBaseUnits(reward.monthlyCapMinor) ||
          BigInt(reward.monthlyCapMinor) <= 0n)
    )
      fail(
        422,
        "vault_setup_unavailable",
        bounty
          ? "Save the USDC bounty terms and network before creating a bounty vault."
          : "Choose a monthly reward amount and network before creating a vault.",
      );
    const claim = await deps.db
      .prepare(
        "SELECT w.wallet_address address FROM effective_payment_wallet_claims w JOIN payment_wallet_authorizations a ON a.claim_id=w.id AND a.github_user_id=w.github_user_id WHERE w.id=? AND w.github_user_id=? AND w.chain=? AND w.source='d1_registry'",
      )
      .bind(input.claimId, actor.githubId, network.chain)
      .first<{ address: string }>();
    if (!claim)
      fail(
        403,
        "wallet_signature_required",
        "Confirm the current owner wallet before creating a vault.",
      );
    const asset = bounty
      ? network.asset
      : (project.manifest.rewardAsset?.address ?? network.asset);
    if (!asset)
      fail(
        422,
        "vault_setup_unavailable",
        "This network has no reviewed reward asset.",
      );
    if (network.family === "solana") {
      if (!bounty && BigInt(reward.monthlyCapMinor) > (1n << 64n) - 1n)
        fail(
          422,
          "vault_setup_unavailable",
          "The monthly amount exceeds the Solana vault limit.",
        );
      let creationError: SolanaWalletActionError | undefined;
      for (const template of await programs(project, input.payoutPolicy)) {
        if (template.network !== input.network || !network.genesisHash)
          continue;
        const config: SolanaProgramConfig = {
          ...template,
          genesisHash: network.genesisHash,
          rpcUrl: deps.rpcUrl(input.network),
        };
        const creation: SolanaVaultCreation = {
          programId: config.programId,
          owner: claim.address,
          mint: asset,
          projectDigest: registryProjectDigest(project.id),
          networkDomain: config.networkDomain,
          identityAuthority: config.identityAuthority,
          feeRecipient: config.feeRecipient,
          bindingDelaySeconds: config.bindingDelaySeconds,
          rotationDelaySeconds: config.rotationDelaySeconds,
          ...(bounty
            ? { payoutPolicy: "security-bounty" as const }
            : {
                monthlyCap: reward.monthlyCapMinor,
                automaticMonthly: input.automatic,
                payoutPolicy: "ordinary" as const,
              }),
        };
        try {
          const { tokenProgram, ...prepared } =
            await prepareSolanaVaultCreation(
              config,
              creation,
              registrationOnly,
            );
          return {
            family: "solana" as const,
            template,
            config,
            creation: { ...creation, tokenProgram },
            prepared,
          };
        } catch (error) {
          // The request can be valid while the chain is unreadable.
          if (error instanceof SolanaRpcUnavailable) networkUnavailable();
          // A finalized creation can predate the current infrastructure pin.
          // Try only retained reviewed configurations, never trust account fields
          // as a new review. Preserve the failure if none matches this vault.
          if (error instanceof SolanaWalletActionError) creationError ??= error;
          // Only a current verified program and Config may anchor new owner creation.
        }
      }
      if (creationError)
        fail(422, "vault_creation_invalid", creationError.message);
      fail(
        503,
        "vault_setup_unavailable",
        "Vault creation is unavailable until this network has a compatible reviewed program.",
      );
    }
    const creation: EvmVaultCreation = {
      projectId: `0x${registryProjectDigest(project.id)}`,
      owner: claim.address,
      asset,
      monthlyCap: bounty ? "0" : reward.monthlyCapMinor,
      monthlyEnabled: input.automatic,
      payoutPolicy: input.payoutPolicy ?? "ordinary",
    };
    for (const template of await factories(project, input.payoutPolicy)) {
      if (template.network !== input.network || !network.chainId) continue;
      const config: EvmFactoryConfig = {
        ...template,
        chainId: BigInt(network.chainId),
        rpcUrl: deps.rpcUrl(input.network),
      };
      let prepared: EvmPrepared;
      try {
        prepared = await prepareEvm(config, creation);
      } catch (error) {
        // An unread chain proves nothing about the template.
        if (error instanceof EvmRpcUnavailable) networkUnavailable();
        // A historical template may have been upgraded. Only a still-verifiable one is usable.
        continue;
      }
      if (
        [creation.owner, template.identityAuthority].some(
          (address) =>
            address.toLowerCase() === template.feeRecipient.toLowerCase(),
        )
      )
        fail(
          422,
          "vault_role_conflict",
          "The platform fee wallet must be separate from the vault owner and identity authority.",
        );
      return { family: "evm" as const, template, config, creation, prepared };
    }
    fail(
      503,
      "vault_setup_unavailable",
      "Vault creation is unavailable on this network until a compatible factory and its current code are reviewed.",
    );
  }
  return {
    async networks(project, payoutPolicy) {
      return [
        ...new Set([
          ...(await templates(project, payoutPolicy)).map(
            ({ deployment }) => deployment.network,
          ),
          ...(await factories(project, payoutPolicy)).map(
            (factory) => factory.network,
          ),
          ...(await programs(project, payoutPolicy)).map(
            (program) => program.network,
          ),
        ]),
      ];
    },
    async review(project, actor, input) {
      const result = await resolve(
        project,
        actor,
        input,
        prepareEvmVaultCreation,
      );
      if (result.family === "solana")
        return {
          payoutPolicy: input.payoutPolicy ?? "ordinary",
          family: "solana",
          network: input.network,
          owner: result.creation.owner,
          asset: result.creation.mint,
          cap:
            input.payoutPolicy === "security-bounty"
              ? "0"
              : project.manifest.reward.monthlyCapMinor,
          capDisplay:
            input.payoutPolicy === "security-bounty"
              ? ""
              : project.manifest.reward.monthlyCapDisplay,
          automatic: input.automatic,
          creation: result.creation,
          ...result.prepared,
        };
      const { config, creation, prepared } = result;
      return {
        payoutPolicy: input.payoutPolicy ?? "ordinary",
        family: "evm",
        network: input.network,
        owner: creation.owner,
        asset: creation.asset,
        cap: creation.monthlyCap,
        capDisplay:
          input.payoutPolicy === "security-bounty"
            ? ""
            : project.manifest.reward.monthlyCapDisplay,
        automatic: input.automatic,
        chainId: config.chainId.toString(),
        ...prepared,
      };
    },
    async register(project, actor, input, transactionId) {
      // Check the creation factory only. verifyEvmVaultCreation reads the
      // created vault at its receipt block, so the latest-block vault lookup
      // and the creation simulation of a review would repeat chain reads.
      const result = await resolve(
        project,
        actor,
        input,
        (config) =>
          verifyEvmFactory(config, "finalized", { forCreation: true }),
        true,
      );
      if (result.family === "solana") {
        try {
          const verified = await verifySolanaVaultCreation(
            result.config,
            result.creation,
            transactionId,
          );
          if (!verified) return null;
          return {
            ...result.template,
            factory: null,
            factoryCodeSha256: null,
            registrar: null,
            ...verified,
            owner: result.creation.owner,
            asset: result.creation.mint,
            deploymentTransaction: transactionId,
          };
        } catch (error) {
          if (error instanceof SolanaRpcUnavailable) networkUnavailable();
          fail(
            422,
            error instanceof SolanaVaultCreationFailed
              ? "vault_creation_failed"
              : "vault_creation_invalid",
            error instanceof Error
              ? error.message
              : "The creation transaction could not be verified.",
          );
        }
      }
      const { template, config, creation } = result;
      let vault: string | null;
      try {
        vault = await verifyEvmVaultCreation(config, creation, transactionId);
      } catch (error) {
        // The request can be valid while the chain is unreadable.
        if (error instanceof EvmRpcUnavailable) networkUnavailable();
        fail(
          422,
          error instanceof EvmVaultCreationFailed
            ? "vault_creation_failed"
            : "vault_creation_invalid",
          error instanceof Error
            ? error.message
            : "The creation transaction could not be verified. Check again.",
        );
      }
      if (!vault) return null;
      return {
        ...template,
        programId: null,
        upgradeAuthority: null,
        projectPda: null,
        networkDomain: null,
        rotationDelaySeconds: null,
        vault,
        owner: creation.owner,
        asset: creation.asset,
        deploymentTransaction: transactionId,
      };
    },
  };
}

export function attachBountyVault(
  manifest: ProjectDefinition,
  deployment: EscrowDeployment,
  effectiveCycle: string,
): ProjectDefinition {
  const program = manifest.securityBounty;
  if (!program?.amount.network || program.amount.currency !== "USDC")
    fail(
      422,
      "vault_setup_unavailable",
      "Save the USDC bounty terms before setting up a bounty vault.",
    );
  if (program.settlement?.deployments.length)
    fail(
      409,
      "vault_already_registered",
      "This project already has a registered bounty vault.",
    );
  return {
    ...manifest,
    securityBounty: {
      ...program,
      settlement: {
        schemaVersion: "1",
        effectiveCycle,
        chain: program.amount.network,
        feeBasisPoints: 2500,
        withdrawalFeeBasisPoints: 200,
        feeMode: "deduct-from-gross",
        ...program.settlement,
        deployments: [deployment],
      },
    },
  };
}

export function attachOrdinaryVault(
  manifest: ProjectDefinition,
  deployment: EscrowDeployment,
): ProjectDefinition {
  if (!manifest.escrow)
    fail(
      422,
      "vault_setup_unavailable",
      "Save the monthly reward policy before setting up a vault.",
    );
  if (manifest.escrow.deployments.length > 0)
    fail(
      409,
      "vault_already_registered",
      "This project already has a registered vault.",
    );
  return {
    ...manifest,
    escrow: { ...manifest.escrow, deployments: [deployment] },
  };
}
