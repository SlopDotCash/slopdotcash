#!/usr/bin/env node
/**
 * Verifies the live Eliza review-publication path before an agent treats
 * attribution-policy drift as a blocker. The check is GET-only: it separates
 * writer identity, target workflow enforcement, documentation, and a known
 * signed forward-path artifact instead of inferring publishability from one
 * policy file or standalone validator.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const skillDirectory = dirname(scriptDirectory);
const CONFIG = JSON.parse(
  readFileSync(join(skillDirectory, "review-compatibility.json"), "utf8"),
);
const SHA_RE = /^[0-9a-f]{40}$/u;
const MAX_API_BYTES = 16 * 1024 * 1024;
const MAX_WORKFLOWS = 128;
const MAX_AUTOMATION_FILES = 256;
const MAX_DIRECTORY_ENTRIES = 128;
const MAX_WORKFLOW_BYTES = 1024 * 1024;
const WORKFLOW_PATH_RE = /^\.github\/workflows\/[^/]+\.ya?ml$/u;
const ACTION_MANIFEST_RE = /(?:^|\/)action\.ya?ml$/u;

function fail(message) {
  throw new TypeError(message);
}

function record(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${field} must be an object`);
  }
  return value;
}

function exactKeys(value, keys, field) {
  if (Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) {
    fail(`${field} has unexpected or missing fields`);
  }
}

function canonicalRepositoryPath(value, field) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9._/-]+$/u.test(value) ||
    value.startsWith("/") ||
    value.split("/").some((part) => part.length === 0 || part === "..")
  ) {
    fail(`${field} is not a canonical repository path`);
  }
  return value;
}

function validateConfiguration(value = CONFIG) {
  const config = record(value, "review compatibility configuration");
  exactKeys(
    config,
    [
      "artifact",
      "forwardProof",
      "integrationBranch",
      "legacyMarker",
      "policyDocument",
      "repositoryId",
      "schemaVersion",
      "validatorPath",
      "writerMarker",
    ],
    "review compatibility configuration",
  );
  if (
    config.schemaVersion !== "1" ||
    config.artifact !== "pull-request-review" ||
    config.repositoryId !== "elizaOS/eliza" ||
    config.integrationBranch !== "develop" ||
    config.writerMarker !== "slop-contribution-attribution:v1" ||
    config.legacyMarker !== "eliza-computer-attribution:v1" ||
    config.policyDocument !== "CONTRIBUTING.md" ||
    config.validatorPath !== "scripts/check-agent-comment-attribution.mjs"
  ) {
    fail("review compatibility configuration has an unsupported identity");
  }
  const proof = record(config.forwardProof, "forward proof");
  exactKeys(
    proof,
    ["commitId", "pullRequest", "reviewId", "url"],
    "forward proof",
  );
  if (
    !Number.isSafeInteger(proof.pullRequest) ||
    proof.pullRequest <= 0 ||
    !Number.isSafeInteger(proof.reviewId) ||
    proof.reviewId <= 0 ||
    !SHA_RE.test(proof.commitId) ||
    proof.url !==
      `https://github.com/${config.repositoryId}/pull/${proof.pullRequest}#pullrequestreview-${proof.reviewId}`
  ) {
    fail("forward proof has an invalid identity");
  }
  return config;
}

function markerFromTerminalLine(body, markerName) {
  if (typeof body !== "string" || body.length === 0) return null;
  const terminal = body.trimEnd().split(/\r?\n/u).at(-1) ?? "";
  const prefix = `<!-- ${markerName} `;
  if (!terminal.startsWith(prefix) || !terminal.endsWith(" -->")) return null;
  try {
    return JSON.parse(terminal.slice(prefix.length, -4));
  } catch {
    return null;
  }
}

function validProofReview(review, config) {
  const value = record(review, "forward proof review");
  const marker = markerFromTerminalLine(value.body, config.writerMarker);
  return (
    value.id === config.forwardProof.reviewId &&
    value.commit_id === config.forwardProof.commitId &&
    value.html_url === config.forwardProof.url &&
    typeof value.submitted_at === "string" &&
    Number.isFinite(Date.parse(value.submitted_at)) &&
    typeof value.state === "string" &&
    marker !== null &&
    marker.run?.schema_version === "1" &&
    marker.run?.project === "eliza" &&
    marker.run?.repository === config.repositoryId &&
    marker.run?.signature_algorithm === "ed25519" &&
    typeof marker.run?.device_public_key === "string" &&
    typeof marker.run?.device_signature === "string" &&
    marker.skill_revision?.startsWith("elizaOS/slopdotcash@")
  );
}

function sourceRunsValidator(source, config) {
  return (
    source.includes(config.validatorPath) ||
    source.includes(config.validatorPath.split("/").at(-1))
  );
}

function localUsesTargets(source) {
  if (typeof source !== "string") fail("automation source must be text");
  const targets = [];
  const pattern =
    /^\s*(?:-\s*)?uses\s*:\s*["']?(\.\/[^"'#\s]+)["']?\s*(?:#.*)?$/gmu;
  for (const match of source.matchAll(pattern)) {
    const target = match[1].replace(/\/+$/u, "").slice(2);
    targets.push(canonicalRepositoryPath(target, "local uses target"));
  }
  return targets;
}

function automationIndex(files) {
  if (!Array.isArray(files) || files.length > MAX_AUTOMATION_FILES) {
    fail("automation inventory is missing or unbounded");
  }
  const indexed = new Map();
  for (const [index, file] of files.entries()) {
    const item = record(file, `automationFiles[${index}]`);
    exactKeys(item, ["path", "source"], `automationFiles[${index}]`);
    const path = canonicalRepositoryPath(
      item.path,
      `automationFiles[${index}].path`,
    );
    if (
      (!WORKFLOW_PATH_RE.test(path) && !ACTION_MANIFEST_RE.test(path)) ||
      typeof item.source !== "string" ||
      Buffer.byteLength(item.source) > MAX_WORKFLOW_BYTES ||
      indexed.has(path)
    ) {
      fail(`automationFiles[${index}] is invalid`);
    }
    indexed.set(path, item.source);
  }
  return indexed;
}

function resolveLocalTarget(target, indexed) {
  if (WORKFLOW_PATH_RE.test(target)) {
    if (!indexed.has(target))
      fail(`local automation target is missing: ${target}`);
    return target;
  }
  const candidates = [`${target}/action.yml`, `${target}/action.yaml`].filter(
    (path) => indexed.has(path),
  );
  if (candidates.length !== 1) {
    fail(`local automation target is missing or ambiguous: ${target}`);
  }
  return candidates[0];
}

function reachableReviewPolicy(rootPath, indexed, config) {
  const pending = [rootPath];
  const visited = new Set();
  let runsValidator = false;
  let acceptsWriter = false;
  while (pending.length > 0) {
    const path = pending.pop();
    if (visited.has(path)) continue;
    visited.add(path);
    const source = indexed.get(path);
    if (typeof source !== "string")
      fail(`automation source is missing: ${path}`);
    runsValidator ||= sourceRunsValidator(source, config);
    acceptsWriter ||= source.includes(config.writerMarker);
    for (const target of localUsesTargets(source)) {
      pending.push(resolveLocalTarget(target, indexed));
    }
  }
  return { acceptsWriter, runsValidator };
}

/** Classifies the exact review path without turning documentation drift into a block. */
export function assessReviewCompatibility(input, configuration = CONFIG) {
  const config = validateConfiguration(configuration);
  const value = record(input, "review compatibility input");
  exactKeys(
    value,
    ["automationFiles", "branchSha", "policy", "proofReview", "validator"],
    "review compatibility input",
  );
  if (!SHA_RE.test(value.branchSha))
    fail("branch SHA must be a full commit id");
  if (typeof value.policy !== "string" || typeof value.validator !== "string") {
    fail("policy and validator sources must be text");
  }
  const indexed = automationIndex(value.automationFiles);
  const workflows = [...indexed]
    .filter(([path]) => WORKFLOW_PATH_RE.test(path))
    .map(([path, source]) => ({ path, source }));
  if (workflows.length === 0 || workflows.length > MAX_WORKFLOWS) {
    fail("workflow inventory is missing or unbounded");
  }
  const enforcingWorkflows = workflows.flatMap(({ path, source }) => {
    if (!/\bpull_request_review\b/u.test(source)) return [];
    const policy = reachableReviewPolicy(path, indexed, config);
    return policy.runsValidator ? [{ path, ...policy }] : [];
  });
  const incompatibleWorkflows = enforcingWorkflows.filter(
    ({ acceptsWriter }) => !acceptsWriter,
  );
  const proofValid = validProofReview(value.proofReview, config);
  const policyMentionsWriter = value.policy.includes(config.writerMarker);
  const policyMentionsLegacy = value.policy.includes(config.legacyMarker);
  const validatorAcceptsWriter = value.validator.includes(config.writerMarker);
  const documentation = policyMentionsWriter
    ? "aligned"
    : policyMentionsLegacy
      ? "legacy-only-drift"
      : "undocumented";
  const enforcement =
    enforcingWorkflows.length === 0
      ? "not-wired-for-reviews"
      : incompatibleWorkflows.length === 0 && validatorAcceptsWriter
        ? "compatible"
        : "incompatible";
  const safeToPublish = proofValid && enforcement !== "incompatible";
  const status = safeToPublish
    ? documentation === "aligned"
      ? "supported"
      : "supported-with-documentation-drift"
    : proofValid
      ? "blocked"
      : "unknown";
  return {
    artifact: config.artifact,
    branchSha: value.branchSha,
    documentation,
    enforcement,
    enforcingWorkflows: enforcingWorkflows.map(({ path }) => path).sort(),
    forwardProof: {
      url: config.forwardProof.url,
      valid: proofValid,
    },
    repositoryId: config.repositoryId,
    safeToPublish,
    status,
    writerMarker: config.writerMarker,
  };
}

