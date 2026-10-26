import type { SolanaEscrowConfig } from "../../contracts/solana/adapter";
import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import { assertPayoutExclusionTransition } from "../../src/lib/payout-exclusions.mjs";
import type {
  EnforcementAction,
  EnforcementActorRole,
  EnforcementPreview,
  GithubActor,
  ProjectApplication,
  ProjectEnforcement,
  ProjectEnforcementState,
  ProjectRecord,
  ProjectSetupStatus,
  PublicProjectApplication,
  SetupAuthority,
  WebSession,
} from "../../src/lib/project-contracts";
import {
  type RepositoryIdentity,
  validRepositoryPath,
} from "../../src/lib/project-contracts";
import { assertProjectPolicyTransition } from "../../src/lib/project-policy.mjs";
import { classifyRevisionChanges } from "../../src/lib/project-revision-changes";
import {
  assertProjectDefinition,
  assertProjectRegistry,
  monthlyAmountDisplay,
  PROJECT_SKILL_TEMPLATES,
  parseAssetAmount,
} from "../../src/lib/project-schema.mjs";
import { publishesGeneratedSkills } from "../../src/lib/project-skill.mjs";
import type { ProjectDefinition } from "../../src/lib/projects.mjs";
import {
  REWARD_ASSET_NETWORKS,
  type RewardAsset,
  rewardAssetChoice,
  sameRewardAsset,
} from "../../src/lib/reward-asset.mjs";
import type { SecurityBountyTerms } from "../../src/lib/security-bounty.mjs";
import {
  isVaultCreationId,
  type VaultSetupInput,
} from "../../src/lib/vault-setup";
import {
  apiErrorResponse,
  exactKeys,
  fail,
  isSameOriginJsonWrite,
  json as jsonResponse,
  PROJECT_ID,
  pathParts,
  requireActor,
} from "../http";
import { handleSolanaFunding } from "../payments/solana-funding";
import type { readSecurityProgramFunds } from "../security/program-funds";
import { readJsonObject } from "../trace/validation";
import type { VettingClearance } from "../vetting/persistence";
import {
  PROJECT_API_CONTRACT_VERSION,
  type ProjectPersistence,
  type RepositoryControl,
} from "./contracts";
import {
  cachedPublicResponse,
  type EdgeCache,
  PUBLIC_PROJECT_CACHE_CONTROL,
  purgeProjectCache,
} from "./edge-cache";
import {
  accountAppealState,
  activeAccountBans,
  activeRestrictions,
  awaitsMaliciousDecision,
  bannedMaintainerIds,
  ENFORCEMENT_ACTIONS,
  enforcedManifest,
  enforcementRevisionReason,
  type ProjectRestriction,
  planEnforcement,
  projectAppealState,
  projectRestriction,
  publicRestrictionOf,
  repositoryIdentity,
  restrictionForRepository,
  sameRepositoryIdentity,
} from "./enforcement";
import {
  type GithubFetch,
  GithubLookupError,
  listOwnedRepositories,
  lookupGitHubActor,
  lookupGitHubRepository,
  validGithubLogin,
} from "./github-lookup";
import {
  type AccessCheck,
  projectSetupStatus,
  type RepositoryAccessReader,
  readRepositoryAccess,
  type ScanRequest,
  type ScanRequester,
  setupAuthority,
} from "./setup";
import { TokenMetadataError, type TokenMetadataReader } from "./token-metadata";
import {
  attachBountyVault,
  attachOrdinaryVault,
  type OwnerVaultSetup,
} from "./vault-setup";

export type ProjectApiDependencies = {
  persistence: ProjectPersistence;
  vaultSetup?: OwnerVaultSetup;
  /** Private registry scope; never resolves ordinary vaults or request RPCs. */
  securitySolanaFundingConfig?: (
    projectId: string,
    network: string,
    vault: string,
  ) => Promise<SolanaEscrowConfig>;
  adminGithubIds: ReadonlySet<string>;
  /** Private trace access is separate from project administration. */
  traceOperatorGithubIds?: ReadonlySet<string>;
  /** GitHub actor IDs with the project moderation role (PRD ADM-05, ADM-06). */
  moderatorGithubIds: ReadonlySet<string>;
  now: () => Date;
  randomId: () => string;
  /** Resolves the GitHub account behind the site sign-in session cookie. */
  sessionActor: (request: Request) => Promise<GithubActor | null>;
  /** Reads a reward token's decimals from chain once, at submission or change. */
  readTokenMetadata: TokenMetadataReader;
  /** Public GitHub reads for the setup form, with an optional server token. */
  github: { fetch: GithubFetch; token?: string; apiOrigin?: string };
  /** Edge cache for public reads; absent in tests and local tooling. */
  cache?: EdgeCache;
  waitUntil?: (promise: Promise<unknown>) => void;
  /**
   * Security vetting of a manifest's executable content through a revision
   * (PRD VET-01). Only "cleared" lets a revision activate or serve skills.
   */
  vettingClearance: (
    projectId: string,
    manifest: ProjectDefinition,
    throughRevision: number,
    forReinstatement?: boolean,
  ) => Promise<VettingClearance>;
  /** Public GitHub facts: the manifest matches its repositories and steward. */
  repositoryControl: (
    manifest: ProjectDefinition,
    repository?: RepositoryIdentity,
  ) => Promise<RepositoryControl>;
  /**
   * The Slopbot installation and the account's exact repository permission.
   * Absent where Slopbot is not connected; setup then reports a retry.
   */
  repositoryAccess?: RepositoryAccessReader;
  /** Queues a malicious-code scan of a project's current revision. */
  requestScan?: ScanRequester;
  /** Finalized funds in a reviewed, separate bounty vault. Never client evidence. */
  securityProgramFunds?: (
    projectId: string,
    program: SecurityBountyTerms,
  ) => ReturnType<typeof readSecurityProgramFunds>;
};

const APPLICATION_ID = /^app_[A-Za-z0-9_-]{8,72}$/u;

function json(
  status: number,
  body: Record<string, unknown>,
  cacheControl = "no-store",
): Response {
  return jsonResponse(status, body, {
    cacheControl,
    headers: { "x-slop-project-api-contract": PROJECT_API_CONTRACT_VERSION },
  });
}

function boundedText(
  value: unknown,
  name: string,
  min: number,
  max: number,
): string {
  if (typeof value !== "string")
    fail(400, "invalid_request", `Invalid ${name}`);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    fail(400, "invalid_request", `${name} must be ${min} to ${max} characters`);
  }
  return trimmed;
}

function invalidManifest(error: unknown): never {
  fail(
    422,
    "invalid_manifest",
    error instanceof Error ? error.message : "Project manifest is invalid",
  );
}

function canonicalManifest(value: unknown): {
  manifest: ProjectDefinition;
  text: string;
} {
  let manifest: ProjectDefinition;
  try {
    manifest = assertProjectDefinition(value) as ProjectDefinition;
  } catch (error) {
    invalidManifest(error);
  }
  return { manifest, text: JSON.stringify(manifest) };
}

/**
 * A new project starts paused, unverified and unfunded, with generated skills
 * and one repository, whose scan binds one integration branch. Listing tier,
 * repository receipt authority, terms activation, vaults and payments arrive
 * through later revisions. Applications stored before self-service setup may
 * still carry the pledged review budget they were submitted with.
 */
function assertNewProjectManifest(
  manifest: ProjectDefinition,
  { storedApplication = false }: { storedApplication?: boolean } = {},
): void {
  const reward = manifest.reward;
  const reviewBudget =
    reward.kind === "monthly-pool" ? reward.reviewBudget : undefined;
  const rules: [boolean, string][] = [
    [manifest.status === "paused", "New projects must start paused"],
    [
      manifest.listingTier === "community",
      "New projects are listed in the community tier",
    ],
    [
      // Slopbot reads authority for the one repository the manifest binds
      // by id, so a project created without an admin names only that one.
      manifest.repositories.length === 1,
      "A new project lists exactly one repository",
    ],
    [
      manifest.skill.publishAtRoot === false,
      "Root skill publication is retired; project skills are served at /projects/<id>/SKILL.md",
    ],
    [
      manifest.skill.sourcePath === PROJECT_SKILL_TEMPLATES.contributor &&
        manifest.reviewSkill.sourcePath === PROJECT_SKILL_TEMPLATES.reviewer,
      "New projects use generated skills from the canonical templates",
    ],
    [
      publishesGeneratedSkills(manifest),
      "Complete the contribution rules that generate the project skills",
    ],
    [
      manifest.authority.state === "unverified" &&
        manifest.authority.proof === null,
      "Repository receipt authority is added in a later revision with its proof",
    ],
    [
      manifest.terms.receiptPolicy.state === "pending-authority-activation",
      "Receipt policy activates only after repository receipt authority",
    ],
    [
      manifest.terms.externalPrize === null,
      "External prizes are not offered through self-service setup",
    ],
    [
      reward.kind === "monthly-pool" &&
        reward.paymentMode === "disabled" &&
        reward.committedMinor === "0" &&
        reward.fundingState === "pledged" &&
        (reviewBudget === undefined ||
          (storedApplication &&
            reviewBudget.paymentMode === "disabled" &&
            reviewBudget.committedMinor === "0" &&
            reviewBudget.fundingState === "pledged")),
      "A new project may only pledge a monthly amount with payments disabled; a separate review budget is not offered",
    ],
    [
      (manifest.funding.addresses ?? []).length === 0 &&
        fundingCommitments(manifest).length === 0 &&
        (manifest.escrow?.deployments ?? []).length === 0,
      "Vault deployments and funding routes are added after setup",
    ],
    [
      manifest.securityBounty === undefined ||
        (["paused", "pending-approval"].includes(
          manifest.securityBounty.status,
        ) &&
          manifest.securityBounty.funding.state === "pledged" &&
          (manifest.securityBounty.settlement?.deployments.length ?? 0) === 0),
      "A security bounty program starts paused with pledged funding and no unverified vault",
    ],
  ];
  for (const [valid, message] of rules) {
    if (!valid) fail(422, "invalid_manifest", message);
  }
}

