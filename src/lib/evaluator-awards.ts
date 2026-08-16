/**
 * Validates the maintainer-approved bridge between an evaluator finding and a
 * capped public score event. Raw model output never reaches the ledger: only a
 * reviewed JSON manifest merged into this repository can create an award.
 */

import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import type { GitHubActor, ScoreEvent } from "./leaderboard";
import { findProject } from "./projects.mjs";

export const EVALUATOR_AWARD_SCHEMA_VERSION = "1" as const;
export const MAX_EVALUATOR_AWARD_FILES = 256;
export const MAX_EVALUATOR_AWARD_FILE_BYTES = 64 * 1024;

interface EvaluatorAwardReview {
  decisionUrl: string;
  reviewedAt: string;
  reviewer: string;
}

export interface EvaluatorAwardManifest {
  schemaVersion: typeof EVALUATOR_AWARD_SCHEMA_VERSION;
  kind: "evaluated-contribution";
  id: string;
  projectId: string;
  repository: string;
  actor: GitHubActor;
  occurredAt: string;
  points: number;
  source: ScoreEvent["source"];
  reason: string;
  review: EvaluatorAwardReview;
}

export interface EvaluatorAwardEvent extends ScoreEvent {
  category: "evaluated-contribution";
  evaluation: EvaluatorAwardReview & {
    manifestPath: string;
    manifestSha256: string;
  };
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  field: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.join("\0") !== wanted.join("\0")) {
    throw new TypeError(`${field} has unexpected or missing fields`);
  }
}

function text(
  value: unknown,
  field: string,
  options: { max: number; min?: number; pattern?: RegExp },
): string {
  if (
    typeof value !== "string" ||
    value.length < (options.min ?? 1) ||
    value.length > options.max ||
    options.pattern?.test(value) === false
  ) {
    throw new TypeError(`${field} is invalid`);
  }
  return value;
}

function iso(value: unknown, field: string): string {
  const result = text(value, field, {
    max: 24,
    pattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u,
  });
  if (!Number.isFinite(Date.parse(result))) {
    throw new TypeError(`${field} is not a UTC timestamp`);
  }
  return result;
}

function githubUrl(
  value: unknown,
  field: string,
  expectedPath: string,
  expectedHash?: RegExp,
): string {
  const result = text(value, field, { max: 512 });
  let parsed: URL;
  try {
    parsed = new URL(result);
  } catch (error) {
    throw new TypeError(`${field} is not a URL`, { cause: error });
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "github.com" ||
    parsed.pathname.toLowerCase() !== expectedPath.toLowerCase() ||
    parsed.search ||
    (expectedHash ? !expectedHash.test(parsed.hash) : parsed.hash !== "") ||
    parsed.username ||
    parsed.password ||
    parsed.port
  ) {
    throw new TypeError(`${field} is not the expected canonical GitHub URL`);
  }
  return result;
}

function actor(value: unknown, field: string): GitHubActor {
  const candidate = record(value, field);
  exactKeys(candidate, ["avatarUrl", "id", "kind", "login", "url"], field);
  const login = text(candidate.login, `${field}.login`, {
    max: 39,
    pattern: /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u,
  });
  const id = text(candidate.id, `${field}.id`, { max: 128 });
  if (candidate.kind !== "User") {
    throw new TypeError(`${field}.kind must be User`);
  }
  const avatarUrl = text(candidate.avatarUrl, `${field}.avatarUrl`, {
    max: 512,
  });
  let avatar: URL;
  try {
    avatar = new URL(avatarUrl);
  } catch (error) {
    throw new TypeError(`${field}.avatarUrl is not a URL`, { cause: error });
  }
  if (
    avatar.protocol !== "https:" ||
    avatar.hostname !== "avatars.githubusercontent.com" ||
    avatar.username ||
    avatar.password ||
    avatar.port
  ) {
    throw new TypeError(`${field}.avatarUrl must use GitHub's avatar origin`);
  }
  return {
    id,
    login,
    avatarUrl,
    url: githubUrl(candidate.url, `${field}.url`, `/${login}`),
    kind: "User",
  };
}

