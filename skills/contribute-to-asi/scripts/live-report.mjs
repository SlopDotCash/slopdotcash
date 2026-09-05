#!/usr/bin/env node
/**
 * Builds a stable, read-only inventory of open elizaOS issues and pull requests
 * for contribution selection. REST pagination stays behind one GET-only
 * adapter; GraphQL uses explicit read-only queries over GitHub's POST endpoint.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const MODEL_DISCLOSURE_PREFIX = "AI provider/model:";
export const REQUIRED_EVIDENCE_ROWS = [
  "before-screenshots",
  "after-screenshots",
  "walkthrough-video",
  "backend-logs",
  "frontend-logs",
  "llm-trajectory",
  "domain-artifacts",
];
export const CLAIM_RECENCY_DAYS = 7;
export const MISSION_READY_LABEL = "mission-ready";
export const MAX_OPEN_ITEMS = 10_000;
// The repository-size bound protects discovery. This smaller work-epoch bound
// is the liveness contract: one run has a finite frozen PR frontier and may
// advance after that frontier is dispositioned even while new PRs arrive.
export const MAX_REVIEW_EPOCH_CANDIDATES = 20;
export const REVIEW_EPOCH_SCHEMA_VERSION = 1;
export const MAX_REVIEW_EPOCH_FILE_BYTES = 262_144;
export const MAX_API_READS = 16;
export const MAX_ACTIVITY_CONNECTION_ITEMS = 1_000;
// Large repositories can legitimately exceed Node's 64 MiB spawnSync default
// after gh concatenates bounded pages. Keep one explicit ceiling high enough
// for the 10,000-item inventory while still failing closed on runaway output.
export const MAX_GH_REPORT_BYTES = 256 * 1024 * 1024;
export const MIN_GRAPHQL_ACTIVITY_POINTS = 1_000;
export const MIN_REST_ACTIVITY_REQUESTS = 100;
export const MIN_SEARCH_ACTIVITY_REQUESTS = 2;
export const MAX_LIVE_INVENTORY_ATTEMPTS = 2;

export class LiveInventoryChangedError extends Error {
  constructor(
    message = "batched activity does not exactly match the live open-item inventory",
    options,
  ) {
    super(message, options);
    this.name = "LiveInventoryChangedError";
  }
}

const REPOSITORY_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const PLACEHOLDER_RE =
  /^(?:n\/?a|none|unknown|unspecified|tbd|todo|null|model|provider|<[^>]+>|\[[^\]]+\])$/i;
const GENERIC_PROVIDER_IDS = new Set([
  "ai",
  "model",
  "n-a",
  "n.a",
  "na",
  "none",
  "provider",
]);
const GENERIC_MODEL_IDS = new Set([
  "ai",
  "claude",
  "gemini",
  "gpt",
  "llama",
  "model",
  "na",
  "none",
]);
const ISSUE_CLAIM_RE = /^CLAIMING:\s*\S/i;
const REVIEW_CLAIM_RE = /^CLAIMING\s+REVIEW:\s*\S/i;
const CONTRIBUTION_CLAIM_RE = /^CLAIMING(?:\s+REVIEW|\s+LEVER)?:\s*\S/i;
const AI_PROVENANCE_DECLARATION_RE =
  /^(?:AI provider\/model\s*:|AI assistance\s*:\s*yes\b|Models?(?:\s+used)?\s*:|Model\(s\)\s+used\s*:|Client\s*\/\s*agent tooling\s*:|Contribution skill revision\s*:)/i;
const AI_PROVENANCE_MARKER_LINE_RE =
  /^<!--\s*(?:(?:elizaos-contribution|eliza-computer)-attribution:v1|slop-contribution-attribution:v1)\b[^\r\n]*-->\s*$/i;
const HUMAN_ONLY_CLAIM_FOOTER_RE =
  /(?:^|\r?\n)\s*AI assistance:\s*no\s*[-\u2013\u2014]\s*human-only claim\s*\r?\n\s*Attribution status:\s*self-reported\s*$/i;
const HUMAN_ONLY_PR_RE =
  /^(?:[-*]\s*)?AI assistance:\s*`?no\s*[-\u2013\u2014]\s*human-only contribution`?\s*$/i;
const ISSUE_CLAIM_LABEL_RE =
  /^(?:(?:claimed|in[- ]progress|working)(?:\s*:\s*[a-z0-9][a-z0-9._/-]*)?|status:\s*(?:claimed|in[- ]progress))$/i;
const REVIEW_CLAIM_LABEL_RE =
  /^(?:(?:review[- ]claimed|review[- ]in[- ]progress)(?:\s*:\s*[a-z0-9][a-z0-9._/-]*)?|review:\s*claimed)$/i;
const BLOCKED_LABEL_RE =
  /^(?:blocked|do[- ]not[- ]merge|human[- ]only|needs[- ]human(?:[- ](?:input|review|verify|verification))?|needs[- ]shaw|status\s*[:/]\s*(?:blocked|proposal|human[- ]only|needs[- ]human(?:[- ](?:input|review|verify|verification))?|needs[- ]shaw))$/i;
const SENSITIVE_LABEL_RE =
  /(?:^|[-_ ])(?:security|vulnerability|credential[-_ ]?leak|secret[-_ ]?leak|cve)(?:$|[-_ ])/i;
const EPIC_TITLE_RE = /^\s*(?:\[[^\]]*\bepic\b[^\]]*\]|epic\s*:)/i;
const EPIC_LABEL_RE = /^epic(?:\s+\d+)?$/i;
const DEFAULT_CONTRIBUTOR_READY_LABELS = [
  MISSION_READY_LABEL,
  "bug-confirmed",
  "demo-blocker",
  "good first issue",
  "help wanted",
  "launch-qa",
  "needs-review",
  "needs testing",
  "p0",
  "p1",
  "p2",
  "priority: high",
  "triage-reviewed",
];
const TRUSTED_CLAIM_ASSOCIATIONS = new Set(["COLLABORATOR", "MEMBER", "OWNER"]);
const EVIDENCE_MARKER_RE = /<!--\s*evidence-row:([a-z0-9-]+)\s*-->/gi;
const NA_WITH_REASON_RE =
  /\bN\/?A\b\s*[-:\u2013\u2014]\s*(?!<[^>]+>)(?!\[[^\]]+\])([^\r\n]+)/i;
const CLAIM_WINDOW_MS = CLAIM_RECENCY_DAYS * 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const FULL_COMMIT_RE = /^[a-f0-9]{40}$/i;
const CLOSING_REFERENCE_RE =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+(?:(?<owner>[A-Za-z0-9_.-]+)\/(?<name>[A-Za-z0-9_.-]+))?#(?<number>[1-9]\d*)\b/gi;
const DOMAIN_ARTIFACT_HOSTS = new Set([
  "arbiscan.io",
  "basescan.org",
  "etherscan.io",
  "polygonscan.com",
  "sepolia.etherscan.io",
  "solscan.io",
]);

function asRecord(value, context) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${context} must be a JSON object`);
  }
  return value;
}

function asArrayField(record, field, context) {
  if (!Array.isArray(record[field])) {
    throw new TypeError(`${context}.${field} must be an array`);
  }
  return record[field];
}

function asNumberField(record, field, context) {
  if (!Number.isInteger(record[field])) {
    throw new TypeError(`${context}.${field} must be an integer`);
  }
  return record[field];
}

function asStringField(record, field, context) {
  if (typeof record[field] !== "string") {
    throw new TypeError(`${context}.${field} must be a string`);
  }
  return record[field];
}

function nullableText(value, context) {
  if (value === null) return "";
  if (typeof value !== "string") {
    throw new TypeError(`${context} must be a string or null`);
  }
  return value;
}

function isoTime(value, context) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${context} must be an ISO timestamp`);
  }
  return value;
}

function optionalIsoTime(value, context) {
  if (value === null) return null;
  return isoTime(value, context);
}

function nowTime(value) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError("Report time must be a valid Date");
  }
  return value.getTime();
}

function isRecent(timestamp, referenceTime) {
  const time = Date.parse(timestamp);
  return (
    time >= referenceTime - CLAIM_WINDOW_MS &&
    time <= referenceTime + CLOCK_SKEW_MS
  );
}

function declarationLineRecords(source) {
  const text = nullableText(source, "declaration source");
  const records = [];
  let fence = null;
  let offset = 0;
  while (offset <= text.length) {
    const newline = text.indexOf("\n", offset);
    const physicalEnd = newline === -1 ? text.length : newline;
    const raw = text.slice(offset, physicalEnd);
    const sourceLine = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const fenceMatch = sourceLine.match(
      /^\s{0,3}(?:(?:[-*+]|\d+[.)])\s+)?(`{3,}|~{3,})(.*)$/,
    );
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (fence === null) {
        fence = { character: marker[0], length: marker.length };
      } else if (
        marker[0] === fence.character &&
        marker.length >= fence.length &&
        fenceMatch[2].trim().length === 0
      ) {
        fence = null;
      }
      if (newline === -1) break;
      offset = newline + 1;
      continue;
    }
    if (
      fence !== null ||
      /^\s{0,3}>/.test(sourceLine) ||
      /^(?:\t| {4})/.test(sourceLine)
    ) {
      if (newline === -1) break;
      offset = newline + 1;
      continue;
    }
    const line = sourceLine
      .trim()
      .replace(/^(?:[-*+]|\d+[.)])\s+/, "")
      .replaceAll("**", "")
      .replaceAll("__", "");
    if (!line.startsWith("`")) {
      records.push({
        end: offset + sourceLine.length,
        normalized: line,
        start: offset,
      });
    }
    if (newline === -1) break;
    offset = newline + 1;
  }
  return records;
}

function declarationLines(source) {
  return declarationLineRecords(source).map((record) => record.normalized);
}

function hasClaimSignal(source, pattern) {
  return declarationLines(source).some((line) => pattern.test(line));
}

function hasHumanOnlyClaimFooter(source) {
  const text = nullableText(source, "claim footer");
  const records = declarationLineRecords(text).filter(
    (record) => record.normalized.length > 0,
  );
  const terminal = records.at(-1);
  return (
    terminal !== undefined &&
    HUMAN_ONLY_CLAIM_FOOTER_RE.test(
      records
        .slice(-2)
        .map((record) => record.normalized)
        .join("\n"),
    ) &&
    text.slice(terminal.end).trim().length === 0
  );
}

function hasHumanOnlyPullRequestDeclaration(source) {
  return declarationLines(source).some((line) => HUMAN_ONLY_PR_RE.test(line));
}

function identifierKey(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isGenericProvider(value) {
  return GENERIC_PROVIDER_IDS.has(identifierKey(value));
}

function isGenericModel(value) {
  const segments = value.split("/");
  return (
    GENERIC_MODEL_IDS.has(identifierKey(value)) ||
    GENERIC_MODEL_IDS.has(identifierKey(segments.at(-1) ?? ""))
  );
}

function hasAiProvenanceSignal(source) {
  return declarationLines(source).some(
    (line) =>
      AI_PROVENANCE_DECLARATION_RE.test(line) ||
      AI_PROVENANCE_MARKER_LINE_RE.test(line),
  );
}

function accountLogin(account) {
  if (account === null) return "ghost";
  const record = asRecord(account, "account");
  return asStringField(record, "login", "account");
}

function accountId(account) {
  if (account === null) return null;
  const id = asRecord(account, "account").id;
  if (
    (Number.isInteger(id) && id > 0) ||
    (typeof id === "string" && id.length > 0 && id.length <= 200)
  ) {
    return id;
  }
  throw new TypeError("account.id must be a positive integer or opaque id");
}

function labelNames(item, context) {
  return asArrayField(item, "labels", context).map((value, index) => {
    if (typeof value === "string") return value.trim();
    return asStringField(
      asRecord(value, `${context}.labels[${index}]`),
      "name",
      `${context}.labels[${index}]`,
    ).trim();
  });
}

function eligibleIssueLabels(value, context) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) {
    throw new TypeError(`${context} must be a non-empty array of labels`);
  }
  const labels = value.map((label, index) => {
    if (typeof label !== "string") {
      throw new TypeError(`${context}[${index}] must be a string`);
    }
    const normalized = label.trim().toLowerCase();
    if (normalized.length === 0 || normalized.length > 50) {
      throw new TypeError(`${context}[${index}] must be a bounded label`);
    }
    return normalized;
  });
  if (new Set(labels).size !== labels.length) {
    throw new TypeError(`${context} must not contain duplicate labels`);
  }
  return labels;
}

/** Loads the project-owned discovery policy next to the installed skill. */
export function readProjectSelectionPolicy(scriptUrl = import.meta.url) {
  const projectPath = join(
    dirname(dirname(fileURLToPath(scriptUrl))),
    "project.json",
  );
  let project;
  try {
    project = JSON.parse(readFileSync(projectPath, "utf8"));
  } catch (cause) {
    throw new Error(
      `Cannot read contributor selection policy: ${projectPath}`,
      {
        cause,
      },
    );
  }
  const record = asRecord(project, "skill project");
  const repositoryId = asStringField(record, "repositoryId", "skill project");
  if (!REPOSITORY_RE.test(repositoryId)) {
    throw new TypeError(
      "skill project.repositoryId must use the owner/name form",
    );
  }
  if (record.selection === undefined) {
    return {
      repositoryId,
      eligibleIssueLabels: [...DEFAULT_CONTRIBUTOR_READY_LABELS],
    };
  }
  const selection = asRecord(record.selection, "skill project.selection");
  return {
    repositoryId,
    eligibleIssueLabels: eligibleIssueLabels(
      selection.eligibleIssueLabels,
      "skill project.selection.eligibleIssueLabels",
    ),
  };
}