/** Historical commitment records; the schema keeps them for old revisions. */
function fundingCommitments(manifest: ProjectDefinition): unknown[] {
  return (manifest.funding as { commitments?: unknown[] }).commitments ?? [];
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

/** Owner terms affect later receipts. Existing cases retain their receipt terms. */
async function ownerSecurityProgram(
  previous: ProjectDefinition,
  next: ProjectDefinition,
  status: SecurityBountyTerms["status"] | undefined,
  actor: GithubActor,
  canManageContacts: boolean,
  deps: ProjectApiDependencies,
): Promise<ProjectDefinition> {
  const before = previous.securityBounty;
  const after = next.securityBounty;
  if (after === undefined) {
    if (before !== undefined)
      fail(
        422,
        "security_program_required",
        "Close the bounty program instead of deleting it; existing reports and awards remain available",
      );
    return next;
  }
  // Contacts receive private-case roles. Ordinary write access cannot grant
  // or remove them; the project steward or a repository admin manages them.
  if (!canManageContacts && before !== undefined) {
    if (
      !sameValue(before.approvers, after.approvers) ||
      !sameValue(before.sponsor, after.sponsor)
    )
      fail(
        422,
        "security_contacts_restricted",
        "Only the project steward or a repository admin can change bounty contacts or the sponsor",
      );
  } else if (
    !canManageContacts &&
    ([
      ...after.approvers.technical,
      ...after.approvers.financial,
      ...after.approvers.dispute,
    ].some((person) => person.githubId !== actor.githubId) ||
      (after.sponsor.githubId !== null &&
        after.sponsor.githubId !== actor.githubId))
  )
    fail(
      422,
      "security_contacts_restricted",
      "Only the project steward or a repository admin can name other bounty contacts or a sponsor",
    );
  if (!sameValue(before?.settlement, after.settlement))
    fail(
      422,
      "security_vault_restricted",
      "Keep the verified bounty vault; a new vault needs verified registration",
    );
  if (
    before?.settlement &&
    !sameValue(
      {
        currency: before.amount.currency,
        decimals: before.amount.decimals,
        network: before.amount.network,
      },
      {
        currency: after.amount.currency,
        decimals: after.amount.decimals,
        network: after.amount.network,
      },
    )
  )
    fail(
      422,
      "security_asset_restricted",
      "A funded bounty program keeps its network and asset",
    );
  const funds = await deps.securityProgramFunds?.(next.id, after);
  if (status === "open" && (!funds || BigInt(funds.availableMinor) <= 0n))
    fail(
      422,
      "security_funding_unavailable",
      "Opening requires available funds in a verified bounty vault with a current finalized balance",
    );
  return {
    ...next,
    securityBounty: {
      ...after,
      status: status ?? after.status,
      funding:
        funds && BigInt(funds.availableMinor) > 0n
          ? {
              state: "verified-available",
              evidence: `Finalized bounty vault balance for ${next.id} at ${funds.snapshotAt}`,
              verifiedAt: funds.snapshotAt,
            }
          : // Pausing does not revoke the recorded funding proof. Award reads
            // still require a fresh snapshot, even after a closed program's
            // balances recover. Existing reports can then receive an award.
            before?.settlement
            ? before.funding
            : { state: "pledged" },
    },
  };
}

/** Every UTC month from the reward start through `last`, in order. */
function monthsThrough(rewardStartAt: string, last: string): string[] {
  const months: string[] = [];
  const month = new Date(`${rewardStartAt.slice(0, 7)}-01T00:00:00Z`);
  for (
    let id = month.toISOString().slice(0, 7);
    id <= last;
    month.setUTCMonth(month.getUTCMonth() + 1),
      id = month.toISOString().slice(0, 7)
  )
    months.push(id);
  return months;
}

/**
 * Applies an owner's financial change prospectively (PRD section 4:
 * "Economic changes are prospective"). The monthly amount, and for an
 * unfunded project its network and asset, may change. Every month from the
 * reward start through the open UTC cycle keeps the amount it had through
 * the existing `cycleCaps` override, so the new amount starts with the next
 * cycle. A closed month waits up to three days for its proposal, which reads
 * the newest revision, so the closed months need the override too. Funded money keeps its network,
 * asset, vault and routes, no separate review budget can be added, and no
 * owner revision adds or changes a vault record.
 */
function prospectiveFinancialChange(
  previous: ProjectDefinition,
  next: ProjectDefinition,
  now: Date,
): ProjectDefinition {
  const before = previous.reward;
  const after = next.reward;
  if (before.kind !== "monthly-pool" || after.kind !== "monthly-pool")
    fail(
      422,
      "financial_change_restricted",
      "Only a monthly reward changes through owner self-service",
    );
  if (!sameValue(before.reviewBudget, after.reviewBudget))
    fail(
      422,
      "financial_change_restricted",
      "A separate review budget is not offered; review credit comes from the shared scoring policy",
    );
  if (!sameValue(previous.funding, next.funding))
    fail(
      422,
      "financial_change_restricted",
      "Funding routes do not change through owner self-service",
    );
  // This API does not read chain state, so it cannot verify that a vault
  // record names a vault from the reviewed factory or program with the
  // project's owner, asset and purpose. A sponsor deposits to every recorded
  // vault, so an ordinary manifest edit never adds or changes one. The
  // separate owner vault-setup route verifies chain state before appending it.
  if (
    !sameValue(
      previous.escrow?.deployments ?? [],
      next.escrow?.deployments ?? [],
    )
  )
    fail(
      422,
      "financial_change_restricted",
      "Use vault setup to register a verified owner vault; a manifest edit cannot change vault records",
    );
  const funded =
    before.fundingState === "committed" ||
    BigInt(before.committedMinor) > 0n ||
    before.paymentMode === "enabled" ||
    (previous.escrow?.deployments ?? []).length > 0 ||
    (previous.funding.addresses ?? []).length > 0 ||
    fundingCommitments(previous).length > 0;
  if (
    funded &&
    (!sameValue(previous.rewardAsset, next.rewardAsset) ||
      !sameValue(previous.escrow, next.escrow))
  )
    fail(
      422,
      "financial_change_restricted",
      "A funded project keeps its network, asset and vault",
    );
  const fixed = (reward: typeof before) => {
    const {
      monthlyCapMinor: _cap,
      monthlyCapDisplay: _display,
      cycleCaps: _cycleCaps,
      chain: _chain,
      currency: _currency,
      feeBasisPoints: _fee,
      // Checked for every revision by assertPayoutExclusionTransition.
      payoutExclusions: _exclusions,
      ...rest
    } = reward;
    return rest;
  };
  const assetChanged =
    !sameValue(previous.rewardAsset, next.rewardAsset) ||
    before.chain !== after.chain ||
    before.currency !== after.currency;
  if (
    !sameValue(fixed(before), fixed(after)) ||
    (assetChanged
      ? after.cycleCaps !== undefined
      : !sameValue(before.cycleCaps, after.cycleCaps))
  )
    fail(
      422,
      "financial_change_restricted",
      "Only the monthly amount, network and asset change through owner self-service",
    );
  const cycleId = now.toISOString().slice(0, 7);
  if (assetChanged) {
    // Old caps remain in immutable revisions of the old asset. The new
    // asset starts next month: every month from the reward start through
    // the open month has no pool in the new asset. The reward start, and
    // with it the accepted score history, does not move.
    const zeroCaps = monthsThrough(before.rewardStartAt, cycleId).map((id) => ({
      cycleId: id,
      monthlyCapMinor: "0",
    }));
    const { cycleCaps: _none, ...reward } = after;
    return {
      ...next,
      reward:
        zeroCaps.length === 0 ? reward : { ...reward, cycleCaps: zeroCaps },
    };
  }
  if (before.monthlyCapMinor === after.monthlyCapMinor) return next;
  // An unlisted month used the previous default amount; it keeps it.
  const caps = before.cycleCaps ?? [];
  const listed = new Set(caps.map((cap) => cap.cycleId));
  const kept = monthsThrough(before.rewardStartAt, cycleId)
    .filter((id) => !listed.has(id))
    .map((id) => ({ cycleId: id, monthlyCapMinor: before.monthlyCapMinor }));
  if (kept.length === 0) return next;
  return {
    ...next,
    reward: {
      ...after,
      cycleCaps: [...caps, ...kept].sort((left, right) =>
        left.cycleId.localeCompare(right.cycleId),
      ),
    },
  };
}

/**
 * Replaces a submitted reward asset with its verified form. An unchanged
 * asset keeps its stored decimals; a new or changed one is read from chain
 * once. The paid symbol and network of the pool follow the asset.
 */
async function verifiedRewardAsset(
  value: unknown,
  prior: RewardAsset | undefined,
  deps: ProjectApiDependencies,
): Promise<unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return value;
  const manifest = value as Record<string, unknown>;
  if (!Object.hasOwn(manifest, "rewardAsset")) return value;
  const submitted = manifest.rewardAsset as Record<string, unknown> | null;
  let choice: ReturnType<typeof rewardAssetChoice>;
  try {
    choice = rewardAssetChoice(
      String(submitted?.network ?? ""),
      String(submitted?.kind ?? ""),
      String(submitted?.address ?? ""),
      String(submitted?.symbol ?? ""),
    );
  } catch (error) {
    invalidManifest(error);
  }
  const network = REWARD_ASSET_NETWORKS[choice.network];
  let asset: RewardAsset;
  if (prior !== undefined && sameRewardAsset(prior, choice as RewardAsset)) {
    asset = prior;
  } else if (choice.kind === "stablecoin") {
    asset = {
      ...choice,
      decimals: network.stablecoin.decimals,
      chainId: network.chainId,
      cluster: network.cluster,
      verifiedAt: deps.now().toISOString(),
    };
  } else {
    let metadata: Awaited<ReturnType<TokenMetadataReader>>;
    try {
      metadata = await deps.readTokenMetadata(choice.network, choice.address);
    } catch (error) {
      fail(
        error instanceof TokenMetadataError ? 422 : 503,
        "reward_asset_unverified",
        error instanceof TokenMetadataError
          ? `The reward token could not be verified on ${network.name}: ${error.message}`
          : `${network.name} could not be reached to verify the reward token. Try again.`,
      );
    }
    asset = {
      ...choice,
      symbol: metadata.symbol ?? choice.symbol,
      decimals: metadata.decimals,
      chainId: network.chainId,
      cluster: network.cluster,
      verifiedAt: deps.now().toISOString(),
    };
  }
  const reward = manifest.reward as Record<string, unknown> | undefined;
  return {
    ...manifest,
    rewardAsset: asset,
    ...(reward?.kind === "monthly-pool"
      ? { reward: { ...reward, chain: asset.network, currency: asset.symbol } }
      : {}),
  };
}

/**
 * Sets the monthly amount from `monthlyAmount`, a decimal number of whole
 * units of the verified reward asset. The amount is stored in that asset's
 * base units (owner decision D11), so a token amount is converted only after
 * its decimals are read from chain. Without a reward asset, the pool is the
 * network's reviewed 6-decimal stablecoin.
 */
function withMonthlyAmount(value: unknown, amount: unknown): unknown {
  if (amount === undefined) return value;
  const manifest =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  const reward = manifest?.reward as Record<string, unknown> | undefined;
  if (manifest === null || reward?.kind !== "monthly-pool")
    fail(422, "invalid_manifest", "A monthly amount needs a monthly pool");
  const asset = manifest.rewardAsset as RewardAsset | undefined;
  let monthlyCapMinor: string;
  let monthlyCapDisplay: string;
  try {
    monthlyCapMinor = parseAssetAmount(amount as string, asset?.decimals ?? 6);
    monthlyCapDisplay = monthlyAmountDisplay(monthlyCapMinor, asset);
  } catch (error) {
    fail(
      422,
      "invalid_manifest",
      `The monthly amount is invalid: ${error instanceof Error ? error.message : "check the amount"}`,
    );
  }
  return {
    ...manifest,
    reward: { ...reward, monthlyCapMinor, monthlyCapDisplay },
  };
}

/**
 * A review budget added or newly funded may not shrink the contributor pool
 * or reach back into an open or closed cycle.
 */
