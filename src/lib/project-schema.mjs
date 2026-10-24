import { assertEscrowPolicy, isBaseUnits } from "./escrow-policy.mjs";
import { exactKeys, readRecord as record } from "./record-validation.mjs";
/**
 * Validates untrusted project folders before they enter discovery, ingestion,
 * skills, or money-shaped views. The schema is intentionally narrow so a pull
 * request cannot smuggle executable configuration or ambiguous reward terms.
 */

import {
  assertFundingAddresses,
  fundingAssetForNetwork,
} from "./funding-address.mjs";
import LEGACY_PROJECTS from "./legacy-projects.json" with { type: "json" };
import { validatePayoutExclusions } from "./payout-exclusions.mjs";
import {
  assertRewardAsset,
  REWARD_ASSET_NETWORK_IDS,
} from "./reward-asset.mjs";
import { assertSecurityBountyTerms } from "./security-bounty.mjs";

/**
 * The canonical generic templates every generated project skill renders from
 * (PRD SKL-03). A project names one as its skill source path.
 */
export const PROJECT_SKILL_TEMPLATES = Object.freeze({
  contributor: "skills/project-contributor-template",
  reviewer: "skills/project-reviewer-template",
});

/**
 * The longest project id. The generated reviewer skill is named
 * `review-<id>-contributions`, and a skill name has at most 64 characters
 * (`scripts/skill-validation/quick_validate.py`).
 */
export const MAX_PROJECT_ID_LENGTH = 43;
const PROJECT_ID = /^[a-z0-9](?:[a-z0-9-]{0,41}[a-z0-9])?$/u;

/**
 * Funding terms a project records once, at creation. Owner self-service never
 * changes `project.funding`, so each project and every one of its revisions
 * keeps the terms it was created with.
 *
 * Projects created before 24 October 2026 record the direct-wallet wording
 * with a 1% fee (2% once an escrow block is adopted). Every project created
 * from that date records the project-vault wording with the ordinary 2% fee,
 * vault or not (PRD section 11, owner decision of 24 October 2026, D3).
 */
export const DIRECT_FUNDING_DISCLOSURE =
  "Funds go directly to the project wallet. Slop does not hold or recover funds.";
export const VAULT_FUNDING_DISCLOSURE =
  "Funds are committed in the project vault. Slop holds no payment keys.";

/**
 * The platform fee, in basis points, a reward policy must record for its
 * project's funding terms. External prize shares keep their 10% platform
 * share.
 */
export function projectFeeBasisPoints({ kind, escrow, disclosure }) {
  if (kind === "external-prize-share") return 1000;
  return escrow !== undefined || disclosure === VAULT_FUNDING_DISCLOSURE
    ? 200
    : 100;
}

/** Maintainer-authored fields, in render order, that generate project skills. */
export const CONTRIBUTION_FIELDS = Object.freeze([
  "approvedScope",
  "contributionGuide",
  "supportedTasks",
  "requiredTests",
  "reviewExpectations",
  "securityContact",
  "closurePolicy",
  "maintainerNotes",
]);

/**
 * Repositories of projects removed before the D1 registry keep their original
 * project id in contributor points and profiles. Listing one of them under
 * another id would key a second award for the same immutable GitHub source,
 * so the registry must reuse the id that history already carries.
 */
const LEGACY_PROJECT_ID_BY_REPOSITORY = new Map(
  LEGACY_PROJECTS.flatMap((project) =>
    project.repositories.flatMap((repository) =>
      [repository.id, ...(repository.aliases ?? [])].map((repositoryId) => [
        repositoryId.toLowerCase(),
        project.id,
      ]),
    ),
  ),
);

const PROJECT_KEYS = [
  "authority",
  "description",
  "eyebrow",
  "funding",
  "headline",
  "id",
  "links",
  "listingTier",
  "modelPolicy",
  "name",
  "repositories",
  "reviewSkill",
  "reward",
  "schemaVersion",
  "skill",
  "slug",
  "status",
  "steward",
  "terms",
];
/**
 * Optional manifest sections. `rewardAsset` and `contribution` arrive with
 * the D1 registry; older revisions omit them.
 */
const OPTIONAL_PROJECT_KEYS = [
  "escrow",
  "participation",
  "rewardAsset",
  "contribution",
  "securityBounty",
];
export const MAX_MONTHLY_CAP_MINOR = 1_000_000_000_000_000n;

/** Formats cent-precise USDC minor units without floating-point conversion. */
export function formatMonthlyCapDisplay(value) {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw new TypeError("monthly cap must be canonical integer minor units");
  }
  const amount = BigInt(value);
  if (amount > MAX_MONTHLY_CAP_MINOR || amount % 10_000n !== 0n) {
    throw new RangeError("monthly cap must be cent-precise and at most $1B");
  }
  const whole = (amount / 1_000_000n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  const cents = Number((amount % 1_000_000n) / 10_000n);
  return `$${whole}${cents === 0 ? "" : `.${String(cents).padStart(2, "0")}`}`;
}

/** Formats integer base units of an asset with `decimals`, without floats. */
export function formatAssetAmount(value, decimals) {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw new TypeError("amount must be canonical integer base units");
  }
  const scale = 10n ** BigInt(decimals);
  const amount = BigInt(value);
  const whole = (amount / scale)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  const fraction =
    decimals === 0
      ? ""
      : (amount % scale).toString().padStart(decimals, "0").replace(/0+$/u, "");
  return fraction === "" ? whole : `${whole}.${fraction}`;
}

/**
 * Converts a decimal amount in whole units of an asset to its integer base
 * units (owner decision D11: amounts use asset base units).
 */
export function parseAssetAmount(value, decimals) {
  const match =
    typeof value === "string"
      ? /^(0|[1-9]\d{0,12})(?:\.(\d{1,36}))?$/u.exec(value)
      : null;
  if (!match) throw new TypeError("amount must be a plain decimal number");
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) {
    throw new RangeError(
      `amount has more decimal places than the asset's ${decimals}`,
    );
  }
  return (
    BigInt(match[1]) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0") || "0")
  ).toString();
}

/**
 * The display of a monthly amount in asset base units. A reviewed stablecoin
 * (6 decimals, so its base units are cent-precise micro-units) keeps the
 * dollar display; a token names its own symbol, never dollars (PRD section 6).
 */
