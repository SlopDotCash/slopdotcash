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
  networks(project: ProjectRecord): Promise<string[]>;
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

export function ownerVaultSetupService(deps: {
  db: D1TransactionalDatabase;
  projects(): Promise<ProjectRecord[]>;
  networks(): string[];
  rpcUrl(network: string): string;
}): OwnerVaultSetup {
  async function templates(project: ProjectRecord) {
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
          ESCROW_NETWORKS[d.network].chain === project.manifest.reward.chain,
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
    // Bounty and monthly funds must never share a vault. The Solana path builds
    // an ordinary vault from the monthly cap only, so it refuses any other purpose.
    if (
      (input.payoutPolicy ?? "ordinary") !== "ordinary" &&
      network?.family !== "evm"
    )
      fail(
        422,
        "vault_setup_unavailable",
        "Owner setup for a Solana bounty vault is not available.",
      );
    if (
      !project.manifest.escrow ||
      !network ||
      reward.kind !== "monthly-pool" ||
      network.chain !== reward.chain ||
      !isBaseUnits(reward.monthlyCapMinor) ||
      BigInt(reward.monthlyCapMinor) <= 0n
    )
      fail(
        422,
        "vault_setup_unavailable",
        "Choose a monthly reward amount and network before creating a vault.",
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
    const asset =
      project.manifest.rewardAsset?.kind === "token"
        ? project.manifest.rewardAsset.address
        : network.asset;
    if (!asset)
      fail(
        422,
        "vault_setup_unavailable",
        "This network has no reviewed reward asset.",
      );
    if (network.family === "solana") {
      if (BigInt(reward.monthlyCapMinor) > (1n << 64n) - 1n)
        fail(
          422,
          "vault_setup_unavailable",
          "The monthly amount exceeds the Solana vault limit.",
        );
      for (const { deployment: template, payoutPolicy } of await templates(
        project,
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
          monthlyCap: reward.monthlyCapMinor,
          automaticMonthly: input.automatic,
          payoutPolicy: "ordinary",
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
      monthlyCap: reward.monthlyCapMinor,
      monthlyEnabled: input.automatic,
      payoutPolicy: "ordinary",
    };
    for (const { deployment: template, payoutPolicy } of await templates(
      project,
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
        ...template,
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
    async networks(project) {
      return [
        ...new Set(
          (await templates(project)).map(
            ({ deployment }) => deployment.network,
          ),
        ),
      ];
    },
    async review(project, actor, input) {
      const result = await resolve(project, actor, input);
      if (result.family === "solana")
        return {
          family: "solana",
          network: input.network,
          owner: result.creation.owner,
          asset: result.creation.mint,
          cap: project.manifest.reward.monthlyCapMinor,
          capDisplay: project.manifest.reward.monthlyCapDisplay,
          automatic: input.automatic,
          creation: result.creation,
          ...result.prepared,
        };
      const { config, creation, prepared } = result;
      return {
        family: "evm",
        network: input.network,
        owner: creation.owner,
        asset: creation.asset,
        cap: creation.monthlyCap,
        capDisplay: project.manifest.reward.monthlyCapDisplay,
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
        ...template,
        vault,
        owner: creation.owner,
        asset: creation.asset,
        deploymentTransaction: transactionId,
      };
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