function assertReviewBudgetTransition(
  prior: ProjectDefinition,
  next: ProjectDefinition,
  now: Date,
): void {
  if (
    prior.reward.kind !== "monthly-pool" ||
    next.reward.kind !== "monthly-pool"
  )
    return;
  const priorBudget = prior.reward.reviewBudget;
  const nextBudget = next.reward.reviewBudget;
  if (!nextBudget) return;
  const changesBudget =
    !priorBudget ||
    (priorBudget.fundingState !== "committed" &&
      nextBudget.fundingState === "committed");
  if (!changesBudget) return;
  if (
    BigInt(next.reward.monthlyCapMinor) < BigInt(prior.reward.monthlyCapMinor)
  ) {
    fail(
      422,
      "invalid_manifest",
      "A review budget cannot be added or funded while the contributor pool cap shrinks",
    );
  }
  const nextCycle = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  if (Date.parse(nextBudget.effectiveAt) < nextCycle) {
    fail(
      422,
      "invalid_manifest",
      "A review budget cannot affect an open or past cycle",
    );
  }
}

/**
 * Checks the candidate against the live registry. Only a manifest revision or a reviewed update application
 * replaces the listed project with the same id; a new application or an
 * approval must conflict with a listed project that already has that id.
 */
function assertRegistryWith(
  projects: ProjectRecord[],
  candidate: ProjectDefinition,
  { replaces }: { replaces: boolean },
): void {
  try {
    assertProjectRegistry([
      ...projects
        .filter((project) => !replaces || project.id !== candidate.id)
        .map((project) => project.manifest),
      candidate,
    ]);
  } catch (error) {
    fail(
      409,
      "registry_conflict",
      error instanceof Error ? error.message : "Project conflicts",
    );
  }
}

function publicApplication(
  application: ProjectApplication,
): PublicProjectApplication {
  return {
    id: application.id,
    projectId: application.projectId,
    repository: application.manifest.repositories[0]?.id ?? null,
    manifest: application.manifest,
    manifestSha256: application.manifestSha256,
    acceptanceCriteria: application.acceptanceCriteria,
    applicant: application.applicant,
    submittedAt: application.submittedAt,
    status: application.status,
    adminNotification: application.adminNotification,
    adminNotificationAt: application.adminNotificationAt,
    decidedAt: application.decidedAt,
    decidedBy: application.decidedBy,
    decisionReason: application.decisionReason,
    githubCheck: application.githubCheck,
    expectedRevision: application.expectedRevision,
    changeReason: application.changeReason,
    referrer: application.referrer,
  };
}

function adminProject(project: ProjectRecord): ProjectRecord {
  return {
    id: project.id,
    status: project.status,
    revision: project.revision,
    manifestSha256: project.manifestSha256,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    sourceApplicationId: project.sourceApplicationId,
    referrer: project.referrer,
    manifest: project.manifest,
  };
}

function sessionBody(
  actor: GithubActor,
  deps: ProjectApiDependencies,
): WebSession {
  return {
    ...actor,
    admin: deps.adminGithubIds.has(actor.githubId),
    traceOperator: deps.traceOperatorGithubIds?.has(actor.githubId) ?? false,
  };
}

async function requireSession(
  request: Request,
  deps: ProjectApiDependencies,
): Promise<WebSession> {
  return sessionBody(await requireActor(request, deps), deps);
}

async function requireAdmin(
  request: Request,
  deps: ProjectApiDependencies,
): Promise<WebSession> {
  const session = await requireSession(request, deps);
  if (!session.admin) fail(403, "forbidden", "Admin access is required");
  return session;
}

/**
 * Resolves the referrer an applicant named (PRJ-05). The login must belong
 * to an account that has signed in to slop.cash, and it cannot be the
 * applicant, the manifest steward or a Slop team account. A refused referral
 * fails the submission with the reason, so the applicant can clear it or
 * fix it; it is never dropped silently.
 */
async function resolveReferrer(
  value: unknown,
  manifest: ProjectDefinition,
  applicant: GithubActor,
  deps: ProjectApiDependencies,
): Promise<GithubActor | null> {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !validGithubLogin(value))
    fail(422, "invalid_referrer", "The referrer must be a GitHub login.");
  const referrer = await lookupGitHubActor(
    deps.github.fetch,
    deps.github.token,
    value,
    deps.github.apiOrigin,
  );
  if (
    referrer === null ||
    !(await deps.persistence.hasSignedInActor(referrer.githubId))
  )
    fail(
      422,
      "invalid_referrer",
      `@${value} has not signed in to slop.cash, so they cannot be recorded as the referrer. Clear the referral or ask them to sign in first.`,
    );
  if (referrer.githubId === applicant.githubId)
    fail(422, "invalid_referrer", "You cannot refer your own project.");
  if (
    referrer.githubId === manifest.steward.github.actorId ||
    referrer.githubLogin.toLowerCase() ===
      manifest.steward.github.login.toLowerCase()
  )
    fail(
      422,
      "invalid_referrer",
      "The project steward cannot be recorded as its referrer.",
    );
  if (
    deps.adminGithubIds.has(referrer.githubId) ||
    deps.moderatorGithubIds.has(referrer.githubId)
  )
    fail(
      422,
      "invalid_referrer",
      "Slop team accounts cannot be recorded as referrers.",
    );
  return referrer;
}

/**
 * The account's current authority over the manifest's repository, read
 * through the Slopbot installation (owner decision D11). A manifest that
 * contradicts GitHub's repository facts is refused; an unavailable GitHub or
 * Slopbot answer means retry, never an admin task.
 */
async function currentAuthority(
  deps: ProjectApiDependencies,
  manifest: ProjectDefinition,
  actor: GithubActor,
): Promise<{ authority: SetupAuthority; access: AccessCheck }> {
  const access = await readRepositoryAccess(
    deps.repositoryAccess,
    manifest,
    actor,
  );
  const authority = setupAuthority(access, actor, manifest.repositories[0].id);
  if (authority.state !== "verified") return { authority, access };
  let control: RepositoryControl;
  try {
    control = await deps.repositoryControl(
      manifest,
      access.state === "read" && access.access.installation === "installed"
        ? access.access.repository
        : undefined,
    );
  } catch {
    const message = "GitHub could not be checked. Try again.";
    return {
      authority: { state: "retry", message },
      access: { state: "retry", message },
    };
  }
  if (control.state === "mismatch")
    fail(422, "invalid_manifest", control.reason);
  return { authority, access };
}

/**
 * Refuses a create, publish or revision without current authority. A
 * missing or suspended Slopbot installation is its own refusal, so the page
 * can link the installation.
 */
function requireAuthority(checked: {
  authority: SetupAuthority;
  access: AccessCheck;
}): void {
  const { authority, access } = checked;
  if (authority.state === "retry")
    throw new GithubLookupError(503, "github_unavailable", authority.message);
  if (access.state === "read" && access.access.installation !== "installed")
    fail(409, "slopbot_required", authority.message);
  if (authority.state === "denied")
    fail(403, "authority_required", authority.message);
}

function isProjectStewardOrAdmin(
  manifest: ProjectDefinition,
  actor: GithubActor,
  access: AccessCheck,
): boolean {
  return (
    actor.githubId === String(manifest.steward.github.actorId) ||
    (access.state === "read" &&
      access.access.installation === "installed" &&
      access.access.permission === "admin")
  );
}

function actorOf(session: WebSession): GithubActor {
  return { githubId: session.githubId, githubLogin: session.githubLogin };
}

async function queueScan(
  deps: ProjectApiDependencies,
  project: ProjectRecord,
  actor: GithubActor,
  reason: string,
): Promise<ScanRequest> {
  if (deps.requestScan === undefined)
    return {
      state: "unavailable",
      message:
        "The security scan service is not available yet, so the scan cannot be queued. Check again later.",
    };
  try {
    return await deps.requestScan(project, actor, reason);
  } catch {
    return {
      state: "unavailable",
      message: "The scan could not be queued. Check again.",
    };
  }
}

/**
 * Runs every setup check for `actor` and acts on the result: it queues a
 * scan of an unscanned or stale revision, and activates a paused project
 * whose owner has write access read through Slopbot, whose repository has
 * Slopbot installed and whose exact content has a clean scan. Activation
 * changes only the status, so the clearance carries over.
 */
async function runSetupCheck(
  request: Request,
  deps: ProjectApiDependencies,
  initial: ProjectRecord,
  actor: GithubActor,
  options: {
    authority?: { authority: SetupAuthority; access: AccessCheck };
    scanRequest?: ScanRequest | null;
    requestScan?: boolean;
  } = {},
): Promise<ProjectSetupStatus> {
  let project = initial;
  const restriction = publicRestrictionOf(
    project,
    await deps.persistence.listEnforcements(),
  );
  let checked = options.authority;
  if (checked === undefined) {
    try {
      checked = await currentAuthority(deps, project.manifest, actor);
    } catch (error) {
      // A repository that no longer matches its manifest is a denial here,
      // shown with its reason, not a failed status read.
      const message =
        typeof error === "object" && error !== null && "message" in error
          ? String(error.message)
          : "GitHub repository facts do not match this project";
      checked = {
        authority: { state: "denied", message },
        access: { state: "retry", message },
      };
    }
  }
  const { authority, access } = checked;
  const clearance = await deps.vettingClearance(
    project.id,
    project.manifest,
    project.revision,
  );
  const open =
    restriction.state === "clear" &&
    project.manifest.listingTier !== "retired" &&
    clearance.state !== "banned";
  let scanRequest = options.scanRequest ?? null;
  if (
    scanRequest === null &&
    open &&
    authority.state === "verified" &&
    (clearance.state === "unscanned" ||
      clearance.state === "stale" ||
      (options.requestScan === true && clearance.state === "quarantined"))
  )
    scanRequest = await queueScan(
      deps,
      project,
      actor,
      `Setup check by @${actor.githubLogin}`,
    );
  let activatedRevision: number | null = null;
  if (
    open &&
    project.status === "paused" &&
    authority.state === "verified" &&
    access.state === "read" &&
    access.access.installation === "installed" &&
    clearance.state === "cleared" &&
    publishesGeneratedSkills(project.manifest)
  ) {
    project = await appendRevision(request, deps, {
      current: project,
      manifest: { ...project.manifest, status: "active" },
      ownerParticipation: true,
      reason: `Activated automatically after setup checks for @${actor.githubLogin}: ${authority.message} Slopbot installation ${access.access.installationId}. ${clearance.assessment === null ? "Grandfathered before security scans" : `Clean scan ${clearance.assessment.id}`}.`,
      actor,
    });
    activatedRevision = project.revision;
  }
  return projectSetupStatus({
    project,
    restriction,
    authority,
    access,
    clearance,
    scanRequest,
    activatedRevision,
    checkedAt: deps.now().toISOString(),
  });
}

/** Recheck the stored creator's current authority after a clean scan.
 * The scan signature does not grant project authority. The same live GitHub,
 * installation, restriction and revision checks used by the owner still run.
 */