function gh(args) {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    maxBuffer: MAX_API_BYTES,
    timeout: 30_000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 || result.signal) {
    const detail = result.stderr.trim();
    throw new Error(`gh ${args[0]} failed${detail ? `: ${detail}` : ""}`);
  }
  return result.stdout;
}

function ghJson(endpoint) {
  try {
    return JSON.parse(gh(["api", "--method", "GET", endpoint]));
  } catch (error) {
    throw new Error(`GitHub returned invalid JSON for ${endpoint}`, {
      cause: error,
    });
  }
}

function ghText(endpoint) {
  return gh([
    "api",
    "--method",
    "GET",
    "-H",
    "Accept: application/vnd.github.raw+json",
    endpoint,
  ]);
}

function boundedDirectory(endpoint, field) {
  const entries = ghJson(endpoint);
  if (!Array.isArray(entries) || entries.length > MAX_DIRECTORY_ENTRIES) {
    fail(`${field} is missing or unbounded`);
  }
  return entries;
}

function validateContentFile(entry, path, field) {
  if (
    entry?.type !== "file" ||
    entry.path !== path ||
    !Number.isSafeInteger(entry.size) ||
    entry.size < 0 ||
    entry.size > MAX_WORKFLOW_BYTES
  ) {
    fail(`${field} is invalid`);
  }
}

