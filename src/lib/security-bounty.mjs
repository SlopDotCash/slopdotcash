import {
  assertEscrowTransition,
  assertSecurityEscrowPolicy,
  ESCROW_NETWORKS,
} from "./escrow-policy.mjs";
import {
  isExactUtc,
  readRecord,
  exactKeys as sharedExactKeys,
} from "./record-validation.mjs";
/**
 * Public terms of a private security bounty program (PRD SEC-01, SEC-05,
 * SEC-06, SEC-18). The terms live in the project's D1 manifest revision as
 * `securityBounty`, so every change appends an immutable revision. Case data
 * never enters this structure; it stays in the restricted case tables.
 */

export const SECURITY_PROGRAM_STATUSES = Object.freeze([
  "draft",
  "pending-approval",
  "open",
  "paused",
  "closed",
]);
export const SECURITY_REWARD_MODES = Object.freeze(["bounty-only", "separate"]);
/** The owner-approved split: researcher 75%, Slop 25% of the gross amount. */
export const SECURITY_SPLIT = Object.freeze({
  researcherBasisPoints: 7500,
  slopBasisPoints: 2500,
});
const CURRENCIES = Object.freeze({
  USD: { decimals: 2, networks: [null] },
  USDC: { decimals: 6, networks: ["base", "ethereum", "robinhood", "solana"] },
});
/** At most 10^15 minor units, the same bound as the monthly pool cap. */
const MAX_GROSS_MINOR = 1_000_000_000_000_000n;
const GITHUB_ID = /^[1-9]\d{0,19}$/u;
const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u;
const KEYS = [
  "amount",
  "approvers",
  "capacity",
  "disclosure",
  "dispute",
  "eligibility",
  "funding",
  "intake",
  "responseTargets",
  "rewardMode",
  "safeHarbor",
  "scope",
  "split",
  "sponsor",
  "status",
  "version",
];

function fail(field, problem = "is invalid") {
  throw new TypeError(`project.securityBounty.${field} ${problem}`);
}

const record = (value, field) =>
  readRecord(value, `project.securityBounty.${field}`);

const exactKeys = (value, keys, field) =>
  sharedExactKeys(value, keys, `project.securityBounty.${field}`);

function text(value, field, max = 2000, min = 1, pattern = undefined) {
  if (
    typeof value !== "string" ||
    value.length < min ||
    value.length > max ||
    value.trim() !== value ||
    (pattern && !pattern.test(value))
  )
    fail(field);
  return value;
}

function integer(value, field, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(field);
  return value;
}

function timestamp(value, field) {
  if (!isExactUtc(value)) fail(field);
  return value;
}

function list(value, field, min, max, validate) {
  if (!Array.isArray(value) || value.length < min || value.length > max)
    fail(field, `must list ${min} to ${max} entries`);
  return value.map((entry, index) => validate(entry, `${field}[${index}]`));
}

/**
 * Splits a gross amount exactly. The gross must be a positive integer number
 * of minor units divisible by four, so no share is rounded (SEC-05).
 */
export function securityBountySplit(grossMinor) {
  if (typeof grossMinor !== "string" || !/^[1-9]\d{0,15}$/u.test(grossMinor))
    throw new TypeError("gross amount must be positive integer minor units");
  const gross = BigInt(grossMinor);
  if (gross > MAX_GROSS_MINOR)
    throw new RangeError("gross amount exceeds the maximum");
  if (gross % 4n !== 0n)
    throw new RangeError(
      "gross amount must be divisible by four minor units so the 75/25 split is exact",
    );
  return {
    grossMinor,
    researcherMinor: ((gross * 3n) / 4n).toString(),
    slopMinor: (gross / 4n).toString(),
  };
}

/** Formats integer minor units without floating-point conversion. */
export function formatSecurityAmount(minorUnits, amount) {
  const value = BigInt(minorUnits);
  const scale = 10n ** BigInt(amount.decimals);
  const whole = (value / scale)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  const fraction = (value % scale)
    .toString()
    .padStart(amount.decimals, "0")
    .replace(/0+$/u, "");
  const number = fraction ? `${whole}.${fraction}` : whole;
  return amount.currency === "USD" ? `$${number}` : `${number} USDC`;
}