export async function refreshProjectSetup(
  request: Request,
  deps: ProjectApiDependencies,
  projectId: string,
): Promise<ProjectSetupStatus | null> {
  const project = await deps.persistence.getProject(projectId);
  const creator = await deps.persistence.projectCreator(projectId);
  if (project === null || creator === null) return null;
  return runSetupCheck(request, deps, project, creator);
}

/**
 * Self-service project creation (PRD section 4). The signed-in owner must
 * have current authority over the repository; the project is listed paused
 * at once, its first scan is queued, and the response carries the setup
 * status with the next action. No admin approves it.
 */
async function createProject(
  request: Request,
  deps: ProjectApiDependencies,
): Promise<Response> {
  const session = await requireSession(request, deps);
  const body = await readJsonObject(request);
  exactKeys(body, ["manifest"], ["referrer", "monthlyAmount"]);
  const { manifest, text } = canonicalManifest(
    withMonthlyAmount(
      await verifiedRewardAsset(body.manifest, undefined, deps),
      body.monthlyAmount,
    ),
  );
  assertNewProjectManifest(manifest);
  const actor = actorOf(session);
  const enforcements = await deps.persistence.listEnforcements();
  assertMaintainerNotBanned(manifest, actor, enforcements);
  assertRepositoryUnrestricted(manifest, enforcements);
  const referrer = await resolveReferrer(body.referrer, manifest, actor, deps);
  assertRegistryWith(await deps.persistence.listProjects(), manifest, {
    replaces: false,
  });
  const checked = await currentAuthority(deps, manifest, actor);
  requireAuthority(checked);
  const created = await deps.persistence.createProject({
    manifest,
    manifestText: text,
    manifestSha256: await sha256Hex(new TextEncoder().encode(text)),
    reason: `Created through self-service setup by @${actor.githubLogin}. ${checked.authority.message}`,
    actor,
    at: deps.now().toISOString(),
    referrer,
  });
  if (created === "conflict")
    fail(
      409,
      "registry_conflict",
      "The project id or repository is already listed",
    );
  await purgeProjectCache(
    deps.cache,
    new URL(request.url).origin,
    await deps.persistence.enforcementGeneration(),
  );
  const project = await deps.persistence.getProject(manifest.id);
  if (project === null) fail(500, "internal_error", "Project vanished");
  const scanRequest = await queueScan(
    deps,
    project,
    actor,
    "First scan after self-service setup",
  );
  return json(201, {
    project: adminProject(project),
    setup: await runSetupCheck(request, deps, project, actor, {
      authority: checked,
      scanRequest,
    }),
  });
}

/** Private balance review requires current repository authority on every request. */
async function ownerBountySolanaFunding(
  request: Request,
  deps: ProjectApiDependencies,
  projectId: string,
): Promise<Response> {
  const actor = actorOf(await requireSession(request, deps));
  const current = await deps.persistence.getProject(projectId);
  if (!current) fail(404, "not_found", "Project not found");
  requireAuthority(await currentAuthority(deps, current.manifest, actor));
  const resolve = deps.securitySolanaFundingConfig;
  if (!resolve)
    fail(503, "funding_unavailable", "Bounty funding is unavailable.");
  return handleSolanaFunding(request, async (network, vault, action) => {
    const latest = await deps.persistence.getProject(projectId);
    if (!latest) fail(404, "not_found", "Project not found");
    if (
      !latest.manifest.securityBounty?.settlement?.deployments.some(
        (deployment) =>
          deployment.network === network && deployment.vault === vault,
      )
    )
      fail(404, "not_found", "Bounty vault not found");
    if (action.step === "review" && action.operation === "deposit") {
      const enforcements = await deps.persistence.listEnforcements();
      assertMaintainerNotBanned(latest.manifest, actor, enforcements);
      if (publicRestrictionOf(latest, enforcements).state !== "clear")
        fail(
          409,
          "project_restricted",
          "New deposits are unavailable while the project is restricted.",
        );
    }
    return resolve(projectId, network, vault);
  });
}

/** Only verified server-derived deployments can bypass the ordinary manifest editor. */
async function ownerVault(
  request: Request,
  deps: ProjectApiDependencies,
  projectId: string,
): Promise<Response> {
  const actor = actorOf(await requireSession(request, deps));
  const current = await deps.persistence.getProject(projectId);
  if (!current) fail(404, "not_found", "Project not found");
  const enforcements = await deps.persistence.listEnforcements();
  const purpose =
    new URL(request.url).searchParams.get("purpose") ?? "ordinary";
  if (
    request.method === "GET" &&
    !["ordinary", "security-bounty"].includes(purpose)
  )
    fail(400, "invalid_request", "Invalid vault purpose");
  if (request.method === "GET" && purpose === "security-bounty") {
    // Reading funded obligations and owner exits remains available during a
    // restriction. New creation and deposits still require participation.
    requireAuthority(await currentAuthority(deps, current.manifest, actor));
    const banned = bannedMaintainerIds(enforcements);
    const canSetup =
      publicRestrictionOf(current, enforcements).state === "clear" &&
      !banned.has(actor.githubId) &&
      !banned.has(String(current.manifest.steward.github.actorId));
    const program = current.manifest.securityBounty;
    return json(200, {
      revision: current.revision,
      canSetup,
      networks:
        canSetup && !program?.settlement?.deployments.length && deps.vaultSetup
          ? await deps.vaultSetup.networks(current, "security-bounty")
          : [],
      funds:
        program && deps.securityProgramFunds
          ? await deps.securityProgramFunds(current.id, program)
          : null,
    });
  }
  assertMaintainerNotBanned(current.manifest, actor, enforcements);
  if (publicRestrictionOf(current, enforcements).state !== "clear")
    fail(
      409,
      "project_restricted",
      "Request reinstatement before setting up a vault.",
    );
  const checked = await currentAuthority(deps, current.manifest, actor);
  requireAuthority(checked);
  // A project has one ordinary vault and no replacement, and its owner
  // controls refunds and the monthly switch. Write access is not enough:
  // only the steward or a repository admin may create or register it.
  if (!isProjectStewardOrAdmin(current.manifest, actor, checked.access))
    fail(
      403,
      "vault_authority_required",
      `Only the project steward or an admin of ${current.manifest.repositories[0].id} can set up the project vault.`,
    );
  if (!deps.vaultSetup)
    fail(
      503,
      "vault_setup_unavailable",
      "Vault setup is unavailable on this deployment.",
    );
  if (request.method === "GET")
    return json(200, {
      revision: current.revision,
      networks: await deps.vaultSetup.networks(current),
    });
  const body = await readJsonObject(request);
  exactKeys(
    body,
    ["step", "expectedRevision", "network", "claimId", "automatic"],
    ["transactionId", "payoutPolicy"],
  );
  if (
    !["review", "register"].includes(String(body.step)) ||
    typeof body.network !== "string" ||
    typeof body.claimId !== "string" ||
    body.claimId.length > 150 ||
    typeof body.automatic !== "boolean" ||
    (body.payoutPolicy !== undefined &&
      body.payoutPolicy !== "ordinary" &&
      body.payoutPolicy !== "security-bounty") ||
    (body.payoutPolicy === "security-bounty" && body.automatic !== false)
  )
    fail(400, "invalid_request", "Invalid vault setup request");
  const input = body as unknown as VaultSetupInput;
  const bounty = input.payoutPolicy === "security-bounty";
  const deployments = bounty
    ? current.manifest.securityBounty?.settlement?.deployments
    : current.manifest.escrow?.deployments;
  if (body.step === "register" && typeof body.transactionId === "string") {
    const existing = deployments?.find(
      (d) =>
        d.network === input.network &&
        d.deploymentTransaction === body.transactionId,
    );
    if (existing)
      return json(200, {
        status: "registered",
        deployment: existing,
        project: current.manifest,
        revision: current.revision,
      });
  }
  const expectedRevision = positiveInteger(
    body.expectedRevision,
    "expectedRevision",
  );
  if (expectedRevision !== current.revision && body.step === "review")
    fail(
      409,
      "stale_revision",
      "The project changed. Reload and review the current policy.",
    );
  if (deployments?.length)
    fail(
      409,
      "vault_already_registered",
      "This project already has a registered vault.",
    );
  if (body.step === "review")
    return json(200, {
      review: await deps.vaultSetup.review(current, actor, input),
    });
  if (
    typeof body.transactionId !== "string" ||
    !isVaultCreationId(input.network, body.transactionId)
  )
    fail(400, "invalid_request", "Enter the vault creation transaction hash.");
  // A wallet send may outlive an owner edit. Verify its exact creation intent
  // from immutable server history, while attaching only to compatible current policy.
  let creation = current;
  if (expectedRevision !== current.revision) {
    const stored = await deps.persistence.getRevisionText(
      projectId,
      expectedRevision,
    );
    if (!stored)
      fail(
        409,
        "stale_revision",
        "The reviewed project revision is not available.",
      );
    const { manifest } = canonicalManifest(JSON.parse(stored.manifestText));
    if (
      manifest.id !== current.id ||
      (bounty
        ? !manifest.securityBounty ||
          !current.manifest.securityBounty ||
          manifest.securityBounty.amount.currency !==
            current.manifest.securityBounty.amount.currency ||
          manifest.securityBounty.amount.network !==
            current.manifest.securityBounty.amount.network ||
          manifest.securityBounty.amount.decimals !==
            current.manifest.securityBounty.amount.decimals ||
          !sameValue(
            manifest.securityBounty.settlement,
            current.manifest.securityBounty.settlement,
          )
        : manifest.reward.kind !== current.manifest.reward.kind ||
          manifest.reward.chain !== current.manifest.reward.chain ||
          !sameValue(manifest.escrow, current.manifest.escrow) ||
          !(
            sameValue(manifest.rewardAsset, current.manifest.rewardAsset) ||
            sameRewardAsset(manifest.rewardAsset, current.manifest.rewardAsset)
          ))
    )
      fail(
        409,
        "vault_policy_changed",
        "The project asset or vault policy changed. Restore the reviewed policy before registering this creation transaction.",
      );
    creation = {
      ...current,
      revision: expectedRevision,
      status: manifest.status,
      manifest,
      manifestSha256: stored.manifestSha256,
    };
  }
  const deployment = await deps.vaultSetup.register(
    creation,
    actor,
    input,
    body.transactionId,
  );
  if (!deployment) return json(200, { status: "pending" });
  const updated = await appendRevision(request, deps, {
    current,
    actor,
    manifest: bounty
      ? attachBountyVault(
          current.manifest,
          deployment,
          deps.now().toISOString().slice(0, 7),
        )
      : attachOrdinaryVault(current.manifest, deployment),
    ownerParticipation: true,
    reason:
      "Owner registered a finalized vault verified against the reviewed factory and project policy.",
  });
  return json(200, {
    status: "registered",
    deployment,
    project: updated.manifest,
    revision: updated.revision,
    ...(!bounty &&
    creation.manifest.reward.monthlyCapMinor !==
      updated.manifest.reward.monthlyCapMinor
      ? {
          notice: `Creation used a monthly cap of ${creation.manifest.reward.monthlyCapDisplay}. The project now uses ${updated.manifest.reward.monthlyCapDisplay}. Use the automatic payment controls below to apply the new cap.`,
        }
      : {}),
  });
}

