/** Owner vault setup. Trust and RPCs come from the server; only the owner signs. */
import {
  type EvmEscrowConfig,
  type EvmVaultCreation,
  EvmVaultCreationFailed,
  prepareEvmVaultCreation,
  verifyEvmVaultCreation,
} from "../../contracts/evm/adapter";
import type { SolanaEscrowConfig } from "../../contracts/solana/adapter";
import {
  prepareSolanaVaultCreation,
  SolanaVaultCreationFailed,
  verifySolanaVaultCreation,
} from "../../contracts/solana/owner-creation";
import type { SolanaVaultCreation } from "../../contracts/solana/owner-instructions";
import { SolanaWalletActionError } from "../../contracts/solana/wallet-transactions";
import {
  ESCROW_NETWORKS,
  type EscrowDeployment,
  isBaseUnits,
} from "../../src/lib/escrow-policy.mjs";
import type { PayoutPolicy } from "../../src/lib/payments/contracts";
import type { ProjectDefinition } from "../../src/lib/projects.mjs";
import type {
  VaultSetupInput,
  VaultSetupReview,
} from "../../src/lib/vault-setup";
import { registryProjectDigest } from "../../src/lib/vault-setup";
import { fail } from "../api-error";
import type { D1TransactionalDatabase } from "../d1";
import type { GithubActor, ProjectRecord } from "./contracts";

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
 * A new vault's first record carries only the current implementation review.
 * Upgrade history is append-only and belongs to the template's own upgrades,
 * so it is never copied to a new deployment or used to verify its creation.
 */
function currentReview(template: EscrowDeployment): EscrowDeployment {
  if (!template.evmUpgrade) return template;
  const { history: _history, ...current } = template.evmUpgrade;
  return { ...template, evmUpgrade: current };
}

export function ownerVaultSetupService(deps: {
  db: D1TransactionalDatabase;
  projects(): Promise<ProjectRecord[]>;
  networks(): string[];
  rpcUrl(network: string): string;
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
  async function resolve(
    project: ProjectRecord,
    actor: GithubActor,
    input: VaultSetupInput,
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
        "SELECT w.wallet_address address FROM wallet_claims w JOIN payment_wallet_authorizations a ON a.claim_id=w.id AND a.github_user_id=w.github_user_id WHERE w.id=? AND w.github_user_id=? AND w.chain=? AND w.source='d1_registry' AND NOT EXISTS(SELECT 1 FROM wallet_claims n WHERE n.supersedes_claim_id=w.id)",
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
      : project.manifest.rewardAsset?.kind === "token"
        ? project.manifest.rewardAsset.address
        : network.asset;
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
      for (const { deployment: template, payoutPolicy } of await templates(
        project,
        input.payoutPolicy,
      )) {
        if (
          template.network !== input.network ||
          !template.programId ||
          !template.projectPda ||
          !template.networkDomain ||
          !template.rotationAuthority ||
          !template.rotationDelaySeconds ||
          !network.genesisHash
        )
          continue;
        const config: SolanaEscrowConfig = {
          ...template,
          programId: template.programId,
          projectPda: template.projectPda,
          networkDomain: template.networkDomain,
          genesisHash: network.genesisHash,
          rotationAuthority: template.rotationAuthority,
          rotationDelaySeconds: template.rotationDelaySeconds,
          rpcUrl: deps.rpcUrl(input.network),
          projectId: project.id,
          mint: template.asset,
          payoutPolicy,
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
          const prepared = await prepareSolanaVaultCreation(
            config,
            creation,
            registrationOnly,
          );
          return {
            family: "solana" as const,
            template,
            config,
            creation,
            prepared,
          };
        } catch (error) {
          if (error instanceof SolanaWalletActionError)
            fail(422, "vault_creation_invalid", error.message);
          // Only a current verified program and Config may anchor new owner creation.
        }
      }
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
    for (const { deployment: template, payoutPolicy } of await templates(
      project,
      input.payoutPolicy,
    )) {
      if (
        template.network !== input.network ||
        !template.factory ||
        !template.factoryCodeSha256 ||
        !template.registrar ||
        !network.chainId
      )
        continue;
      const config: EvmEscrowConfig = {
        ...currentReview(template),
        factory: template.factory,
        factoryCodeSha256: template.factoryCodeSha256,
        registrar: template.registrar,
        chainId: BigInt(network.chainId),
        rpcUrl: deps.rpcUrl(input.network),
        // A bounty vault can anchor the same reviewed factory, but must verify as a bounty.
        payoutPolicy,
      };
      try {
        const prepared = await prepareEvmVaultCreation(config, creation);
        return { family: "evm" as const, template, config, creation, prepared };
      } catch {
        // A historical template may have been upgraded. Only a still-verifiable one is usable.
      }
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
        ...new Set(
          (await templates(project, payoutPolicy)).map(
            ({ deployment }) => deployment.network,
          ),
        ),
      ];
    },
    async review(project, actor, input) {
      const result = await resolve(project, actor, input);
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
      const result = await resolve(project, actor, input, true);
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
            ...verified,
            owner: result.creation.owner,
            asset: result.creation.mint,
            deploymentTransaction: transactionId,
          };
        } catch (error) {
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
        ...currentReview(template),
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
