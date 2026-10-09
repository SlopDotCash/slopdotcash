/** Produce unsigned owner requests from an exact source-bound, review-complete proposal. */
import { resolve } from "node:path";
import {
  baseAwardId,
  buildCommitAwardCalldata,
} from "../contracts/evm/adapter";
import { solanaAwardId } from "../contracts/solana/adapter";
import { ESCROW_NETWORKS } from "../src/lib/escrow-policy.mjs";
import { findProject } from "../src/lib/projects.mjs";
import {
  verifyCurrentEscrowDeployment,
  verifyEscrowReview,
} from "./escrow-review";
import { resolveGitHubToken } from "./github-token";
import {
  resolveEscrowIdentities,
  validateEscrowCycle,
} from "./prepare-escrow-cycle";

export async function prepareEscrowCommitments(
  projectId: string,
  cycleId: string,
  network: string,
  now = new Date(),
) {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(cycleId))
    throw new Error("Expected YYYY-MM cycle");
  const project = findProject(projectId);
  if (!project?.escrow) throw new Error("Project has no escrow policy");
  const deployment = project.escrow.deployments.find(
    (entry) => entry.network === network,
  );
  if (!deployment) throw new Error("Reviewed deployment not found");
  const { proposal, digest } = await validateEscrowCycle(
    resolve("cycles", projectId, cycleId, "escrow-v2"),
    projectId,
    cycleId,
  );
  const token = await resolveGitHubToken();
  const currentDeploymentPublication = await verifyCurrentEscrowDeployment({
    projectId,
    currentProject: project,
    archiveDirectory: resolve("cycles", projectId, cycleId, "escrow-v2"),
    token,
  });
  const review = await verifyEscrowReview({
    directory: resolve("cycles", projectId, cycleId, "escrow-v2"),
    proposal,
    proposalSha256: digest,
    stewardActorId: project.steward.github.actorId,
    now,
    token,
  });
  const identities = await resolveEscrowIdentities(
    proposal.awards.map((award) => award.githubNodeId),
    token,
  );
  if (
    proposal.awards.some(
      (award) =>
        identities.find((actor) => actor.nodeId === award.githubNodeId)
          ?.githubUserId !== award.githubUserId,
    )
  )
    throw new Error("Live GitHub identity no longer matches reviewed awards");
  const decisions = new Map(
    review.decisions.rows.map((row) => [row.githubUserId, row]),
  );
  const awards = proposal.awards
    .filter(
      (award) =>
        decisions.get(award.githubUserId)?.state === "approved" &&
        BigInt(decisions.get(award.githubUserId)?.approvedGrossMicro ?? "0") >
          0n,
    )
    .map((award) => ({
      // The escrow accepts only this vault-bound ID, so no other project can
      // reserve it first.
      awardId:
        project.escrow?.chain === "base"
          ? baseAwardId(
              BigInt(ESCROW_NETWORKS[deployment.network].chainId ?? "0"),
              deployment.vault,
              `0x${award.sourceDigest}`,
            ).slice(2)
          : solanaAwardId(deployment.projectPda ?? "", award.sourceDigest),
      sourceDigest: award.sourceDigest,
      githubUserId: award.githubUserId,
      grossMicro: decisions.get(award.githubUserId)?.approvedGrossMicro ?? "0",
    }));
  return {
    schemaVersion: "2",
    kind: "unsigned-escrow-commitments",
    projectId,
    cycleId,
    network,
    proposalSha256: digest,
    reviewEvidence: review,
    currentDeploymentPublication,
    owner: deployment.owner,
    warning:
      "Unsigned requests are not approval or funding proof. The project owner must review and sign. Index each finalized commitment separately; partial batches remain partial.",
    ...(project.escrow.chain === "base"
      ? {
          transactions: awards.map((award) => ({
            chainId: Number(ESCROW_NETWORKS[deployment.network].chainId),
            to: deployment.vault,
            value: "0",
            data: buildCommitAwardCalldata({
              obligationId: `0x${award.awardId}`,
              sourceDigest: `0x${award.sourceDigest}`,
              githubUserId: award.githubUserId,
              grossMicro: award.grossMicro,
            }),
          })),
        }
      : {
          // The Solana owner-plan tool binds these batches to a fresh blockhash without signing.
          batches: Array.from(
            { length: Math.ceil(awards.length / 3) },
            (_, index) => ({
              deployment,
              operation: "commit",
              awards: awards.slice(index * 3, index * 3 + 3),
            }),
          ),
        }),
  };
}

if (import.meta.main) {
  const [projectId, cycleId, network, ...extra] = process.argv.slice(2);
  if (!projectId || !cycleId || !network || extra.length)
    throw new Error(
      "Usage: bun scripts/prepare-escrow-commitments.ts PROJECT YYYY-MM NETWORK",
    );
  process.stdout.write(
    `${JSON.stringify(await prepareEscrowCommitments(projectId, cycleId, network), null, 2)}\n`,
  );
}