/**
 * Publishes an owner's revision at once (PRD section 4). Presentation
 * changes publish as they are; a change to the skill inputs pauses an active
 * project and queues a fresh scan unless PRD section 8 exempts it. A clean
 * result reactivates it on the next setup check; a financial change applies
 * from the next UTC cycle.
 * Identity, status, listing, steward, authority and terms stay with the
 * reviewed exception paths. A stale `expectedRevision` fails with 409.
 */
async function publishOwnerRevision(
  request: Request,
  deps: ProjectApiDependencies,
  projectId: string,
  stored?: {
    body: Record<string, unknown>;
    applicationId: string;
    actor: GithubActor;
  },
): Promise<Response> {
  const actor = stored?.actor ?? actorOf(await requireSession(request, deps));
  if (!PROJECT_ID.test(projectId)) fail(404, "not_found", "Project not found");
  const body = stored?.body ?? (await readJsonObject(request));
  exactKeys(
    body,
    ["manifest", "expectedRevision"],
    ["reason", "monthlyAmount"],
  );
  const expectedRevision = positiveInteger(
    body.expectedRevision,
    "expectedRevision",
  );
  const note =
    body.reason === undefined || body.reason === ""
      ? null
      : boundedText(body.reason, "reason", 1, 500);
  if (
    typeof body.manifest !== "object" ||
    body.manifest === null ||
    Array.isArray(body.manifest)
  )
    fail(422, "invalid_manifest", "Project manifest is invalid");
  const current = await deps.persistence.getProject(projectId);
  if (current === null) fail(404, "not_found", "Project not found");
  if (current.revision !== expectedRevision)
    fail(409, "stale_revision", "The project changed since you loaded it");
  const enforcements = await deps.persistence.listEnforcements();
  assertMaintainerNotBanned(current.manifest, actor, enforcements);
  const restriction = publicRestrictionOf(current, enforcements);
  if (restriction.state !== "clear")
    fail(
      409,
      "project_restricted",
      `The project is ${restriction.state}; request reinstatement before changing it`,
    );
  // Authority comes from the stored project. Submitted repository facts must
  // never authorize private funding reads or a revision of another project.
  const checked = await currentAuthority(deps, current.manifest, actor);
  requireAuthority(checked);
  // The server decides status and listing; the owner sends content.
  let prepared = withMonthlyAmount(
    await verifiedRewardAsset(
      {
        ...(body.manifest as Record<string, unknown>),
        status: current.manifest.status,
        listingTier: current.manifest.listingTier,
      },
      current.manifest.rewardAsset,
      deps,
    ),
    body.monthlyAmount,
  ) as ProjectDefinition;
  if (
    current.manifest.reward.kind === "monthly-pool" &&
    prepared.reward?.kind === "monthly-pool" &&
    (!sameValue(current.manifest.rewardAsset, prepared.rewardAsset) ||
      current.manifest.reward.chain !== prepared.reward.chain ||
      current.manifest.reward.currency !== prepared.reward.currency)
  ) {
    // These read-only caps belong to the previous asset. Check continuity
    // before removing them from validation of the new asset's manifest.
    if (
      !sameValue(current.manifest.reward.cycleCaps, prepared.reward.cycleCaps)
    )
      fail(
        422,
        "financial_change_restricted",
        "Historical cycle caps cannot change",
      );
    const { cycleCaps: _oldCaps, ...reward } = prepared.reward;
    prepared = { ...prepared, reward };
  }
  const programChanged = !sameValue(
    current.manifest.securityBounty,
    prepared.securityBounty,
  );
  const requestedProgramStatus = prepared.securityBounty?.status;
  if (programChanged && prepared.securityBounty)
    prepared = {
      ...prepared,
      securityBounty: {
        ...prepared.securityBounty,
        // Validate all terms before using them in a funding lookup. The server
        // alone sets verified funding and then permits an open program.
        status:
          requestedProgramStatus === "open"
            ? "paused"
            : prepared.securityBounty.status,
        funding: { state: "pledged" },
      },
    };
  let { manifest: submitted } = canonicalManifest(prepared);
  // Reject forbidden manifest changes before reading private funds.
  if (submitted.id !== projectId)
    fail(422, "invalid_manifest", "Project id cannot change");
  const restricted = classifyRevisionChanges(
    current.manifest,
    submitted,
  ).restricted;
  if (restricted.length > 0)
    fail(
      422,
      "owner_field_restricted",
      `These fields do not change through owner self-service: ${restricted.join(", ")}`,
    );
  if (programChanged)
    submitted = await ownerSecurityProgram(
      current.manifest,
      submitted,
      requestedProgramStatus,
      actor,
      isProjectStewardOrAdmin(current.manifest, actor, checked.access),
      deps,
    );
  const changes = classifyRevisionChanges(current.manifest, submitted);
  if (
    changes.presentation.length +
      changes.executable.length +
      changes.financial.length ===
    0
  )
    fail(422, "no_change", "The revision changes nothing");
  let manifest =
    changes.financial.length > 0
      ? prospectiveFinancialChange(current.manifest, submitted, deps.now())
      : submitted;
  const clearance =
    changes.executable.length > 0
      ? await deps.vettingClearance(projectId, manifest, current.revision)
      : null;
  // The permanent exemption also covers future executable changes. The
  // restriction and current-owner checks above still apply to every edit.
  const scanRequired =
    changes.executable.length > 0 &&
    !(clearance?.state === "cleared" && clearance.assessment === null);
  if (scanRequired && manifest.status === "active")
    manifest = { ...manifest, status: "paused" };
  const summary = [
    changes.presentation.length > 0
      ? `presentation (${changes.presentation.join(", ")}) published`
      : null,
    changes.executable.length > 0
      ? `skill inputs (${changes.executable.join(", ")}) ${scanRequired ? "need a new scan" : "published under the existing-project scan exemption"}`
      : null,
    changes.financial.length > 0
      ? `financial policy (${changes.financial.join(", ")}) published; monthly amounts apply from the next UTC cycle and bounty terms apply to later reports`
      : null,
  ]
    .filter((part) => part !== null)
    .join("; ");
  const updated = await appendRevision(request, deps, {
    current,
    manifest,
    reason: `Owner update by @${actor.githubLogin}: ${summary}.${note ? ` ${note}` : ""}`,
    actor,
    applicationId: stored?.applicationId,
    ownerParticipation: true,
  });
  const scanRequest = scanRequired
    ? await queueScan(
        deps,
        updated,
        actor,
        `Owner changed ${changes.executable.join(", ")}`,
      )
    : null;
  const setup = await runSetupCheck(request, deps, updated, actor, {
    authority: checked,
    scanRequest,
  });
  const published = await deps.persistence.getProject(projectId);
  if (published === null) fail(500, "internal_error", "Project vanished");
  return json(200, {
    project: adminProject(published),
    changes: {
      presentation: changes.presentation,
      executable: changes.executable,
      financial: changes.financial,
    },
    setup,
  });
}

/** The signed-in account's projects and the applications it can still publish. */
async function listSetup(
  request: Request,
  deps: ProjectApiDependencies,
): Promise<Response> {
  const session = await requireSession(request, deps);
  const [projects, applications] = await Promise.all([
    deps.persistence.listOwnedProjects(session.githubId),
    deps.persistence.listApplicantApplications(session.githubId),
  ]);
  return json(200, {
    projects: projects.map((project) => ({
      id: project.id,
      slug: project.manifest.slug,
      name: project.manifest.name,
      status: project.status,
      listingTier: project.manifest.listingTier,
      revision: project.revision,
    })),
    applications: applications
      .filter((application) => application.status === "pending")
      .map(publicApplication),
  });
}

async function checkSetup(
  request: Request,
  deps: ProjectApiDependencies,
  projectId: string,
): Promise<Response> {
  const session = await requireSession(request, deps);
  if (!PROJECT_ID.test(projectId)) fail(404, "not_found", "Project not found");
  const body = await readJsonObject(request);
  exactKeys(body, [], ["requestScan"]);
  if (body.requestScan !== undefined && typeof body.requestScan !== "boolean")
    fail(400, "invalid_request", "Invalid requestScan");
  const project = await deps.persistence.getProject(projectId);
  if (project === null) fail(404, "not_found", "Project not found");
  return json(200, {
    setup: await runSetupCheck(request, deps, project, actorOf(session), {
      requestScan: body.requestScan === true,
    }),
  });
}

/**
 * Migrates an application submitted before self-service setup: its own
 * applicant publishes the stored manifest, without entering it again, after
 * the same identity, authority, restriction and registry checks a new
 * project passes. A stored update publishes as an owner revision against its
 * stored base revision.
 */
async function publishPendingApplication(
  request: Request,
  deps: ProjectApiDependencies,
  applicationId: string,
): Promise<Response> {
  const session = await requireSession(request, deps);
  if (!APPLICATION_ID.test(applicationId))
    fail(404, "not_found", "Application not found");
  const body = await readJsonObject(request);
  exactKeys(body, []);
  const application = await deps.persistence.getApplication(applicationId);
  if (
    application === null ||
    application.applicant.githubId !== session.githubId
  )
    fail(404, "not_found", "Application not found");
  if (application.status !== "pending")
    fail(
      409,
      "already_decided",
      `Application was already ${application.status}`,
    );
  const actor = actorOf(session);
  if (application.expectedRevision !== undefined)
    return await publishOwnerRevision(request, deps, application.projectId, {
      body: {
        manifest: application.manifest,
        expectedRevision: application.expectedRevision,
        ...(application.changeReason
          ? { reason: application.changeReason.slice(0, 500) }
          : {}),
      },
      applicationId,
      actor,
    });
  canonicalManifest(application.manifest);
  assertNewProjectManifest(application.manifest, { storedApplication: true });
  const enforcements = await deps.persistence.listEnforcements();
  assertMaintainerNotBanned(application.manifest, actor, enforcements);
  assertRepositoryUnrestricted(application.manifest, enforcements);
  assertRegistryWith(
    await deps.persistence.listProjects(),
    application.manifest,
    { replaces: false },
  );
  const checked = await currentAuthority(deps, application.manifest, actor);
  requireAuthority(checked);
  const result = await deps.persistence.publishApplication({
    applicationId,
    actor,
    reason: `Published by its applicant through self-service setup. ${checked.authority.message}`,
    at: deps.now().toISOString(),
  });
  if (result === "conflict")
    fail(
      409,
      "registry_conflict",
      "The project id or repository is already listed, or the application was published",
    );
  await purgeProjectCache(
    deps.cache,
    new URL(request.url).origin,
    await deps.persistence.enforcementGeneration(),
  );
  const project = await deps.persistence.getProject(application.projectId);
  if (project === null) fail(500, "internal_error", "Project vanished");
  const scanRequest = await queueScan(
    deps,
    project,
    actor,
    "First scan after publishing a stored application",
  );
  return json(201, {
    project: adminProject(project),
    setup: await runSetupCheck(request, deps, project, actor, {
      authority: checked,
      scanRequest,
    }),
  });
}