export function readLiveReviewCompatibility(configuration = CONFIG) {
  const config = validateConfiguration(configuration);
  const ref = ghJson(
    `repos/${config.repositoryId}/git/ref/heads/${config.integrationBranch}`,
  );
  const branchSha = ref?.object?.sha;
  if (!SHA_RE.test(branchSha ?? "")) fail("integration branch has no full SHA");
  const atRef = (path) =>
    `repos/${config.repositoryId}/contents/${canonicalRepositoryPath(path, "GitHub content path")}?ref=${branchSha}`;
  const workflowEntries = boundedDirectory(
    atRef(".github/workflows"),
    "target repository workflow directory",
  ).filter(
    (entry) =>
      entry?.type === "file" &&
      typeof entry.path === "string" &&
      WORKFLOW_PATH_RE.test(entry.path),
  );
  if (
    workflowEntries.length === 0 ||
    workflowEntries.length > MAX_WORKFLOWS ||
    workflowEntries.some(
      (entry) =>
        !Number.isSafeInteger(entry.size) ||
        entry.size < 0 ||
        entry.size > MAX_WORKFLOW_BYTES,
    )
  ) {
    fail("target repository workflow inventory is missing or unbounded");
  }
  const automationFiles = workflowEntries.map((entry) => ({
    path: entry.path,
    source: ghText(atRef(entry.path)),
  }));
  const indexed = new Map(automationFiles.map((file) => [file.path, file]));
  const pending = automationFiles
    .filter(({ source }) => /\bpull_request_review\b/u.test(source))
    .flatMap(({ source }) => localUsesTargets(source));
  const visitedTargets = new Set();
  while (pending.length > 0) {
    const target = pending.pop();
    if (visitedTargets.has(target)) continue;
    visitedTargets.add(target);
    if (WORKFLOW_PATH_RE.test(target)) {
      const workflow = indexed.get(target);
      if (!workflow) {
        fail(`referenced workflow is missing from its directory: ${target}`);
      }
      pending.push(...localUsesTargets(workflow.source));
      continue;
    }
    const manifests = boundedDirectory(
      atRef(target),
      `local action directory ${target}`,
    ).filter(
      (entry) =>
        entry?.type === "file" &&
        typeof entry.path === "string" &&
        [`${target}/action.yml`, `${target}/action.yaml`].includes(entry.path),
    );
    if (manifests.length !== 1) {
      fail(`local action manifest is missing or ambiguous: ${target}`);
    }
    const [manifest] = manifests;
    validateContentFile(
      manifest,
      manifest.path,
      `local action manifest ${manifest.path}`,
    );
    if (!indexed.has(manifest.path)) {
      const file = {
        path: manifest.path,
        source: ghText(atRef(manifest.path)),
      };
      indexed.set(file.path, file);
      automationFiles.push(file);
      if (automationFiles.length > MAX_AUTOMATION_FILES) {
        fail("automation inventory is missing or unbounded");
      }
      pending.push(...localUsesTargets(file.source));
    }
  }
  return assessReviewCompatibility(
    {
      automationFiles,
      branchSha,
      policy: ghText(atRef(config.policyDocument)),
      proofReview: ghJson(
        `repos/${config.repositoryId}/pulls/${config.forwardProof.pullRequest}/reviews/${config.forwardProof.reviewId}`,
      ),
      validator: ghText(atRef(config.validatorPath)),
    },
    config,
  );
}