function compareByNumber(left, right) {
  return left.number - right.number;
}

function reviewEpochCandidate(
  value,
  index,
  context = "review epoch candidate",
) {
  const record = asRecord(value, `${context}[${index}]`);
  const number = asNumberField(record, "number", `${context}[${index}]`);
  if (number < 1) {
    throw new TypeError(`${context}[${index}].number must be positive`);
  }
  const headSha = asStringField(
    record,
    "headSha",
    `${context}[${index}]`,
  ).toLowerCase();
  if (!FULL_COMMIT_RE.test(headSha)) {
    throw new TypeError(
      `${context}[${index}].headSha must be a full commit SHA`,
    );
  }
  const updatedAt = isoTime(record.updatedAt, `${context}[${index}].updatedAt`);
  return { number, headSha, updatedAt };
}

function reviewEpochIdentity(value, context = "review epoch candidate") {
  const record = asRecord(value, context);
  const number = asNumberField(record, "number", context);
  if (number < 1) {
    throw new TypeError(`${context}.number must be positive`);
  }
  const headSha = asStringField(record, "headSha", context).toLowerCase();
  if (!FULL_COMMIT_RE.test(headSha)) {
    throw new TypeError(`${context}.headSha must be a full commit SHA`);
  }
  return { number, headSha };
}

/**
 * Freezes a deterministic, bounded PR review frontier. Candidates updated
 * after the cutoff are explicitly deferred, as are candidates beyond the
 * finite epoch count; both are eligible for a later epoch and never vanish
 * from diagnostics.
 */
export function createReviewEpoch(
  candidates,
  cutoff,
  maxCandidates = MAX_REVIEW_EPOCH_CANDIDATES,
) {
  if (!Array.isArray(candidates)) {
    throw new TypeError("review epoch candidates must be an array");
  }
  const cutoffTime = Date.parse(isoTime(cutoff, "review epoch cutoff"));
  if (
    !Number.isInteger(maxCandidates) ||
    maxCandidates < 1 ||
    maxCandidates > MAX_REVIEW_EPOCH_CANDIDATES
  ) {
    throw new TypeError(
      `review epoch maxCandidates must be an integer from 1 to ${MAX_REVIEW_EPOCH_CANDIDATES}`,
    );
  }
  const normalized = candidates
    .map((value, index) => reviewEpochCandidate(value, index))
    .sort(compareByNumber);
  const seen = new Set();
  for (const candidate of normalized) {
    if (seen.has(candidate.number)) {
      throw new TypeError(
        `duplicate review epoch candidate #${candidate.number}`,
      );
    }
    seen.add(candidate.number);
  }
  const frozen = normalized.filter(
    (candidate) => Date.parse(candidate.updatedAt) <= cutoffTime,
  );
  const arrivals = normalized
    .filter((candidate) => Date.parse(candidate.updatedAt) > cutoffTime)
    .map((candidate) => ({ ...candidate, deferredReason: "after-cutoff" }));
  const selected = frozen.slice(0, maxCandidates);
  const overLimit = frozen
    .slice(maxCandidates)
    .map((candidate) => ({ ...candidate, deferredReason: "epoch-limit" }));
  return {
    schemaVersion: REVIEW_EPOCH_SCHEMA_VERSION,
    cutoff,
    maxCandidates,
    candidateCount: normalized.length,
    candidates: selected,
    deferred: [...overLimit, ...arrivals].sort(compareByNumber),
    completion: {
      requiredCandidateCount: selected.length,
      allowsNextTier: false,
      maxNextTierOutcomes: 0,
    },
  };
}

const REVIEW_EPOCH_DISPOSITIONS = new Set([
  "merge",
  "fix",
  "close",
  "stale-head",
]);

/** Returns the lower-tier permit only after every frozen candidate is closed. */
export function completeReviewEpoch(epoch, dispositions) {
  const record = asRecord(epoch, "review epoch");
  const schemaVersion = asNumberField(record, "schemaVersion", "review epoch");
  if (schemaVersion !== REVIEW_EPOCH_SCHEMA_VERSION) {
    throw new TypeError(
      `review epoch.schemaVersion must be ${REVIEW_EPOCH_SCHEMA_VERSION}`,
    );
  }
  const cutoff = isoTime(record.cutoff, "review epoch.cutoff");
  const candidates = asArrayField(record, "candidates", "review epoch").map(
    (candidate, index) =>
      reviewEpochIdentity(candidate, `review epoch.candidates[${index}]`),
  );
  if (!Array.isArray(dispositions)) {
    throw new TypeError("review epoch dispositions must be an array");
  }
  const expected = new Map(
    candidates.map((candidate) => [candidate.number, candidate]),
  );
  if (expected.size !== candidates.length) {
    throw new TypeError("review epoch contains duplicate candidates");
  }
  const completed = new Set();
  const normalizedDispositions = new Map();
  for (const [index, value] of dispositions.entries()) {
    const context = `review epoch dispositions[${index}]`;
    const disposition = asRecord(value, context);
    const number = asNumberField(disposition, "number", context);
    const candidate = expected.get(number);
    if (!candidate) {
      throw new TypeError(`${context} names non-epoch candidate #${number}`);
    }
    if (completed.has(number)) {
      throw new TypeError(`duplicate review epoch disposition for #${number}`);
    }
    const expectedHeadSha = asStringField(
      disposition,
      "expectedHeadSha",
      context,
    ).toLowerCase();
    if (expectedHeadSha !== candidate.headSha) {
      throw new TypeError(
        `${context} does not bind the frozen head for #${number}`,
      );
    }
    const status = asStringField(disposition, "status", context);
    if (!REVIEW_EPOCH_DISPOSITIONS.has(status)) {
      throw new TypeError(`${context}.status is not a terminal disposition`);
    }
    const normalizedDisposition = {
      number,
      expectedHeadSha,
      status,
    };
    if (status === "stale-head") {
      const currentHeadSha = asStringField(
        disposition,
        "currentHeadSha",
        context,
      ).toLowerCase();
      if (
        !FULL_COMMIT_RE.test(currentHeadSha) ||
        currentHeadSha === candidate.headSha
      ) {
        throw new TypeError(
          `${context}.currentHeadSha must be a different full commit SHA`,
        );
      }
      normalizedDisposition.currentHeadSha = currentHeadSha;
    } else {
      const recommendationUrl = asStringField(
        disposition,
        "recommendationUrl",
        context,
      );
      let parsedRecommendationUrl;
      try {
        parsedRecommendationUrl = new URL(recommendationUrl);
      } catch (cause) {
        throw new TypeError(`${context}.recommendationUrl must be a URL`, {
          cause,
        });
      }
      const pathParts = parsedRecommendationUrl.pathname
        .split("/")
        .filter(Boolean);
      if (
        parsedRecommendationUrl.protocol !== "https:" ||
        parsedRecommendationUrl.hostname !== "github.com" ||
        parsedRecommendationUrl.username !== "" ||
        parsedRecommendationUrl.password !== "" ||
        pathParts.length < 4 ||
        pathParts[2] !== "pull" ||
        Number(pathParts[3]) !== number ||
        recommendationUrl.length > 2_048
      ) {
        throw new TypeError(
          `${context}.recommendationUrl must be a bounded public GitHub HTTPS URL`,
        );
      }
      normalizedDisposition.recommendationUrl =
        parsedRecommendationUrl.toString();
    }
    completed.add(number);
    normalizedDispositions.set(number, normalizedDisposition);
  }
  const remainingCandidates = candidates
    .filter((candidate) => !completed.has(candidate.number))
    .map((candidate) => candidate.number);
  const complete = remainingCandidates.length === 0;
  return {
    schemaVersion: REVIEW_EPOCH_SCHEMA_VERSION,
    cutoff,
    complete,
    dispositionCount: completed.size,
    requiredCandidateCount: candidates.length,
    remainingCandidates,
    dispositions: candidates.flatMap((candidate) => {
      const disposition = normalizedDispositions.get(candidate.number);
      return disposition ? [disposition] : [];
    }),
    allowsNextTier: complete,
    ...(complete
      ? { nextTier: "next-eligible-lower-tier", maxNextTierOutcomes: 1 }
      : { maxNextTierOutcomes: 0 }),
  };
}

function readBoundedJsonFile(path, context) {
  if (typeof path !== "string" || path.trim() === "") {
    throw new TypeError(`${context} path must be a non-empty string`);
  }
  const statistics = statSync(path);
  if (!statistics.isFile()) {
    throw new TypeError(`${context} must be a regular file`);
  }
  if (statistics.size > MAX_REVIEW_EPOCH_FILE_BYTES) {
    throw new RangeError(
      `${context} exceeds ${MAX_REVIEW_EPOCH_FILE_BYTES} bytes`,
    );
  }
  const contents = readFileSync(path);
  if (contents.byteLength > MAX_REVIEW_EPOCH_FILE_BYTES) {
    throw new RangeError(
      `${context} exceeds ${MAX_REVIEW_EPOCH_FILE_BYTES} bytes`,
    );
  }
  try {
    return JSON.parse(contents.toString("utf8"));
  } catch (cause) {
    throw new SyntaxError(`${context} must contain valid JSON`, { cause });
  }
}

function reviewEpochFromFile(path) {
  const value = asRecord(
    readBoundedJsonFile(path, "review epoch input"),
    "review epoch input",
  );
  if (value.selection === undefined) return value;
  const selection = asRecord(value.selection, "review epoch input.selection");
  return asRecord(
    selection.reviewEpoch,
    "review epoch input.selection.reviewEpoch",
  );
}

/**
 * Publication boundary for an epoch candidate. A changed head is stale and
 * must be deferred; only an exact byte-for-byte head match is publishable.
 */