async function listMyApplications(
  request: Request,
  deps: ProjectApiDependencies,
): Promise<Response> {
  const session = await requireSession(request, deps);
  const applications = await deps.persistence.listApplicantApplications(
    session.githubId,
  );
  return json(200, { applications: applications.map(publicApplication) });
}

async function listAdminProjects(
  request: Request,
  deps: ProjectApiDependencies,
): Promise<Response> {
  const session = await requireAdmin(request, deps);
  const [projects, records] = await Promise.all([
    deps.persistence.listProjects(),
    deps.persistence.listEnforcements(),
  ]);
  const moderation =
    deps.moderatorGithubIds.size === 0
      ? "unconfigured"
      : deps.moderatorGithubIds.has(session.githubId)
        ? "moderator"
        : "not-moderator";
  return json(200, {
    projects: projects.map((project) => ({
      ...adminProject(project),
      enforcement: adminEnforcement(
        project,
        projectRestriction(project.id, records),
        moderation,
      ),
    })),
  });
}

/** An admin revision: the exception path for fields owners do not change. */
async function replaceProjectManifest(
  request: Request,
  deps: ProjectApiDependencies,
  projectId: string,
): Promise<Response> {
  const session = await requireAdmin(request, deps);
  if (!PROJECT_ID.test(projectId)) fail(404, "not_found", "Project not found");
  const body = await readJsonObject(request);
  exactKeys(body, ["manifest", "expectedRevision", "reason"]);
  const expectedRevision = positiveInteger(
    body.expectedRevision,
    "expectedRevision",
  );
  const reason = boundedText(body.reason, "reason", 1, 1000);
  const current = await deps.persistence.getProject(projectId);
  if (current === null) fail(404, "not_found", "Project not found");
  if (current.revision !== expectedRevision)
    fail(409, "stale_revision", "The project changed since you loaded it");
  const { manifest } = canonicalManifest(
    await verifiedRewardAsset(
      body.manifest,
      current.manifest.rewardAsset,
      deps,
    ),
  );
  if (manifest.id !== projectId)
    fail(422, "invalid_manifest", "Project id cannot change");
  assertReviewBudgetTransition(current.manifest, manifest, deps.now());
  const updated = await appendRevision(request, deps, {
    current,
    manifest,
    reason,
    actor: actorOf(session),
  });
  return json(200, { project: adminProject(updated) });
}

/**
 * Appends one revision after every registry rule: restrictions, policy
 * transitions, registry uniqueness, generated-skill content and the
 * clearance gate. Only content a scan cleared may become active, or change
 * its skill inputs while active (PRD VET-01).
 */
async function appendRevision(
  request: Request,
  deps: ProjectApiDependencies,
  input: {
    current: ProjectRecord;
    manifest: ProjectDefinition;
    reason: string;
    actor: GithubActor;
    applicationId?: string;
    /** Recheck owner eligibility within the guarded enforcement snapshot. */
    ownerParticipation?: true;
  },
): Promise<ProjectRecord> {
  const { current, actor } = input;
  const projectId = current.id;
  const { manifest, text } = canonicalManifest(input.manifest);
  // Read the generation first: a record that lands after it makes the
  // guarded append below a conflict, so no write uses stale restrictions.
  const enforcementGeneration = await deps.persistence.enforcementGeneration();
  const enforcements = await deps.persistence.listEnforcements();
  if (input.ownerParticipation)
    assertMaintainerNotBanned(current.manifest, actor, enforcements);
  const restriction = projectRestriction(projectId, enforcements);
  // A new revision cannot lift a Quarantine or a Ban (PRD ADM-06).
  if (restriction.state !== "clear" && !enforcedManifest(manifest)) {
    fail(
      409,
      "project_restricted",
      `The project is ${restriction.state}; a revision must keep it paused and retired until reinstatement`,
    );
  }
  // Nor can a revision move a restricted repository, renamed or not, into
  // another project. The project's own restriction is checked above. A
  // project already listed for a restricted repository may still append the
  // paused, retired revision that restriction imposes, if it claims the same
  // repositories as before.
  if (
    !enforcedManifest(manifest) ||
    !sameRepositoryIdentity(current.manifest, manifest)
  )
    assertRepositoryUnrestricted(
      manifest,
      enforcements.filter((record) => record.projectId !== projectId),
    );
  try {
    assertProjectPolicyTransition(current.manifest, manifest);
    assertPayoutExclusionTransition(current.manifest, manifest, deps.now());
  } catch (error) {
    invalidManifest(error);
  }
  assertRegistryWith(await deps.persistence.listProjects(), manifest, {
    replaces: true,
  });
  // Project skills are generated from this manifest and the reviewed
  // template, so a project goes live only with complete skill content.
  if (manifest.status === "active" && !publishesGeneratedSkills(manifest)) {
    fail(
      422,
      "skill_content_incomplete",
      "Complete the generated-skill contribution fields before activation",
    );
  }
  if (manifest.skill.publishAtRoot) {
    fail(
      422,
      "invalid_manifest",
      "Root skill publication is retired; project skills are served at /projects/<id>/SKILL.md",
    );
  }
  const changesExecutable =
    classifyRevisionChanges(current.manifest, manifest).executable.length > 0 ||
    !sameValue(current.manifest.repositories, manifest.repositories) ||
    !sameValue(current.manifest.skill, manifest.skill) ||
    !sameValue(current.manifest.reviewSkill, manifest.reviewSkill);
  if (
    manifest.status === "active" &&
    (current.status !== "active" || changesExecutable)
  ) {
    const vetting = await deps.vettingClearance(
      projectId,
      manifest,
      current.revision,
    );
    if (vetting.state !== "cleared")
      fail(
        422,
        "vetting_required",
        `Security vetting is ${vetting.state}. Only a revision whose skill inputs and source passed a clean scan of the current integration-branch head and skill template can activate.`,
      );
  }
  const result = await deps.persistence.appendProjectRevision(
    {
      projectId,
      applicationId: input.applicationId,
      expectedRevision: current.revision,
      manifest,
      manifestText: text,
      manifestSha256: await sha256Hex(new TextEncoder().encode(text)),
      reason: input.reason.slice(0, 1000),
      actor,
      at: deps.now().toISOString(),
    },
    enforcementGeneration,
  );
  if (result === "conflict") {
    fail(409, "stale_revision", "The project changed since you loaded it");
  }
  await purgeProjectCache(
    deps.cache,
    new URL(request.url).origin,
    await deps.persistence.enforcementGeneration(),
  );
  const updated = await deps.persistence.getProject(projectId);
  if (updated === null) fail(500, "internal_error", "Project vanished");
  return updated;
}

function publicRestriction(
  restriction: ProjectRestriction,
): Record<string, unknown> {
  return {
    projectId: restriction.projectId,
    sourceProjectId: restriction.sourceProjectId,
    state: restriction.state,
    appeal: restriction.appeal,
    since: restriction.since,
  };
}

function activePublicRestrictions(
  projects: ProjectRecord[],
  records: ProjectEnforcement[],
): Record<string, unknown>[] {
  const restricted = activeRestrictions(records);
  // A project listed for a restricted repository is closed with it.
  const shared = projects
    .filter(
      (project) =>
        !restricted.some((restriction) => restriction.projectId === project.id),
    )
    .map((project) => publicRestrictionOf(project, records))
    .filter((restriction) => restriction.state !== "clear");
  return [...restricted, ...shared].map(publicRestriction);
}

/**
 * Refuses an application, approval or revision that claims a repository of
 * a restricted project.
 */
function assertRepositoryUnrestricted(
  manifest: ProjectDefinition,
  enforcements: ProjectEnforcement[],
): void {
  const restriction = restrictionForRepository(manifest, enforcements);
  if (restriction !== null)
    fail(
      403,
      "repository_restricted",
      `This repository belongs to a ${restriction.state} project; only reinstatement can list it again`,
    );
}

/**
 * Refuses project setup and owner changes by a maintainer that a moderator
 * banned after a confirmed malicious result (PRD sections 2 and 8), whether
 * the account acts itself or is named as the steward.
 */
function assertMaintainerNotBanned(
  manifest: ProjectDefinition,
  actor: GithubActor,
  enforcements: ProjectEnforcement[],
): void {
  const banned = bannedMaintainerIds(enforcements);
  if (
    banned.has(actor.githubId) ||
    banned.has(String(manifest.steward.github.actorId))
  )
    fail(
      403,
      "maintainer_banned",
      "A moderator banned this maintainer after a confirmed malicious scan result. The account cannot start new Slop participation. The banned account, project steward or original applicant may appeal the project decision.",
    );
}

function adminEnforcement(
  project: ProjectRecord,
  restriction: ProjectRestriction,
  moderation: ProjectEnforcementState["moderation"],
): ProjectEnforcementState {
  return {
    state: restriction.state,
    appeal: restriction.appeal,
    since: restriction.since,
    restrictedBy: restriction.restrictedBy,
    nextSequence: restriction.nextSequence,
    // The matching revision has not landed while a restricted manifest is
    // still listed or active; public routes stay closed meanwhile.
    revisionPending:
      restriction.state !== "clear" && !enforcedManifest(project.manifest),
    moderation,
    decisionRequired: awaitsMaliciousDecision(restriction),
    bannedMaintainers: restriction.bannedMaintainers,
    records: restriction.records,
  };
}

async function requireModerator(
  request: Request,
  deps: ProjectApiDependencies,
): Promise<WebSession> {
  const session = await requireAdmin(request, deps);
  if (deps.moderatorGithubIds.size === 0)
    fail(
      403,
      "moderation_unavailable",
      "Moderation is not configured. Contact the service operator.",
    );
  if (!deps.moderatorGithubIds.has(session.githubId))
    fail(403, "forbidden", "The project moderator role is required");
  return session;
}

function positiveInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
    fail(400, "invalid_request", `Invalid ${name}`);
  return value;
}

/** Reason and evidence fields every enforcement request carries. */
function enforcementText(body: Record<string, unknown>): {
  reason: string;
  evidenceReference: string;
} {
  return {
    reason: boundedText(body.reason, "reason", 1, 1000),
    evidenceReference: boundedText(
      body.evidenceReference,
      "evidenceReference",
      1,
      500,
    ),
  };
}

/**
 * Previews or applies one ADM-06 action. The preview and the write run the
 * same plan against the same expected revision and record sequence, so the
 * confirmed write is exactly what the moderator saw, or it fails with 409.
 */