function review(value: unknown, field: string): EvaluatorAwardReview {
  const candidate = record(value, field);
  exactKeys(candidate, ["decisionUrl", "reviewedAt", "reviewer"], field);
  const reviewer = text(candidate.reviewer, `${field}.reviewer`, {
    max: 39,
    pattern: /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u,
  });
  const decisionUrl = text(candidate.decisionUrl, `${field}.decisionUrl`, {
    max: 512,
  });
  let parsed: URL;
  try {
    parsed = new URL(decisionUrl);
  } catch (error) {
    throw new TypeError(`${field}.decisionUrl is not a URL`, { cause: error });
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "github.com" ||
    !/^\/elizaOS\/(?:slopdotcash|army)\/pull\/[1-9]\d*$/iu.test(
      parsed.pathname,
    ) ||
    parsed.search ||
    parsed.hash
  ) {
    throw new TypeError(
      `${field}.decisionUrl must be an elizaOS/slopdotcash pull request`,
    );
  }
  return {
    decisionUrl,
    reviewedAt: iso(candidate.reviewedAt, `${field}.reviewedAt`),
    reviewer,
  };
}

/** Strictly validates one checked-in award manifest. */
export function assertEvaluatorAwardManifest(
  value: unknown,
): EvaluatorAwardManifest {
  const manifest = record(value, "evaluator award");
  exactKeys(
    manifest,
    [
      "actor",
      "id",
      "kind",
      "occurredAt",
      "points",
      "projectId",
      "reason",
      "repository",
      "review",
      "schemaVersion",
      "source",
    ],
    "evaluator award",
  );
  if (
    manifest.schemaVersion !== EVALUATOR_AWARD_SCHEMA_VERSION ||
    manifest.kind !== "evaluated-contribution"
  ) {
    throw new TypeError("evaluator award protocol header is invalid");
  }
  const projectId = text(manifest.projectId, "evaluator award.projectId", {
    max: 48,
    pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/u,
  });
  const project = findProject(projectId);
  if (!project)
    throw new TypeError(`Unknown evaluator-award project: ${projectId}`);
  const repository = text(manifest.repository, "evaluator award.repository", {
    max: 200,
  });
  const registeredRepository = project.repositories.find(
    (candidate) => candidate.id.toLowerCase() === repository.toLowerCase(),
  );
  if (!registeredRepository || registeredRepository.id !== repository) {
    throw new TypeError(
      "evaluator award repository is not canonical for its project",
    );
  }
  const source = record(manifest.source, "evaluator award.source");
  exactKeys(
    source,
    ["id", "kind", "number", "title", "url"],
    "evaluator award.source",
  );
  if (!["issue", "pull-request", "review"].includes(String(source.kind))) {
    throw new TypeError("evaluator award.source.kind is invalid");
  }
  if (!Number.isSafeInteger(source.number) || Number(source.number) <= 0) {
    throw new TypeError("evaluator award.source.number must be positive");
  }
  const number = Number(source.number);
  const sourceKind = source.kind as ScoreEvent["source"]["kind"];
  const pathKind = sourceKind === "issue" ? "issues" : "pull";
  const normalizedRepository = repository.split("/");
  const sourceUrl = githubUrl(
    source.url,
    "evaluator award.source.url",
    `/${normalizedRepository[0]}/${normalizedRepository[1]}/${pathKind}/${number}`,
    sourceKind === "review"
      ? /^#(?:pullrequestreview-|discussion_r)\d+$/iu
      : undefined,
  );
  const occurredAt = iso(manifest.occurredAt, "evaluator award.occurredAt");
  const approval = review(manifest.review, "evaluator award.review");
  if (Date.parse(approval.reviewedAt) < Date.parse(occurredAt)) {
    throw new RangeError(
      "evaluator award review cannot precede the contribution",
    );
  }
  if (
    !Number.isSafeInteger(manifest.points) ||
    Number(manifest.points) < 1 ||
    Number(manifest.points) > 8
  ) {
    throw new TypeError(
      "evaluator award.points must be an integer from 1 to 8",
    );
  }
  return {
    schemaVersion: EVALUATOR_AWARD_SCHEMA_VERSION,
    kind: "evaluated-contribution",
    id: text(manifest.id, "evaluator award.id", {
      max: 128,
      pattern: /^award_[a-z0-9][a-z0-9_-]*$/u,
    }),
    projectId,
    repository,
    actor: actor(manifest.actor, "evaluator award.actor"),
    occurredAt,
    points: Number(manifest.points),
    source: {
      id: text(source.id, "evaluator award.source.id", { max: 128 }),
      kind: sourceKind,
      number,
      title: text(source.title, "evaluator award.source.title", { max: 512 }),
      url: sourceUrl,
    },
    reason: text(manifest.reason, "evaluator award.reason", {
      min: 40,
      max: 1_000,
    }),
    review: approval,
  };
}