export function monthlyAmountDisplay(value, rewardAsset) {
  if (rewardAsset?.kind !== "token") return formatMonthlyCapDisplay(value);
  if (!isBaseUnits(value)) {
    throw new RangeError("monthly amount is too large");
  }
  return `${formatAssetAmount(value, rewardAsset.decimals)} ${rewardAsset.symbol}`;
}

function text(value, field, { max = 500, min = 1, pattern } = {}) {
  if (
    typeof value !== "string" ||
    value.length < min ||
    value.length > max ||
    (pattern && !pattern.test(value))
  ) {
    throw new TypeError(`${field} is invalid`);
  }
  return value;
}

function url(value, field, expectedOrigin) {
  const result = text(value, field, { max: 500 });
  let parsed;
  try {
    parsed = new URL(result);
  } catch (error) {
    throw new TypeError(`${field} is not a URL`, { cause: error });
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    (expectedOrigin && parsed.origin !== expectedOrigin)
  ) {
    throw new TypeError(`${field} is not an allowed HTTPS URL`);
  }
  return result;
}

function minor(value, field) {
  return text(value, field, { pattern: /^(?:0|[1-9]\d*)$/u });
}

function nullable(value, field, validator) {
  return value === null ? null : validator(value, field);
}

function digest(value, field) {
  return text(value, field, { pattern: /^[0-9a-f]{64}$/u });
}

function commit(value, field) {
  return text(value, field, { pattern: /^[0-9a-f]{40}$/u });
}

function numericId(value, field) {
  return text(value, field, { max: 40, pattern: /^[1-9]\d*$/u });
}

function repositoryIdentities(repository) {
  return [repository.id, ...(repository.aliases ?? [])];
}

function immutableGithubUrl(value, field, repositoryIds, commitSha, path) {
  const result = url(value, field, "https://github.com");
  const pathname = new URL(result).pathname;
  if (
    !repositoryIds.some(
      (repositoryId) =>
        pathname === `/${repositoryId}/blob/${commitSha}/${path}`,
    )
  ) {
    throw new TypeError(`${field} must be an immutable repository URL`);
  }
  return result;
}

function immutableGithubCommitUrl(value, field, repositoryIds, commitSha) {
  const result = url(value, field, "https://github.com");
  const pathname = new URL(result).pathname;
  if (
    !repositoryIds.some((repositoryId) => {
      const prefix = `/${repositoryId}/blob/${commitSha}/`;
      return pathname.startsWith(prefix) && pathname.length > prefix.length;
    })
  ) {
    throw new TypeError(
      `${field} must bind its repository, commit, and non-empty path`,
    );
  }
  return result;
}

function validateSteward(value) {
  const field = "project.steward";
  const steward = record(value, field);
  exactKeys(steward, ["displayName", "github", "kind", "website"], field);
  text(steward.displayName, `${field}.displayName`, { max: 120, min: 2 });
  if (
    !["individual", "organization", "dao", "collective"].includes(steward.kind)
  ) {
    throw new TypeError(`${field}.kind is invalid`);
  }
  const github = record(steward.github, `${field}.github`);
  exactKeys(
    github,
    ["actorId", "login", "nodeId", "profileUrl", "type"],
    `${field}.github`,
  );
  numericId(github.actorId, `${field}.github.actorId`);
  text(github.nodeId, `${field}.github.nodeId`, {
    max: 100,
    pattern: /^[A-Za-z0-9_=-]+$/u,
  });
  text(github.login, `${field}.github.login`, {
    max: 39,
    pattern: /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u,
  });
  if (!["User", "Organization"].includes(github.type)) {
    throw new TypeError(`${field}.github.type is invalid`);
  }
  const profileUrl = url(
    github.profileUrl,
    `${field}.github.profileUrl`,
    "https://github.com",
  );
  if (
    new URL(profileUrl).pathname.toLowerCase() !==
    `/${github.login}`.toLowerCase()
  ) {
    throw new TypeError(`${field}.github.profileUrl does not match its login`);
  }
  nullable(steward.website, `${field}.website`, (entry, name) =>
    url(entry, name),
  );
  return steward;
}

function validateAuthority(value, repository) {
  const field = "project.authority";
  const authority = record(value, field);
  exactKeys(
    authority,
    ["proof", "reason", "repositoryId", "repositoryNodeId", "role", "state"],
    field,
  );
  numericId(authority.repositoryId, `${field}.repositoryId`);
  text(authority.repositoryNodeId, `${field}.repositoryNodeId`, {
    max: 100,
    pattern: /^[A-Za-z0-9_=-]+$/u,
  });
  if (authority.role !== "project-steward") {
    throw new TypeError(`${field}.role is invalid`);
  }
  if (authority.state === "unverified") {
    if (
      authority.proof !== null ||
      authority.reason !== "missing-repository-proof"
    ) {
      throw new TypeError(`${field} unverified state is inconsistent`);
    }
    return authority;
  }
  if (authority.state !== "verified" || authority.reason !== null) {
    throw new TypeError(`${field}.state is invalid`);
  }
  const proof = record(authority.proof, `${field}.proof`);
  exactKeys(
    proof,
    ["commitSha", "fileSha256", "policyRevision", "url", "verifiedAt"],
    `${field}.proof`,
  );
  const commitSha = commit(proof.commitSha, `${field}.proof.commitSha`);
  digest(proof.fileSha256, `${field}.proof.fileSha256`);
  text(proof.policyRevision, `${field}.proof.policyRevision`, {
    max: 80,
    pattern: /^[a-z0-9][a-z0-9._-]*$/u,
  });
  timestamp(proof.verifiedAt, `${field}.proof.verifiedAt`);
  immutableGithubUrl(
    proof.url,
    `${field}.proof.url`,
    repositoryIdentities(repository),
    commitSha,
    ".github/slop-project.json",
  );
  return authority;
}