async function enforceProject(
  request: Request,
  deps: ProjectApiDependencies,
  projectId: string,
  mode: "preview" | "apply",
): Promise<Response> {
  const session = await requireModerator(request, deps);
  if (!PROJECT_ID.test(projectId)) fail(404, "not_found", "Project not found");
  const body = await readJsonObject(request);
  exactKeys(
    body,
    [
      "action",
      "reason",
      "evidenceReference",
      "expectedRevision",
      "expectedSequence",
    ],
    ["responsibleAccounts"],
  );
  if (!ENFORCEMENT_ACTIONS.includes(body.action as EnforcementAction))
    fail(400, "invalid_request", "Invalid enforcement action");
  const responsibleAccounts: GithubActor[] = [];
  if (body.responsibleAccounts !== undefined) {
    if (!Array.isArray(body.responsibleAccounts))
      fail(400, "invalid_request", "Select the responsible accounts.");
    for (const selected of body.responsibleAccounts) {
      if (
        !selected ||
        typeof selected !== "object" ||
        typeof selected.githubLogin !== "string"
      )
        fail(400, "invalid_request", "Enter a GitHub account name.");
      const account = await lookupGitHubActor(
        deps.github.fetch,
        deps.github.token,
        selected.githubLogin,
        deps.github.apiOrigin,
      );
      if (
        account === null ||
        (selected.githubId !== undefined &&
          selected.githubId !== account.githubId)
      )
        fail(
          409,
          "account_changed",
          "The selected GitHub account changed. Preview the decision again.",
        );
      if (
        !responsibleAccounts.some(
          (entry) => entry.githubId === account.githubId,
        )
      )
        responsibleAccounts.push(account);
    }
  }
  return await recordEnforcement(deps, {
    projectId,
    responsibleAccounts,
    action: body.action as EnforcementAction,
    ...enforcementText(body),
    expectedRevision: positiveInteger(
      body.expectedRevision,
      "expectedRevision",
    ),
    expectedSequence: positiveInteger(
      body.expectedSequence,
      "expectedSequence",
    ),
    actor: { githubId: session.githubId, githubLogin: session.githubLogin },
    actorRole: () => "project-moderator",
    decisionSource: "admin-panel",
    mode,
  });
}

/**
 * Owners, original applicants and accounts named in the current project ban
 * can request reinstatement. A moderator who did not place the restriction
 * still decides it. Filing does not grant project authority.
 */
async function listAccountAppeals(
  request: Request,
  deps: ProjectApiDependencies,
): Promise<Response> {
  const session = await requireSession(request, deps);
  const records = await deps.persistence.listEnforcements();
  const projectIds = new Set(
    activeAccountBans(records)
      .filter(({ account }) => account.githubId === session.githubId)
      .map(({ record }) => record.projectId),
  );
  return json(200, {
    appeals: [...projectIds].map((projectId) => {
      const restriction = projectRestriction(projectId, records);
      return {
        projectId,
        state: restriction.state,
        appeal: accountAppealState(restriction, session.githubId),
      };
    }),
  });
}

async function requestReinstatement(
  request: Request,
  deps: ProjectApiDependencies,
): Promise<Response> {
  const session = await requireSession(request, deps);
  const body = await readJsonObject(request);
  exactKeys(body, ["projectId", "reason", "evidenceReference"]);
  if (typeof body.projectId !== "string" || !PROJECT_ID.test(body.projectId))
    fail(404, "not_found", "Project not found");
  return await recordEnforcement(deps, {
    projectId: body.projectId,
    action: "request_reinstatement",
    ...enforcementText(body),
    // An appeal changes no revision and has no preview; an open appeal or a
    // concurrent record refuses it with 409.
    expectedRevision: null,
    expectedSequence: null,
    actor: { githubId: session.githubId, githubLogin: session.githubLogin },
    actorRole: async (project, restriction) => {
      const isBannedAccount = restriction.bannedMaintainers.some(
        (account) => account.githubId === session.githubId,
      );
      const ownerRole =
        String(project.manifest.steward.github.actorId) === session.githubId
          ? "project-steward"
          : (await deps.persistence.projectCreator(project.id))?.githubId ===
              session.githubId
            ? "project-applicant"
            : null;
      if (
        isBannedAccount &&
        (restriction.state === "clear" ||
          projectAppealState(restriction) === "requested")
      )
        return "banned-account";
      if (ownerRole !== null) return ownerRole;
      if (isBannedAccount) return "banned-account";
      return fail(
        403,
        "forbidden",
        "Only the project steward, the account that listed the project, or an account banned by this project decision can appeal",
      );
    },
    decisionSource: "owner-request",
    mode: "apply",
  });
}

async function recordEnforcement(
  deps: ProjectApiDependencies,
  input: {
    projectId: string;
    responsibleAccounts?: GithubActor[];
    action: EnforcementAction;
    reason: string;
    evidenceReference: string;
    /** Null for an owner appeal, which has no preview to confirm. */
    expectedRevision: number | null;
    expectedSequence: number | null;
    actor: GithubActor;
    actorRole: (
      project: ProjectRecord,
      restriction: ProjectRestriction,
    ) => EnforcementActorRole | Promise<EnforcementActorRole>;
    decisionSource: ProjectEnforcement["decisionSource"];
    mode: "preview" | "apply";
  },
): Promise<Response> {
  const {
    projectId,
    action,
    reason,
    evidenceReference,
    expectedRevision,
    expectedSequence,
    actor,
    mode,
  } = input;
  const project = await deps.persistence.getProject(projectId);
  if (project === null) fail(404, "not_found", "Project not found");
  const restriction = projectRestriction(
    projectId,
    await deps.persistence.listEnforcements(),
  );
  // Role, plan, recipients and append sequence share one restriction snapshot.
  // A concurrent decision then fails the existing append conflict check.
  const actorRole = await input.actorRole(project, restriction);
  if (
    (expectedRevision !== null && project.revision !== expectedRevision) ||
    (expectedSequence !== null && restriction.nextSequence !== expectedSequence)
  )
    fail(409, "stale_enforcement", "The project changed since you loaded it");
  let listedBefore = false;
  if (action === "reinstate" && restriction.openedAtRevision !== null) {
    const opened = await deps.persistence.getRevisionText(
      projectId,
      restriction.openedAtRevision,
    );
    if (opened === null)
      fail(500, "internal_error", "The restricted revision is missing");
    listedBefore =
      (JSON.parse(opened.manifestText) as ProjectDefinition).listingTier !==
      "retired";
  }
  const plan = planEnforcement({
    action,
    actor,
    project,
    restriction,
    listedBefore,
    responsibleAccounts: input.responsibleAccounts,
  });
  let vettingReview: ProjectEnforcement["vettingReview"];
  if (action === "reinstate") {
    const vetting = await deps.vettingClearance(
      projectId,
      project.manifest,
      project.revision,
      true,
    );
    const latestRestriction = restriction.records.findLast(
      (record) => record.action === "quarantine" || record.action === "ban",
    );
    if (
      vetting.state !== "cleared" ||
      vetting.assessment === null ||
      vetting.assessment.revision !== project.revision ||
      (latestRestriction !== undefined &&
        vetting.assessment.requestedAt < latestRestriction.createdAt)
    )
      fail(
        409,
        "vetting_required",
        "Reinstatement requires a fresh clean scan of the current restricted revision, requested after the latest restriction, at the current integration-branch head and skill template.",
      );
    vettingReview = {
      assessmentId: vetting.assessment.id,
      maliciousAssessmentIds: vetting.reviewedMaliciousAssessmentIds ?? [],
    };
  }
  const selectedAccounts = input.responsibleAccounts ?? [];
  const accountReinstatements: NonNullable<
    ProjectEnforcement["accountReinstatements"]
  > = [];
  if (action === "reinstate_accounts") {
    if (selectedAccounts.length === 0)
      fail(400, "invalid_request", "Select the accounts to reinstate.");
    const currentBans = activeAccountBans(restriction.records);
    for (const selected of selectedAccounts) {
      const bans = currentBans.filter(
        ({ account }) => account.githubId === selected.githubId,
      );
      if (bans.length === 0)
        fail(
          409,
          "account_not_banned",
          "The selected account has no active ban from this project.",
        );
      for (const { record } of bans)
        accountReinstatements.push({
          ...selected,
          banEnforcementId: record.id,
        });
    }
  }
  const maintainerBans =
    action === "reinstate_accounts" ? [] : selectedAccounts;
  if (maintainerBans.length > 0 && !plan.bansMaintainer)
    fail(
      400,
      "invalid_request",
      "Account bans require a moderator decision on a confirmed malicious result.",
    );
  const recordId = `enf_${deps.randomId().replaceAll("-", "")}`;
  const at = deps.now().toISOString();
  const revisionText =
    plan.manifest === null ? null : JSON.stringify(plan.manifest);
  const revisionSha256 =
    revisionText === null
      ? null
      : await sha256Hex(new TextEncoder().encode(revisionText));
  // A restriction keeps the repository identity it found, so a later rename
  // or application for the same repository stays restricted.
  const identity = repositoryIdentity(project.manifest);
  const record: ProjectEnforcement = {
    id: recordId,
    projectId,
    sequence: restriction.nextSequence,
    action,
    stateAfter: plan.stateAfter,
    appealAfter: plan.appealAfter,
    reason,
    evidenceReference,
    repositoryGithubId: restriction.repositoryGithubId ?? identity.githubId,
    repositoryKeys: [
      ...new Set([...restriction.repositoryKeys, ...identity.keys]),
    ],
    actor,
    actorRole,
    decisionSource:
      actorRole === "banned-account" ? "account-request" : input.decisionSource,
    beforeRevision: project.revision,
    beforeManifestSha256: project.manifestSha256,
    afterRevision: revisionText === null ? null : project.revision + 1,
    afterManifestSha256: revisionSha256,
    result:
      revisionText !== null
        ? "revision_appended"
        : plan.pendingReason !== null
          ? "revision_pending"
          : "no_revision_needed",
    ...(vettingReview ? { vettingReview } : {}),
    ...(maintainerBans.length > 0 ? { maintainerBans } : {}),
    ...(accountReinstatements.length > 0 ? { accountReinstatements } : {}),
    createdAt: at,
  };
  const preview: EnforcementPreview = {
    projectId,
    projectName: project.manifest.name,
    action,
    sequence: record.sequence,
    stateBefore: restriction.state,
    stateAfter: record.stateAfter,
    appealBefore: restriction.appeal,
    appealAfter: record.appealAfter,
    result: record.result,
    pendingReason: plan.pendingReason,
    maintainerBans,
    accountReinstatements,
    revision: {
      before: project.revision,
      after: record.afterRevision,
      statusBefore: project.manifest.status,
      statusAfter: plan.manifest?.status ?? project.manifest.status,
      listingTierBefore: project.manifest.listingTier,
      listingTierAfter:
        plan.manifest?.listingTier ?? project.manifest.listingTier,
    },
  };
  if (mode === "preview") return json(200, { preview });
  const outcome = await deps.persistence.appendEnforcement(
    record,
    plan.manifest === null || revisionText === null || revisionSha256 === null
      ? null
      : {
          projectId,
          expectedRevision: project.revision,
          manifest: plan.manifest,
          manifestText: revisionText,
          manifestSha256: revisionSha256,
          reason: enforcementRevisionReason(action, recordId),
          actor,
          at,
        },
    // Only a moderator who did not place the restriction or account ban, and
    // who did not file the appeal, may decide it.
    action === "request_reinstatement"
      ? [...deps.moderatorGithubIds].filter((githubId) =>
          actorRole === "banned-account"
            ? githubId !== actor.githubId &&
              !activeAccountBans(restriction.records).some(
                ({ account, record: ban }) =>
                  account.githubId === actor.githubId &&
                  ban.actor?.githubId === githubId,
              )
            : githubId !== actor.githubId &&
              !restriction.restrictedBy.some(
                (placed) => placed.githubId === githubId,
              ),
        )
      : [],
  );
  if (outcome === "conflict")
    fail(409, "stale_enforcement", "The project changed since you loaded it");
  // The new record changes the enforcement generation, so every public
  // cache key in every colo is replaced on its next request.
  return json(200, { preview, record });
}