export function recheckReviewEpochCandidate(candidate, currentHeadSha) {
  const normalized = reviewEpochIdentity(candidate);
  if (
    typeof currentHeadSha !== "string" ||
    !FULL_COMMIT_RE.test(currentHeadSha)
  ) {
    throw new TypeError("currentHeadSha must be a full commit SHA");
  }
  const current = currentHeadSha.toLowerCase();
  if (current === normalized.headSha) {
    return { number: normalized.number, status: "current", publishable: true };
  }
  return {
    number: normalized.number,
    status: "stale",
    publishable: false,
    currentHeadSha: current,
    deferredReason: "head-changed",
  };
}

function compareComment(left, right) {
  return left.id - right.id || left.url.localeCompare(right.url);
}

/** Returns same-repository issues an open PR body explicitly closes. */
export function closingIssueNumbers(body, repo) {
  const text = nullableText(body, "pull request body").replace(
    /<!--[\s\S]*?-->/g,
    "",
  );
  if (!REPOSITORY_RE.test(repo)) {
    throw new TypeError("Repository must use the owner/name form");
  }
  const numbers = new Set();
  for (const line of declarationLines(text)) {
    for (const match of line.matchAll(CLOSING_REFERENCE_RE)) {
      const owner = match.groups?.owner;
      const name = match.groups?.name;
      if (
        owner !== undefined &&
        name !== undefined &&
        `${owner}/${name}`.toLowerCase() !== repo.toLowerCase()
      ) {
        continue;
      }
      numbers.add(Number(match.groups?.number));
    }
  }
  return [...numbers].sort((left, right) => left - right);
}

export function parsePaginatedJson(output, endpoint = "GitHub endpoint") {
  if (typeof output !== "string") {
    throw new TypeError(`gh api did not return text output for ${endpoint}`);
  }
  const records = [];
  const lines = output.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (line.trim().length === 0) continue;
    try {
      records.push(JSON.parse(line));
    } catch (error) {
      const detail = error instanceof Error ? `: ${error.message}` : "";
      throw new SyntaxError(
        `gh api returned malformed JSON for ${endpoint} at output line ${index + 1}${detail}`,
      );
    }
  }
  return records;
}

/**
 * @param {string} endpoint
 * @param {(command: string, args: string[], options: import("node:child_process").SpawnSyncOptionsWithStringEncoding) => { error?: Error; status: number | null; stderr: string; stdout: string }} spawn
 */
