import { readFile, writeFile } from "node:fs/promises";
import { ESCROW_NETWORKS } from "../src/lib/escrow-policy.mjs";
import { ASI_NOVEMBER_CLOSEOUT as approved } from "../src/lib/payments/asi-november-closeout";
import { buildEscrowCycle } from "../src/lib/payments/escrow-cycle";
import { periodBounds } from "../src/lib/payments/monthly-allocation";
import { repositoriesCountedFor } from "../src/lib/project-repositories.mjs";
import { assertProjectDefinition } from "../src/lib/project-schema.mjs";
import {
  exactKeys,
  isExactUtc,
  readRecord,
} from "../src/lib/record-validation.mjs";
import { resolveRewardCapMinor } from "../src/lib/reward-cap.mjs";
import { sha256Hex } from "../src/lib/sha256";
import { guardedMonthlyImportPlan } from "./guarded-monthly-import";

const decode = new TextDecoder("utf-8", { fatal: true });
const period = periodBounds(approved.period);
const from = new Date(period.from).toISOString();

function digest(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value))
    throw new Error("Expected an exact SHA-256 digest.");
  return value;
}

function timestamp(value: unknown): string {
  if (typeof value !== "string" || !isExactUtc(value))
    throw new Error("Expected an exact UTC timestamp.");
  return value;
}

function integer(value: unknown, min: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min)
    throw new Error("Invalid registry revision or enforcement generation.");
  return value;
}

function githubActorId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[1-9][0-9]{0,19}$/u.test(value) ||
    BigInt(value) > (1n << 64n) - 1n
  )
    throw new Error("Record the producer and reviewer by numeric GitHub ID.");
  return value;
}

export function asiCloseoutCoverage(
  policy: ReturnType<typeof assertProjectDefinition>,
  snapshotSha256: string,
) {
  return repositoriesCountedFor(policy, Date.parse(from)).map(({ id }) => ({
    repository: id,
    from,
    cutoff: approved.cutoff,
    snapshotSha256,
  }));
}

export function buildAsiCloseoutCycle(
  snapshot: Uint8Array,
  manifest: string,
  generatedAt: string,
) {
  return buildEscrowCycle(
    {
      projectId: approved.projectId,
      cycleId: approved.period,
      generatedAt,
      earlyCloseAt: approved.cutoff,
    },
    snapshot,
    null,
    new TextEncoder().encode(manifest),
  );
}

