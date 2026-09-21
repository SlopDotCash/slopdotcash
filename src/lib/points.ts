/** Nonfinancial points. This module never supplies reward or settlement inputs. */
import type {
  GitHubActor,
  LeaderboardSnapshot,
  ScoreEvent,
} from "./leaderboard";
import { findProject, findProjectByRepositoryId } from "./projects.mjs";
import { sha256Hex } from "./sha256";

export const POINTS_RULE = "slop-points-v1";
export const WELCOME_POINTS = 5;
export const POINTS_NOTICE =
  "Points have no monetary value and cannot be transferred or redeemed. Project payments follow separate published rules.";
export interface PointAward {
  key: string;
  actor: Pick<GitHubActor, "id" | "login">;
  projectId: string;
  category: ScoreEvent["category"];
  amount: number;
  occurredAt: string;
  sourceId: string;
  sourceUrl: string;
  workUnitId: string;
  provisional: boolean;
}
export interface PointRevision {
  id: string;
  previous: string | null;
  recordedAt: string;
  sourceDigest: string;
  sourceRule: string;
  award: PointAward;
}
export interface PointsJournal {
  schemaVersion: "1";
  ruleVersion: typeof POINTS_RULE;
  generatedAt: string;
  coverage: { repository: string; from: string; to: string; digest: string }[];
  revisions: PointRevision[];
}
export interface PointsMember {
  actor: PointAward["actor"];
  total: number;
  monthly: number;
  firstContributionAt: string;
  projects: number;
  badges: string[];
  awards: PointAward[];
}
const digestPattern = /^[a-f0-9]{64}$/;
const categories = new Set([
  "merged-pull-request",
  "resolved-issue",
  "material-test-change",
  "evidence",
  "substantive-review",
  "evaluated-contribution",
]);
function iso(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
function exact(value: object, keys: string[]) {
  if (Object.keys(value).sort().join() !== keys.sort().join())
    throw new Error("Unexpected points fields");
}
export function pointRevisionId(revision: Omit<PointRevision, "id">): string {
  return sha256Hex(JSON.stringify(revision));
}
export function assertPointsJournal(
  value: unknown,
): asserts value is PointsJournal {
  if (!value || typeof value !== "object")
    throw new Error("Invalid points journal");
  const p = value as PointsJournal;
  exact(p, [
    "schemaVersion",
    "ruleVersion",
    "generatedAt",
    "coverage",
    "revisions",
  ]);
  if (
    p.schemaVersion !== "1" ||
    p.ruleVersion !== POINTS_RULE ||
    !iso(p.generatedAt) ||
    !Array.isArray(p.revisions) ||
    p.revisions.length > 250000 ||
    !Array.isArray(p.coverage)
  )
    throw new Error("Invalid points journal header");
  const latest = new Map<string, PointRevision>();
  const ids = new Set<string>();
  for (const r of p.revisions) {
    exact(r, [
      "id",
      "previous",
      "recordedAt",
      "sourceDigest",
      "sourceRule",
      "award",
    ]);
    const a = r.award;
    exact(a, [
      "key",
      "actor",
      "projectId",
      "category",
      "amount",
      "occurredAt",
      "sourceId",
      "sourceUrl",
      "workUnitId",
      "provisional",
    ]);
    exact(a.actor, ["id", "login"]);
    if (
      !/^[A-Za-z0-9_=-]{4,256}$/.test(a.actor.id) ||
      !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(a.actor.login) ||
      !findProject(a.projectId) ||
      !categories.has(a.category) ||
      !Number.isSafeInteger(a.amount) ||
      a.amount < 0 ||
      !iso(a.occurredAt) ||
      !iso(r.recordedAt) ||
      r.recordedAt > p.generatedAt ||
      !digestPattern.test(r.sourceDigest) ||
      !["slop-score-v1", "slop-score-v2", "github-merged-history-v1"].includes(
        r.sourceRule,
      ) ||
      typeof a.provisional !== "boolean" ||
      typeof a.sourceId !== "string" ||
      a.sourceId.length > 256 ||
      typeof a.workUnitId !== "string" ||
      a.workUnitId.length > 300
    )
      throw new Error("Invalid point award");
    const url = new URL(a.sourceUrl);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      a.sourceUrl.length > 2048
    )
      throw new Error("Invalid point source");
    if (a.key !== pointKey(a.projectId, a.actor.id, a.category, a.sourceId))
      throw new Error("Point source key mismatch");
    const { id, ...body } = r;
    if (
      id !== pointRevisionId(body) ||
      ids.has(id) ||
      r.previous !== (latest.get(a.key)?.id ?? null)
    )
      throw new Error("Broken points revision chain");
    const prior = latest.get(a.key);
    if (
      prior &&
      (prior.award.occurredAt !== a.occurredAt ||
        r.recordedAt < prior.recordedAt)
    )
      throw new Error("Point history moved");
    latest.set(a.key, r);
    ids.add(id);
  }
  for (const c of p.coverage) {
    exact(c, ["repository", "from", "to", "digest"]);
    if (
      !findProjectByRepositoryId(c.repository) ||
      !iso(c.from) ||
      !iso(c.to) ||
      c.from >= c.to ||
      !digestPattern.test(c.digest)
    )
      throw new Error("Invalid points coverage");
  }
}
export function pointKey(
  project: string,
  actor: string,
  category: string,
  source: string,
): string {
  return sha256Hex(JSON.stringify([project, actor, category, source]));
}
export function pointsForScore(
  event: Pick<ScoreEvent, "scoreThirds" | "points">,
): number {
  const amount =
    event.scoreThirds === undefined
      ? event.points * 30
      : event.scoreThirds * 10;
  if (!Number.isSafeInteger(amount) || amount <= 0)
    throw new Error("Score cannot be converted to exact points");
  return amount;
}
export function awardForScore(event: ScoreEvent): PointAward {
  const project = findProjectByRepositoryId(event.repository);
  if (!project || event.actor.kind !== "User")
    throw new Error("Points require a registered project and user");
  return {
    key: pointKey(
      project.id,
      event.actor.id,
      event.category,
      event.category === "evidence" ? event.id : event.source.id,
    ),
    actor: { id: event.actor.id, login: event.actor.login },
    projectId: project.id,
    category: event.category,
    amount: pointsForScore(event),
    occurredAt: new Date(event.occurredAt).toISOString(),
    sourceId: event.category === "evidence" ? event.id : event.source.id,
    sourceUrl: event.source.url,
    workUnitId: event.workUnitId ?? event.id,
    provisional:
      event.category === "merged-pull-request" &&
      event.scoreThirds === 1 &&
      !event.scoreDecisionSourceId,
  };
}
export function latestPoints(
  journal: PointsJournal,
): Map<string, PointRevision> {
  return new Map(journal.revisions.map((r) => [r.award.key, r]));
}
export function appendPointAwards(
  journal: PointsJournal,
  awards: PointAward[],
  sourceDigest: string,
  sourceRule: string,
  recordedAt: string,
): PointsJournal {
  assertPointsJournal(journal);
  const output = {
    ...journal,
    generatedAt: recordedAt,
    revisions: [...journal.revisions],
  };
  const latest = latestPoints(journal);
  for (const award of [...awards].sort((a, b) => a.key.localeCompare(b.key))) {
    const previous = latest.get(award.key);
    if (previous && JSON.stringify(previous.award) === JSON.stringify(award))
      continue;
    const revision = {
      previous: previous?.id ?? null,
      recordedAt,
      sourceDigest,
      sourceRule,
      award,
    };
    const next = { id: pointRevisionId(revision), ...revision };
    output.revisions.push(next);
    latest.set(award.key, next);
  }
  assertPointsJournal(output);
  return output;
}
export function applyPointsSnapshot(
  journal: PointsJournal,
  snapshot: LeaderboardSnapshot,
  digest: string,
  recordedAt: string,
): PointsJournal {
  const awards = snapshot.ledger
    .filter((e) => e.actor.kind === "User")
    .map(awardForScore);
  const keys = new Set(awards.map((a) => a.key));
  const repositoryIds = new Set(snapshot.repositories.map((r) => r.id));
  // A complete newer census can correct a formerly accepted source. Never infer
  // deletion from missing pages or a shortened rolling window.
  for (const previous of latestPoints(journal).values()) {
    const a = previous.award;
    const project = findProject(a.projectId);
    if (
      a.amount &&
      !keys.has(a.key) &&
      a.occurredAt >= snapshot.window.from &&
      a.occurredAt < snapshot.window.to &&
      project?.repositories.every((r) => repositoryIds.has(r.id))
    )
      awards.push({ ...a, amount: 0 });
  }
  const result = appendPointAwards(
    journal,
    awards,
    digest,
    snapshot.ruleVersion,
    recordedAt,
  );
  const existing = new Set(
    result.coverage.map((c) => `${c.repository}:${c.digest}`),
  );
  result.coverage = [
    ...result.coverage,
    ...snapshot.repositories
      .filter((r) => !existing.has(`${r.id}:${digest}`))
      .map((r) => ({
        repository: r.id,
        from: snapshot.window.from,
        to: snapshot.window.to,
        digest,
      })),
  ];
  return result;
}
export function pointMembers(
  journal: PointsJournal,
  month = journal.generatedAt.slice(0, 7),
  projectId?: string,
): PointsMember[] {
  const groups = new Map<string, PointAward>();
  const awards = [...latestPoints(journal).values()].map((r) => r.award);
  const evaluatedReviews = new Set(
    awards
      .filter(
        (a) =>
          a.amount > 0 &&
          a.category === "evaluated-contribution" &&
          a.sourceUrl.includes("#pullrequestreview-"),
      )
      .map((a) => `${a.actor.id}:${a.sourceUrl.split("#")[0]}`),
  );
  for (const a of awards) {
    if (
      a.category === "substantive-review" &&
      evaluatedReviews.has(`${a.actor.id}:${a.sourceUrl.split("#")[0]}`)
    )
      continue;
    if (!a.amount || (projectId && a.projectId !== projectId)) continue;
    const key = JSON.stringify([
      a.projectId,
      a.actor.id,
      a.category,
      a.occurredAt.slice(0, 7),
      a.category === "substantive-review"
        ? a.sourceUrl.split("#")[0]
        : a.workUnitId,
    ]);
    const prior = groups.get(key);
    if (
      !prior ||
      a.amount > prior.amount ||
      (a.amount === prior.amount && a.sourceId < prior.sourceId)
    )
      groups.set(key, a);
  }
  const members = new Map<string, PointsMember>();
  for (const a of groups.values()) {
    const m = members.get(a.actor.id) ?? {
      actor: a.actor,
      total: 0,
      monthly: 0,
      firstContributionAt: a.occurredAt,
      projects: 0,
      badges: [],
      awards: [],
    };
    m.total += a.amount;
    if (a.occurredAt.startsWith(month)) m.monthly += a.amount;
    if (!Number.isSafeInteger(m.total))
      throw new Error("Points total overflow");
    if (a.occurredAt < m.firstContributionAt)
      m.firstContributionAt = a.occurredAt;
    m.awards.push(a);
    members.set(a.actor.id, m);
  }
  for (const m of members.values()) {
    m.awards.sort(
      (a, b) =>
        b.occurredAt.localeCompare(a.occurredAt) || a.key.localeCompare(b.key),
    );
    m.projects = new Set(m.awards.map((a) => a.projectId)).size;
    m.badges = [
      "First accepted contribution",
      ...(m.awards.some((a) => a.category === "substantive-review")
        ? ["First qualifying review"]
        : []),
      ...(m.projects >= 3 ? ["Contributions in 3 projects"] : []),
    ];
  }
  return [...members.values()].sort(
    (a, b) => b.total - a.total || a.actor.id.localeCompare(b.actor.id),
  );
}
export function emptyPointsJournal(at: string): PointsJournal {
  return {
    schemaVersion: "1",
    ruleVersion: POINTS_RULE,
    generatedAt: at,
    coverage: [],
    revisions: [],
  };
}

