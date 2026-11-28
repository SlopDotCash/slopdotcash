// spec/settlement/octoberImport.md, "Planning computes the packet and writes nothing"; spec/settlement/octoberImport.md, "An apply run writes only under the reviewed digest, current main and the production lock"
import { createHash } from "node:crypto";
import { allocate } from "../kernels/allocate.ts";
import { ordinaryFeeBase } from "../kernels/fees.ts";
import {
  assertOctoberReviewedWeights,
  decodeOctoberReviewedPacket,
  octoberPeriod,
  octoberThrough,
  type OctoberObservedWeight,
  type OctoberReviewedIdentity,
} from "./review.ts";

const octoberStart = "2026-10-01T00:00:00.000Z";
const slopOctoberStart = "2026-10-11T00:00:00.000Z";
const approvedPool = 1_000_000_000n;
const approvedAsset = "USDC";
const approvedRails = {
  eliza: {
    chain: "solana",
    network: "solana-mainnet",
    assetAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    vaultPattern: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u,
    fundedVault: undefined,
  },
  slopdotcash: {
    chain: "base",
    network: "base-mainnet",
    assetAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    vaultPattern: /^0x[0-9a-f]{40}$/iu,
    fundedVault: "0x6c1297c3b96a00347cb501f572cb5811c2a8ed36",
  },
} as const;

type OctoberImportProject = keyof typeof approvedRails;

export interface OctoberRegistry {
  readonly capturedAt: string;
  readonly enforcementGeneration: number;
  readonly revision: number;
  readonly manifestSha256: string;
  readonly manifest: string;
  readonly restricted: boolean;
  readonly verifiedOwnerGithubId: string;
}

export interface OctoberEvidence {
  readonly publicPointsBatch: string;
  readonly privatePointsBatch: string;
  readonly observedWeights: ReadonlyMap<string, OctoberObservedWeight>;
  readonly knownIdentities: ReadonlyMap<string, string>;
  readonly eligible: ReadonlySet<string>;
}

export interface OctoberAward {
  readonly githubUserId: string;
  readonly login: string;
  readonly grossBase: string;
  readonly feeBase: string;
  readonly netBase: string;
  readonly sourceDigest: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("October requires a complete, current registry manifest.");
  }
  return value as Record<string, unknown>;
}

