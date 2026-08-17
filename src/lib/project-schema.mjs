/**
 * Validates untrusted project folders before they enter discovery, ingestion,
 * skills, or money-shaped views. The schema is intentionally narrow so a pull
 * request cannot smuggle executable configuration or ambiguous reward terms.
 */

import { assertFundingAddresses } from "./funding-address.mjs";
import {
  assertFundingCommitments,
  hasActiveFundingCommitment,
} from "./funding-instruments.mjs";

const PROJECT_KEYS = [
  "authority",
  "description",
  "eyebrow",
  "funding",
  "headline",
  "id",
  "links",
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

function record(value, field) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value;
}

function exactKeys(value, keys, field) {
  if (Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) {
    throw new TypeError(`${field} has unexpected or missing fields`);
  }
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

function immutableGithubUrl(value, field, repositoryId, commitSha, path) {
  const result = url(value, field, "https://github.com");
  if (
    new URL(result).pathname !== `/${repositoryId}/blob/${commitSha}/${path}`
  ) {
    throw new TypeError(`${field} must be an immutable repository URL`);
  }
  return result;
}

function immutableGithubCommitUrl(value, field, repositoryId, commitSha) {
  const result = url(value, field, "https://github.com");
  const prefix = `/${repositoryId}/blob/${commitSha}/`;
  const pathname = new URL(result).pathname;
  if (!pathname.startsWith(prefix) || pathname.length === prefix.length) {
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
    repository.id,
    commitSha,
    ".github/slop-project.json",
  );
  return authority;
}

function validateTerms(
  value,
  repositoryId,
  reward,
  steward,
  { allowLegacyUnsupportedOwnershipClaim = false } = {},
) {
  const field = "project.terms";
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
      pattern: /^[A-Za-z0-9-.+]+$/u,
    });
    const licenseCommit = commit(
      license.commitSha,
      `${field}.repositoryLicense.commitSha`,
    );
    digest(license.fileSha256, `${field}.repositoryLicense.fileSha256`);
    immutableGithubUrl(
      license.url,
      `${field}.repositoryLicense.url`,
      repositoryId,
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
      repositoryId,
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
      current.licenseSha256 !== license.fileSha256 ||
      current.inboundTermsSha256 !== inbound.fileSha256 ||
      current.prizeRulesSha256 !== (terms.externalPrize?.rulesSha256 ?? null)
    ) {
      throw new TypeError(
        `${field}.receiptPolicy latest binding must match current terms`,
      );
    }
  }
  return terms;
}

function timestamp(value, field) {
  const result = text(value, field, {
    pattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u,
  });
  if (!Number.isFinite(Date.parse(result)))
    throw new TypeError(`${field} is invalid`);
  return result;
}