export function readGhPages(endpoint, spawn = spawnSync) {
  if (typeof endpoint !== "string" || endpoint.length === 0) {
    throw new TypeError("GitHub endpoint must be a non-empty string");
  }
  // `--jq .[]` emits one compact JSON record per line across every page and is
  // available in gh 2.45, which Ubuntu 24.04 packages. The newer `--slurp`
  // flag first shipped in gh 2.48, so it fails before the first inventory read
  // on that CLI. This preserves complete, ordered pagination and stays GET-only.
  const args = [
    "api",
    "--method",
    "GET",
    "--paginate",
    "--jq",
    ".[]",
    endpoint,
  ];
  const result = spawn("gh", args, {
    encoding: "utf8",
    maxBuffer: MAX_GH_REPORT_BYTES,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail =
      typeof result.stderr === "string" && result.stderr.trim().length > 0
        ? `: ${result.stderr.trim()}`
        : "";
    throw new Error(`gh api failed for ${endpoint}${detail}`);
  }
  if (typeof result.stdout !== "string") {
    throw new TypeError("gh api did not return text output");
  }
  return parsePaginatedJson(result.stdout, endpoint);
}

/** Performs the single live GET used as the pre-publication head guard. */
export function readLivePullHead(repo, number, spawn = spawnSync) {
  if (!REPOSITORY_RE.test(repo)) {
    throw new TypeError("Repository must use the owner/name form");
  }
  if (!Number.isInteger(number) || number < 1) {
    throw new TypeError("pull request number must be a positive integer");
  }
  const endpoint = `repos/${repo}/pulls/${number}`;
  const result = spawn(
    "gh",
    [
      "api",
      "--method",
      "GET",
      "--jq",
      "{number: .number, headSha: .head.sha, updatedAt: .updated_at}",
      endpoint,
    ],
    {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail =
      typeof result.stderr === "string" && result.stderr.trim().length > 0
        ? `: ${result.stderr.trim()}`
        : "";
    throw new Error(`gh api failed for ${endpoint}${detail}`);
  }
  let value;
  try {
    value = JSON.parse(result.stdout);
  } catch (cause) {
    throw new SyntaxError(`gh api returned malformed JSON for ${endpoint}`, {
      cause,
    });
  }
  const record = asRecord(value, `live pull request #${number}`);
  const liveNumber = asNumberField(
    record,
    "number",
    `live pull request #${number}`,
  );
  if (liveNumber !== number) {
    throw new TypeError(`live pull request number changed from #${number}`);
  }
  const headSha = asStringField(
    record,
    "headSha",
    `live pull request #${number}`,
  ).toLowerCase();
  if (!FULL_COMMIT_RE.test(headSha)) {
    throw new TypeError(
      `live pull request #${number}.headSha must be a full commit SHA`,
    );
  }
  return {
    number,
    headSha,
    updatedAt: isoTime(
      record.updatedAt,
      `live pull request #${number}.updatedAt`,
    ),
  };
}

export function recheckLivePullHead(repo, candidate, spawn = spawnSync) {
  const normalized = reviewEpochIdentity(candidate);
  const live = readLivePullHead(repo, normalized.number, spawn);
  return {
    ...recheckReviewEpochCandidate(normalized, live.headSha),
    expectedHeadSha: normalized.headSha,
    updatedAt: live.updatedAt,
  };
}

const ACTIVITY_PAGE_SIZE = 100;
const GRAPHQL_ACTOR_FIELDS = `
  login
  __typename
  ... on User { databaseId }
  ... on Bot { databaseId }
  ... on Organization { databaseId }
`;
const GRAPHQL_COMMENT_FIELDS = `
  databaseId
  url
  body
  createdAt
  authorAssociation
  author { ${GRAPHQL_ACTOR_FIELDS} }
`;
const OPEN_ISSUE_ACTIVITY_QUERY = `
  query($owner: String!, $name: String!, $endCursor: String) {
    repository(owner: $owner, name: $name) {
      issues(
        first: 100
        after: $endCursor
        states: OPEN
        orderBy: { field: CREATED_AT, direction: ASC }
      ) {
        nodes {
          number
          comments(first: 100) {
            totalCount
            nodes { ${GRAPHQL_COMMENT_FIELDS} }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;
const OPEN_PULL_ACTIVITY_QUERY = `
  query($owner: String!, $name: String!, $endCursor: String) {
    repository(owner: $owner, name: $name) {
      pullRequests(
        first: 20
        after: $endCursor
        states: OPEN
        orderBy: { field: CREATED_AT, direction: ASC }
      ) {
        nodes {
          number
          comments(first: 100) {
            totalCount
            nodes { ${GRAPHQL_COMMENT_FIELDS} }
          }
          reviews(first: 100) {
            totalCount
            nodes {
              databaseId
              url
              body
              submittedAt
              state
              commit { oid }
              author { ${GRAPHQL_ACTOR_FIELDS} }
            }
          }
          reviewThreads(first: 100) {
            totalCount
            nodes {
              comments(first: 100) {
                totalCount
                nodes { ${GRAPHQL_COMMENT_FIELDS} }
              }
            }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

function graphqlConnection(record, field, context) {
  const connection = asRecord(record[field], `${context}.${field}`);
  const totalCount = asNumberField(
    connection,
    "totalCount",
    `${context}.${field}`,
  );
  const nodes = asArrayField(connection, "nodes", `${context}.${field}`);
  if (totalCount > MAX_ACTIVITY_CONNECTION_ITEMS) {
    throw new RangeError(
      `${context}.${field} exceeds the complete ${MAX_ACTIVITY_CONNECTION_ITEMS}-record activity bound`,
    );
  }
  const expectedPageSize = Math.min(totalCount, ACTIVITY_PAGE_SIZE);
  if (nodes.length !== expectedPageSize) {
    throw new RangeError(
      `${context}.${field} returned ${nodes.length} of the expected ${expectedPageSize} initial activity records`,
    );
  }
  return {
    needsPagination: totalCount > ACTIVITY_PAGE_SIZE,
    nodes,
    totalCount,
  };
}

function readGhActivityPage(endpoint, pageNumber, context, spawn) {
  const separator = endpoint.includes("?") ? "&" : "?";
  const pagedEndpoint = `${endpoint}${separator}page=${pageNumber}`;
  const result = spawn(
    "gh",
    ["api", "--method", "GET", "--jq", ".[]", pagedEndpoint],
    {
      encoding: "utf8",
      maxBuffer: MAX_GH_REPORT_BYTES,
      windowsHide: true,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail =
      typeof result.stderr === "string" && result.stderr.trim().length > 0
        ? `: ${result.stderr.trim()}`
        : "";
    throw new Error(`gh api failed for ${context} page ${pageNumber}${detail}`);
  }
  const records = parsePaginatedJson(
    result.stdout,
    `${context} page ${pageNumber}`,
  );
  if (records.length > ACTIVITY_PAGE_SIZE) {
    throw new RangeError(
      `${context} page ${pageNumber} returned ${records.length} records, exceeding the ${ACTIVITY_PAGE_SIZE}-record page bound`,
    );
  }
  return records;
}

function readOverflowActivity(endpoint, expectedCount, context, spawn) {
  const records = [];
  const maximumPages = Math.ceil(
    MAX_ACTIVITY_CONNECTION_ITEMS / ACTIVITY_PAGE_SIZE,
  );
  for (let pageNumber = 1; pageNumber <= maximumPages + 1; pageNumber += 1) {
    const page = readGhActivityPage(endpoint, pageNumber, context, spawn);
    if (pageNumber > maximumPages) {
      if (page.length > 0) {
        throw new RangeError(
          `${context} exceeds the complete ${MAX_ACTIVITY_CONNECTION_ITEMS}-record activity bound`,
        );
      }
      break;
    }
    records.push(...page);
    if (expectedCount !== null && records.length > expectedCount) {
      throw new RangeError(
        `${context} returned more than the ${expectedCount} records it reported`,
      );
    }
    if (page.length < ACTIVITY_PAGE_SIZE) break;
  }
  if (expectedCount !== null && records.length !== expectedCount) {
    throw new RangeError(
      `${context} returned ${records.length} records after reporting ${expectedCount}`,
    );
  }
  return records;
}

function activityItemNumber(record, field, context) {
  const url = asStringField(record, field, context);
  const match = url.match(/\/(?:issues|pulls)\/([1-9]\d*)$/);
  if (!match) {
    throw new TypeError(`${context}.${field} must end with an item number`);
  }
  return Number(match[1]);
}

function appendBoundedActivity(target, value, context) {
  if (target.length >= MAX_ACTIVITY_CONNECTION_ITEMS) {
    throw new RangeError(
      `${context} exceeds the complete ${MAX_ACTIVITY_CONNECTION_ITEMS}-record activity bound`,
    );
  }
  target.push(value);
}

function readGhSearchPullNumbers(repo, qualifier, spawn) {
  const query = `repo:${repo} is:pr is:open review:${qualifier}`;
  const result = spawn(
    "gh",
    [
      "api",
      "--method",
      "GET",
      "--paginate",
      "-f",
      `q=${query}`,
      "-f",
      "per_page=100",
      "--jq",
      ".items[]",
      "search/issues",
    ],
    {
      encoding: "utf8",
      maxBuffer: MAX_GH_REPORT_BYTES,
      windowsHide: true,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail =
      result.stderr.trim().length > 0 ? `: ${result.stderr.trim()}` : "";
    throw new Error(`gh api failed for review:${qualifier}${detail}`);
  }
  const records = parsePaginatedJson(result.stdout, `review:${qualifier}`);
  if (records.length >= 1_000) {
    throw new RangeError(
      `review:${qualifier} reaches GitHub's 1000-result search bound`,
    );
  }
  const numbers = new Set();
  for (const [index, value] of records.entries()) {
    const number = asNumberField(
      asRecord(value, `review:${qualifier}[${index}]`),
      "number",
      `review:${qualifier}[${index}]`,
    );
    if (numbers.has(number)) {
      throw new TypeError(
        `duplicate review:${qualifier} result for #${number}`,
      );
    }
    numbers.add(number);
  }
  return numbers;
}

function readGhRestOpenActivity(repo, spawn) {
  const issueItems = readGhPages(
    `repos/${repo}/issues?state=open&per_page=100&sort=created&direction=asc`,
    spawn,
  )
    .map((value, index) => asRecord(value, `REST issues[${index}]`))
    .filter((item) => item.pull_request === undefined);
  const pullItems = readGhPages(
    `repos/${repo}/pulls?state=open&per_page=100&sort=created&direction=asc`,
    spawn,
  ).map((value, index) => asRecord(value, `REST pulls[${index}]`));
  if (issueItems.length > MAX_OPEN_ITEMS || pullItems.length > MAX_OPEN_ITEMS) {
    throw new RangeError(
      `Live discovery exceeds the ${MAX_OPEN_ITEMS}-item per-kind safety bound`,
    );
  }
  const oldestCreatedAt = [...issueItems, ...pullItems]
    .map((item, index) =>
      isoTime(item.created_at, `REST open items[${index}].created_at`),
    )
    .sort((left, right) => Date.parse(left) - Date.parse(right))[0];
  const since =
    oldestCreatedAt === undefined
      ? null
      : `since=${encodeURIComponent(oldestCreatedAt)}`;
  const issues = new Map();
  for (const item of issueItems) {
    const number = asNumberField(item, "number", "REST issue");
    if (issues.has(number))
      throw new TypeError(`duplicate issue activity for #${number}`);
    issues.set(number, []);
  }
  const pulls = new Map();
  for (const item of pullItems) {
    const number = asNumberField(item, "number", "REST pull request");
    if (pulls.has(number))
      throw new TypeError(`duplicate pull activity for #${number}`);
    pulls.set(number, {
      issueComments: [],
      inlineComments: [],
      reviews: [],
      reviewStatus: "none",
    });
  }
  const issueComments =
    since === null
      ? []
      : readGhPages(
          `repos/${repo}/issues/comments?per_page=100&sort=created&direction=asc&${since}`,
          spawn,
        );
  for (const [index, value] of issueComments.entries()) {
    const record = asRecord(value, `REST issue comments[${index}]`);
    const number = activityItemNumber(
      record,
      "issue_url",
      `REST issue comments[${index}]`,
    );
    if (issues.has(number)) {
      appendBoundedActivity(
        issues.get(number),
        record,
        `issue #${number}.comments`,
      );
    } else if (pulls.has(number)) {
      appendBoundedActivity(
        pulls.get(number).issueComments,
        record,
        `pull request #${number}.comments`,
      );
    }
  }
  const inlineComments =
    since === null || pulls.size === 0
      ? []
      : readGhPages(
          `repos/${repo}/pulls/comments?per_page=100&sort=created&direction=asc&${since}`,
          spawn,
        );
  for (const [index, value] of inlineComments.entries()) {
    const record = asRecord(value, `REST review comments[${index}]`);
    const number = activityItemNumber(
      record,
      "pull_request_url",
      `REST review comments[${index}]`,
    );
    if (pulls.has(number)) {
      appendBoundedActivity(
        pulls.get(number).inlineComments,
        record,
        `pull request #${number}.review comments`,
      );
    }
  }
  const approved = readGhSearchPullNumbers(repo, "approved", spawn);
  const changesRequested = readGhSearchPullNumbers(
    repo,
    "changes_requested",
    spawn,
  );
  for (const number of approved) {
    if (!pulls.has(number)) {
      throw new TypeError(`review:approved returned non-open pull #${number}`);
    }
    pulls.get(number).reviewStatus = "approved";
  }
  for (const number of changesRequested) {
    if (!pulls.has(number)) {
      throw new TypeError(
        `review:changes_requested returned non-open pull #${number}`,
      );
    }
    if (approved.has(number)) {
      throw new TypeError(`conflicting REST review status for pull #${number}`);
    }
    pulls.get(number).reviewStatus = "changes_requested";
  }
  return { issues, pulls };
}

function graphqlAccount(value, context) {
  if (value === null) return null;
  const actor = asRecord(value, context);
  const type = asStringField(actor, "__typename", context);
  const login = asStringField(actor, "login", context);
  return {
    id: Number.isInteger(actor.databaseId)
      ? actor.databaseId
      : `login:${login.toLowerCase()}`,
    login,
    type: type === "Bot" ? "Bot" : "User",
  };
}

function graphqlComment(value, context) {
  const comment = asRecord(value, context);
  return {
    id: asNumberField(comment, "databaseId", context),
    html_url: asStringField(comment, "url", context),
    user: graphqlAccount(comment.author, `${context}.author`),
    author_association: asStringField(comment, "authorAssociation", context),
    body: nullableText(comment.body, `${context}.body`),
    created_at: isoTime(comment.createdAt, `${context}.createdAt`),
  };
}

function graphqlReview(value, context) {
  const review = asRecord(value, context);
  const commit =
    review.commit === null
      ? null
      : asRecord(review.commit, `${context}.commit`);
  return {
    id: asNumberField(review, "databaseId", context),
    html_url: asStringField(review, "url", context),
    user: graphqlAccount(review.author, `${context}.author`),
    body: nullableText(review.body, `${context}.body`),
    submitted_at:
      review.submittedAt === null
        ? null
        : isoTime(review.submittedAt, `${context}.submittedAt`),
    state: asStringField(review, "state", context),
    commit_id:
      commit === null
        ? null
        : asStringField(commit, "oid", `${context}.commit`),
  };
}

function readGraphqlActivityNodes(repo, query, selector, spawn, context) {
  const [owner, name] = repo.split("/");
  const result = spawn(
    "gh",
    [
      "api",
      "graphql",
      "--method",
      "POST",
      "--paginate",
      "-f",
      `query=${query}`,
      "-F",
      `owner=${owner}`,
      "-F",
      `name=${name}`,
      "--jq",
      selector,
    ],
    {
      encoding: "utf8",
      maxBuffer: MAX_GH_REPORT_BYTES,
      windowsHide: true,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail =
      result.stderr.trim().length > 0 ? `: ${result.stderr.trim()}` : "";
    throw new Error(`gh api graphql failed for ${context}${detail}`);
  }
  return parsePaginatedJson(result.stdout, context);
}

export function createGhCommandBudget(spawn = spawnSync) {
  let count = 0;
  return {
    get count() {
      return count;
    },
    run: (command, args, options) => {
      if (count >= MAX_API_READS) {
        throw new RangeError(
          `Live discovery exceeds the ${MAX_API_READS}-command safety bound`,
        );
      }
      count += 1;
      return spawn(command, args, options);
    },
  };
}

function rateResource(value, context) {
  const resource = asRecord(value, context);
  const limit = asNumberField(resource, "limit", context);
  const remaining = asNumberField(resource, "remaining", context);
  const reset = asNumberField(resource, "reset", context);
  if (limit <= 0 || remaining < 0 || remaining > limit || reset <= 0) {
    throw new RangeError(`${context} contains an invalid rate budget`);
  }
  return { limit, remaining, reset };
}

const GRAPHQL_RATE_LIMIT_QUERY =
  "query SlopActivityRateLimit { rateLimit { limit remaining resetAt } }";

function readGhGraphqlRateLimit(spawn) {
  const result = spawn(
    "gh",
    [
      "api",
      "graphql",
      "--method",
      "POST",
      "-f",
      `query=${GRAPHQL_RATE_LIMIT_QUERY}`,
      "--jq",
      ".data.rateLimit",
    ],
    {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = `${result.stderr ?? ""}\n${result.stdout ?? ""}`.trim();
    if (/\b(?:secondary )?rate limit\b|abuse detection/iu.test(detail)) {
      return { rateLimited: true };
    }
    throw new Error(
      `gh api graphql failed for rate-limit preflight${detail ? `: ${detail}` : ""}`,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (cause) {
    throw new SyntaxError(
      "gh api graphql returned malformed JSON for rate-limit preflight",
      { cause },
    );
  }
  const resource = asRecord(parsed, "GitHub GraphQL rate-limit preflight");
  const limit = asNumberField(
    resource,
    "limit",
    "GitHub GraphQL rate-limit preflight",
  );
  const remaining = asNumberField(
    resource,
    "remaining",
    "GitHub GraphQL rate-limit preflight",
  );
  const resetAt = nullableText(resource.resetAt, "GraphQL rate-limit resetAt");
  const reset = resetAt === null ? Number.NaN : Date.parse(resetAt) / 1000;
  if (
    limit <= 0 ||
    remaining < 0 ||
    remaining > limit ||
    !Number.isSafeInteger(reset) ||
    reset <= 0
  ) {
    throw new RangeError(
      "GitHub GraphQL rate-limit preflight contains an invalid rate budget",
    );
  }
  return { limit, remaining, reset, rateLimited: false };
}

export function readGhRateLimits(spawn = spawnSync) {
  const result = spawn(
    "gh",
    [
      "api",
      "--method",
      "GET",
      "--jq",
      "{resources: .resources | {core, graphql, search}}",
      "rate_limit",
    ],
    {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail =
      result.stderr.trim().length > 0 ? `: ${result.stderr.trim()}` : "";
    throw new Error(`gh api failed for rate_limit${detail}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (cause) {
    throw new SyntaxError("gh api returned malformed JSON for rate_limit", {
      cause,
    });
  }
  const resources = asRecord(
    asRecord(parsed, "GitHub rate limit response").resources,
    "GitHub rate limit resources",
  );
  const graphql = rateResource(resources.graphql, "GitHub GraphQL rate limit");
  const rest = rateResource(resources.core, "GitHub REST rate limit");
  const search = rateResource(resources.search, "GitHub Search rate limit");
  const directGraphql = readGhGraphqlRateLimit(spawn);
  return {
    graphqlLimit: directGraphql.rateLimited
      ? graphql.limit
      : directGraphql.limit,
    graphqlRemaining: directGraphql.rateLimited ? 0 : directGraphql.remaining,
    graphqlReset: directGraphql.rateLimited
      ? graphql.reset
      : directGraphql.reset,
    graphqlBudgetSource: directGraphql.rateLimited
      ? "direct-probe-rate-limited"
      : "direct-graphql",
    restLimit: rest.limit,
    restRemaining: rest.remaining,
    restReset: rest.reset,
    searchLimit: search.limit,
    searchRemaining: search.remaining,
    searchReset: search.reset,
  };
}

/** Reads open activity in two batches plus bounded overflow pagination. */
export function readGhOpenActivity(repo, spawn = spawnSync, rateLimits = null) {
  if (!REPOSITORY_RE.test(repo)) {
    throw new TypeError("Repository must use the owner/name form");
  }
  let limits = rateLimits;
  if (limits !== null) {
    const options = asRecord(limits, "GitHub rate limits");
    if (options.preflight === true) {
      limits = readGhRateLimits(spawn);
    }
  }
  if (limits !== null) {
    limits = asRecord(limits, "GitHub rate limits");
    const graphqlRemaining = asNumberField(
      limits,
      "graphqlRemaining",
      "GitHub rate limits",
    );
    const restRemaining = asNumberField(
      limits,
      "restRemaining",
      "GitHub rate limits",
    );
    const searchRemaining = asNumberField(
      limits,
      "searchRemaining",
      "GitHub rate limits",
    );
    if (graphqlRemaining < MIN_GRAPHQL_ACTIVITY_POINTS) {
      if (
        restRemaining < MIN_REST_ACTIVITY_REQUESTS ||
        searchRemaining < MIN_SEARCH_ACTIVITY_REQUESTS
      ) {
        throw new RangeError(
          "GitHub budgets cannot afford either complete GraphQL or REST activity discovery",
        );
      }
      return {
        ...readGhRestOpenActivity(repo, spawn),
        rateLimits: limits,
        source: "rest",
      };
    }
  }
  const issueNodes = readGraphqlActivityNodes(
    repo,
    OPEN_ISSUE_ACTIVITY_QUERY,
    ".data.repository.issues.nodes[]",
    spawn,
    "open issue activity",
  );
  const pullNodes = readGraphqlActivityNodes(
    repo,
    OPEN_PULL_ACTIVITY_QUERY,
    ".data.repository.pullRequests.nodes[]",
    spawn,
    "open pull request activity",
  );
  if (issueNodes.length > MAX_OPEN_ITEMS || pullNodes.length > MAX_OPEN_ITEMS) {
    throw new RangeError(
      `Live discovery exceeds the ${MAX_OPEN_ITEMS}-item per-kind safety bound`,
    );
  }
  const issues = new Map();
  for (const [index, value] of issueNodes.entries()) {
    const context = `issue activity[${index}]`;
    const node = asRecord(value, context);
    const number = asNumberField(node, "number", context);
    if (issues.has(number))
      throw new TypeError(`duplicate issue activity for #${number}`);
    const comments = graphqlConnection(node, "comments", context);
    issues.set(
      number,
      comments.needsPagination
        ? readOverflowActivity(
            issueCommentsEndpoint(repo, number),
            comments.totalCount,
            `${context}.comments`,
            spawn,
          )
        : comments.nodes.map((comment, commentIndex) =>
            graphqlComment(comment, `${context}.comments[${commentIndex}]`),
          ),
    );
  }
  const pulls = new Map();
  for (const [index, value] of pullNodes.entries()) {
    const context = `pull activity[${index}]`;
    const node = asRecord(value, context);
    const number = asNumberField(node, "number", context);
    if (pulls.has(number))
      throw new TypeError(`duplicate pull activity for #${number}`);
    const commentConnection = graphqlConnection(node, "comments", context);
    const issueComments = commentConnection.needsPagination
      ? readOverflowActivity(
          issueCommentsEndpoint(repo, number),
          commentConnection.totalCount,
          `${context}.comments`,
          spawn,
        )
      : commentConnection.nodes.map((comment, commentIndex) =>
          graphqlComment(comment, `${context}.comments[${commentIndex}]`),
        );
    const reviewConnection = graphqlConnection(node, "reviews", context);
    const reviews = reviewConnection.needsPagination
      ? readOverflowActivity(
          pullReviewsEndpoint(repo, number),
          reviewConnection.totalCount,
          `${context}.reviews`,
          spawn,
        )
      : reviewConnection.nodes.map((review, reviewIndex) =>
          graphqlReview(review, `${context}.reviews[${reviewIndex}]`),
        );
    const threadConnection = graphqlConnection(node, "reviewThreads", context);
    let inlineComments;
    if (threadConnection.needsPagination) {
      inlineComments = readOverflowActivity(
        pullReviewCommentsEndpoint(repo, number),
        null,
        `${context}.review comments`,
        spawn,
      );
    } else {
      let expectedInlineComments = 0;
      let nestedPaginationNeeded = false;
      const initialInlineComments = threadConnection.nodes.flatMap(
        (thread, threadIndex) => {
          const threadContext = `${context}.reviewThreads[${threadIndex}]`;
          const record = asRecord(thread, threadContext);
          const comments = graphqlConnection(record, "comments", threadContext);
          expectedInlineComments += comments.totalCount;
          if (expectedInlineComments > MAX_ACTIVITY_CONNECTION_ITEMS) {
            throw new RangeError(
              `${context}.review comments exceeds the complete ${MAX_ACTIVITY_CONNECTION_ITEMS}-record activity bound`,
            );
          }
          nestedPaginationNeeded ||= comments.needsPagination;
          return comments.nodes.map((comment, commentIndex) =>
            graphqlComment(
              comment,
              `${threadContext}.comments[${commentIndex}]`,
            ),
          );
        },
      );
      inlineComments = nestedPaginationNeeded
        ? readOverflowActivity(
            pullReviewCommentsEndpoint(repo, number),
            expectedInlineComments,
            `${context}.review comments`,
            spawn,
          )
        : initialInlineComments;
    }
    pulls.set(number, { issueComments, inlineComments, reviews });
  }
  return {
    issues,
    pulls,
    ...(limits === null ? {} : { rateLimits: limits }),
    source: "graphql",
  };
}

export function parseModelDisclosure(text) {
  const body = nullableText(text, "disclosure text");
  for (const line of declarationLines(body)) {
    const match = line.match(/^AI provider\/model\s*:\s*(.+)$/i);
    if (!match) continue;
    const pair = match[1].match(/^(.+?)\s+\/\s+(.+)$/);
    if (!pair) return null;
    const provider = pair[1].trim();
    const model = pair[2].trim();
    if (
      provider.length === 0 ||
      model.length === 0 ||
      isGenericProvider(provider) ||
      isGenericModel(model) ||
      PLACEHOLDER_RE.test(provider) ||
      PLACEHOLDER_RE.test(model) ||
      /[<>[\]]/.test(provider) ||
      /[<>[\]]/.test(model)
    ) {
      return null;
    }
    return { provider, model };
  }
  return null;
}

export function isBotAccount(account) {
  if (account === null) return false;
  const record = asRecord(account, "account");
  asStringField(record, "login", "account");
  if (record.type !== undefined && typeof record.type !== "string") {
    throw new TypeError("account.type must be a string when present");
  }
  return String(record.type).toLowerCase() === "bot";
}

export function isKnownHumanAccount(account) {
  if (account === null) return false;
  const record = asRecord(account, "account");
  if (record.type !== undefined && typeof record.type !== "string") {
    throw new TypeError("account.type must be a string when present");
  }
  return record.type === undefined || record.type.toLowerCase() === "user";
}

function normalizeComment(value, kind, index) {
  const context = `${kind}[${index}]`;
  const record = asRecord(value, context);
  return {
    id: asNumberField(record, "id", context),
    kind,
    url: asStringField(record, "html_url", context),
    author: accountLogin(record.user),
    authorId: accountId(record.user),
    authorKnown: record.user !== null,
    bot: isBotAccount(record.user),
    authorAssociation: asStringField(
      record,
      "author_association",
      context,
    ).toUpperCase(),
    body: nullableText(record.body, `${context}.body`),
    createdAt: isoTime(record.created_at, `${context}.created_at`),
  };
}

function normalizeComments(values, kind) {
  if (!Array.isArray(values)) {
    throw new TypeError(`${kind} response must be an array`);
  }
  return values
    .map((value, index) => normalizeComment(value, kind, index))
    .sort(compareComment);
}

function normalizeReview(value, index) {
  const context = `review[${index}]`;
  const record = asRecord(value, context);
  const commitId = nullableText(record.commit_id, `${context}.commit_id`);
  if (commitId.length > 0 && !FULL_COMMIT_RE.test(commitId)) {
    throw new TypeError(
      `${context}.commit_id must be a full commit SHA or null`,
    );
  }
  return {
    id: asNumberField(record, "id", context),
    kind: "review",
    url: asStringField(record, "html_url", context),
    author: accountLogin(record.user),
    authorId: accountId(record.user),
    bot: isBotAccount(record.user),
    body: nullableText(record.body, `${context}.body`),
    createdAt: optionalIsoTime(record.submitted_at, `${context}.submitted_at`),
    state: asStringField(record, "state", context).toUpperCase(),
    commitId: commitId.length === 0 ? null : commitId.toLowerCase(),
  };
}

function normalizeReviews(values) {
  if (!Array.isArray(values)) {
    throw new TypeError("review response must be an array");
  }
  return values
    .map((value, index) => normalizeReview(value, index))
    .sort(compareComment);
}

export function auditCommentDisclosures(comments) {
  return comments
    .filter(
      (comment) =>
        comment.authorKnown &&
        !comment.bot &&
        comment.body.trim().length > 0 &&
        (hasClaimSignal(comment.body, CONTRIBUTION_CLAIM_RE) ||
          hasAiProvenanceSignal(comment.body)) &&
        !hasHumanOnlyClaimFooter(comment.body) &&
        parseModelDisclosure(comment.body) === null,
    )
    .map(({ id, kind, url, author }) => ({ id, kind, url, author }));
}

export function extractEvidenceRows(body) {
  const source = nullableText(body, "PR body");
  const markers = [...source.matchAll(EVIDENCE_MARKER_RE)].map((match) => ({
    id: match[1].toLowerCase(),
    start: match.index,
    end: match.index + match[0].length,
  }));
  const rows = new Map();
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    const next = markers[index + 1];
    rows.set(
      marker.id,
      boundEvidenceRow(
        source.slice(marker.end, next ? next.start : source.length),
      ),
    );
  }
  return rows;
}

function boundEvidenceRow(block) {
  const lines = block.split(/\r?\n/);
  const row = [];
  let started = false;
  let detailsDepth = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!started) {
      if (line.trim().length === 0) continue;
      started = true;
      row.push(line);
      detailsDepth = Math.max(
        0,
        detailsDepth +
          (line.match(/<details\b/gi) ?? []).length -
          (line.match(/<\/details>/gi) ?? []).length,
      );
      continue;
    }
    const nextContent = lines
      .slice(index + 1)
      .find((candidate) => candidate.trim().length > 0);
    const blankBeforeDetails =
      line.trim().length === 0 &&
      detailsDepth === 0 &&
      /^<details\b/i.test(nextContent?.trim() ?? "");
    if (
      detailsDepth === 0 &&
      !blankBeforeDetails &&
      (line.trim().length === 0 ||
        /^#/.test(line.trim()) ||
        (/^[-*]\s/.test(line) && !/^\s/.test(line)))
    ) {
      break;
    }
    row.push(line);
    detailsDepth = Math.max(
      0,
      detailsDepth +
        (line.match(/<details\b/gi) ?? []).length -
        (line.match(/<\/details>/gi) ?? []).length,
    );
  }
  return row.join("\n").trim();
}

function extractUrls(text) {
  const urls = [];
  for (const match of text.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) {
    const raw = match[0].replace(/[.,;:!?]+$/, "");
    try {
      urls.push(new URL(raw));
    } catch {
      // error-policy:J3 Malformed contribution text is not an evidence URL.
    }
  }
  return urls;
}

function isUserAttachment(url) {
  return (
    url.protocol === "https:" &&
    url.hostname.toLowerCase() === "github.com" &&
    /^\/user-attachments\/assets\/[a-z0-9-]+$/i.test(url.pathname)
  );
}

function isAllowedRepositoryArtifact(url) {
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);
  if (host === "raw.githubusercontent.com") {
    return (
      segments.length >= 4 &&
      segments[0].toLowerCase() === "elizaos" &&
      segments[1].toLowerCase() === "eliza" &&
      FULL_COMMIT_RE.test(segments[2])
    );
  }
  if (host !== "github.com") return false;
  return (
    (segments.length >= 5 &&
      segments[0].toLowerCase() === "elizaos" &&
      segments[1].toLowerCase() === "eliza" &&
      segments[2] === "blob" &&
      FULL_COMMIT_RE.test(segments[3])) ||
    (segments.length === 7 &&
      segments[0].toLowerCase() === "elizaos" &&
      segments[1].toLowerCase() === "eliza" &&
      segments[2] === "actions" &&
      segments[3] === "runs" &&
      /^\d+$/.test(segments[4]) &&
      segments[5] === "artifacts" &&
      /^\d+$/.test(segments[6]))
  );
}

function isAllowedDomainArtifact(url) {
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (!DOMAIN_ARTIFACT_HOSTS.has(host)) return false;
  if (host === "solscan.io") {
    return /^\/tx\/[1-9A-HJ-NP-Za-km-z]{32,100}$/i.test(url.pathname);
  }
  return /^\/(?:tx|transaction)\/0x[a-f0-9]{64}$/i.test(url.pathname);
}

function hasAllowedEvidenceUrl(rowId, row) {
  return extractUrls(row).some(
    (url) =>
      isUserAttachment(url) ||
      isAllowedRepositoryArtifact(url) ||
      (rowId === "domain-artifacts" && isAllowedDomainArtifact(url)),
  );
}

function backendLogLikeLine(line) {
  if (
    /^(?:\d{4}-\d{2}-\d{2}T\S+\s+)?(?:TRACE|DEBUG|INFO|WARN|ERROR|FATAL)?\s*\[[A-Z][A-Za-z0-9_.-]{2,}\]\s+\S/.test(
      line,
    )
  ) {
    return true;
  }
  const structuredKeys = new Set(
    [...line.matchAll(/"(time|timestamp|level|message)"\s*:/gi)].map((match) =>
      match[1].toLowerCase(),
    ),
  );
  return structuredKeys.has("level") && structuredKeys.has("message");
}

function frontendLogLikeLine(line) {
  if (
    /^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+https?:\/\/\S+\s+[1-5]\d\d\b/i.test(
      line,
    ) ||
    /(?:console\.(?:debug|info|log|warn|error)|\[(?:console|network)\])/i.test(
      line,
    )
  ) {
    return true;
  }
  const structuredKeys = new Set(
    [...line.matchAll(/"(method|url|status|statusCode)"\s*:/gi)].map((match) =>
      match[1].toLowerCase(),
    ),
  );
  return (
    structuredKeys.has("method") &&
    structuredKeys.has("url") &&
    (structuredKeys.has("status") || structuredKeys.has("statuscode"))
  );
}

function substantiveLogContent(content, rowId) {
  const plain = content
    .replaceAll(String.fromCodePoint(27), "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<summary\b[^>]*>[\s\S]*?<\/summary>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/^```[^\r\n]*|```$/gm, "")
    .trim();
  if (
    plain.length < 80 ||
    /<[^>]+>|\b(?:todo|tbd|lorem ipsum|example logs?|sample logs?|logs? (?:go|are) here)\b/i.test(
      plain,
    ) ||
    /\b(?:paste|insert|replace)\b[^\r\n]{0,30}\blogs?\b/i.test(plain)
  ) {
    return false;
  }
  const lines = plain
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length < 2) return false;
  const lineClassifier =
    rowId === "backend-logs" ? backendLogLikeLine : frontendLogLikeLine;
  if (lines.filter(lineClassifier).length >= 2) return true;

  const structuredKeys = new Set(
    [
      ...plain.matchAll(
        /"(time|timestamp|level|message|method|url|status|statusCode)"\s*:/gi,
      ),
    ].map((match) => match[1].toLowerCase()),
  );
  return rowId === "backend-logs"
    ? structuredKeys.has("message") &&
        structuredKeys.has("level") &&
        (structuredKeys.has("time") || structuredKeys.has("timestamp"))
    : structuredKeys.has("method") &&
        structuredKeys.has("url") &&
        (structuredKeys.has("status") || structuredKeys.has("statuscode"));
}

function hasSubstantiveInlineLogs(rowId, row) {
  if (rowId !== "backend-logs" && rowId !== "frontend-logs") return false;
  for (const match of row.matchAll(/<details\b[^>]*>([\s\S]*?)<\/details>/gi)) {
    if (substantiveLogContent(match[1], rowId)) return true;
  }
  return false;
}

function hasSpecificNotApplicableReason(row) {
  const match = row.match(NA_WITH_REASON_RE);
  if (!match) return false;
  const reason = match[1]
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/[*_`[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:!?]+$/, "");
  if (
    reason.length < 12 ||
    /https?:\/\//i.test(reason) ||
    /^(?:none|unknown|unspecified|not applicable|no reason|placeholder|tbd|todo)$/i.test(
      reason,
    ) ||
    /<[^>]+>|\[[^\]]+\]/.test(match[1])
  ) {
    return false;
  }
  return (reason.match(/[A-Za-z][A-Za-z0-9'-]*/g) ?? []).length >= 3;
}

export function auditPrEvidence(body) {
  const rows = extractEvidenceRows(body);
  const findings = REQUIRED_EVIDENCE_ROWS.map((id) => {
    if (!rows.has(id)) return { id, status: "missing" };
    const row = rows.get(id);
    return {
      id,
      status:
        hasAllowedEvidenceUrl(id, row) ||
        hasSubstantiveInlineLogs(id, row) ||
        hasSpecificNotApplicableReason(row)
          ? "ok"
          : "unsatisfied",
    };
  });
  return {
    ok: findings.every((finding) => finding.status === "ok"),
    findings,
  };
}

function itemSummary(item, context) {
  return {
    number: asNumberField(item, "number", context),
    title: asStringField(item, "title", context),
    url: asStringField(item, "html_url", context),
    author: accountLogin(item.user),
    labels: labelNames(item, context).sort((left, right) =>
      left.localeCompare(right),
    ),
  };
}

function claimReasons(item, comments, mode, context, referenceTime) {
  const reasons = [];
  const labels = labelNames(item, context);
  const claimLabel =
    mode === "issue" ? ISSUE_CLAIM_LABEL_RE : REVIEW_CLAIM_LABEL_RE;
  const matchedLabels = labels.filter(
    (label) => claimLabel.test(label) || BLOCKED_LABEL_RE.test(label),
  );
  if (matchedLabels.length > 0) {
    reasons.push(`labels: ${matchedLabels.sort().join(", ")}`);
  }

  const author = accountLogin(item.user);
  const authorId = accountId(item.user);
  const authorKey = author.toLowerCase();
  const assignees = asArrayField(item, "assignees", context)
    .filter((assignee) => !isBotAccount(assignee))
    .map((assignee) => ({
      id: accountId(assignee),
      login: accountLogin(assignee),
    }))
    .filter(
      (assignee) =>
        mode === "issue" ||
        !(
          (authorId !== null && assignee.id === authorId) ||
          assignee.login.toLowerCase() === authorKey
        ),
    )
    .map((assignee) => assignee.login);
  if (assignees.length > 0) {
    reasons.push(`assignees: ${assignees.sort().join(", ")}`);
  }

  const claimPattern = mode === "issue" ? ISSUE_CLAIM_RE : REVIEW_CLAIM_RE;
  const claimers = comments
    .filter(
      (comment) =>
        comment.authorKnown &&
        !comment.bot &&
        TRUSTED_CLAIM_ASSOCIATIONS.has(comment.authorAssociation) &&
        (mode === "issue" ||
          !(
            (authorId !== null && comment.authorId === authorId) ||
            comment.author.toLowerCase() === authorKey
          )) &&
        hasClaimSignal(comment.body, claimPattern) &&
        isRecent(comment.createdAt, referenceTime),
    )
    .map((comment) => comment.author)
    .filter((author, index, authors) => authors.indexOf(author) === index)
    .sort();
  if (claimers.length > 0)
    reasons.push(`claim comments: ${claimers.join(", ")}`);
  return reasons;
}

function requestedReviewTargets(item, context) {
  const users = asArrayField(item, "requested_reviewers", context).map(
    (value, index) => {
      const account = asRecord(
        value,
        `${context}.requested_reviewers[${index}]`,
      );
      return {
        key: `user:${accountLogin(account).toLowerCase()}`,
        label: accountLogin(account),
      };
    },
  );
  const teams = asArrayField(item, "requested_teams", context).map(
    (value, index) => {
      const team = asRecord(value, `${context}.requested_teams[${index}]`);
      const slug = asStringField(
        team,
        "slug",
        `${context}.requested_teams[${index}]`,
      );
      return { key: `team:${slug.toLowerCase()}`, label: `@${slug}` };
    },
  );
  return [...users, ...teams].sort((left, right) =>
    left.key.localeCompare(right.key),
  );
}

function reviewRequestStatus(targets) {
  return {
    active: targets.map((target) => target.label).sort(),
    stale: [],
  };
}

function currentHeadReviewStatus(item, reviews, context) {
  const head = asRecord(item.head, `${context}.head`);
  const headSha = asStringField(head, "sha", `${context}.head`).toLowerCase();
  if (!FULL_COMMIT_RE.test(headSha)) {
    throw new TypeError(`${context}.head.sha must be a full commit SHA`);
  }
  const author = accountLogin(item.user).toLowerCase();
  const authorId = accountId(item.user);
  const latestByReviewer = new Map();
  for (const review of reviews) {
    if (
      review.bot ||
      (authorId !== null && review.authorId === authorId) ||
      review.author.toLowerCase() === author
    ) {
      continue;
    }
    const isDecision = ["APPROVED", "CHANGES_REQUESTED"].includes(review.state);
    if (isDecision && review.createdAt === null) {
      throw new TypeError(
        `${context} review ${review.id} is missing the timestamp for its ${review.state} decision`,
      );
    }
    // GitHub returns a null reviewed commit when the exact reviewed history is
    // no longer reachable. Preserve the review for disclosure auditing, but it
    // cannot prove a decision against the current head.
    if (isDecision && review.commitId === null) continue;
    if (
      !["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(review.state) ||
      review.createdAt === null ||
      review.commitId === null
    ) {
      continue;
    }
    const key =
      review.authorId === null
        ? `ghost:${review.id}`
        : `actor:${review.authorId}`;
    const submittedAt = Date.parse(review.createdAt);
    const previous = latestByReviewer.get(key);
    if (!previous || submittedAt > previous.submittedAt) {
      latestByReviewer.set(key, { submittedAt, reviews: [review] });
    } else if (submittedAt === previous.submittedAt) {
      previous.reviews.push(review);
    }
  }

  const approved = [];
  const changesRequested = [];
  for (const entry of latestByReviewer.values()) {
    const currentHeadStates = entry.reviews
      .filter((review) => review.commitId === headSha)
      .map((review) => review.state);
    if (currentHeadStates.includes("CHANGES_REQUESTED")) {
      changesRequested.push(entry.reviews[0].author);
    } else if (currentHeadStates.includes("APPROVED")) {
      approved.push(entry.reviews[0].author);
    }
  }
  return {
    approved: approved.sort(),
    changesRequested: changesRequested.sort(),
  };
}

function issueCommentsEndpoint(repo, number) {
  return `repos/${repo}/issues/${number}/comments?per_page=100`;
}

function pullReviewsEndpoint(repo, number) {
  return `repos/${repo}/pulls/${number}/reviews?per_page=100`;
}

function pullReviewCommentsEndpoint(repo, number) {
  return `repos/${repo}/pulls/${number}/comments?per_page=100`;
}

function listCommentsWhenPresent(item, countField, endpoint, kind, listPages) {
  const count = asNumberField(item, countField, `item #${item.number}`);
  return count === 0 ? [] : normalizeComments(listPages(endpoint), kind);
}

export function collectLiveReport(
  repo,
  listPages = readGhPages,
  now = new Date(),
  onProgress = () => {},
  openActivity = null,
  projectEligibleIssueLabels = DEFAULT_CONTRIBUTOR_READY_LABELS,
) {
  if (!REPOSITORY_RE.test(repo)) {
    throw new TypeError("Repository must use the owner/name form");
  }
  const referenceTime = nowTime(now);
  const snapshotCutoff = now.toISOString();
  const candidateLabelSet = new Set(
    eligibleIssueLabels(projectEligibleIssueLabels, "eligible issue labels"),
  );

  const issueEndpoint = `repos/${repo}/issues?state=open&per_page=100&sort=created&direction=asc`;
  const pullEndpoint = `repos/${repo}/pulls?state=open&per_page=100&sort=created&direction=asc`;
  const issueItems = listPages(issueEndpoint)
    .map((value, index) => asRecord(value, `issues[${index}]`))
    .filter((item) => item.pull_request === undefined)
    .sort((left, right) => left.number - right.number);
  const pullItems = listPages(pullEndpoint)
    .map((value, index) => asRecord(value, `pulls[${index}]`))
    .sort((left, right) => left.number - right.number);
  const openPullsByClosingIssue = new Map();
  for (const item of pullItems) {
    for (const issueNumber of closingIssueNumbers(item.body, repo)) {
      const pullNumbers = openPullsByClosingIssue.get(issueNumber) ?? [];
      pullNumbers.push(item.number);
      openPullsByClosingIssue.set(issueNumber, pullNumbers);
    }
  }
  if (issueItems.length > MAX_OPEN_ITEMS || pullItems.length > MAX_OPEN_ITEMS) {
    throw new RangeError(
      `Live discovery exceeds the ${MAX_OPEN_ITEMS}-item per-kind safety bound`,
    );
  }
  if (openActivity !== null) {
    const activity = asRecord(openActivity, "open activity");
    if (!(activity.issues instanceof Map) || !(activity.pulls instanceof Map)) {
      throw new TypeError("open activity must contain issue and pull maps");
    }
    const issueNumbers = new Set(issueItems.map((item) => item.number));
    const pullNumbers = new Set(pullItems.map((item) => item.number));
    if (
      activity.issues.size !== issueNumbers.size ||
      activity.pulls.size !== pullNumbers.size ||
      [...issueNumbers].some((number) => !activity.issues.has(number)) ||
      [...pullNumbers].some((number) => !activity.pulls.has(number))
    ) {
      throw new LiveInventoryChangedError();
    }
  }
  onProgress({ phase: "issues", current: 0, total: issueItems.length });

  const candidateIssues = [];
  const botIssues = [];
  const unknownAuthorIssues = [];
  const sensitiveIssues = [];
  const untriagedIssues = [];
  const claimedIssues = [];
  const issuesWithOpenPullRequests = [];
  const issueCommentAudits = [];

  for (const [index, item] of issueItems.entries()) {
    onProgress({
      phase: "issues",
      current: index + 1,
      total: issueItems.length,
    });
    const summary = itemSummary(item, `issue #${item.number}`);
    if (item.user === null) {
      unknownAuthorIssues.push(summary);
      continue;
    }
    if (isBotAccount(item.user)) {
      botIssues.push(summary);
      continue;
    }
    if (!isKnownHumanAccount(item.user)) {
      unknownAuthorIssues.push(summary);
      continue;
    }
    const comments =
      openActivity === null
        ? listCommentsWhenPresent(
            item,
            "comments",
            issueCommentsEndpoint(repo, summary.number),
            "issue-comment",
            listPages,
          )
        : normalizeComments(
            openActivity.issues.get(summary.number),
            "issue-comment",
          );
    const missing = auditCommentDisclosures(comments);
    if (missing.length > 0) {
      issueCommentAudits.push({ ...summary, missingModelDisclosures: missing });
    }

    const labels = labelNames(item, `issue #${summary.number}`);
    if (labels.some((label) => SENSITIVE_LABEL_RE.test(label))) {
      sensitiveIssues.push({
        number: summary.number,
        url: summary.url,
        reason: "security-sensitive label",
      });
      continue;
    }
    const epic =
      EPIC_TITLE_RE.test(summary.title) ||
      labels.some((label) => EPIC_LABEL_RE.test(label.trim()));
    if (
      epic ||
      !labels.some((label) => candidateLabelSet.has(label.trim().toLowerCase()))
    ) {
      untriagedIssues.push({
        ...summary,
        reason: epic
          ? "epic requires a bounded child issue"
          : `missing eligible maintainer label (${[...candidateLabelSet].sort().join(", ")})`,
      });
      continue;
    }
    const reasons = claimReasons(
      item,
      comments,
      "issue",
      `issue #${summary.number}`,
      referenceTime,
    );
    if (reasons.length > 0) {
      claimedIssues.push({ ...summary, claimReasons: reasons });
      continue;
    }
    const closingPullRequests =
      openPullsByClosingIssue.get(summary.number) ?? [];
    if (closingPullRequests.length > 0) {
      issuesWithOpenPullRequests.push({
        ...summary,
        closingPullRequests: [...closingPullRequests].sort(
          (left, right) => left - right,
        ),
      });
      continue;
    }
    candidateIssues.push(summary);
  }

  const reviewablePullRequests = [];
  const botPullRequests = [];
  const unknownAuthorPullRequests = [];
  const sensitivePullRequests = [];
  const draftPullRequests = [];
  const claimedPullRequests = [];
  const reviewedPullRequests = [];
  const changesRequestedPullRequests = [];
  const pullRequestAudits = [];

  onProgress({ phase: "pull requests", current: 0, total: pullItems.length });
  for (const [index, item] of pullItems.entries()) {
    onProgress({
      phase: "pull requests",
      current: index + 1,
      total: pullItems.length,
    });
    const context = `pull request #${item.number}`;
    const summary = itemSummary(item, context);
    if (item.user === null) {
      unknownAuthorPullRequests.push(summary);
      continue;
    }
    if (isBotAccount(item.user)) {
      botPullRequests.push(summary);
      continue;
    }
    if (!isKnownHumanAccount(item.user)) {
      unknownAuthorPullRequests.push(summary);
      continue;
    }
    const labels = labelNames(item, context);
    if (labels.some((label) => SENSITIVE_LABEL_RE.test(label))) {
      sensitivePullRequests.push({
        number: summary.number,
        url: summary.url,
        reason: "security-sensitive label",
      });
      continue;
    }
    if (typeof item.draft !== "boolean") {
      throw new TypeError(`${context}.draft must be a boolean`);
    }
    // Pull-list responses do not guarantee comment counts, so all three
    // paginated comment surfaces are read explicitly.
    const pullActivity = openActivity?.pulls.get(summary.number);
    const issueComments = normalizeComments(
      pullActivity?.issueComments ??
        listPages(issueCommentsEndpoint(repo, summary.number)),
      "pr-comment",
    );
    const inlineComments = normalizeComments(
      pullActivity?.inlineComments ??
        listPages(pullReviewCommentsEndpoint(repo, summary.number)),
      "review-comment",
    );
    const reviews = normalizeReviews(
      pullActivity?.reviews ??
        listPages(pullReviewsEndpoint(repo, summary.number)),
    );
    const allComments = [...issueComments, ...inlineComments, ...reviews].sort(
      compareComment,
    );
    const body = nullableText(item.body, `${context}.body`);
    const requestedTargets = requestedReviewTargets(item, context);
    const requestStatus = reviewRequestStatus(requestedTargets);
    const fallbackReviewStatus = pullActivity?.reviewStatus ?? null;
    if (
      fallbackReviewStatus !== null &&
      !new Set(["none", "approved", "changes_requested"]).has(
        fallbackReviewStatus,
      )
    ) {
      throw new TypeError(`${context} has an invalid REST review status`);
    }
    const currentReviews =
      fallbackReviewStatus === "approved"
        ? { approved: ["GitHub REST review status"], changesRequested: [] }
        : fallbackReviewStatus === "changes_requested"
          ? {
              approved: [],
              changesRequested: ["GitHub REST review status"],
            }
          : currentHeadReviewStatus(item, reviews, context);
    const reviewState = {
      activeRequests: requestStatus.active,
      staleRequests: requestStatus.stale,
      currentHeadApprovals: currentReviews.approved,
      currentHeadChangesRequested: currentReviews.changesRequested,
    };
    const head = asRecord(item.head, `${context}.head`);
    const headSha = asStringField(head, "sha", `${context}.head`).toLowerCase();
    if (!FULL_COMMIT_RE.test(headSha)) {
      throw new TypeError(`${context}.head.sha must be a full commit SHA`);
    }
    const updatedAt = isoTime(item.updated_at, `${context}.updated_at`);
    const detailedSummary = {
      ...summary,
      updatedAt,
      headSha,
      reviewState,
    };
    pullRequestAudits.push({
      ...detailedSummary,
      bodyProviderModel: parseModelDisclosure(body),
      bodyHumanOnly: hasHumanOnlyPullRequestDeclaration(body),
      missingModelDisclosures: auditCommentDisclosures(allComments),
      evidence: auditPrEvidence(body),
    });

    const reasons = claimReasons(
      item,
      [...issueComments, ...inlineComments],
      "pull request",
      context,
      referenceTime,
    );
    if (requestStatus.active.length > 0) {
      reasons.push(
        `active review requests: ${requestStatus.active.join(", ")}`,
      );
    }
    if (item.draft) {
      draftPullRequests.push(detailedSummary);
      continue;
    }
    if (reasons.length > 0) {
      claimedPullRequests.push({ ...detailedSummary, claimReasons: reasons });
      continue;
    }
    if (currentReviews.changesRequested.length > 0) {
      changesRequestedPullRequests.push(detailedSummary);
      continue;
    }
    if (currentReviews.approved.length > 0) {
      reviewedPullRequests.push(detailedSummary);
      continue;
    }
    reviewablePullRequests.push(detailedSummary);
  }

  const reviewEpoch = createReviewEpoch(reviewablePullRequests, snapshotCutoff);
  return {
    repository: repo,
    snapshot: { cutoff: snapshotCutoff },
    selection: {
      eligibleIssueLabels: [...candidateLabelSet].sort(),
      reviewEpoch,
    },
    totals: {
      openIssues: issueItems.length,
      openPullRequests: pullItems.length,
      candidateIssues: candidateIssues.length,
      reviewablePullRequests: reviewablePullRequests.length,
    },
    candidateIssues: candidateIssues.sort(compareByNumber),
    reviewablePullRequests: reviewablePullRequests.sort(compareByNumber),
    filtered: {
      botIssues: botIssues.sort(compareByNumber),
      unknownAuthorIssues: unknownAuthorIssues.sort(compareByNumber),
      sensitiveIssues: sensitiveIssues.sort(compareByNumber),
      untriagedIssues: untriagedIssues.sort(compareByNumber),
      claimedIssues: claimedIssues.sort(compareByNumber),
      issuesWithOpenPullRequests:
        issuesWithOpenPullRequests.sort(compareByNumber),
      botPullRequests: botPullRequests.sort(compareByNumber),
      unknownAuthorPullRequests:
        unknownAuthorPullRequests.sort(compareByNumber),
      sensitivePullRequests: sensitivePullRequests.sort(compareByNumber),
      draftPullRequests: draftPullRequests.sort(compareByNumber),
      claimedPullRequests: claimedPullRequests.sort(compareByNumber),
      reviewedPullRequests: reviewedPullRequests.sort(compareByNumber),
      changesRequestedPullRequests:
        changesRequestedPullRequests.sort(compareByNumber),
    },
    audits: {
      issueComments: issueCommentAudits.sort(compareByNumber),
      pullRequests: pullRequestAudits.sort(compareByNumber),
    },
  };
}

function markdownItems(items) {
  if (items.length === 0) return "_None._";
  return items
    .map((item) => {
      const staleRequests = item.reviewState?.staleRequests ?? [];
      const suffixes = [];
      if (staleRequests.length > 0) {
        suffixes.push(
          `stale review request: ${staleRequests.join(", ")} (reconfirm live state)`,
        );
      }
      if (item.closingPullRequests?.length > 0) {
        suffixes.push(
          `open closing PR${item.closingPullRequests.length === 1 ? "" : "s"}: ${item.closingPullRequests.map((number) => `#${number}`).join(", ")}`,
        );
      }
      const suffix = suffixes.length === 0 ? "" : ` — ${suffixes.join("; ")}`;
      return `- [#${item.number}](${item.url}) ${item.title}${suffix}`;
    })
    .join("\n");
}

export function renderMarkdown(report) {
  const eligibleLabels = eligibleIssueLabels(
    report.selection?.eligibleIssueLabels,
    "report.selection.eligibleIssueLabels",
  );
  const lines = [
    `# elizaOS contribution report — ${report.repository}`,
    "",
    `Open issues: ${report.totals.openIssues}; unclaimed candidates: ${report.totals.candidateIssues}.`,
    `Open PRs: ${report.totals.openPullRequests}; reviewable candidates: ${report.totals.reviewablePullRequests}.`,
    report.selection?.reviewEpoch
      ? `Review epoch cutoff: ${report.selection.reviewEpoch.cutoff}; frozen candidates: ${report.selection.reviewEpoch.candidates.length}/${report.selection.reviewEpoch.candidateCount}; deferred to a later epoch: ${report.selection.reviewEpoch.deferred.length}.`
      : "Review epoch: unavailable.",
    "",
    "## Priority 1: unclaimed issue candidates with no open closing PR",
    "",
    markdownItems(report.candidateIssues),
    "",
    "## Priority 2: pull requests with no current-head review",
    "",
    markdownItems(report.reviewablePullRequests),
    "",
    "## Issues already represented by an open pull request",
    "",
    markdownItems(report.filtered.issuesWithOpenPullRequests),
    "",
    "## Open issues awaiting maintainer triage",
    "",
    markdownItems(report.filtered.untriagedIssues),
    "",
    "## Disclosure and evidence gaps",
    "",
  ];

  const gaps = [];
  for (const issue of report.audits.issueComments) {
    gaps.push(
      `- Issue [#${issue.number}](${issue.url}): ${issue.missingModelDisclosures.length} claim or AI-provenance comment(s) lack exact provider/model disclosure.`,
    );
  }
  for (const pull of report.audits.pullRequests) {
    const details = [];
    if (pull.bodyProviderModel === null && !pull.bodyHumanOnly) {
      details.push("PR body lacks exact provider/model disclosure");
    }
    if (pull.missingModelDisclosures.length > 0) {
      details.push(
        `${pull.missingModelDisclosures.length} claim or AI-provenance comment(s) lack disclosure`,
      );
    }
    const evidenceGaps = pull.evidence.findings
      .filter((finding) => finding.status !== "ok")
      .map((finding) => `${finding.id}=${finding.status}`);
    if (evidenceGaps.length > 0) {
      details.push(`evidence ${evidenceGaps.join(", ")}`);
    }
    if (details.length > 0) {
      gaps.push(`- PR [#${pull.number}](${pull.url}): ${details.join("; ")}.`);
    }
  }
  lines.push(gaps.length > 0 ? gaps.join("\n") : "_No audited gaps._");
  lines.push(
    "",
    `_Read-only heuristic report: issue candidates require one configured maintainer-controlled repository label (${eligibleLabels.join(", ")}); titles, bodies, comments, Discussions, and other labels cannot substitute. Claim comments expire after ${CLAIM_RECENCY_DAYS} days and count only from repository owners, members, or collaborators unless durable repository state remains; active GitHub review requests persist until cleared. Verify live Project state and newest comments before claiming._`,
    "",
  );
  return lines.join("\n");
}

export function parseCliArguments(
  args,
  defaultRepository = readProjectSelectionPolicy().repositoryId,
) {
  if (!REPOSITORY_RE.test(defaultRepository)) {
    throw new TypeError("default repository must use the owner/name form");
  }
  const options = {
    repo: defaultRepository,
    json: false,
    help: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") {
      options.json = true;
    } else if (argument === "--epoch-only") {
      options.epochOnly = true;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--repo") {
      index += 1;
      if (index >= args.length) {
        throw new TypeError("--repo requires an owner/name value");
      }
      options.repo = args[index];
    } else if (argument.startsWith("--repo=")) {
      options.repo = argument.slice("--repo=".length);
    } else if (argument === "--recheck-pr") {
      index += 1;
      if (index >= args.length) {
        throw new TypeError("--recheck-pr requires a pull request number");
      }
      options.recheckPr = Number(args[index]);
    } else if (argument.startsWith("--recheck-pr=")) {
      options.recheckPr = Number(argument.slice("--recheck-pr=".length));
    } else if (argument === "--expected-head") {
      index += 1;
      if (index >= args.length) {
        throw new TypeError("--expected-head requires a full commit SHA");
      }
      options.expectedHead = args[index];
    } else if (argument.startsWith("--expected-head=")) {
      options.expectedHead = argument.slice("--expected-head=".length);
    } else if (argument === "--complete-epoch") {
      index += 1;
      if (index >= args.length) {
        throw new TypeError("--complete-epoch requires a JSON file path");
      }
      options.completeEpochPath = args[index];
    } else if (argument.startsWith("--complete-epoch=")) {
      options.completeEpochPath = argument.slice("--complete-epoch=".length);
    } else if (argument === "--dispositions") {
      index += 1;
      if (index >= args.length) {
        throw new TypeError("--dispositions requires a JSON file path");
      }
      options.dispositionsPath = args[index];
    } else if (argument.startsWith("--dispositions=")) {
      options.dispositionsPath = argument.slice("--dispositions=".length);
    } else {
      throw new TypeError(`Unknown argument: ${argument}`);
    }
  }
  if (!REPOSITORY_RE.test(options.repo)) {
    throw new TypeError("--repo must use the owner/name form");
  }
  if (options.recheckPr !== undefined) {
    if (!Number.isInteger(options.recheckPr) || options.recheckPr < 1) {
      throw new TypeError("--recheck-pr must be a positive integer");
    }
    if (
      typeof options.expectedHead !== "string" ||
      !FULL_COMMIT_RE.test(options.expectedHead)
    ) {
      throw new TypeError(
        "--expected-head must be a full commit SHA when rechecking a PR",
      );
    }
  } else if (options.expectedHead !== undefined) {
    throw new TypeError("--expected-head requires --recheck-pr");
  }
  const completionRequested =
    options.completeEpochPath !== undefined ||
    options.dispositionsPath !== undefined;
  if (completionRequested) {
    if (
      typeof options.completeEpochPath !== "string" ||
      options.completeEpochPath.trim() === "" ||
      typeof options.dispositionsPath !== "string" ||
      options.dispositionsPath.trim() === ""
    ) {
      throw new TypeError(
        "--complete-epoch and --dispositions must be provided together",
      );
    }
    if (options.recheckPr !== undefined) {
      throw new TypeError(
        "--complete-epoch cannot be combined with --recheck-pr",
      );
    }
  }
  if (
    options.epochOnly === true &&
    (options.json || completionRequested || options.recheckPr !== undefined)
  ) {
    throw new TypeError(
      "--epoch-only cannot be combined with another output operation",
    );
  }
  return options;
}

export function usage() {
  return `Usage: node scripts/live-report.mjs [options]

Read and paginate open GitHub issues and pull requests without changing them.

Options:
  --repo <owner/name>  Repository to inspect (default: this skill's project)
  --json               Print stable machine-readable JSON
  --epoch-only         Print only the finite review epoch JSON
  --recheck-pr <n>     GET one live PR head before publishing a review
  --expected-head <sha>  Frozen epoch head required by --recheck-pr
  --complete-epoch <path>  Validate a saved report or epoch JSON file
  --dispositions <path>  Terminal disposition JSON required for completion
  --help, -h           Show this help
`;
}

/** Repeats one complete read when GitHub changes its open-item inventory mid-snapshot. */
export function retryChangedLiveInventory(collect, onRetry = () => {}) {
  for (let attempt = 1; attempt <= MAX_LIVE_INVENTORY_ATTEMPTS; attempt += 1) {
    try {
      return collect(attempt);
    } catch (cause) {
      if (!(cause instanceof LiveInventoryChangedError)) throw cause;
      if (attempt === MAX_LIVE_INVENTORY_ATTEMPTS) {
        throw new LiveInventoryChangedError(
          `Open GitHub inventory changed while collecting the live report after ${MAX_LIVE_INVENTORY_ATTEMPTS} attempts`,
          { cause },
        );
      }
      onRetry({ attempt, cause });
    }
  }
  throw new Error("unreachable live inventory retry state");
}

export function main(args = process.argv.slice(2)) {
  const selectionPolicy = readProjectSelectionPolicy();
  const options = parseCliArguments(args, selectionPolicy.repositoryId);
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  if (options.completeEpochPath !== undefined) {
    const epoch = reviewEpochFromFile(options.completeEpochPath);
    const dispositions = readBoundedJsonFile(
      options.dispositionsPath,
      "review epoch dispositions",
    );
    const result = completeReviewEpoch(epoch, dispositions);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.complete) process.exitCode = 2;
    return;
  }
  const commandBudget = createGhCommandBudget();
  if (options.recheckPr !== undefined) {
    const result = recheckLivePullHead(
      options.repo,
      {
        number: options.recheckPr,
        headSha: options.expectedHead,
      },
      commandBudget.run,
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.publishable) process.exitCode = 2;
    return;
  }
  const boundedRead = (endpoint) => {
    return readGhPages(endpoint, commandBudget.run);
  };
  let rateLimits = { preflight: true };
  const { report } = retryChangedLiveInventory(
    () => {
      const openActivity = readGhOpenActivity(
        options.repo,
        commandBudget.run,
        rateLimits,
      );
      rateLimits = openActivity.rateLimits;
      const limits = asRecord(openActivity.rateLimits, "GitHub rate limits");
      process.stderr.write(
        `[Slop] GitHub budgets: GraphQL ${limits.graphqlRemaining}/${limits.graphqlLimit} (${limits.graphqlBudgetSource}); REST ${limits.restRemaining}/${limits.restLimit}; Search ${limits.searchRemaining}/${limits.searchLimit}; activity source ${openActivity.source}\n`,
      );
      return {
        report: collectLiveReport(
          options.repo,
          boundedRead,
          new Date(),
          ({ phase, current, total }) => {
            if (current === 0 || current === total || current % 10 === 0) {
              process.stderr.write(
                `[Slop] scanning ${phase}: ${current}/${total} (${commandBudget.count} bounded GitHub commands)\n`,
              );
            }
          },
          openActivity,
          selectionPolicy.eligibleIssueLabels,
        ),
      };
    },
    ({ attempt }) =>
      process.stderr.write(
        `[Slop] open-item inventory changed during snapshot attempt ${attempt}; retrying one complete read\n`,
      ),
  );
  process.stdout.write(
    options.epochOnly
      ? `${JSON.stringify(report.selection.reviewEpoch, null, 2)}\n`
      : options.json
        ? `${JSON.stringify(report, null, 2)}\n`
        : renderMarkdown(report),
  );
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  existsSync(process.argv[1]) &&
  realpathSync(fileURLToPath(import.meta.url)) ===
    realpathSync(process.argv[1]);

if (invokedDirectly) {
  try {
    main();
  } catch (error) {
    // error-policy:J1 The CLI boundary turns a failed read/audit into a non-zero exit.
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Slop live report failed: ${message}\n`);
    process.exitCode = 1;
  }
}