function render(result) {
  const workflowDetail =
    result.enforcingWorkflows.length === 0
      ? "none"
      : result.enforcingWorkflows.join(", ");
  return [
    `Slop review compatibility: ${result.status}`,
    `Writer: ${result.writerMarker}`,
    `Target: ${result.repositoryId}@${result.branchSha}`,
    `Documentation: ${result.documentation}`,
    `Review enforcement: ${result.enforcement} (${workflowDetail})`,
    `Forward proof: ${result.forwardProof.valid ? "valid" : "invalid"} ${result.forwardProof.url}`,
    result.safeToPublish
      ? "The exact review path is supported. Do not infer a blocker from documentation drift alone."
      : "Stop before publishing: the exact review path is blocked or no longer proven.",
  ].join("\n");
}

function main(args = process.argv.slice(2)) {
  if (args.some((argument) => argument !== "--json") || args.length > 1) {
    fail("Usage: node scripts/review-preflight.mjs [--json]");
  }
  const result = readLiveReviewCompatibility();
  process.stdout.write(
    args[0] === "--json"
      ? `${JSON.stringify(result, null, 2)}\n`
      : `${render(result)}\n`,
  );
  if (!result.safeToPublish) process.exitCode = 1;
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
    // error-policy:J1 CLI boundary returns an explicit failed preflight.
    process.stderr.write(
      `Slop review compatibility refused: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    process.exitCode = 1;
  }
}
