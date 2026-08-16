/**
 * Validates untrusted project folders before they enter discovery, ingestion,
 * skills, or money-shaped views. The schema is intentionally narrow so a pull
 * request cannot smuggle executable configuration or ambiguous reward terms.
 */

import {
  fundingAssetForNetwork,
  isFundingAddress,
} from "./funding-address.mjs";

const PROJECT_KEYS = [
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
  exactKeys(
    skill,
    publicPath ? ["id", "publicPath", "sourcePath"] : ["id", "sourcePath"],
    field,
  );
  if (
    skill.id !== expectedId ||
    skill.sourcePath !== `skills/${expectedId}` ||
    (publicPath && skill.publicPath !== publicPath)
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
  exactKeys(
    funding,
    ["addresses", "disclosure", "mode", "recordsPath"],
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
  if (!Array.isArray(funding.addresses) || funding.addresses.length > 4) {
    throw new TypeError(
      "project.funding addresses must contain at most four routes",
    );
  }
  const seen = new Set();
  for (const [index, value] of funding.addresses.entries()) {
    const field = `project.funding.addresses[${index}]`;
    const route = record(value, field);
    exactKeys(
      route,
      ["address", "asset", "effectiveAt", "network", "replacedAt"],
      field,
    );
    const expectedAsset = fundingAssetForNetwork(route.network);
    if (!expectedAsset || route.asset !== expectedAsset) {
      throw new TypeError(`${field} network or asset is unsupported`);
    }
    if (!isFundingAddress(route.network, route.address)) {
      throw new TypeError(`${field}.address is invalid`);
    }
    const effectiveAt = timestamp(route.effectiveAt, `${field}.effectiveAt`);
    const replacedAt =
      route.replacedAt === null
        ? null
        : timestamp(route.replacedAt, `${field}.replacedAt`);
    if (
      replacedAt !== null &&
      Date.parse(replacedAt) <= Date.parse(effectiveAt)
    ) {
      throw new TypeError(`${field}.replacedAt must follow effectiveAt`);
    }
    const key = `${route.network}:${route.asset}`;
    if (seen.has(key)) {
      throw new TypeError(
        "project.funding addresses contain a duplicate route",
      );
    }
    seen.add(key);
  }
  return funding;
}

/** Validates one project folder manifest. */
export function assertProjectDefinition(value) {
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