function validateRepository(value, index) {
  const field = `project.repositories[${index}]`;
  const repository = record(value, field);
  exactKeys(
    repository,
    ["description", "displayName", "githubUrl", "id", "integrationBranch"],
    field,
  );
  const id = text(repository.id, `${field}.id`, {
    max: 201,
    pattern: /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u,
  });
  const githubUrl = url(
    repository.githubUrl,
    `${field}.githubUrl`,
    "https://github.com",
  );
  if (
    new URL(githubUrl).pathname.replace(/\/$/u, "").toLowerCase() !==
    `/${id}`.toLowerCase()
  ) {
    throw new TypeError(`${field}.githubUrl does not match its repository id`);
  }
  text(repository.displayName, `${field}.displayName`, { max: 201 });
  text(repository.description, `${field}.description`, { max: 500, min: 12 });
  text(repository.integrationBranch, `${field}.integrationBranch`, {
    max: 255,
    pattern: /^(?!.*(?:\.\.|\s|~|\^|:|\?|\*|\[|\\))[A-Za-z0-9._/-]+$/u,
  });
  return repository;
}

function validateSkill(value, field, expectedId, publicPath) {
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
  if (
    skill.id !== expectedId ||
    skill.sourcePath !== `skills/${expectedId}` ||
    (publicPath &&
      (skill.publicPath !== publicPath ||
        (hasPublishAtRoot && typeof skill.publishAtRoot !== "boolean")))
  ) {
    throw new TypeError(`${field} does not match its project identity`);
  }
  return skill;
}

function validateReward(value, field) {
  const reward = record(value, field);
  const hasExternal = Object.hasOwn(reward, "externalOpportunity");
  exactKeys(
    reward,
    [
      "chain",
      "committedMinor",
      "currency",
      "cycle",
      ...(hasExternal ? ["externalOpportunity"] : []),
      "feeBasisPoints",
      "fundingState",
      "kind",
      "monthlyCapDisplay",
      "monthlyCapMinor",
      "paymentMode",
      "rewardStartAt",
      "unusedFunds",
    ],
    field,
  );
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
  if (reward.cycle !== "calendar-month-utc" || reward.feeBasisPoints !== 100) {
    throw new TypeError(`${field} cycle or fee policy is invalid`);
  }
  if (reward.kind === "monthly-pool") {
    const paymentsDisabled = reward.paymentMode === "disabled";
    if (
      hasExternal ||
      reward.currency !== "USDC" ||
      reward.chain !== "solana" ||
      reward.unusedFunds !== "rollover-without-cap-increase" ||
      (paymentsDisabled
        ? reward.fundingState !== "pledged" || committedMinor !== "0"
        : reward.fundingState !== "committed" ||
          BigInt(committedMinor) <= 0n) ||
      reward.monthlyCapDisplay !== formatMonthlyCapDisplay(monthlyCapMinor)
    ) {
      throw new TypeError(`${field} monthly pool policy is inconsistent`);
    }
  } else if (reward.kind === "external-prize-share") {
    if (
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
  const hasCommitments = Object.hasOwn(funding, "commitments");
  exactKeys(
    funding,
    [
      "addresses",
      ...(hasCommitments ? ["commitments"] : []),
      "disclosure",
      "mode",
      "recordsPath",
    ],
    "project.funding",
  );
  if (
    funding.mode !== "direct-noncustodial" ||
    funding.recordsPath !== `funding/${projectId}` ||
    funding.disclosure !==
      "Funds go directly to the project wallet. Slop does not hold or recover funds."
  ) {
    throw new TypeError("project.funding non-custodial policy is invalid");
  }
  assertFundingAddresses(funding.addresses, "project.funding.addresses");
  if (hasCommitments) {
    assertFundingCommitments(
      funding.commitments,
      "project.funding.commitments",
    );
  }
  return funding;
}

function validateProjectDefinition(
  value,
  { allowLegacyUnsupportedOwnershipClaim = false } = {},
) {
  const project = record(value, "project");
  exactKeys(project, PROJECT_KEYS, "project");
  if (project.schemaVersion !== "1")
    throw new TypeError("project schemaVersion is unsupported");
  const id = text(project.id, "project.id", {
    max: 48,
    pattern: /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/u,
  });
  if (project.slug !== id)
    throw new TypeError("project.slug must equal project.id");
  text(project.name, "project.name", { max: 80, min: 2 });
  text(project.eyebrow, "project.eyebrow", { max: 80, min: 3 });
  text(project.headline, "project.headline", { max: 120, min: 8 });
  text(project.description, "project.description", { max: 600, min: 24 });
  if (project.status !== "active" && project.status !== "paused") {
    throw new TypeError("project.status is invalid");
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
  );
  validateSkill(
    project.reviewSkill,
    "project.reviewSkill",
    `review-${id}-contributions`,
  );
  validateReward(project.reward, "project.reward");
  validateFunding(project.funding, id);
  if (
    project.reward.fundingState === "committed" &&
    !hasActiveFundingCommitment(project.funding.commitments)
  ) {
    throw new TypeError(
      "project.reward committed funding requires an active commitment instrument",
    );
  }
  validateSteward(project.steward);
  validateAuthority(project.authority, repositories[0]);
  validateTerms(
    project.terms,
    repositories[0].id,
    project.reward,
    project.steward,
    { allowLegacyUnsupportedOwnershipClaim },
  );
  if (project.status === "active" && project.authority.state !== "verified") {
    throw new TypeError(
      "active projects require verified repository authority",
    );
  }
  if (project.status === "active") {
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
    url(value, `project.links.${name}`);
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
    allowLegacyUnsupportedOwnershipClaim: true,
  });
}

/** Validates uniqueness and trust boundaries across the full registry. */
export function assertProjectRegistry(values) {
  if (!Array.isArray(values) || values.length === 0 || values.length > 100) {
    throw new TypeError("project registry must contain 1 to 100 projects");
  }
  const projects = values.map(assertProjectDefinition);
  for (const launchProject of ["eliza", "delta-star"]) {
    if (!projects.some((project) => project.id === launchProject)) {
      throw new TypeError(
        `project registry is missing launch project ${launchProject}`,
      );
    }
  }
  for (const [field, entries] of [
    ["ids", projects.map((project) => project.id)],
    ["contributor skills", projects.map((project) => project.skill.id)],
    ["review skills", projects.map((project) => project.reviewSkill.id)],
    [
      "repositories",
      projects.flatMap((project) =>
        project.repositories.map((repository) => repository.id.toLowerCase()),
      ),
    ],
  ]) {
    if (new Set(entries).size !== entries.length) {
      throw new TypeError(`project registry contains duplicate ${field}`);
    }
  }
  return projects;
}