function validateTerms(
  value,
  repository,
  reward,
  steward,
  { allowLegacyUnsupportedOwnershipClaim = false } = {},
) {
  const field = "project.terms";
  const repositoryIds = repositoryIdentities(repository);
  const terms = record(value, field);
  exactKeys(
    terms,
    [
      "assignment",
      "copyright",
      "effectiveAt",
      "externalPrize",
      "inbound",
      "paymentTransfersIp",
      "receiptPolicy",
      "repositoryLicense",
      "retroactive",
      "revision",
    ],
    field,
  );
  text(terms.revision, `${field}.revision`, {
    max: 80,
    pattern: /^[a-z0-9][a-z0-9._-]*$/u,
  });
  timestamp(terms.effectiveAt, `${field}.effectiveAt`);
  const receiptPolicy = record(terms.receiptPolicy, `${field}.receiptPolicy`);
  exactKeys(
    receiptPolicy,
    ["activatedAt", "bindings", "state"],
    `${field}.receiptPolicy`,
  );
  if (!Array.isArray(receiptPolicy.bindings)) {
    throw new TypeError(`${field}.receiptPolicy.bindings must be an array`);
  }
  if (receiptPolicy.state === "pending-authority-activation") {
    if (
      receiptPolicy.activatedAt !== null ||
      receiptPolicy.bindings.length !== 0
    ) {
      throw new TypeError(
        `${field}.receiptPolicy pending state cannot have activation bindings`,
      );
    }
  } else if (receiptPolicy.state === "active") {
    timestamp(receiptPolicy.activatedAt, `${field}.receiptPolicy.activatedAt`);
    if (receiptPolicy.bindings.length === 0) {
      throw new TypeError(
        `${field}.receiptPolicy active state requires bindings`,
      );
    }
  } else {
    throw new TypeError(`${field}.receiptPolicy.state is invalid`);
  }
  if (terms.paymentTransfersIp !== false || terms.retroactive !== false) {
    throw new TypeError(
      `${field} cannot transfer IP by payment or apply retroactively`,
    );
  }
  const copyright = record(terms.copyright, `${field}.copyright`);
  exactKeys(
    copyright,
    [
      "claimedLegalHolder",
      "governanceResolution",
      "legalCapacity",
      "model",
      "notice",
    ],
    `${field}.copyright`,
  );
  if (
    !["sponsor-owned", "contributor-retained", "mixed", "unknown"].includes(
      copyright.model,
    )
  ) {
    throw new TypeError(`${field}.copyright.model is invalid`);
  }
  nullable(
    copyright.claimedLegalHolder,
    `${field}.copyright.claimedLegalHolder`,
    (entry, name) => text(entry, name, { max: 240 }),
  );
  nullable(copyright.notice, `${field}.copyright.notice`, (entry, name) =>
    text(entry, name, { max: 500 }),
  );
  if (
    copyright.model === "contributor-retained" &&
    copyright.claimedLegalHolder !== null
  ) {
    throw new TypeError(
      `${field} contributor-retained terms forbid a sole-holder claim`,
    );
  }
  if (
    copyright.model === "sponsor-owned" &&
    copyright.claimedLegalHolder === null
  ) {
    throw new TypeError(
      `${field} sponsor-owned terms require an exact legal holder`,
    );
  }
  if (
    !allowLegacyUnsupportedOwnershipClaim &&
    (copyright.model === "mixed" || copyright.model === "unknown") &&
    copyright.claimedLegalHolder !== null
  ) {
    throw new TypeError(
      `${field} records no ownership claim outside signed sponsor-owned terms`,
    );
  }
  if (copyright.legalCapacity !== null) {
    const capacity = record(
      copyright.legalCapacity,
      `${field}.copyright.legalCapacity`,
    );
    exactKeys(
      capacity,
      ["entityId", "jurisdiction", "legalName"],
      `${field}.copyright.legalCapacity`,
    );
    for (const name of ["entityId", "jurisdiction", "legalName"]) {
      text(capacity[name], `${field}.copyright.legalCapacity.${name}`, {
        max: 240,
      });
    }
  }
  if (copyright.governanceResolution !== null) {
    const resolution = record(
      copyright.governanceResolution,
      `${field}.copyright.governanceResolution`,
    );
    exactKeys(
      resolution,
      ["fileSha256", "url", "version"],
      `${field}.copyright.governanceResolution`,
    );
    digest(
      resolution.fileSha256,
      `${field}.copyright.governanceResolution.fileSha256`,
    );
    url(resolution.url, `${field}.copyright.governanceResolution.url`);
    text(
      resolution.version,
      `${field}.copyright.governanceResolution.version`,
      {
        max: 80,
      },
    );
  }
  const license = record(terms.repositoryLicense, `${field}.repositoryLicense`);
  exactKeys(
    license,
    ["commitSha", "fileSha256", "spdx", "state", "url"],
    `${field}.repositoryLicense`,
  );
  if (license.state === "unknown") {
    if (
      [license.commitSha, license.fileSha256, license.spdx, license.url].some(
        (entry) => entry !== null,
      )
    ) {
      throw new TypeError(
        `${field}.repositoryLicense unknown state must not invent terms`,
      );
    }
  } else if (license.state === "verified") {
    text(license.spdx, `${field}.repositoryLicense.spdx`, {
      max: 80,
      pattern: /^[A-Za-z0-9-.+]+(?: (?:AND|OR|WITH) [A-Za-z0-9-.+]+)*$/u,
    });
    const licenseCommit = commit(
      license.commitSha,
      `${field}.repositoryLicense.commitSha`,
    );
    digest(license.fileSha256, `${field}.repositoryLicense.fileSha256`);
    immutableGithubUrl(
      license.url,
      `${field}.repositoryLicense.url`,
      repositoryIds,
      licenseCommit,
      "LICENSE",
    );
  } else {
    throw new TypeError(`${field}.repositoryLicense.state is invalid`);
  }
  const inbound = record(terms.inbound, `${field}.inbound`);
  exactKeys(
    inbound,
    ["acceptance", "commitSha", "fileSha256", "mode", "termsUrl", "version"],
    `${field}.inbound`,
  );
  if (
    !["license", "cla", "assignment", "dco", "mixed", "unknown"].includes(
      inbound.mode,
    )
  ) {
    throw new TypeError(`${field}.inbound.mode is invalid`);
  }
  if (inbound.mode === "unknown") {
    if (
      [
        inbound.acceptance,
        inbound.commitSha,
        inbound.fileSha256,
        inbound.termsUrl,
        inbound.version,
      ].some((entry) => entry !== null)
    ) {
      throw new TypeError(
        `${field}.inbound unknown state must not invent terms`,
      );
    }
  } else {
    text(inbound.acceptance, `${field}.inbound.acceptance`, { max: 240 });
    const inboundCommit = commit(
      inbound.commitSha,
      `${field}.inbound.commitSha`,
    );
    digest(inbound.fileSha256, `${field}.inbound.fileSha256`);
    text(inbound.version, `${field}.inbound.version`, { max: 80 });
    immutableGithubCommitUrl(
      inbound.termsUrl,
      `${field}.inbound.termsUrl`,
      repositoryIds,
      inboundCommit,
    );
  }
  if (terms.assignment !== null) {
    const assignment = record(terms.assignment, `${field}.assignment`);
    exactKeys(
      assignment,
      ["assignee", "fileSha256", "instrumentUrl", "signedAt", "version"],
      `${field}.assignment`,
    );
    text(assignment.assignee, `${field}.assignment.assignee`, { max: 240 });
    digest(assignment.fileSha256, `${field}.assignment.fileSha256`);
    url(assignment.instrumentUrl, `${field}.assignment.instrumentUrl`);
    timestamp(assignment.signedAt, `${field}.assignment.signedAt`);
    text(assignment.version, `${field}.assignment.version`, { max: 80 });
  }
  if (inbound.mode === "assignment" && terms.assignment === null) {
    throw new TypeError(
      `${field} assignment inbound mode requires a signed instrument`,
    );
  }
  if (copyright.model === "sponsor-owned" && terms.assignment === null) {
    throw new TypeError(
      `${field} sponsor-owned terms require a signed assignment instrument`,
    );
  }
  if (
    copyright.model === "sponsor-owned" &&
    steward.kind === "dao" &&
    (copyright.legalCapacity === null ||
      copyright.governanceResolution === null)
  ) {
    throw new TypeError(
      `${field} DAO title requires legal capacity and a governance resolution`,
    );
  }
  if (reward.kind === "external-prize-share") {
    const prize = record(terms.externalPrize, `${field}.externalPrize`);
    exactKeys(
      prize,
      [
        "allocationAuthority",
        "defaultContributorAllocation",
        "eligibility",
        "ipTerms",
        "organizer",
        "rulesCapturedAt",
        "rulesSha256",
        "rulesUrl",
        "version",
      ],
      `${field}.externalPrize`,
    );
    text(prize.organizer, `${field}.externalPrize.organizer`, { max: 160 });
    url(prize.rulesUrl, `${field}.externalPrize.rulesUrl`);
    for (const name of [
      "allocationAuthority",
      "defaultContributorAllocation",
      "eligibility",
      "ipTerms",
      "version",
    ]) {
      text(prize[name], `${field}.externalPrize.${name}`, { max: 240 });
    }
    if (prize.rulesSha256 === null || prize.rulesCapturedAt === null) {
      if (
        prize.rulesSha256 !== null ||
        prize.rulesCapturedAt !== null ||
        prize.version !== "unknown"
      ) {
        throw new TypeError(
          `${field}.externalPrize unverified rules are inconsistent`,
        );
      }
    } else {
      digest(prize.rulesSha256, `${field}.externalPrize.rulesSha256`);
      timestamp(
        prize.rulesCapturedAt,
        `${field}.externalPrize.rulesCapturedAt`,
      );
    }
  } else if (terms.externalPrize !== null) {
    throw new TypeError(
      `${field}.externalPrize is only valid for external prizes`,
    );
  }
  if (receiptPolicy.state === "active") {
    if (license.state !== "verified" || license.fileSha256 === null) {
      throw new TypeError(
        `${field}.receiptPolicy active state requires a verified repository license`,
      );
    }
    if (inbound.mode === "unknown" || inbound.fileSha256 === null) {
      throw new TypeError(
        `${field}.receiptPolicy active state requires immutable inbound terms`,
      );
    }
    if (
      terms.externalPrize !== null &&
      (terms.externalPrize.rulesSha256 === null ||
        terms.externalPrize.rulesCapturedAt === null ||
        terms.externalPrize.version === "unknown")
    ) {
      throw new TypeError(
        `${field}.receiptPolicy active state requires immutable external prize rules`,
      );
    }
    const revisions = new Set();
    let previousActivation = -Infinity;
    const bindings = receiptPolicy.bindings.map((value, index) => {
      const bindingField = `${field}.receiptPolicy.bindings[${index}]`;
      const binding = record(value, bindingField);
      exactKeys(
        binding,
        [
          "activatedAt",
          "inboundTermsSha256",
          "licenseSha256",
          "policyRevision",
          "prizeRulesSha256",
        ],
        bindingField,
      );
      const policyRevision = text(
        binding.policyRevision,
        `${bindingField}.policyRevision`,
        { max: 80, pattern: /^[a-z0-9][a-z0-9._-]*$/u },
      );
      if (revisions.has(policyRevision)) {
        throw new TypeError(`${field}.receiptPolicy has duplicate revisions`);
      }
      revisions.add(policyRevision);
      const activatedAt = timestamp(
        binding.activatedAt,
        `${bindingField}.activatedAt`,
      );
      if (Date.parse(activatedAt) <= previousActivation) {
        throw new TypeError(
          `${field}.receiptPolicy bindings must be activation ordered`,
        );
      }
      previousActivation = Date.parse(activatedAt);
      digest(binding.licenseSha256, `${bindingField}.licenseSha256`);
      nullable(
        binding.inboundTermsSha256,
        `${bindingField}.inboundTermsSha256`,
        digest,
      );
      nullable(
        binding.prizeRulesSha256,
        `${bindingField}.prizeRulesSha256`,
        digest,
      );
      return binding;
    });
    const first = bindings[0];
    const current = bindings.at(-1);
    if (first.activatedAt !== receiptPolicy.activatedAt) {
      throw new TypeError(
        `${field}.receiptPolicy cutover must equal its first binding activation`,
      );
    }
    if (
      current.policyRevision !== terms.revision ||
      current.activatedAt !== terms.effectiveAt ||
      current.licenseSha256 !== license.fileSha256 ||
      current.inboundTermsSha256 !== inbound.fileSha256 ||
      current.prizeRulesSha256 !== (terms.externalPrize?.rulesSha256 ?? null)
    ) {
      throw new TypeError(
        `${field}.receiptPolicy latest binding must match current terms and effective date`,
      );
    }
  }
  return terms;
}

