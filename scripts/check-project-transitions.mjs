/**
 * Validates project policy and new proposal funding against an immutable Git base.
 * Schema validation alone cannot protect append-only policy history because a
 * well-shaped manifest may still rewrite or delete an earlier binding.
 */

import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertProjectPolicyTransition } from "../src/lib/project-policy.mjs";
import {
  assertHistoricalProjectDefinition,
  assertProjectDefinition,
} from "../src/lib/project-schema.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROJECTS = resolve(ROOT, "projects");
const REVISION = /^[0-9a-f]{40}$/u;
const PROJECT_PATH =
  /^projects\/([a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?)\/project\.json$/u;
const MAX_PROJECTS = 100;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_PROPOSAL_FILES = 24_000;
const MAX_PROPOSAL_INVENTORY_BYTES = 256 * 1024 * 1024;
const PROPOSAL_PATH =
  /^cycles\/([a-z0-9-]+)\/(\d{4}-(?:0[1-9]|1[0-2]))\/proposal\.json$/u;

function fundingBasis(reward) {
  return {
    fundingState: reward.fundingState,
    committedMinor: reward.committedMinor,
    monthlyCapMinor: reward.monthlyCapMinor,
  };
}

function sameFundingBasis(left, right) {
  return (
    left &&
    right &&
    Object.keys(left).length === 3 &&
    Object.keys(right).length === 3 &&
    left.fundingState === right.fundingState &&
    left.committedMinor === right.committedMinor &&
    left.monthlyCapMinor === right.monthlyCapMinor
  );
}

/** Runs from the immutable base commit; proposal fields never authorize funds. */
export function validateProposalFundingTransitions(
  previousProjects,
  currentProjects,
  previousProposals,
  currentProposals,
) {
  const previous = boundedProjectMap(previousProjects, { historical: true });
  const current = boundedProjectMap(currentProjects);
  const priorFiles = new Map(previousProposals);
  const nextPaths = new Set(currentProposals.map(([path]) => path));
  for (const path of priorFiles.keys()) {
    if (!nextPaths.has(path))
      throw new TypeError("historical cycle proposals cannot be deleted");
  }
  if (
    currentProposals.length > MAX_PROPOSAL_FILES ||
    priorFiles.size > MAX_PROPOSAL_FILES
  )
    throw new TypeError("cycle proposal inventory exceeds its bound");
  let proposalBytes = 0;
  for (const [, bytes] of [...previousProposals, ...currentProposals]) {
    const size = Buffer.byteLength(bytes);
    proposalBytes += size;
    if (
      size > MAX_MANIFEST_BYTES ||
      proposalBytes > MAX_PROPOSAL_INVENTORY_BYTES
    )
      throw new TypeError("cycle proposal inventory exceeds its byte bound");
  }
  for (const [path, bytes] of currentProposals) {
    const match = path.match(PROPOSAL_PATH);
    if (!match || Buffer.byteLength(bytes) > MAX_MANIFEST_BYTES)
      throw new TypeError("invalid cycle proposal path or size");
    const proposal = JSON.parse(bytes);
    if (
      previous.get(match[1])?.reward.kind === "monthly-pool" &&
      proposal.kind !== "reward-allocation"
    )
      throw new TypeError("monthly proposal must retain its allocation kind");
    if (proposal.kind !== "reward-allocation") continue;
    if (priorFiles.has(path)) {
      const prior = JSON.parse(priorFiles.get(path));
      if (
        JSON.stringify(prior.fundingBasis) !==
        JSON.stringify(proposal.fundingBasis)
      )
        throw new TypeError("historical proposal funding basis cannot change");
      continue;
    }
    const prior = previous.get(match[1]);
    const next = current.get(match[1]);
    if (
      !prior ||
      !next ||
      prior.reward.kind !== "monthly-pool" ||
      proposal.projectId !== match[1] ||
      proposal.cycleId !== match[2]
    )
      throw new TypeError(
        "new proposal needs an existing reviewed monthly-pool project",
      );
    if (
      !sameFundingBasis(fundingBasis(prior.reward), fundingBasis(next.reward))
    )
      throw new TypeError(
        "funding policy and a new proposal must land in separate reviewed changes",
      );
    if (!sameFundingBasis(proposal.fundingBasis, fundingBasis(prior.reward)))
      throw new TypeError(
        "new proposal funding basis differs from the immutable base project policy",
      );
  }
}

function parseManifest(bytes, path, { historical = false } = {}) {
  if (Buffer.byteLength(bytes) > MAX_MANIFEST_BYTES) {
    throw new TypeError(`${path} exceeds the manifest byte limit`);
  }
  let value;
  try {
    value = JSON.parse(bytes);
  } catch (error) {
    throw new TypeError(`${path} is invalid JSON`, { cause: error });
  }
  return historical
    ? assertHistoricalProjectDefinition(value)
    : assertProjectDefinition(value);
}

function boundedProjectMap(entries, options) {
  if (entries.length > MAX_PROJECTS) {
    throw new TypeError(`project inventory exceeds ${MAX_PROJECTS} entries`);
  }
  const projects = new Map();
  for (const [path, bytes] of entries) {
    const match = path.match(PROJECT_PATH);
    if (!match) throw new TypeError(`project path is not canonical: ${path}`);
    const project = parseManifest(bytes, path, options);
    if (project.id !== match[1] || projects.has(project.id)) {
      throw new TypeError(
        `project identity is duplicated or misplaced: ${path}`,
      );
    }
    projects.set(project.id, project);
  }
  return projects;
}

function assertRootPublisherInventory(projects, label) {
  const declared = [...projects.values()].filter((project) =>
    Object.hasOwn(project.skill, "publishAtRoot"),
  );
  if (declared.length === 0) return false;
  if (declared.length !== projects.size) {
    throw new TypeError(
      `${label} project inventory must migrate publishAtRoot atomically`,
    );
  }
  if (
    declared.filter((project) => project.skill.publishAtRoot === true)
      .length !== 1
  ) {
    throw new TypeError(
      `${label} project inventory must declare exactly one root publisher`,
    );
  }
  return true;
}

function assertReviewBudgetTransition(prior, next, now) {
  const priorBudget = prior.reward.reviewBudget;
  const nextBudget = next.reward.reviewBudget;
  if (!nextBudget) return;

  const addsReviewBudget = !priorBudget;
  const fundsReviewBudget =
    priorBudget?.fundingState !== "committed" &&
    nextBudget.fundingState === "committed";
  if (
    (addsReviewBudget || fundsReviewBudget) &&
    BigInt(next.reward.monthlyCapMinor) < BigInt(prior.reward.monthlyCapMinor)
  ) {
    throw new TypeError(
      `project ${next.id} cannot add or fund a review budget while reducing the contributor pool cap`,
    );
  }
  if (addsReviewBudget || fundsReviewBudget) {
    const instant = new Date(now);
    const nextCycle = Date.UTC(
      instant.getUTCFullYear(),
      instant.getUTCMonth() + 1,
      1,
    );
    if (Date.parse(nextBudget.effectiveAt) < nextCycle) {
      throw new TypeError(
        `project ${next.id} review budget cannot affect an open or past cycle`,
      );
    }
  }
}

export function validateProjectTransitions(
  previousEntries,
  currentEntries,
  now = Date.now(),
) {
  const previous = boundedProjectMap(previousEntries, { historical: true });
  const current = boundedProjectMap(currentEntries);
  const previousPublishesAtRoot = assertRootPublisherInventory(
    previous,
    "previous",
  );
  const currentPublishesAtRoot = assertRootPublisherInventory(
    current,
    "current",
  );
  for (const [projectId, prior] of previous) {
    const next = current.get(projectId);
    if (!next) {
      throw new TypeError(
        `project ${projectId} cannot be deleted; pause it and preserve its policy history`,
      );
    }
    assertProjectPolicyTransition(prior, next);
    assertReviewBudgetTransition(prior, next, now);
  }
  if (previousPublishesAtRoot && !currentPublishesAtRoot) {
    throw new TypeError(
      "current project inventory cannot remove publishAtRoot declarations",
    );
  }
  return { previous: previous.size, current: current.size };
}

function git(args) {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function revisionEntries(revision, label = "revision") {
  if (!REVISION.test(revision)) throw new TypeError(`${label} is invalid`);
  git(["cat-file", "-e", `${revision}^{commit}`]);
  const paths = git([
    "ls-tree",
    "-r",
    "--name-only",
    revision,
    "--",
    "projects",
  ])
    .split("\n")
    .filter((path) => PROJECT_PATH.test(path));
  return paths.map((path) => [path, git(["show", `${revision}:${path}`])]);
}

async function workingEntries() {
  const directories = (await readdir(PROJECTS, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  return Promise.all(
    directories.map(async (directory) => {
      const path = `projects/${directory}/project.json`;
      return [path, await readFile(resolve(ROOT, path), "utf8")];
    }),
  );
}

export async function checkProjectTransitions(baseRevision, currentRevision) {
  const previous = revisionEntries(baseRevision, "base revision");
  const current =
    currentRevision === undefined
      ? await workingEntries()
      : revisionEntries(currentRevision, "current revision");
  const result = validateProjectTransitions(previous, current);
  const proposalPaths = (revision) =>
    git(
      revision
        ? ["ls-tree", "-r", "--name-only", revision, "--", "cycles"]
        : [
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "--",
            "cycles",
          ],
    )
      .split("\n")
      .filter((path) => PROPOSAL_PATH.test(path));
  let aggregateBytes = 0;
  const readProposals = async (revision) => {
    const paths = proposalPaths(revision);
    if (paths.length > MAX_PROPOSAL_FILES)
      throw new TypeError("cycle proposal inventory exceeds its bound");
    const entries = [];
    for (const path of paths) {
      const bytes = revision
        ? git(["show", `${revision}:${path}`])
        : await readFile(resolve(ROOT, path), "utf8");
      const size = Buffer.byteLength(bytes);
      aggregateBytes += size;
      if (
        size > MAX_MANIFEST_BYTES ||
        aggregateBytes > MAX_PROPOSAL_INVENTORY_BYTES
      )
        throw new TypeError("cycle proposal inventory exceeds its byte bound");
      entries.push([path, bytes]);
    }
    return entries;
  };
  const priorProposals = await readProposals(baseRevision);
  const nextProposals = await readProposals(currentRevision);
  validateProposalFundingTransitions(
    previous,
    current,
    priorProposals,
    nextProposals,
  );
  return result;
}

if (import.meta.main) {
  try {
    if (process.argv.length < 3 || process.argv.length > 4) {
      throw new TypeError(
        "Usage: check-project-transitions.mjs <base-sha> [current-sha]",
      );
    }
    const result = await checkProjectTransitions(
      process.argv[2],
      process.argv[3],
    );
    process.stdout.write(
      `[Slop] validated ${result.previous} existing project policy transitions across ${result.current} current projects\n`,
    );
  } catch (error) {
    process.stderr.write(
      `[Slop] project transition refused: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    process.exitCode = 1;
  }
}