function validateApprovers(value) {
  const approvers = record(value, "approvers");
  exactKeys(approvers, ["dispute", "financial", "technical"], "approvers");
  const people = {};
  for (const role of ["technical", "financial", "dispute"]) {
    people[role] = list(
      approvers[role],
      `approvers.${role}`,
      1,
      10,
      (entry, field) => {
        const person = record(entry, field);
        exactKeys(person, ["githubId", "githubLogin"], field);
        text(person.githubId, `${field}.githubId`, 20, 1, GITHUB_ID);
        text(person.githubLogin, `${field}.githubLogin`, 39, 1, GITHUB_LOGIN);
        return person.githubId;
      },
    );
    if (new Set(people[role]).size !== people[role].length)
      fail(`approvers.${role}`, "contains duplicates");
  }
  // `approvers.dispute` names the program's dispute contact. A Slop
  // moderator decides escalated disputes (owner decision D10 dropped the
  // separate-role rule); the case handler still refuses self-review.
}

/**
 * Validates `project.securityBounty` against the rest of the manifest. The
 * caller passes the project's repositories and reward so bounty-only mode
 * can refuse a monthly-pool promise.
 */
export function assertSecurityBountyTerms(value, { repositories, reward }) {
  const terms = record(value, "");
  exactKeys(
    terms,
    terms.settlement === undefined ? KEYS : [...KEYS, "settlement"],
    "",
  );
  if (terms.version !== "1") fail("version");
  if (!SECURITY_PROGRAM_STATUSES.includes(terms.status)) fail("status");
  if (!SECURITY_REWARD_MODES.includes(terms.rewardMode)) fail("rewardMode");
  if (terms.eligibility !== "critical-loss-of-funds") fail("eligibility");
  const amount = record(terms.amount, "amount");
  exactKeys(
    amount,
    ["currency", "decimals", "grossMinor", "network"],
    "amount",
  );
  const currency = CURRENCIES[amount.currency];
  if (currency === undefined) fail("amount.currency");
  if (amount.decimals !== currency.decimals) fail("amount.decimals");
  if (!currency.networks.includes(amount.network)) fail("amount.network");
  try {
    securityBountySplit(amount.grossMinor);
  } catch (error) {
    fail("amount.grossMinor", `is invalid: ${error.message}`);
  }
  const split = record(terms.split, "split");
  exactKeys(split, ["researcherBasisPoints", "slopBasisPoints"], "split");
  if (
    split.researcherBasisPoints !== SECURITY_SPLIT.researcherBasisPoints ||
    split.slopBasisPoints !== SECURITY_SPLIT.slopBasisPoints
  )
    fail("split", "must be the approved 75/25 researcher/Slop split");
  const sponsor = record(terms.sponsor, "sponsor");
  exactKeys(sponsor, ["githubId", "name"], "sponsor");
  text(sponsor.name, "sponsor.name", 120, 2);
  if (sponsor.githubId !== null)
    text(sponsor.githubId, "sponsor.githubId", 20, 1, GITHUB_ID);
  const funding = record(terms.funding, "funding");
  if (funding.state === "pledged") {
    exactKeys(funding, ["state"], "funding");
  } else if (funding.state === "verified-available") {
    exactKeys(funding, ["evidence", "state", "verifiedAt"], "funding");
    text(funding.evidence, "funding.evidence", 500, 8);
    timestamp(funding.verifiedAt, "funding.verifiedAt");
  } else {
    fail("funding.state");
  }
  const capacity = record(terms.capacity, "capacity");
  exactKeys(capacity, ["awards", "closesAt", "exhaustionRule"], "capacity");
  integer(capacity.awards, "capacity.awards", 1, 1000);
  if (capacity.closesAt !== null)
    timestamp(capacity.closesAt, "capacity.closesAt");
  text(capacity.exhaustionRule, "capacity.exhaustionRule", 1000, 12);
  const repositoryIds = repositories.map((entry) => entry.id.toLowerCase());
  const scope = record(terms.scope, "scope");
  exactKeys(
    scope,
    [
      "deployments",
      "excludedDependencies",
      "includedAssets",
      "lossDefinition",
      "severityRubric",
      "sourceRevisions",
      "testingPermission",
    ],
    "scope",
  );
  list(
    scope.sourceRevisions,
    "scope.sourceRevisions",
    1,
    20,
    (entry, field) => {
      const source = record(entry, field);
      exactKeys(source, ["commit", "repository"], field);
      if (!repositoryIds.includes(String(source.repository).toLowerCase()))
        fail(`${field}.repository`, "must be one of the project repositories");
      text(source.commit, `${field}.commit`, 40, 40, /^[0-9a-f]{40}$/u);
    },
  );
  list(scope.deployments, "scope.deployments", 0, 50, (entry, field) => {
    const deployment = record(entry, field);
    exactKeys(deployment, ["address", "codeIdentity", "network"], field);
    text(deployment.network, `${field}.network`, 40, 2, /^[a-z0-9-]+$/u);
    text(deployment.address, `${field}.address`, 128, 8, /^[A-Za-z0-9]+$/u);
    if (deployment.codeIdentity !== null)
      text(deployment.codeIdentity, `${field}.codeIdentity`, 200, 8);
  });
  list(scope.includedAssets, "scope.includedAssets", 1, 50, (entry, field) =>
    text(entry, field, 200, 2),
  );
  list(
    scope.excludedDependencies,
    "scope.excludedDependencies",
    0,
    50,
    (entry, field) => text(entry, field, 200, 2),
  );
  text(scope.testingPermission, "scope.testingPermission", 2000, 12);
  text(scope.severityRubric, "scope.severityRubric", 2000, 12);
  text(scope.lossDefinition, "scope.lossDefinition", 2000, 12);
  const intake = record(terms.intake, "intake");
  exactKeys(intake, ["kind", "repository"], "intake");
  if (intake.kind !== "github-private-vulnerability-reporting")
    fail("intake.kind", "must be GitHub private vulnerability reporting");
  if (!repositoryIds.includes(String(intake.repository).toLowerCase()))
    fail("intake.repository", "must be one of the project repositories");
  const targets = record(terms.responseTargets, "responseTargets");
  exactKeys(
    targets,
    ["acknowledgeHours", "triageBusinessDays", "updateIntervalDays"],
    "responseTargets",
  );
  integer(targets.acknowledgeHours, "responseTargets.acknowledgeHours", 1, 336);
  integer(
    targets.triageBusinessDays,
    "responseTargets.triageBusinessDays",
    1,
    60,
  );
  integer(
    targets.updateIntervalDays,
    "responseTargets.updateIntervalDays",
    1,
    60,
  );
  if (terms.settlement !== undefined) {
    const settlement = assertSecurityEscrowPolicy(terms.settlement);
    if (amount.currency !== "USDC" || settlement.chain !== amount.network)
      fail("settlement", "requires matching USDC program terms");
    for (const deployment of settlement.deployments) {
      const network = ESCROW_NETWORKS[deployment.network];
      if (
        !network.assets.some(
          (asset) =>
            asset.symbol === "USDC" &&
            asset.decimals === amount.decimals &&
            (network.family === "evm"
              ? asset.address.toLowerCase() === deployment.asset.toLowerCase()
              : asset.address === deployment.asset),
        )
      )
        fail("settlement", "requires the reviewed USDC asset on this network");
    }
  }
  validateApprovers(terms.approvers);
  const dispute = record(terms.dispute, "dispute");
  exactKeys(dispute, ["authority", "process"], "dispute");
  if (dispute.authority !== "advisory" && dispute.authority !== "binding")
    fail("dispute.authority");
  text(dispute.process, "dispute.process", 2000, 12);
  text(terms.disclosure, "disclosure", 2000, 12);
  text(terms.safeHarbor, "safeHarbor", 4000, 12);
  // Bounty-only programs promise no monthly pool (SEC-01, SEC-06).
  if (
    terms.rewardMode === "bounty-only" &&
    (reward.kind !== "monthly-pool" ||
      reward.monthlyCapMinor !== "0" ||
      reward.committedMinor !== "0" ||
      reward.paymentMode !== "disabled" ||
      Object.hasOwn(reward, "reviewBudget") ||
      Object.hasOwn(reward, "cycleCaps"))
  )
    fail(
      "rewardMode",
      "bounty-only requires a $0 monthly pool with payments disabled",
    );
  // A pledge is not a balance: paid capacity opens only on verified funds.
  if (terms.status === "open" && funding.state !== "verified-available")
    fail("status", "open requires verified available funding");
  return terms;
}

/**
 * Refuses a revision that removes the program, because its approvers govern
 * restricted case access after closure. Obligations already frozen in cases
 * are never read from later revisions.
 */
export function assertSecurityBountyTransition(previous, next) {
  assertEscrowTransition(previous?.settlement, next?.settlement);
  if (previous === undefined) return;
  if (next === undefined)
    throw new TypeError(
      "a security bounty program cannot be removed; close it instead",
    );
}
