/** Owner vault setup. Trust and RPCs come from the server; only the owner signs. */
import {
  type EvmEscrowConfig,
  type EvmVaultCreation,
  EvmVaultCreationFailed,
  prepareEvmVaultCreation,
  verifyEvmVaultCreation,
} from "../../contracts/evm/adapter";
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
              : project.manifest.reward.chain) &&
          // Solana uses the same registration policy; its edge creation planner is separate.
          ESCROW_NETWORKS[d.network].family === "evm",
      );
  }
  async function resolve(
    project: ProjectRecord,
    actor: GithubActor,
    input: VaultSetupInput,
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
        return { template, config, creation, prepared };
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
      const { config, creation, prepared } = await resolve(
        project,
        actor,
        input,
      );
      return {
        payoutPolicy: input.payoutPolicy ?? "ordinary",
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
      const { template, config, creation } = await resolve(
        project,
        actor,
        input,
      );
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