function exactInstant(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function registryTerms(projectId: OctoberImportProject, manifestText: string) {
  const rail = approvedRails[projectId];
  const manifest = record(JSON.parse(manifestText) as unknown);
  const reward = record(manifest.reward);
  const escrow = record(manifest.escrow);
  const deployment = Array.isArray(escrow.deployments) && escrow.deployments.length === 1
    ? record(escrow.deployments[0])
    : undefined;
  const asset = manifest.rewardAsset === undefined ? undefined : record(manifest.rewardAsset);
  if (
    manifest.id !== projectId || manifest.status !== "active" ||
    reward.kind !== "monthly-pool" || reward.chain !== rail.chain || reward.currency !== approvedAsset ||
    reward.feeBasisPoints !== 200 || escrow.chain !== rail.chain ||
    escrow.feeMode !== "deduct-from-gross" || escrow.feeBasisPoints !== 200 ||
    deployment?.network !== rail.network || deployment.asset !== rail.assetAddress ||
    typeof deployment.vault !== "string" || !rail.vaultPattern.test(deployment.vault) ||
    (rail.fundedVault !== undefined && deployment.vault.toLowerCase() !== rail.fundedVault) ||
    (projectId === "slopdotcash" && escrow.effectiveCycle !== octoberPeriod) ||
    (asset !== undefined &&
      (asset.address !== rail.assetAddress || asset.decimals !== 6 || asset.symbol !== approvedAsset ||
        asset.network !== rail.chain)) ||
    !exactInstant(reward.rewardStartAt)
  ) {
    throw new Error("The project registry does not match the approved October rail and fee.");
  }
  if (projectId === "slopdotcash") {
    const caps = Array.isArray(reward.cycleCaps) ? reward.cycleCaps.map(record) : [];
    const octoberCaps = caps.filter(({ cycleId }) => cycleId === octoberPeriod);
    if (octoberCaps.length !== 1 || octoberCaps[0]?.monthlyCapMinor !== "0") {
      throw new Error("Slop requires the explicit zero automatic cap for October.");
    }
    const terms = manifest.terms === undefined ? undefined : record(manifest.terms);
    const receipt = terms?.receiptPolicy === undefined ? undefined : record(terms.receiptPolicy);
    if (asset?.chainId !== "8453" || receipt?.state !== "active") {
      throw new Error("Slop requires active receipts and the verified Base asset.");
    }
  }
  return { rail, from: reward.rewardStartAt > octoberStart ? reward.rewardStartAt : octoberStart, vault: deployment.vault };
}

function compareActors(left: OctoberReviewedIdentity, right: OctoberReviewedIdentity): number {
  return left.login.toLocaleLowerCase("en").localeCompare(right.login.toLocaleLowerCase("en"), "en") ||
    left.login.localeCompare(right.login, "en") ||
    left.githubNodeId.localeCompare(right.githubNodeId, "en");
}

function allocateOctober(projectId: OctoberImportProject, actors: readonly { readonly actor: OctoberReviewedIdentity; readonly points: bigint }[]): OctoberAward[] {
  const actorsInLegacyTieOrder = [...actors].sort((left, right) => compareActors(left.actor, right.actor));
  const allocation = allocate(approvedPool, actorsInLegacyTieOrder.map(({ points }, index) => ({ actor: index + 1, weight: points })));
  if (allocation.kind !== "Allocated") throw new Error("October proposal allocation refused.");
  return allocation.shares.map(({ actor: rank, amount }) => {
    const actor = actorsInLegacyTieOrder[rank - 1]?.actor;
    if (actor === undefined) throw new Error("An October share lacks a reviewed identity.");
    const fee = ordinaryFeeBase(amount);
    return {
      githubUserId: actor.githubUserId,
      login: actor.login,
      grossBase: amount.toString(),
      feeBase: fee.toString(),
      netBase: (amount - fee).toString(),
      sourceDigest: sha256(JSON.stringify(["slop-escrow-origin-v2", projectId, octoberPeriod, actor.githubUserId])),
    };
  }).sort((left, right) => left.githubUserId.localeCompare(right.githubUserId, "en"));
}

export function compileOctoberProposal(
  projectId: OctoberImportProject,
  bytes: Uint8Array,
  reviewDigest: string,
  capture: OctoberRegistry,
  now: string,
) {
  const packet = decodeOctoberReviewedPacket(bytes, reviewDigest);
  const project = packet.projects[0];
  if (packet.projects.length !== 1 || project?.id !== projectId) {
    throw new Error("Expected exactly the selected project in the October packet.");
  }
  if (
    !exactInstant(capture.capturedAt) || !exactInstant(now) || capture.capturedAt < packet.reviewedAt ||
    capture.capturedAt > now || capture.enforcementGeneration !== packet.enforcementGeneration ||
    project.revision !== capture.revision || project.manifestSha256 !== capture.manifestSha256 ||
    sha256(capture.manifest) !== capture.manifestSha256 || capture.restricted
  ) {
    throw new Error("The current project registry or enforcement differs from the reviewed packet.");
  }
  if (capture.verifiedOwnerGithubId !== packet.reviewerGithubId) {
    throw new Error("The October packet needs the verified current project owner.");
  }
  const terms = registryTerms(projectId, capture.manifest);
  if (project.from !== terms.from || terms.from >= octoberThrough ||
    (projectId === "slopdotcash" && terms.from !== slopOctoberStart)) {
    throw new Error("The October review does not cover the approved contribution window.");
  }
  const identities = new Map(project.identities.map((actor) => [actor.githubUserId, actor]));
  const payable = project.weights.flatMap(({ githubUserId, acceptedWorkPoints, eligible }) => {
    if (!eligible || acceptedWorkPoints === 0) return [];
    const actor = identities.get(githubUserId);
    if (actor === undefined) throw new Error("An October award lacks a reviewed identity.");
    return [{ actor, points: BigInt(acceptedWorkPoints) }];
  });
  const awards = allocateOctober(projectId, payable);
  const gross = awards.reduce((sum, award) => sum + BigInt(award.grossBase), 0n);
  const fees = awards.reduce((sum, award) => sum + BigInt(award.feeBase), 0n);
  if (gross !== approvedPool) throw new Error("The October proposal must conserve the approved gross.");
  const proposal = {
    id: projectId,
    period: octoberPeriod,
    through: octoberThrough,
    revision: project.revision,
    manifestSha256: project.manifestSha256,
    sourceSnapshotSha256: reviewDigest,
    pointsBatch: packet.evidence.pointsBatch,
    enforcementGeneration: capture.enforcementGeneration,
    network: terms.rail.network,
    vault: terms.vault,
    asset: approvedAsset,
    assetAddress: terms.rail.assetAddress,
    decimals: 6,
    grossBase: gross.toString(),
    feeBase: fees.toString(),
    netBase: (gross - fees).toString(),
    awards,
  };
  return { proposal, project };
}

export function checkOctoberEvidence(compiled: ReturnType<typeof compileOctoberProposal>, evidence: OctoberEvidence): void {
  if (evidence.publicPointsBatch !== compiled.proposal.pointsBatch || evidence.privatePointsBatch !== compiled.proposal.pointsBatch) {
    throw new Error("The current public and private Points batches must match the October packet.");
  }
  assertOctoberReviewedWeights(compiled.project, evidence.observedWeights, evidence.knownIdentities, evidence.eligible);
}

export function prepareOctoberProposal(
  projectId: OctoberImportProject,
  bytes: Uint8Array,
  reviewDigest: string,
  capture: OctoberRegistry & OctoberEvidence,
  now: string,
) {
  const compiled = compileOctoberProposal(projectId, bytes, reviewDigest, capture, now);
  checkOctoberEvidence(compiled, capture);
  return compiled.proposal;
}