/** Loads every bounded award file and rejects duplicate ids or source credit. */
export function loadEvaluatorAwardEvents(
  root = resolve(process.cwd(), "evaluations"),
): EvaluatorAwardEvent[] {
  const rootStats = lstatSync(root, { throwIfNoEntry: false });
  if (!rootStats) return [];
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new TypeError("evaluations root must be a real directory");
  }
  const paths: string[] = [];
  for (const projectEntry of readdirSync(root, { withFileTypes: true })) {
    if (projectEntry.name === "README.md") continue;
    if (!projectEntry.isDirectory() || projectEntry.isSymbolicLink()) {
      throw new TypeError(
        `evaluations/${projectEntry.name} must be a project directory`,
      );
    }
    for (const entry of readdirSync(join(root, projectEntry.name), {
      withFileTypes: true,
    })) {
      if (
        !entry.isFile() ||
        entry.isSymbolicLink() ||
        !/^award-[a-z0-9][a-z0-9-]*\.json$/u.test(entry.name)
      ) {
        throw new TypeError(
          `evaluations/${projectEntry.name}/${entry.name} is not a canonical award file`,
        );
      }
      paths.push(join(root, projectEntry.name, entry.name));
    }
  }
  paths.sort();
  if (paths.length > MAX_EVALUATOR_AWARD_FILES) {
    throw new RangeError("evaluator award file limit exceeded");
  }
  const ids = new Set<string>();
  const sources = new Set<string>();
  return paths.map((path) => {
    const stats = lstatSync(path);
    if (stats.size <= 0 || stats.size > MAX_EVALUATOR_AWARD_FILE_BYTES) {
      throw new RangeError(`${relative(root, path)} has invalid size`);
    }
    const bytes = readFileSync(path);
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString("utf8"));
    } catch (error) {
      throw new TypeError(`${relative(root, path)} is not valid JSON`, {
        cause: error,
      });
    }
    const manifest = assertEvaluatorAwardManifest(parsed);
    if (
      basename(resolve(path)) !== basename(path) ||
      !resolve(path).startsWith(`${resolve(root)}${sep}`)
    ) {
      throw new TypeError("evaluator award path escaped its root");
    }
    const pathProject = relative(root, path).split(sep)[0];
    if (pathProject !== manifest.projectId) {
      throw new TypeError(`${relative(root, path)} does not match projectId`);
    }
    const sourceKey = `${manifest.repository}\0${manifest.source.id}`;
    if (ids.has(manifest.id) || sources.has(sourceKey)) {
      throw new TypeError("evaluator award ids and sources must be unique");
    }
    ids.add(manifest.id);
    sources.add(sourceKey);
    return {
      id: manifest.id,
      actor: manifest.actor,
      category: "evaluated-contribution",
      points: manifest.points,
      occurredAt: manifest.occurredAt,
      repository: manifest.repository,
      source: manifest.source,
      reason: manifest.reason,
      evaluation: {
        ...manifest.review,
        manifestPath: relative(process.cwd(), path).replaceAll(sep, "/"),
        manifestSha256: createHash("sha256").update(bytes).digest("hex"),
      },
    };
  });
}