function timestamp(value, field) {
  const result = text(value, field, {
    pattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u,
  });
  if (
    !Number.isFinite(Date.parse(result)) ||
    new Date(result).toISOString() !== result
  )
    throw new TypeError(`${field} is invalid`);
  return result;
}

function validateRepository(value, index) {
  const field = `project.repositories[${index}]`;
  const repository = record(value, field);
  const requiredKeys = [
    "description",
    "displayName",
    "githubUrl",
    "id",
    "integrationBranch",
  ];
  const actualKeys = Object.keys(repository).sort().join("\0");
  if (
    actualKeys !== [...requiredKeys].sort().join("\0") &&
    actualKeys !== [...requiredKeys, "aliases"].sort().join("\0")
  ) {
    throw new TypeError(`${field} has unexpected or missing fields`);
  }
  const id = text(repository.id, `${field}.id`, {
    max: 201,
    pattern: /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u,
  });
  const aliases = repository.aliases ?? [];
  if (!Array.isArray(aliases) || aliases.length > 10) {
    throw new TypeError(`${field}.aliases must contain at most 10 entries`);
  }
  const repositoryIds = [
    id,
    ...aliases.map((alias, aliasIndex) =>
      text(alias, `${field}.aliases[${aliasIndex}]`, {
        max: 201,
        pattern: /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u,
      }),
    ),
  ];
  if (
    new Set(repositoryIds.map((repositoryId) => repositoryId.toLowerCase()))
      .size !== repositoryIds.length
  ) {
    throw new TypeError(`${field} contains duplicate repository identities`);
  }
  const githubUrl = url(
    repository.githubUrl,
    `${field}.githubUrl`,
    "https://github.com",
  );
  if (
    !repositoryIds.some(
      (repositoryId) =>
        new URL(githubUrl).pathname.replace(/\/$/u, "").toLowerCase() ===
        `/${repositoryId}`.toLowerCase(),
    )
  ) {
    throw new TypeError(
      `${field}.githubUrl does not match a registered repository identity`,
    );
  }
  text(repository.displayName, `${field}.displayName`, { max: 201 });
  text(repository.description, `${field}.description`, { max: 500, min: 12 });
  text(repository.integrationBranch, `${field}.integrationBranch`, {
    max: 255,
    pattern: /^(?!.*(?:\.\.|\s|~|\^|:|\?|\*|\[|\\))[A-Za-z0-9._/-]+$/u,
  });
  return repository;
}

function validateSkill(
  value,
  field,
  expectedId,
  publicPath,
  { allowLegacyMissingPublishAtRoot = false } = {},
) {
  const skill = record(value, field);
  const hasPublishAtRoot = Object.hasOwn(skill, "publishAtRoot");
  exactKeys(
    skill,
    publicPath
      ? [
          "id",
          "publicPath",
          ...(hasPublishAtRoot ? ["publishAtRoot"] : []),
          "sourcePath",
        ]
      : ["id", "sourcePath"],
    field,
  );
  if (publicPath && !hasPublishAtRoot && !allowLegacyMissingPublishAtRoot) {
    throw new TypeError(`${field}.publishAtRoot is required`);
  }
  // A generated skill names its canonical template; a historical project
  // names its own committed skill folder.
  const template = publicPath
    ? PROJECT_SKILL_TEMPLATES.contributor
    : PROJECT_SKILL_TEMPLATES.reviewer;
  if (
    skill.id !== expectedId ||
    (skill.sourcePath !== `skills/${expectedId}` &&
      skill.sourcePath !== template) ||
    (publicPath &&
      (skill.publicPath !== publicPath ||
        (hasPublishAtRoot && typeof skill.publishAtRoot !== "boolean")))
  ) {
    throw new TypeError(`${field} does not match its project identity`);
  }
  return skill;
}

/**
 * Maintainer-authored text that generated skills carry as data. Strings must
 * be well-formed Unicode so every renderer serializes the same bytes.
 */
function validateContribution(value) {
  const contribution = record(value, "project.contribution");
  exactKeys(contribution, [...CONTRIBUTION_FIELDS], "project.contribution");
  for (const field of CONTRIBUTION_FIELDS) {
    const entry = contribution[field];
    if (
      typeof entry !== "string" ||
      !entry.isWellFormed() ||
      entry.length < (field === "approvedScope" ? 6 : 0) ||
      entry.length > 2000
    ) {
      throw new TypeError(`project.contribution.${field} is invalid`);
    }
  }
  return contribution;
}

function validateExternalEvaluations(value, field) {
  const policy = record(value, field);
  exactKeys(policy, ["enabled"], field);
  if (typeof policy.enabled !== "boolean") {
    throw new TypeError(`${field}.enabled must be a boolean`);
  }
}

function validateReviewBudget(value, field, poolPaymentMode) {
  const budget = record(value, field);
  exactKeys(
    budget,
    [
      "committedMinor",
      "effectiveAt",
      "fundingState",
      "monthlyCapDisplay",
      "monthlyCapMinor",
      "paymentMode",
      "unusedFunds",
    ],
    field,
  );
  const monthlyCapMinor = minor(
    budget.monthlyCapMinor,
    `${field}.monthlyCapMinor`,
  );
  const effectiveAt = timestamp(budget.effectiveAt, `${field}.effectiveAt`);
  const committedMinor = minor(
    budget.committedMinor,
    `${field}.committedMinor`,
  );
  if (budget.paymentMode !== "disabled" && budget.paymentMode !== "enabled") {
    throw new TypeError(`${field}.paymentMode is invalid`);
  }
  text(budget.monthlyCapDisplay, `${field}.monthlyCapDisplay`, { max: 80 });
  const paymentsDisabled = budget.paymentMode === "disabled";
  if (
    BigInt(monthlyCapMinor) <= 0n ||
    !effectiveAt.endsWith("-01T00:00:00.000Z") ||
    budget.unusedFunds !== "rollover-without-cap-increase" ||
    (paymentsDisabled
      ? !(
          (budget.fundingState === "pledged" && committedMinor === "0") ||
          (budget.fundingState === "committed" && BigInt(committedMinor) > 0n)
        )
      : budget.fundingState !== "committed" || BigInt(committedMinor) <= 0n) ||
    (budget.paymentMode === "enabled" && poolPaymentMode !== "enabled") ||
    budget.monthlyCapDisplay !== formatMonthlyCapDisplay(monthlyCapMinor)
  ) {
    throw new TypeError(`${field} review budget policy is inconsistent`);
  }
  return budget;
}

function validateReward(
  value,
  field,
  {
    allowLegacyExternalPrizeFee = false,
    escrow = undefined,
    fundingDisclosure = undefined,
    rewardAsset = undefined,
  } = {},
) {
  const reward = record(value, field);
  const hasExternal = Object.hasOwn(reward, "externalOpportunity");
  const hasReviewBudget = Object.hasOwn(reward, "reviewBudget");
  const hasCycleCaps = Object.hasOwn(reward, "cycleCaps");
  const hasExternalEvaluations = Object.hasOwn(reward, "externalEvaluations");
  const hasPayoutExclusions = Object.hasOwn(reward, "payoutExclusions");
  exactKeys(
    reward,
    [
      "chain",
      "committedMinor",
      "currency",
      "cycle",
      ...(hasExternal ? ["externalOpportunity"] : []),
      ...(hasExternalEvaluations ? ["externalEvaluations"] : []),
      ...(hasCycleCaps ? ["cycleCaps"] : []),
      "feeBasisPoints",
      "fundingState",
      "kind",
      "monthlyCapDisplay",
      "monthlyCapMinor",
      ...(hasPayoutExclusions ? ["payoutExclusions"] : []),
      "paymentMode",
      ...(hasReviewBudget ? ["reviewBudget"] : []),
      "rewardStartAt",
      "unusedFunds",
    ],
    field,
  );
  if (hasPayoutExclusions)
    validatePayoutExclusions(
      reward.payoutExclusions,
      `${field}.payoutExclusions`,
    );
  if (hasExternalEvaluations) {
    validateExternalEvaluations(
      reward.externalEvaluations,
      `${field}.externalEvaluations`,
    );
  }
  const monthlyCapMinor = minor(
    reward.monthlyCapMinor,
    `${field}.monthlyCapMinor`,
  );
  const committedMinor = minor(
    reward.committedMinor,
    `${field}.committedMinor`,
  );
  if (reward.paymentMode !== "disabled" && reward.paymentMode !== "enabled") {
    throw new TypeError(`${field}.paymentMode is invalid`);
  }
  text(reward.monthlyCapDisplay, `${field}.monthlyCapDisplay`, { max: 80 });
  timestamp(reward.rewardStartAt, `${field}.rewardStartAt`);
  const expectedFeeBasisPoints = projectFeeBasisPoints({
    kind: reward.kind,
    escrow,
    disclosure: fundingDisclosure,
  });
  const hasLegacyExternalPrizeFee =
    allowLegacyExternalPrizeFee &&
    reward.kind === "external-prize-share" &&
    reward.feeBasisPoints === 100;
  if (
    reward.cycle !== "calendar-month-utc" ||
    (reward.feeBasisPoints !== expectedFeeBasisPoints &&
      !hasLegacyExternalPrizeFee)
  ) {
    throw new TypeError(`${field} cycle or fee policy is invalid`);
  }
  if (reward.kind === "monthly-pool") {
    const paymentsDisabled = reward.paymentMode === "disabled";
    // A chosen reward asset fixes the network and the paid symbol. Without
    // one, each settlement network has one approved stablecoin (FND-02).
    const legacyRail =
      !escrow &&
      (reward.chain === "solana" || reward.chain === "base") &&
      (rewardAsset === undefined || rewardAsset.kind === "stablecoin");
    if (
      hasExternal ||
      (rewardAsset !== undefined && rewardAsset.network !== reward.chain) ||
      reward.currency !==
        (rewardAsset?.symbol ?? fundingAssetForNetwork(reward.chain)) ||
      // `reward.chain` is the project's one settlement network (RFC #472).
      // An escrow project settles on its escrow chain. Before it adopts an
      // escrow policy, a project names Base or Solana with a stablecoin, or
      // declares another reviewed reward asset as display metadata only.
      (escrow
        ? reward.chain !== escrow.chain
        : !legacyRail &&
          (rewardAsset === undefined ||
            !REWARD_ASSET_NETWORK_IDS.includes(reward.chain) ||
            reward.paymentMode !== "disabled")) ||
      reward.unusedFunds !== "rollover-without-cap-increase" ||
      (paymentsDisabled
        ? !(
            (reward.fundingState === "pledged" && committedMinor === "0") ||
            (reward.fundingState === "committed" && BigInt(committedMinor) > 0n)
          )
        : reward.fundingState !== "committed" ||
          BigInt(committedMinor) <= 0n) ||
      reward.monthlyCapDisplay !==
        monthlyAmountDisplay(monthlyCapMinor, rewardAsset)
    ) {
      throw new TypeError(`${field} monthly pool policy is inconsistent`);
    }
    if (hasCycleCaps) {
      if (!Array.isArray(reward.cycleCaps) || reward.cycleCaps.length === 0) {
        throw new TypeError(`${field}.cycleCaps must be a nonempty array`);
      }
      let previousCycle = "";
      for (const entry of reward.cycleCaps) {
        const cap = record(entry, `${field}.cycleCaps entry`);
        exactKeys(
          cap,
          ["cycleId", "monthlyCapMinor"],
          `${field}.cycleCaps entry`,
        );
        if (
          typeof cap.cycleId !== "string" ||
          !/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(cap.cycleId) ||
          cap.cycleId <= previousCycle
        ) {
          throw new TypeError(
            `${field}.cycleCaps must have unique chronological UTC months`,
          );
        }
        monthlyAmountDisplay(cap.monthlyCapMinor, rewardAsset);
        previousCycle = cap.cycleId;
      }
    }
    if (hasReviewBudget) {
      validateReviewBudget(
        reward.reviewBudget,
        `${field}.reviewBudget`,
        reward.paymentMode,
      );
    }
  } else if (reward.kind === "external-prize-share") {
    if (
      hasReviewBudget ||
      hasCycleCaps ||
      !hasExternal ||
      reward.currency !== null ||
      reward.chain !== null ||
      reward.monthlyCapMinor !== "0" ||
      reward.monthlyCapDisplay !== "$0 platform pool" ||
      committedMinor !== "0" ||
      reward.paymentMode !== "disabled" ||
      reward.unusedFunds !== "not-applicable" ||
      reward.fundingState !== "external-opportunity"
    ) {
      throw new TypeError(
        `${field} external opportunity policy is inconsistent`,
      );
    }
    const external = record(
      reward.externalOpportunity,
      `${field}.externalOpportunity`,
    );
    exactKeys(
      external,
      ["advertisedAmountDisplay", "name", "url"],
      `${field}.externalOpportunity`,
    );
    text(external.name, `${field}.externalOpportunity.name`, { max: 160 });
    text(
      external.advertisedAmountDisplay,
      `${field}.externalOpportunity.advertisedAmountDisplay`,
      { max: 80 },
    );
    url(external.url, `${field}.externalOpportunity.url`);
  } else {
    throw new TypeError(`${field}.kind is unsupported`);
  }
  return reward;
}

function validateFunding(value, projectId) {
  const funding = record(value, "project.funding");
  exactKeys(
    funding,
    ["addresses", "disclosure", "mode", "recordsPath"],
    "project.funding",
  );
  if (
    funding.mode !== "direct-noncustodial" ||
    funding.recordsPath !== `funding/${projectId}` ||
    (funding.disclosure !== DIRECT_FUNDING_DISCLOSURE &&
      funding.disclosure !== VAULT_FUNDING_DISCLOSURE)
  ) {
    throw new TypeError("project.funding non-custodial policy is invalid");
  }
  assertFundingAddresses(funding.addresses, "project.funding.addresses");
  return funding;
}

function validateProjectDefinition(
  value,
  {
    allowLegacyMissingListingTier = false,
    allowLegacyMissingPublishAtRoot = false,
    allowLegacyExternalPrizeFee = false,
    allowLegacyUnsupportedOwnershipClaim = false,
  } = {},
) {
  const project = record(value, "project");
  exactKeys(
    project,
    allowLegacyMissingListingTier && !("listingTier" in project)
      ? [
          ...PROJECT_KEYS.filter((key) => key !== "listingTier"),
          ...OPTIONAL_PROJECT_KEYS.filter((key) => Object.hasOwn(project, key)),
        ]
      : [
          ...PROJECT_KEYS,
          ...OPTIONAL_PROJECT_KEYS.filter((key) => Object.hasOwn(project, key)),
        ],
    "project",
  );
  if (project.escrow !== undefined) {
    assertEscrowPolicy(project.escrow);
    if (project.reward?.kind !== "monthly-pool")
      throw new TypeError(
        "External prize shares must be funded and converted before escrow activation",
      );
    if (project.reward?.paymentMode !== "disabled")
      throw new TypeError(
        "Escrow migration cannot leave the legacy payment path enabled",
      );
  }
  if (project.schemaVersion !== "1")
    throw new TypeError("project schemaVersion is unsupported");
  const id = text(project.id, "project.id", {
    max: MAX_PROJECT_ID_LENGTH,
    pattern: PROJECT_ID,
  });
  if (project.slug !== id)
    throw new TypeError("project.slug must equal project.id");
  text(project.name, "project.name", { max: 80, min: 2 });
  text(project.eyebrow, "project.eyebrow", { max: 80, min: 3 });
  text(project.headline, "project.headline", { max: 120, min: 8 });
  text(project.description, "project.description", { max: 600, min: 24 });
  if (project.contribution !== undefined)
    validateContribution(project.contribution);
  if (
    !(allowLegacyMissingListingTier && !("listingTier" in project)) &&
    project.listingTier !== "featured" &&
    project.listingTier !== "community" &&
    project.listingTier !== "retired"
  ) {
    throw new TypeError("project.listingTier is invalid");
  }
  if (project.status !== "active" && project.status !== "paused") {
    throw new TypeError("project.status is invalid");
  }
  // A retired manifest only resolves immutable history; it never collects.
  if (project.listingTier === "retired" && project.status !== "paused") {
    throw new TypeError("retired projects must stay paused");
  }
  if (project.participation !== undefined) {
    const participation = record(
      project.participation,
      "project.participation",
    );
    if (participation.state === "archived") {
      exactKeys(
        participation,
        ["state", "successorProjectId"],
        "project.participation",
      );
      text(
        participation.successorProjectId,
        "project.participation.successorProjectId",
        { max: MAX_PROJECT_ID_LENGTH, pattern: PROJECT_ID },
      );
      if (participation.successorProjectId === id)
        throw new TypeError("archived project cannot be its own successor");
    } else if (participation.state === "permission-required") {
      exactKeys(participation, ["state"], "project.participation");
    } else {
      throw new TypeError("project.participation.state is invalid");
    }
    if (project.status !== "paused")
      throw new TypeError("restricted participation requires a paused project");
  }
  if (
    !Array.isArray(project.repositories) ||
    project.repositories.length === 0 ||
    project.repositories.length > 20
  ) {
    throw new TypeError(
      "project.repositories must contain 1 to 20 repositories",
    );
  }
  const repositories = project.repositories.map(validateRepository);
  if (
    new Set(repositories.map((repository) => repository.id.toLowerCase()))
      .size !== repositories.length
  ) {
    throw new TypeError("project.repositories contains duplicates");
  }
  validateSkill(
    project.skill,
    "project.skill",
    `contribute-to-${id}`,
    `/projects/${id}/skill.md`,
    { allowLegacyMissingPublishAtRoot },
  );
  validateSkill(
    project.reviewSkill,
    "project.reviewSkill",
    `review-${id}-contributions`,
  );
  if (project.rewardAsset !== undefined) {
    assertRewardAsset(project.rewardAsset);
    if (project.reward?.kind !== "monthly-pool")
      throw new TypeError("project.rewardAsset requires a monthly pool");
  }
  // Generated skills render from both templates and the maintainer fields.
  const generated =
    project.skill.sourcePath === PROJECT_SKILL_TEMPLATES.contributor;
  if (
    generated !==
      (project.reviewSkill.sourcePath === PROJECT_SKILL_TEMPLATES.reviewer) ||
    (generated && project.contribution === undefined)
  ) {
    throw new TypeError(
      "generated project skills need both templates and project.contribution",
    );
  }
  validateReward(project.reward, "project.reward", {
    allowLegacyExternalPrizeFee,
    escrow: project.escrow,
    fundingDisclosure: project.funding?.disclosure,
    rewardAsset: project.rewardAsset,
  });
  validateFunding(project.funding, id);
  if (project.securityBounty !== undefined)
    assertSecurityBountyTerms(project.securityBounty, {
      repositories,
      reward: project.reward,
    });
  if (project.escrow && project.securityBounty?.settlement) {
    for (const privateVault of project.securityBounty.settlement.deployments)
      if (
        project.escrow.deployments.some(
          (ordinary) =>
            ordinary.network === privateVault.network &&
            (privateVault.programId
              ? ordinary.vault === privateVault.vault
              : ordinary.vault.toLowerCase() ===
                privateVault.vault.toLowerCase()),
        )
      )
        throw new TypeError(
          "Private bounties must use a separate vault so public totals reveal no private payments",
        );
  }
  // Escrow is the only funding mode, and the escrow vault holds the balance.
  // No manifest instrument can back a committed amount or an enabled payment.
  if (
    project.reward.fundingState === "committed" ||
    project.reward.reviewBudget?.fundingState === "committed"
  ) {
    throw new TypeError(
      "project.reward committed funding is unsupported; fund the project escrow",
    );
  }
  validateSteward(project.steward);
  validateAuthority(project.authority, repositories[0]);
  validateTerms(
    project.terms,
    repositories[0],
    project.reward,
    project.steward,
    { allowLegacyUnsupportedOwnershipClaim },
  );
  if (
    project.status === "active" &&
    project.authority.state !== "verified" &&
    (project.terms.receiptPolicy.state !== "pending-authority-activation" ||
      project.reward.paymentMode !== "disabled")
  ) {
    throw new TypeError(
      "active projects without verified repository authority require pending receipts and disabled payments",
    );
  }
  if (project.status === "active" && project.authority.state === "verified") {
    if (
      project.terms.receiptPolicy.state !== "active" ||
      project.terms.receiptPolicy.activatedAt !==
        project.authority.proof.verifiedAt
    ) {
      throw new TypeError(
        "active projects require receipt cutover at the immutable authority activation",
      );
    }
  }
  if (
    project.status === "active" &&
    project.authority.state === "verified" &&
    (project.terms.inbound.mode === "unknown" ||
      project.terms.repositoryLicense.state === "unknown" ||
      (project.reward.kind === "external-prize-share" &&
        project.terms.externalPrize?.version === "unknown"))
  ) {
    throw new TypeError("active projects require known mandatory terms");
  }
  const modelPolicy = record(project.modelPolicy, "project.modelPolicy");
  exactKeys(modelPolicy, ["disclosureRequired", "mode"], "project.modelPolicy");
  if (
    modelPolicy.mode !== "open-declared" ||
    modelPolicy.disclosureRequired !== true
  ) {
    throw new TypeError(
      "project.modelPolicy must allow every declared model and require disclosure",
    );
  }
  const links = record(project.links, "project.links");
  if (!Object.hasOwn(links, "repository") || !Object.hasOwn(links, "issues")) {
    throw new TypeError("project.links must include repository and issues");
  }
  for (const [name, value] of Object.entries(links)) {
    text(name, "project link name", { max: 40, pattern: /^[a-z][a-z0-9-]*$/u });
    url(
      value,
      `project.links.${name}`,
      name === "x" ? "https://x.com" : undefined,
    );
    if (
      name === "x" &&
      (new URL(value).search ||
        !/^\/[A-Za-z0-9_]{1,15}$/u.test(new URL(value).pathname))
    ) {
      throw new TypeError("project.links.x must be an X profile URL");
    }
  }
  return project;
}

/** Validates one current project folder manifest. */
export function assertProjectDefinition(value) {
  return validateProjectDefinition(value);
}

/**
 * Validates the immutable prior side of a policy transition. Historical
 * manifests may contain an unsupported mixed/unknown holder assertion that a
 * strict successor removes; all other schema rules remain enforced.
 */
export function assertHistoricalProjectDefinition(value) {
  return validateProjectDefinition(value, {
    allowLegacyMissingListingTier: true,
    allowLegacyMissingPublishAtRoot: true,
    allowLegacyExternalPrizeFee: true,
    allowLegacyUnsupportedOwnershipClaim: true,
  });
}

/** Validates uniqueness and trust boundaries across the full registry. */
export function assertProjectRegistry(values) {
  // Projects are added on slop.cash, so a new registry starts empty.
  if (!Array.isArray(values) || values.length > 100) {
    throw new TypeError("project registry must contain 0 to 100 projects");
  }
  const projects = values.map(assertProjectDefinition);
  if (
    projects.filter((project) => project.skill.publishAtRoot === true).length >
    1
  ) {
    throw new TypeError(
      "project registry must declare at most one root-published contributor skill",
    );
  }
  for (const [field, entries] of [
    ["ids", projects.map((project) => project.id)],
    ["contributor skills", projects.map((project) => project.skill.id)],
    ["review skills", projects.map((project) => project.reviewSkill.id)],
    [
      "repositories",
      projects.flatMap((project) =>
        project.repositories.flatMap((repository) =>
          [repository.id, ...(repository.aliases ?? [])].map((repositoryId) =>
            repositoryId.toLowerCase(),
          ),
        ),
      ),
    ],
  ]) {
    if (new Set(entries).size !== entries.length) {
      throw new TypeError(`project registry contains duplicate ${field}`);
    }
  }
  for (const project of projects) {
    for (const repository of project.repositories) {
      for (const repositoryId of [
        repository.id,
        ...(repository.aliases ?? []),
      ]) {
        const legacyId = LEGACY_PROJECT_ID_BY_REPOSITORY.get(
          repositoryId.toLowerCase(),
        );
        if (legacyId !== undefined && legacyId !== project.id) {
          throw new TypeError(
            `project registry lists ${repositoryId} under id ${project.id}; contributor history keeps it under id ${legacyId}`,
          );
        }
      }
    }
  }
  for (const project of projects) {
    if (
      project.participation?.state === "archived" &&
      !projects.some(
        (candidate) =>
          candidate.id === project.participation.successorProjectId,
      )
    ) {
      throw new TypeError(
        "archived project successor is not in the project registry",
      );
    }
  }
  return projects;
}