export function prepareAsiNovemberCloseout(input: {
  reviewedPacket: Uint8Array;
  reviewedPacketSha256: string;
  currentRegistry: Uint8Array;
  snapshot: Uint8Array;
  now?: Date;
}) {
  const reviewedPacketSha256 = digest(input.reviewedPacketSha256);
  if (sha256Hex(input.reviewedPacket) !== reviewedPacketSha256)
    throw new Error("Reviewed ASI packet digest does not match.");
  const packet = readRecord(
    JSON.parse(decode.decode(input.reviewedPacket)),
    "reviewed ASI packet",
  );
  exactKeys(
    packet,
    [
      "schemaVersion",
      "kind",
      "projectId",
      "period",
      "cutoff",
      "grossBase",
      "reviewedAt",
      "producerGithubId",
      "reviewerGithubId",
      "snapshotSha256",
      "pointsBatch",
      "manifestSha256",
      "revision",
      "enforcementGeneration",
    ],
    "reviewed ASI packet",
  );
  if (
    packet.schemaVersion !== "1" ||
    packet.kind !== "reviewed-asi-november-closeout" ||
    packet.projectId !== approved.projectId ||
    packet.period !== approved.period ||
    packet.cutoff !== approved.cutoff ||
    packet.grossBase !== approved.grossBase
  )
    throw new Error(
      "The packet does not bind the approved ASI November closeout.",
    );
  const reviewerGithubId = githubActorId(packet.reviewerGithubId);
  if (githubActorId(packet.producerGithubId) === reviewerGithubId)
    throw new Error("The producer and independent reviewer must be different.");
  const reviewedAt = timestamp(packet.reviewedAt);
  const sourceSnapshotSha256 = digest(packet.snapshotSha256);
  if (sourceSnapshotSha256 !== sha256Hex(input.snapshot))
    throw new Error("The verified snapshot differs from the reviewed packet.");
  const pointsBatch = digest(packet.pointsBatch);
  const manifestSha256 = digest(packet.manifestSha256);
  const revision = integer(packet.revision, 1);
  const enforcementGeneration = integer(packet.enforcementGeneration, 0);

  const registry = readRecord(
    JSON.parse(decode.decode(input.currentRegistry)),
    "ASI registry capture",
  );
  exactKeys(
    registry,
    [
      "schemaVersion",
      "origin",
      "capturedAt",
      "enforcementGeneration",
      "projects",
    ],
    "ASI registry capture",
  );
  const capturedAt = timestamp(registry.capturedAt);
  if (
    registry.schemaVersion !== "1" ||
    registry.origin !== "https://slop.cash" ||
    registry.enforcementGeneration !== enforcementGeneration ||
    reviewedAt < approved.cutoff ||
    capturedAt < reviewedAt ||
    capturedAt > (input.now ?? new Date()).toISOString()
  )
    throw new Error("The production registry capture or review time is stale.");
  if (!Array.isArray(registry.projects) || registry.projects.length !== 1)
    throw new Error("Capture exactly the ASI project.");
  const entry = readRecord(registry.projects[0], "ASI registry project");
  exactKeys(
    entry,
    ["id", "revision", "manifestSha256", "manifestText", "restriction"],
    "ASI registry project",
  );
  if (
    entry.id !== approved.projectId ||
    entry.revision !== revision ||
    entry.manifestSha256 !== manifestSha256 ||
    entry.restriction !== "clear" ||
    typeof entry.manifestText !== "string" ||
    sha256Hex(entry.manifestText) !== manifestSha256
  )
    throw new Error(
      "The production ASI registry capture differs from the reviewed revision.",
    );
  const manifest = entry.manifestText;
  const policy = assertProjectDefinition(JSON.parse(manifest));
  const deployment = policy.escrow?.deployments[0];
  const asset = policy.rewardAsset;
  const duration = BigInt(Date.parse(approved.cutoff) - period.from);
  const month = BigInt(period.to - period.from);
  if (
    JSON.stringify(policy) !== manifest ||
    policy.id !== approved.projectId ||
    policy.status !== "active" ||
    policy.authority.state !== "verified" ||
    policy.terms.receiptPolicy.state !== "active" ||
    policy.reward.kind !== "monthly-pool" ||
    (BigInt(resolveRewardCapMinor(policy, approved.period)) * duration) /
      month !==
      BigInt(approved.grossBase) ||
    policy.escrow?.deployments.length !== 1 ||
    deployment?.network !== approved.network ||
    asset?.network !== approved.chain ||
    asset.symbol !== approved.assetSymbol ||
    asset.decimals !== approved.assetDecimals ||
    asset.address !== ESCROW_NETWORKS[approved.network].asset ||
    deployment.asset !== asset.address ||
    policy.escrow.feeBasisPoints !== 200
  )
    throw new Error(
      "The registered ASI pool, asset, or vault differs from the approved closeout.",
    );

  const proposal = buildAsiCloseoutCycle(input.snapshot, manifest, reviewedAt);
  if (proposal.grossCapMicro !== approved.grossBase)
    throw new Error("The proposal does not use the approved cap.");
  const monthlyBase = {
    projectId: approved.projectId,
    period: approved.period,
    capBase: approved.grossBase,
    earlyCloseAt: approved.cutoff,
    manifestSha256,
    sourceSnapshotSha256,
    rows: proposal.awards
      .filter((award) => award.grossMicro !== "0")
      .map((award) => ({
        githubUserId: award.githubUserId,
        login: award.login,
        grossBase: award.grossMicro,
        sourceDigest: award.sourceDigest,
      })),
  };
  const coverage = asiCloseoutCoverage(policy, sourceSnapshotSha256);
  return {
    ...guardedMonthlyImportPlan({
      capturedAt,
      enforcementGeneration,
      pointsBatch,
      projects: [{ monthlyBase, manifest, revision, coverage }],
    }),
    review: {
      reviewedPacketSha256,
      reviewerGithubId,
      pointsBatch,
      capturedAt,
      revision,
      deployment,
      contributionWindow: proposal.contributionWindow,
      feeBasisPoints: proposal.feeBasisPoints,
      monthlyBase,
    },
  };
}

if (import.meta.main) {
  try {
    const [mode, reviewedPacket, reviewSha256, registry, source, output] =
      process.argv.slice(2);
    if (
      process.argv.length !== 8 ||
      (mode !== "preview" && mode !== "guarded-sql")
    )
      throw new Error(
        "Usage: prepare-asi-november-closeout.ts preview|guarded-sql REVIEW_PACKET REVIEW_SHA256 CURRENT_REGISTRY SNAPSHOT NEW_PRIVATE_FILE",
      );
    const [packetBytes, registryBytes, snapshot] = await Promise.all([
      readFile(reviewedPacket),
      readFile(registry),
      readFile(source),
    ]);
    const result = prepareAsiNovemberCloseout({
      reviewedPacket: packetBytes,
      reviewedPacketSha256: reviewSha256,
      currentRegistry: registryBytes,
      snapshot,
    });
    await writeFile(
      output,
      mode === "guarded-sql"
        ? result.sql
        : `${JSON.stringify(result.review, null, 2)}\n`,
      { flag: "wx", mode: 0o600 },
    );
  } catch (error) {
    process.stderr.write(
      `ASI closeout refused: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    process.exitCode = 1;
  }
}