export interface PointsIndex {
  schemaVersion: "1";
  ruleVersion: typeof POINTS_RULE;
  generatedAt: string;
  coverage: PointsJournal["coverage"];
  revisionCount: number;
  shards: { path: string; sha256: string; count: number }[];
}
export function assemblePoints(
  index: PointsIndex,
  parts: string[],
): PointsJournal {
  exact(index, [
    "schemaVersion",
    "ruleVersion",
    "generatedAt",
    "coverage",
    "revisionCount",
    "shards",
  ]);
  if (
    index.schemaVersion !== "1" ||
    index.ruleVersion !== POINTS_RULE ||
    !iso(index.generatedAt) ||
    !Array.isArray(index.shards) ||
    index.shards.length !== 16 ||
    parts.length !== 16 ||
    !Number.isSafeInteger(index.revisionCount) ||
    index.revisionCount < 0 ||
    index.revisionCount > 250000
  )
    throw new Error("Invalid points index");
  const records: { sequence: number; revision: PointRevision }[] = [];
  for (let i = 0; i < 16; i++) {
    const shard = index.shards[i];
    exact(shard, ["path", "sha256", "count"]);
    if (
      shard.path !== `/data/points/${i.toString(16)}.json` ||
      sha256Hex(parts[i]) !== shard.sha256
    )
      throw new Error("Points shard checksum mismatch");
    const rows = JSON.parse(parts[i]);
    if (!Array.isArray(rows) || rows.length !== shard.count)
      throw new Error("Incomplete points shard");
    for (const row of rows) {
      exact(row, ["sequence", "revision"]);
      if (!Number.isSafeInteger(row.sequence) || row.sequence < 0)
        throw new Error("Invalid points sequence");
      records.push(row);
    }
  }
  records.sort((a, b) => a.sequence - b.sequence);
  if (
    records.length !== index.revisionCount ||
    records.some((r, i) => r.sequence !== i)
  )
    throw new Error("Incomplete points sequence");
  const journal: PointsJournal = {
    schemaVersion: "1",
    ruleVersion: POINTS_RULE,
    generatedAt: index.generatedAt,
    coverage: index.coverage,
    revisions: records.map((r) => r.revision),
  };
  assertPointsJournal(journal);
  return journal;
}
