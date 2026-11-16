/** The independently reviewed accepted-work inputs for the one-time October 2026 pools. */
import {
  ESCROW_NETWORKS,
  type EscrowDeployment,
  isBaseUnits,
  maxBaseUnitsForChain,
} from "../src/lib/escrow-policy.mjs";
import { compareActors, githubUserIdFromNodeId } from "../src/lib/github-actor";
import { ordinaryFee } from "../src/lib/payments/contracts";
import { escrowAwardOrigin } from "../src/lib/payments/escrow-cycle";
import type { MonthlyBase } from "../src/lib/payments/monthly-allocation";
import { payoutExclusionFor } from "../src/lib/payout-exclusions.mjs";
import { assertProjectDefinition } from "../src/lib/project-schema.mjs";
import { sha256Hex } from "../src/lib/sha256";
import { allocateWeightedRows } from "../src/lib/weighted-allocation";

const PERIOD = "2026-10";
const CLOSE = "2026-11-01T00:00:00.000Z";
const APPROVED_TERMS_SHA =
  "9f7fe96337fcede7ba6436ff2c526babc05709efc777989180d1fc12ef054136";
const APPROVAL_DATE = "2026-11-14";
const EVIDENCE = [
  "census",
  "assessmentJournal",
  "pointsBatch",
  "attribution",
  "duplicateCredit",
  "protectedHistory",
  "eligibility",
] as const;

type Json = Record<string, unknown>;
type Identity = { id: string; login: string; githubUserId: string };
type ProjectTerms = {
  id: string;
  network: EscrowDeployment["network"];
  asset: string;
  assetAddress: string;
  decimals: number;
  grossBase: string;
};

function object(value: unknown, label: string, keys: readonly string[]): Json {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  const row = value as Json;
  if (
    Object.keys(row).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(row, key))
  )
    throw new Error(`${label} has unexpected or missing fields`);
  return row;
}

function list(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value))
    throw new Error(`${label} must be a lowercase SHA-256 digest`);
  return value;
}

function timestamp(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    throw new Error(`${label} must be an exact UTC timestamp`);
  return value;
}

function githubId(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !/^[1-9][0-9]{0,19}$/u.test(value) ||
    BigInt(value) > (1n << 64n) - 1n
  )
    throw new Error(`${label} must be a positive numeric GitHub actor ID`);
  return value;
}

function identity(value: unknown, label: string): Identity {
  const row = object(value, label, ["githubUserId", "githubNodeId", "login"]);
  const id = githubId(row.githubUserId, label);
  if (
    typeof row.githubNodeId !== "string" ||
    githubUserIdFromNodeId(row.githubNodeId) !== id
  )
    throw new Error(`${label} has an unknown or mismatched GitHub node ID`);
  if (typeof row.login !== "string" || !/^[A-Za-z0-9-]{1,39}$/u.test(row.login))
    throw new Error(`${label} has an invalid GitHub login`);
  return { id: row.githubNodeId, login: row.login, githubUserId: id };
}

function indexProjects(
  values: unknown,
  label: string,
  keys: readonly string[],
  approved: ReadonlySet<string>,
) {
  const indexed = new Map<string, Json>();
  for (const value of list(values, label)) {
    const row = object(value, label, keys);
    if (
      typeof row.id !== "string" ||
      !approved.has(row.id) ||
      indexed.has(row.id)
    )
      throw new Error(`${label} has a duplicate or unknown project ID`);
    indexed.set(row.id, row);
  }
  return indexed;
}

function parse(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error(`${label} is not valid UTF-8 JSON`);
  }
}