function publicJson(body: Record<string, unknown>): Response {
  const response = json(200, body, PUBLIC_PROJECT_CACHE_CONTROL);
  response.headers.set("access-control-allow-origin", "*");
  return response;
}

async function listPublicProjects(
  deps: ProjectApiDependencies,
): Promise<Response> {
  const [projects, records] = await Promise.all([
    deps.persistence.listProjects(),
    deps.persistence.listEnforcements(),
  ]);
  return publicJson({
    schemaVersion: "1",
    projects: projects.map((project) => project.manifest),
    // Restricted projects stay in the list for history; every reader must
    // treat them as paused and retired, even before the revision lands.
    restrictions: activePublicRestrictions(projects, records),
  });
}

/**
 * Public credit input for the score generator (PRD section 8). A banned
 * account earns no new contribution or review credit from its earliest
 * active ban. Only immutable GitHub IDs and start times are published; the
 * reason, evidence, project and login stay private. A released ban leaves
 * the list.
 */
async function listPublicAccountBans(
  deps: ProjectApiDependencies,
): Promise<Response> {
  const since = new Map<string, string>();
  for (const { account, record } of activeAccountBans(
    await deps.persistence.listEnforcements(),
  )) {
    const current = since.get(account.githubId);
    if (
      current === undefined ||
      Date.parse(record.createdAt) < Date.parse(current)
    )
      since.set(account.githubId, record.createdAt);
  }
  return publicJson({
    schemaVersion: "slop-account-bans:v1",
    bans: [...since]
      .map(([githubId, bannedAt]) => ({ githubId, bannedAt }))
      .sort(
        (left, right) =>
          left.githubId.length - right.githubId.length ||
          (left.githubId < right.githubId
            ? -1
            : left.githubId > right.githubId
              ? 1
              : 0),
      ),
  });
}

async function readPublicProject(
  deps: ProjectApiDependencies,
  projectId: string,
): Promise<Response> {
  if (!PROJECT_ID.test(projectId)) fail(404, "not_found", "Project not found");
  const project = await deps.persistence.getProject(projectId);
  if (project === null) fail(404, "not_found", "Project not found");
  const restriction = publicRestrictionOf(
    project,
    await deps.persistence.listEnforcements(),
  );
  if (restriction.state !== "clear") {
    // An appeal names the project whose records hold the restriction.
    const appeal =
      restriction.sourceProjectId === project.id
        ? "The project steward or applicant may request reinstatement"
        : `The restriction is recorded on project ${restriction.sourceProjectId}, which claims the same repository; its steward or applicant may request reinstatement of ${restriction.sourceProjectId}`;
    return json(410, {
      error: "project_restricted",
      message: `This project is ${restriction.state}. Its history stays public; its skills and participation are closed. ${appeal} with POST /api/v1/project-appeals.`,
      restriction: publicRestriction(restriction),
    });
  }
  if (project.manifest.listingTier === "retired")
    fail(404, "not_found", "Project not found");
  const vetting = await deps.vettingClearance(
    project.id,
    project.manifest,
    project.revision,
  );
  const response = json(200, {
    schemaVersion: "1",
    project: project.manifest,
    revision: project.revision,
    manifestSha256: project.manifestSha256,
    updatedAt: project.updatedAt,
    skillsPublished:
      publishesGeneratedSkills(project.manifest) && vetting.state === "cleared",
    vetting,
  });
  response.headers.set("access-control-allow-origin", "*");
  return response;
}

/**
 * One approved revision with its exact stored bytes. A generated skill's
 * installer hashes these bytes against the digest bound in its provenance.
 */
async function getPublicRevision(
  deps: ProjectApiDependencies,
  projectId: string,
  revisionText: string,
): Promise<Response> {
  const revision = Number(revisionText);
  if (
    !PROJECT_ID.test(projectId) ||
    !/^[1-9][0-9]{0,8}$/u.test(revisionText) ||
    !Number.isSafeInteger(revision)
  )
    fail(404, "not_found", "Revision not found");
  const stored = await deps.persistence.getRevisionText(projectId, revision);
  if (stored === null) fail(404, "not_found", "Revision not found");
  return json(
    200,
    {
      schemaVersion: "1",
      projectId,
      revision,
      manifestSha256: stored.manifestSha256,
      manifestText: stored.manifestText,
    },
    "public, max-age=31536000, immutable",
  );
}

async function listPublicRevisions(
  deps: ProjectApiDependencies,
): Promise<Response> {
  const revisions = await deps.persistence.listRevisions();
  return publicJson({ schemaVersion: "1", revisions });
}

const GITHUB_LOOKUP_CACHE_CONTROL = "private, max-age=300";

async function githubLookup(
  request: Request,
  deps: ProjectApiDependencies,
  parts: string[],
): Promise<Response> {
  const session = await requireSession(request, deps);
  // Public GitHub facts are the same for every caller, so the edge cache is
  // shared; the session only gates who may spend the lookup budget.
  const url = new URL(request.url);
  const cacheRequest = new Request(
    parts[1] === "owned-repositories"
      ? `${url.origin}/api/v1/project-github/owned-repositories/${session.githubLogin.toLowerCase()}`
      : `${url.origin}${url.pathname.toLowerCase()}`,
  );
  const build = async () => {
    if (parts[1] === "owned-repositories") {
      if (!validGithubLogin(session.githubLogin))
        fail(
          400,
          "invalid_request",
          "The signed-in GitHub login is not valid.",
        );
      const repositories = await listOwnedRepositories(
        deps.github.fetch,
        deps.github.token,
        session.githubLogin,
        deps.github.apiOrigin,
      );
      return json(200, { repositories }, "public, max-age=0, s-maxage=300");
    }
    const repository = `${parts[2]}/${parts[3]}`;
    if (!validRepositoryPath(repository))
      fail(400, "invalid_request", "Enter the repository as owner/name.");
    const facts = await lookupGitHubRepository(
      deps.github.fetch,
      deps.github.token,
      repository,
      deps.github.apiOrigin,
    );
    return json(200, { repository: facts }, "public, max-age=0, s-maxage=300");
  };
  const response = await cachedPublicResponse(
    deps.cache,
    cacheRequest,
    build,
    deps.waitUntil,
  );
  response.headers.set("cache-control", GITHUB_LOOKUP_CACHE_CONTROL);
  return response;
}

function isProjectRoute(parts: string[]): boolean {
  return (
    // Deeper /projects/:id/... paths belong to the trace API.
    (parts[0] === "projects" && parts.length <= 2) ||
    parts[0] === "project-vaults" ||
    parts[0] === "project-github" ||
    parts[0] === "project-revisions" ||
    parts[0] === "project-session" ||
    parts[0] === "project-setup" ||
    parts[0] === "project-applications" ||
    parts[0] === "project-appeals" ||
    (parts[0] === "project-account-bans" && parts.length === 1) ||
    (parts[0] === "admin" && parts[1] === "projects")
  );
}

/** Returns null when the path belongs to another API module. */
export async function handleProjectApi(
  request: Request,
  deps: ProjectApiDependencies,
): Promise<Response | null> {
  const parts = pathParts(request);
  const route = `${request.method} ${parts
    .map((part, index) =>
      (parts[0] === "admin" && index === 2) ||
      (parts[0] === "projects" && index === 1) ||
      (parts[0] === "project-setup" && index === 1) ||
      (parts[0] === "project-vaults" && index === 1) ||
      (parts[0] === "project-applications" && index === 1 && parts.length === 3)
        ? ":id"
        : parts[0] === "project-github" &&
            parts[1] === "repositories" &&
            index >= 2
          ? ":name"
          : part,
    )
    .join("/")}`;
  try {
    if (
      request.method !== "GET" &&
      parts.length > 0 &&
      isProjectRoute(parts) &&
      !isSameOriginJsonWrite(request)
    ) {
      fail(403, "origin_forbidden", "Requests must come from this site");
    }
    if (
      request.method === "GET" &&
      parts[0] === "project-revisions" &&
      parts.length === 3
    )
      return await getPublicRevision(deps, parts[1], parts[2]);
    switch (route) {
      case "GET projects":
        return await cachedPublicResponse(
          deps.cache,
          request,
          () => listPublicProjects(deps),
          deps.waitUntil,
          await deps.persistence.enforcementGeneration(),
        );
      case "GET project-revisions":
        return await cachedPublicResponse(
          deps.cache,
          request,
          () => listPublicRevisions(deps),
          deps.waitUntil,
          await deps.persistence.enforcementGeneration(),
        );
      case "GET project-account-bans":
        return await cachedPublicResponse(
          deps.cache,
          request,
          () => listPublicAccountBans(deps),
          deps.waitUntil,
          await deps.persistence.enforcementGeneration(),
        );
      case "GET projects/:id":
        return await readPublicProject(deps, parts[1]);
      case "GET project-github/owned-repositories":
      case "GET project-github/repositories/:name/:name":
        return await githubLookup(request, deps, parts);
      case "GET project-session": {
        // Signed out is an ordinary state, not an error the browser logs.
        const actor = await deps.sessionActor(request);
        return json(200, {
          session: actor === null ? null : sessionBody(actor, deps),
        });
      }
      case "POST projects":
        return await createProject(request, deps);
      case "PUT projects/:id":
        return await publishOwnerRevision(request, deps, parts[1]);
      case "POST project-vaults/:id/solana-funding":
        return await ownerBountySolanaFunding(request, deps, parts[1]);
      case "GET project-vaults/:id":
      case "POST project-vaults/:id":
        return await ownerVault(request, deps, parts[1]);
      case "GET project-setup":
        return await listSetup(request, deps);
      case "POST project-setup/:id/check":
        return await checkSetup(request, deps, parts[1]);
      case "GET project-applications/mine":
        return await listMyApplications(request, deps);
      case "POST project-applications/:id/publish":
        return await publishPendingApplication(request, deps, parts[1]);
      case "GET admin/projects":
        return await listAdminProjects(request, deps);
      case "PUT admin/projects/:id/manifest":
        return await replaceProjectManifest(request, deps, parts[2]);
      case "POST admin/projects/:id/enforcement-preview":
        return await enforceProject(request, deps, parts[2], "preview");
      case "POST admin/projects/:id/enforcement":
        return await enforceProject(request, deps, parts[2], "apply");
      case "POST project-appeals":
        return await requestReinstatement(request, deps);
      case "GET project-appeals":
        return await listAccountAppeals(request, deps);
    }
    if (isProjectRoute(parts)) return json(404, { error: "not_found" });
    return null;
  } catch (caught) {
    return apiErrorResponse(caught, {
      label: "project API failure",
      respond: json,
      publicMessage: (_status, error, caught) =>
        caught instanceof GithubLookupError ||
        error.code === "vault_setup_unavailable",
    });
  }
}