function sameAddress(
  network: ProjectTerms["network"],
  left: string,
  right: string,
) {
  return ESCROW_NETWORKS[network].family === "evm"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

export function prepareOctoberPreview(input: {
  approvedTerms: Uint8Array;
  reviewedPacket: Uint8Array;
  reviewedPacketSha256: string;
  currentRegistry: Uint8Array;
  now?: Date;
  /** Current GitHub owner authority, verified by the trusted October runner. */
  verifiedOwnerProjectIds?: ReadonlySet<string>;
}) {
  if (sha256Hex(input.approvedTerms) !== APPROVED_TERMS_SHA)
    throw new Error("Owner-approved terms digest does not match");
  const terms = parse(input.approvedTerms, "Owner-approved terms") as {
    projects: ProjectTerms[];
  };
  const approved = new Set(terms.projects.map((project) => project.id));
  const reviewedPacketSha256 = digest(
    input.reviewedPacketSha256,
    "Independently supplied review digest",
  );
  if (sha256Hex(input.reviewedPacket) !== reviewedPacketSha256)
    throw new Error("Reviewed packet digest does not match");
  const packet = object(
    parse(input.reviewedPacket, "Reviewed packet"),
    "Reviewed packet",
    [
      "schemaVersion",
      "kind",
      "period",
      "through",
      "approvedTermsSha256",
      "producerGithubId",
      "reviewerGithubId",
      "reviewedAt",
      "enforcementGeneration",
      "evidence",
      "projects",
    ],
  );
  if (
    packet.schemaVersion !== "1" ||
    packet.kind !== "reconciled-october-accepted-work" ||
    packet.period !== PERIOD ||
    packet.through !== CLOSE ||
    packet.approvedTermsSha256 !== APPROVED_TERMS_SHA
  )
    throw new Error(
      "Reviewed packet does not bind approved October and its full UTC window",
    );
  githubId(packet.producerGithubId, "Producer");
  githubId(packet.reviewerGithubId, "Reviewer");
  const enforcementGeneration = packet.enforcementGeneration;
  if (
    typeof enforcementGeneration !== "number" ||
    !Number.isSafeInteger(enforcementGeneration) ||
    enforcementGeneration < 0
  )
    throw new Error(
      "Reviewed packet must pin a nonnegative D1 enforcement generation",
    );
  const reviewedAt = timestamp(packet.reviewedAt, "Review time");
  if (reviewedAt.slice(0, 10) < APPROVAL_DATE)
    throw new Error("Review predates the owner decision");
  const evidence = object(packet.evidence, "Evidence digests", EVIDENCE);
  for (const key of EVIDENCE) digest(evidence[key], `Evidence ${key}`);
  const registry = object(
    parse(input.currentRegistry, "Current registry capture"),
    "Current registry capture",
    [
      "schemaVersion",
      "origin",
      "capturedAt",
      "enforcementGeneration",
      "projects",
    ],
  );
  if (registry.schemaVersion !== "1" || registry.origin !== "https://slop.cash")
    throw new Error("Expected a production registry capture");
  if (registry.enforcementGeneration !== enforcementGeneration)
    throw new Error("D1 enforcement generation changed after review");
  const capturedAt = timestamp(registry.capturedAt, "Registry capture time");
  const now = (input.now ?? new Date()).toISOString();
  if (capturedAt < reviewedAt || capturedAt > now)
    throw new Error("Registry capture is stale or from the future");

  const reviewed = indexProjects(
    packet.projects,
    "Reviewed projects",
    [
      "id",
      "revision",
      "manifestSha256",
      "from",
      "reconciliation",
      "identities",
      "weights",
    ],
    approved,
  );
  const current = indexProjects(
    registry.projects,
    "Current projects",
    ["id", "revision", "manifestSha256", "manifestText", "restriction"],
    approved,
  );
  if (reviewed.size === 0)
    throw new Error("No approved project is selected for review");
  const omittedProjects = terms.projects
    .filter(({ id }) => !reviewed.has(id))
    .map(({ id }) => ({ id, status: "omitted-no-reviewed-weights" as const }));
  const usedVaults = new Set<string>();
  const projects = terms.projects.flatMap((term) => {
    const { id, network, asset, assetAddress, decimals, grossBase } = term;
    const review = reviewed.get(id);
    if (!review) return [];
    const entry = current.get(id);
    if (!entry)
      throw new Error(`${id} is missing from the current registry capture`);
    const manifestSha256 = digest(
      entry.manifestSha256,
      `${id} manifest digest`,
    );
    if (
      typeof entry.revision !== "number" ||
      !Number.isSafeInteger(entry.revision) ||
      entry.revision < 1 ||
      entry.revision !== review.revision ||
      manifestSha256 !== review.manifestSha256 ||
      typeof entry.manifestText !== "string" ||
      sha256Hex(entry.manifestText) !== manifestSha256
    )
      throw new Error(`${id} has a stale or altered registry binding`);
    const policy = assertProjectDefinition(
      parse(new TextEncoder().encode(entry.manifestText), `${id} manifest`),
    );
    // D1's exact canonical manifest is a single JSON line. This also keeps
    // the normal monthly writer's one-statement-per-line output unambiguous.
    if (JSON.stringify(policy) !== entry.manifestText)
      throw new Error(
        `${id} does not contain the exact canonical manifest bytes`,
      );
    if (
      policy.id !== id ||
      policy.status !== "active" ||
      entry.restriction !== "clear" ||
      (!(
        policy.authority.state === "verified" &&
        policy.terms.receiptPolicy.state === "active"
      ) &&
        !input.verifiedOwnerProjectIds?.has(id))
    )
      throw new Error(
        `${id} needs active clearance and verified current owner authority`,
      );
    const route = ESCROW_NETWORKS[network];
    const vaults = policy.escrow?.deployments ?? [];
    const deployment = vaults[0];
    if (
      vaults.length !== 1 ||
      !deployment ||
      deployment.network !== network ||
      !sameAddress(network, deployment.asset, assetAddress)
    )
      throw new Error(
        `${id} needs exactly one registered vault on the approved asset and network`,
      );
    const vaultKey = `${network}:${route.family === "evm" ? deployment.vault.toLowerCase() : deployment.vault}`;
    if (usedVaults.has(vaultKey))
      throw new Error(`${id} repeats another project's vault`);
    usedVaults.add(vaultKey);
    if (
      policy.reward.kind !== "monthly-pool" ||
      policy.reward.chain !== route.chain ||
      policy.reward.currency !== asset ||
      policy.reward.feeBasisPoints !== 200 ||
      policy.escrow?.feeMode !== "deduct-from-gross" ||
      policy.escrow.feeBasisPoints !== 200 ||
      !route.assets.some(
        (accepted) =>
          accepted.symbol === asset &&
          accepted.decimals === decimals &&
          sameAddress(network, accepted.address, assetAddress),
      ) ||
      (policy.rewardAsset &&
        (policy.rewardAsset.decimals !== decimals ||
          !sameAddress(network, policy.rewardAsset.address, assetAddress)))
    )
      throw new Error(
        `${id} registry economics differ from the approved terms`,
      );
    if (
      !isBaseUnits(grossBase) ||
      BigInt(grossBase) <= 0n ||
      BigInt(grossBase) > maxBaseUnitsForChain(route.chain)
    )
      throw new Error(`${id} has an invalid approved gross pool`);
    const from =
      policy.reward.rewardStartAt > `${PERIOD}-01T00:00:00.000Z`
        ? policy.reward.rewardStartAt
        : `${PERIOD}-01T00:00:00.000Z`;
    if (
      review.from !== from ||
      from >= CLOSE ||
      review.reconciliation !== "complete"
    )
      throw new Error(`${id} has unreconciled or incomplete October coverage`);

    const identities = new Map<string, Identity>();
    for (const value of list(review.identities, `${id} reviewed identities`)) {
      const actor = identity(value, `${id} actor`);
      if (identities.has(actor.githubUserId))
        throw new Error(`${id} has a duplicate reviewed GitHub ID`);
      identities.set(actor.githubUserId, actor);
    }
    const seen = new Set<string>();
    const weighted: { actor: Identity; points: bigint }[] = [];
    for (const value of list(review.weights, `${id} reviewed weights`)) {
      const row = object(value, `${id} weight`, [
        "githubUserId",
        "acceptedWorkPoints",
        "eligible",
      ]);
      const actorId = githubId(row.githubUserId, `${id} weight`);
      const actor = identities.get(actorId);
      if (!actor || seen.has(actorId))
        throw new Error(`${id} has a duplicate or unknown weighted GitHub ID`);
      seen.add(actorId);
      if (
        typeof row.acceptedWorkPoints !== "number" ||
        !Number.isSafeInteger(row.acceptedWorkPoints) ||
        row.acceptedWorkPoints < 0 ||
        typeof row.eligible !== "boolean"
      )
        throw new Error(
          `${id} has invalid accepted-work weights or eligibility`,
        );
      if (row.eligible && payoutExclusionFor(policy, PERIOD, actor.id))
        throw new Error(`${id} marks a registry-excluded contributor eligible`);
      if (row.eligible && row.acceptedWorkPoints > 0)
        weighted.push({ actor, points: BigInt(row.acceptedWorkPoints) });
    }
    if (seen.size !== identities.size)
      throw new Error(
        `${id} has reviewed identities without a weight disposition`,
      );
    if (weighted.length === 0)
      throw new Error(`${id} has no positive eligible accepted-work weights`);
    const allocations = allocateWeightedRows(
      BigInt(grossBase),
      weighted,
      ({ points }) => points,
      (left, right) => compareActors(left.actor, right.actor),
    );
    const awards = allocations
      .map(({ row: { actor, points }, amount }) => {
        const fee = ordinaryFee(amount);
        return {
          githubUserId: actor.githubUserId,
          login: actor.login,
          sourceDigest: escrowAwardOrigin(id, PERIOD, actor.githubUserId),
          acceptedWorkPoints: points.toString(),
          grossBase: amount.toString(),
          feeBase: fee.toString(),
          netBase: (amount - fee).toString(),
        };
      })
      .sort((left, right) =>
        left.githubUserId.localeCompare(right.githubUserId, "en"),
      );
    const sum = awards.reduce(
      (total, award) => total + BigInt(award.grossBase),
      0n,
    );
    if (sum !== BigInt(grossBase))
      throw new Error(`${id} proposal does not conserve the approved gross`);
    const feeTotal = awards.reduce(
      (total, award) => total + BigInt(award.feeBase),
      0n,
    );
    const monthlyBase: MonthlyBase = {
      projectId: id,
      period: PERIOD,
      manifestSha256,
      sourceSnapshotSha256: reviewedPacketSha256,
      capBase: grossBase,
      rows: awards.map(({ githubUserId, login, grossBase, sourceDigest }) => ({
        githubUserId,
        login,
        grossBase,
        sourceDigest,
      })),
    };
    return [
      {
        id,
        manifest: entry.manifestText,
        revision: entry.revision,
        network,
        vault: deployment.vault,
        asset,
        assetAddress,
        decimals,
        grossBase,
        feeBase: feeTotal.toString(),
        netBase: (sum - feeTotal).toString(),
        monthlyBase,
        awards,
      },
    ];
  });
  return {
    schemaVersion: "1",
    kind: "october-payout-review-only",
    period: PERIOD,
    through: CLOSE,
    approvedTermsSha256: APPROVED_TERMS_SHA,
    reviewedPacketSha256,
    registryCaptureSha256: sha256Hex(input.currentRegistry),
    capturedAt,
    enforcementGeneration,
    evidence,
    projects,
    omittedProjects,
  };
}
