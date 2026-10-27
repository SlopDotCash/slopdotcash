/** Nonfinancial points. This module never supplies reward or settlement inputs. */
import type {
  GitHubActor,
  LeaderboardSnapshot,
  PublishedPenalty,
  ScoreEvent,
} from "./leaderboard";
import {
  findHistoricalProject,
  findHistoricalRepository,
  isHistoricalProjectId,
  isHistoricalRepositoryId,
} from "./projects.mjs";
import { findRegisteredRepositoryById } from "./repositories.mjs";
import { penaltyDeductions } from "./score-penalties";
import { VALUE_SCORING_APPROVED_HISTORY_FROM } from "./scoring-policy";
import { sha256Hex } from "./sha256";

export const POINTS_RULE = "slop-points-v1";
/**
 * A published Slopbot debit recorded as a negative Points award for the UTC
 * month of the close (PRD section 7). Points are the one public measure, so
 * the debit is applied here as well as to the score and the payment weight.
 */
export const PENALTY_DEBIT_CATEGORY = "penalty-debit";
export const POINTS_NOTICE =
  "Points have no cash value and cannot be transferred or redeemed.";
export interface PointAward {
  key: string;
  actor: Pick<GitHubActor, "id" | "login">;
  projectId: string;
  category: ScoreEvent["category"] | "payout-received" | "penalty-debit";
  amount: number;
  occurredAt: string;
  sourceId: string;
  sourceUrl: string;
  workUnitId: string;
  provisional: boolean;
}
export interface PointDecision {
  sourceId: string;
  effectiveAt: string;
  reason: string;
}
export interface PointRevision {
  decision?: PointDecision & { delta: number };
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
  "payout-received",
  PENALTY_DEBIT_CATEGORY,
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
      ...("decision" in r ? ["decision"] : []),
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
      !isHistoricalProjectId(a.projectId) ||
      !categories.has(a.category) ||
      !Number.isSafeInteger(a.amount) ||
      (a.category === PENALTY_DEBIT_CATEGORY ? a.amount > 0 : a.amount < 0) ||
      !iso(a.occurredAt) ||
      !iso(r.recordedAt) ||
      r.recordedAt > p.generatedAt ||
      !digestPattern.test(r.sourceDigest) ||
      ![
        "slop-score-v1",
        "slop-score-v2",
        "github-merged-history-v1",
        "verified-payout-v1",
      ].includes(r.sourceRule) ||
      typeof a.provisional !== "boolean" ||
      typeof a.sourceId !== "string" ||
      a.sourceId.length > 256 ||
      typeof a.workUnitId !== "string" ||
      a.workUnitId.length > 300
    )
      throw new Error("Invalid point award");
    if (a.category === "payout-received") {
      const cycle = a.sourceId.split(":")[1];
      if (
        r.sourceRule !== "verified-payout-v1" ||
        ![0, 25].includes(a.amount) ||
        a.provisional ||
        !/^\d{4}-(0[1-9]|1[0-2])$/.test(cycle ?? "") ||
        a.sourceId !== `payout:${cycle}:${a.actor.id}` ||
        a.workUnitId !== a.sourceId ||
        a.sourceUrl !== `https://slop.cash/cycles/${a.projectId}/${cycle}`
      )
        throw new Error("Invalid payout recognition");
    } else if (a.category === PENALTY_DEBIT_CATEGORY) {
      // A debit keeps Slopbot's recorded close, never a later GitHub event.
      if (
        r.sourceRule !== "slop-score-v2" ||
        a.provisional ||
        a.workUnitId !== a.sourceId
      )
        throw new Error("Invalid penalty debit");
    } else if (r.sourceRule === "verified-payout-v1")
      throw new Error("Payout rule requires payout evidence");
    const url = new URL(a.sourceUrl);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      a.sourceUrl.length > 2048
    )
      throw new Error("Invalid point source");
    if (
      a.key !== pointKey(a.projectId, a.actor.id, a.category, a.sourceId) &&
      !(
        a.category === "merged-pull-request" &&
        /^wu_[a-f0-9]{64}$/u.test(a.workUnitId) &&
        a.key ===
          pointKey(
            a.projectId,
            a.actor.id,
            a.category,
            a.sourceId,
            a.workUnitId,
          )
      )
    )
      throw new Error("Point source key mismatch");
    const { id, ...body } = r;
    if (
      id !== pointRevisionId(body) ||
      ids.has(id) ||
      r.previous !== (latest.get(a.key)?.id ?? null)
    )
      throw new Error("Broken points revision chain");
    const prior = latest.get(a.key);
    if ("decision" in r) {
      const decision = r.decision;
      if (!decision || typeof decision !== "object")
        throw new Error("Invalid points decision");
      exact(decision, ["sourceId", "effectiveAt", "reason", "delta"]);
      if (
        r.sourceRule !== "slop-score-v2" ||
        typeof decision.sourceId !== "string" ||
        !(
          /^[A-Za-z0-9_=-]{4,256}$/u.test(decision.sourceId) ||
          /^value:[a-f0-9]{64}$/u.test(decision.sourceId)
        ) ||
        !iso(decision.effectiveAt) ||
        decision.effectiveAt > r.recordedAt ||
        typeof decision.reason !== "string" ||
        !decision.reason.trim() ||
        !Number.isSafeInteger(decision.delta) ||
        decision.delta !== a.amount - (prior?.award.amount ?? 0)
      )
        throw new Error("Points decision does not reconcile its revision");
    }

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
      !isHistoricalRepositoryId(c.repository) ||
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
  workUnit?: string,
): string {
  return sha256Hex(
    JSON.stringify([
      project,
      actor,
      category,
      source,
      ...(workUnit === undefined ? [] : [workUnit]),
    ]),
  );
}
/** One legacy credit-third is ten Slop Points. */
export const POINTS_PER_THIRD = 10;

function pointsForScore(
  event: Pick<ScoreEvent, "scoreThirds" | "points"> &
    Partial<Pick<ScoreEvent, "category" | "scoreDecisionSourceId">>,
): number {
  const amount =
    event.scoreThirds === undefined
      ? event.points * (3 * POINTS_PER_THIRD)
      : event.scoreThirds * POINTS_PER_THIRD;
  const assessedZero =
    amount === 0 &&
    event.category === "merged-pull-request" &&
    /^value:[a-f0-9]{64}$/u.test(event.scoreDecisionSourceId ?? "");
  if (!Number.isSafeInteger(amount) || (amount <= 0 && !assessedZero))
    throw new Error("Score cannot be converted to exact points");
  return amount;
}
export function awardForScore(event: ScoreEvent): PointAward {
  // Retained history may name a project that is no longer listed.
  const project = findHistoricalRepository(event.repository);
  if (!project || event.actor.kind !== "User")
    throw new Error("Points require a registered project and user");
  return {
    key: pointKey(
      project.projectId,
      event.actor.id,
      event.category,
      event.category === "evidence" ? event.id : event.source.id,
      event.category === "merged-pull-request" && event.id.includes(":joint:")
        ? event.workUnitId
        : undefined,
    ),
    actor: { id: event.actor.id, login: event.actor.login },
    projectId: project.projectId,
    category: event.category,
    amount: pointsForScore(event),
    occurredAt: new Date(event.occurredAt).toISOString(),
    sourceId: event.category === "evidence" ? event.id : event.source.id,
    sourceUrl: event.source.url,
    workUnitId: event.workUnitId ?? event.id,
    provisional:
      event.scoreDecisionSourceId?.startsWith("value:") === true ||
      (event.category === "merged-pull-request" &&
        event.scoreThirds !== undefined &&
        !event.scoreDecisionSourceId),
  };
}
export function latestPoints(
  journal: PointsJournal,
): Map<string, PointRevision> {
  return new Map(journal.revisions.map((r) => [r.award.key, r]));
}
/** The project a published debit belongs to, from the registered repository. */
function debitProjectOf(repository: string): string {
  const projectId = findRegisteredRepositoryById(repository)?.projectId;
  if (!projectId) throw new Error("Points require a registered project");
  return projectId;
}
/**
 * One published Slopbot debit as a negative Points award for the UTC month of
 * the close. `appliedThirds` is the snapshot's own applied debit, already
 * bounded by that month's credit, so the month never falls below zero.
 */
export function awardForPenalty(
  penalty: PublishedPenalty,
  appliedThirds: number,
): PointAward {
  if (!Number.isSafeInteger(appliedThirds) || appliedThirds <= 0)
    throw new Error("A published debit needs positive applied thirds");
  const projectId = debitProjectOf(penalty.repository);
  return {
    key: pointKey(
      projectId,
      penalty.actor.id,
      PENALTY_DEBIT_CATEGORY,
      penalty.id,
    ),
    actor: { id: penalty.actor.id, login: penalty.actor.login },
    projectId,
    category: PENALTY_DEBIT_CATEGORY,
    amount: -appliedThirds * POINTS_PER_THIRD,
    occurredAt: new Date(penalty.occurredAt).toISOString(),
    sourceId: penalty.id,
    sourceUrl: penalty.source.url,
    workUnitId: penalty.id,
    provisional: false,
  };
}
export function appendPointAwards(
  journal: PointsJournal,
  awards: PointAward[],
  sourceDigest: string,
  sourceRule: string,
  recordedAt: string,
  decisions?: ReadonlyMap<string, PointDecision>,
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
    const decision = decisions?.get(award.key);
    if (
      previous &&
      JSON.stringify(previous.award) === JSON.stringify(award) &&
      (!decision ||
        (previous.decision?.sourceId === decision.sourceId &&
          previous.decision.effectiveAt === decision.effectiveAt &&
          previous.decision.reason === decision.reason))
    )
      continue;
    const revision = {
      previous: previous?.id ?? null,
      recordedAt,
      sourceDigest,
      sourceRule,
      award,
      ...(decision
        ? {
            decision: {
              ...decision,
              delta: award.amount - (previous?.award.amount ?? 0),
            },
          }
        : {}),
    };
    const next = { id: pointRevisionId(revision), ...revision };
    output.revisions.push(next);
    latest.set(award.key, next);
  }
  assertPointsJournal(output);
  return output;
}
/**
 * Keys of positive retained-history awards (substantive reviews and
 * evaluator awards) whose latest revision was appended by the retained
 * batch: the batch rule with a digest that no snapshot recorded in the
 * coverage. The retained files are the only source for these awards.
 */
export function retainedBatchOwnedKeys(journal: PointsJournal): Set<string> {
  const coverage = new Set(journal.coverage.map((c) => c.digest));
  const keys = new Set<string>();
  for (const revision of latestPoints(journal).values()) {
    const award = revision.award;
    if (
      award.amount > 0 &&
      (award.category === "substantive-review" ||
        award.category === "evaluated-contribution") &&
      revision.sourceRule === "slop-score-v2" &&
      !coverage.has(revision.sourceDigest)
    )
      keys.add(award.key);
  }
  return keys;
}
export function applyPointsSnapshot(
  journal: PointsJournal,
  snapshot: LeaderboardSnapshot,
  digest: string,
  recordedAt: string,
): PointsJournal {
  // A snapshot ledger only carries a downstream copy of a retained award
  // (re-derived work unit, possibly dropped as a repeat work unit), so it
  // neither rewrites nor zeroes one the retained batch owns.
  const batchOwned = retainedBatchOwnedKeys(journal);
  const awards = snapshot.ledger
    .filter((e) => e.actor.kind === "User")
    .map(awardForScore)
    .filter((a) => !batchOwned.has(a.key));
  const decisions = new Map<string, PointDecision>();
  const parentDecisions = new Map<string, PointDecision>();
  for (const event of snapshot.ledger) {
    if (
      event.actor.kind !== "User" ||
      !event.scoreDecisionSourceId ||
      !event.scoreDecisionAt
    )
      continue;
    const decision = {
      sourceId: event.scoreDecisionSourceId,
      effectiveAt: new Date(event.scoreDecisionAt).toISOString(),
      reason: event.reason,
    };
    decisions.set(awardForScore(event).key, decision);
    parentDecisions.set(event.source.url.split("#")[0], decision);
  }
  const keys = new Set(awards.map((a) => a.key));
  // Merges the snapshot scores by their own record, such as the minimum for a
  // member whose joint decision is no longer assessed.
  const ownRecordMerges = new Set(
    awards
      .filter(
        (a) =>
          a.category === "merged-pull-request" &&
          a.key === pointKey(a.projectId, a.actor.id, a.category, a.sourceId),
      )
      .map((a) => `${a.projectId}\0${a.sourceId}`),
  );
  const repositoryIds = new Set(snapshot.repositories.map((r) => r.id));
  // A published debit lowers the same UTC month's accepted-work points. It uses
  // the snapshot's own applied thirds, so Points, score and payment weight
  // agree and a month never falls below zero (PRD section 7).
  const publishedPenalties = (snapshot.penalties ?? []).filter((penalty) =>
    repositoryIds.has(penalty.repository),
  );
  const appliedDebits = penaltyDeductions(
    snapshot.ledger,
    publishedPenalties,
    debitProjectOf,
  ).byPenalty;
  for (const penalty of publishedPenalties) {
    const thirds = appliedDebits.get(penalty.id) ?? 0;
    if (thirds <= 0) continue;
    const award = awardForPenalty(penalty, thirds);
    if (batchOwned.has(award.key) || keys.has(award.key)) continue;
    awards.push(award);
    keys.add(award.key);
  }
  // An adverse ruling can correct a review before the rolling window. A
  // policy or window omission does not revoke its previously earned credit.
  const excludedReviews = new Set<string>();
  const omittedReviews = new Map<string, string>();
  for (const exclusion of snapshot.reviewExclusions ?? []) {
    const key = `${findHistoricalRepository(exclusion.repository)?.projectId}\0${exclusion.reviewId}`;
    const omitted =
      exclusion.reason === "review-credit-before-policy" ||
      exclusion.reason === "review-credit-outside-window";
    if (omitted) omittedReviews.set(key, exclusion.reason);
    else excludedReviews.add(key);
  }
  // A complete newer census can correct a formerly accepted source. Never infer
  // deletion from missing pages or a shortened rolling window.
  for (const previous of latestPoints(journal).values()) {
    const a = previous.award;
    if (a.category === PENALTY_DEBIT_CATEGORY && !keys.has(a.key)) {
      // A reversed debit is absent from the published feed, so the next
      // snapshot restores that month's points instead of keeping a stale debit.
      awards.push({ ...a, amount: 0 });
      keys.add(a.key);
    }
    const omission =
      a.category === "substantive-review"
        ? omittedReviews.get(`${a.projectId}\0${a.sourceId}`)
        : undefined;
    if (omission) {
      const beforePolicy =
        iso(snapshot.valuePolicyEffectiveAt) &&
        snapshot.valuePolicyEffectiveAt >=
          VALUE_SCORING_APPROVED_HISTORY_FROM &&
        a.occurredAt < snapshot.valuePolicyEffectiveAt;
      const outsideWindow =
        a.occurredAt < snapshot.window.from ||
        a.occurredAt >= snapshot.window.to;
      if (
        !(omission === "review-credit-before-policy"
          ? beforePolicy
          : outsideWindow)
      )
        throw new Error(
          "Review omission contradicts its recorded occurrence or policy boundary",
        );
      continue;
    }
    const project = findHistoricalProject(a.projectId);
    const sourceUrl = new URL(a.sourceUrl);
    const match =
      sourceUrl.origin === "https://github.com"
        ? sourceUrl.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/([1-9][0-9]*)$/u)
        : null;
    let invalidatedJointDecision: PointDecision | undefined;
    if (snapshot.valueAssessmentCoverage && match) {
      const repository = findRegisteredRepositoryById(
        `${match[1]}/${match[2]}`,
      );
      const coverage = snapshot.valueAssessmentCoverage.find(
        (row) =>
          row.repository === repository?.id &&
          row.pullRequestNumber === Number(match[3]),
      );
      // The exact completion source can invalidate its prior joint decision
      // even when it no longer has an eligible actor for a replacement award.
      if (
        a.category === "merged-pull-request" &&
        a.key !== pointKey(a.projectId, a.actor.id, a.category, a.sourceId) &&
        coverage?.pullRequestId === a.sourceId &&
        ["stale", "incomplete"].includes(coverage.status) &&
        coverage.recordDigest &&
        previous.decision?.sourceId === `value:${coverage.recordDigest}`
      )
        invalidatedJointDecision = {
          sourceId: previous.decision.sourceId,
          effectiveAt: snapshot.generatedAt,
          reason: `The current completion source marks this prior joint assessment ${coverage.status}.`,
        };
      // A missing valuation is not evidence that an earlier award was wrong.
      // A legacy-policy source is scored by its unchanged historical rules.
      // A joint unit award still gives way once the same merge is scored by
      // its own record, so the merge is not credited twice.
      if (
        (!coverage ||
          !["assessed", "human-ratified", "legacy-policy"].includes(
            coverage.status,
          )) &&
        !invalidatedJointDecision &&
        !(
          a.key !== pointKey(a.projectId, a.actor.id, a.category, a.sourceId) &&
          ownRecordMerges.has(`${a.projectId}\0${a.sourceId}`)
        )
      )
        continue;
    }
    if (
      a.category !== "payout-received" &&
      a.amount &&
      !batchOwned.has(a.key) &&
      !keys.has(a.key) &&
      ((a.occurredAt >= snapshot.window.from &&
        a.occurredAt < snapshot.window.to) ||
        (a.category === "substantive-review" &&
          excludedReviews.has(`${a.projectId}\0${a.sourceId}`))) &&
      project?.repositories.every((r) => repositoryIds.has(r.id))
    ) {
      awards.push({ ...a, amount: 0 });
      const decision =
        invalidatedJointDecision ??
        parentDecisions.get(a.sourceUrl.split("#")[0]);
      if (decision)
        decisions.set(a.key, {
          ...decision,
          reason: `Prior credit was superseded by the current source-bound scoring decision. ${decision.reason}`,
        });
    }
  }
  const result = appendPointAwards(
    journal,
    awards,
    digest,
    snapshot.ruleVersion,
    recordedAt,
    decisions,
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
/**
 * Canonical identity of a GitHub pull-request review URL: the case-folded
 * owner/repo path plus the PR number. It mirrors exactly what the journal
 * validator (assertEvaluatorAwardManifest) accepts as a review source:
 * https scheme, github.com host, /owner/repo/pull/<number> path, and a
 * review fragment (#pullrequestreview-<id> or #discussion_r<id>, matched
 * case-insensitively like the validator).
 *
 * URL parsing normalizes the evasion forms the validator accepts while
 * retaining the raw string: owner/repo casing variants, the explicit
 * default port (:443, dropped as default by the URL parser), an empty query
 * marker, and dot-segment paths (including percent-encoded dot-segments).
 *
 * The owner/repo is resolved through the registered project repository
 * inventory (registry and removed projects via findHistoricalRepository), so a
 * registered alias maps to the canonical repository id: the validator
 * accepts alias paths as review sources, and without this the same PR
 * reached through the canonical id and through an alias would get different
 * identities and evade the evaluated-review suppression (PRD section 14
 * anti-duplication rule). URLs outside the registry keep the case-folded
 * owner/repo path as their identity.
 *
 * It returns undefined for anything else, so genuinely different URLs
 * (other hosts, other paths, other PR numbers, non-review fragments) and
 * URLs the validator itself rejects (an explicit non-default port, a
 * non-empty query) never share an identity and are never deduped together.
 */
export function canonicalReviewIdentity(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:") return undefined;
  if (parsed.hostname.toLowerCase() !== "github.com") return undefined;
  if (parsed.username || parsed.password) return undefined;
  // Mirrors the strict evaluator URL parser (githubUrl in
  // src/lib/evaluator-awards.ts): the URL parser drops an explicit default
  // port, so :443 stays accepted; an explicit non-default port or any
  // non-empty query is rejected by the validator and must yield no identity.
  if (parsed.port) return undefined;
  if (parsed.search) return undefined;
  const path = /^\/([^/]+)\/([^/]+)\/pull\/([1-9]\d*)$/.exec(parsed.pathname);
  if (!path) return undefined;
  const fragment = parsed.hash.toLowerCase();
  if (!/^#(pullrequestreview-|discussion_r)\d+$/.test(fragment))
    return undefined;
  // Canonicalize registered repository aliases: the validator accepts a
  // review source URL through any registered alias, so keying on the raw
  // owner/repo would let an evaluated award on the canonical id and a
  // substantive review on an alias (or vice versa) miss the dedup set and
  // double-count.
  const ownerRepo = `${path[1]}/${path[2]}`;
  const repositoryId = (
    findHistoricalRepository(ownerRepo)?.repositoryId ?? ownerRepo
  ).toLowerCase();
  return `${repositoryId}/pull/${path[3]}`;
}
export function pointMembers(
  journal: PointsJournal,
  month = journal.generatedAt.slice(0, 7),
  projectId?: string,
): PointsMember[] {
  const groups = new Map<string, PointAward>();
  const actors = new Map<string, PointRevision>();
  for (const revision of journal.revisions) {
    const prior = actors.get(revision.award.actor.id);
    if (!prior || revision.recordedAt >= prior.recordedAt)
      actors.set(revision.award.actor.id, revision);
  }
  const firstContributionAt = new Map<string, string>();
  const revisions = [...latestPoints(journal).values()];
  const valueAwardKeys = new Set(
    revisions
      .filter((revision) => revision.decision?.sourceId.startsWith("value:"))
      .map((revision) => revision.award.key),
  );
  const awards = revisions.map((revision) => revision.award);
  // The dedup key is the canonical parsed PR identity, not the raw URL:
  // the journal validator accepts URL variants (owner/repo casing, default
  // port, empty query, dot-segments, mixed-case review fragment) while
  // keeping the raw string, so keying on the raw string lets variants evade
  // the evaluated-review suppression and double-count (PRD section 14
  // anti-duplication rule).
  const evaluatedReviews = new Set(
    awards
      .filter((a) => a.amount > 0 && a.category === "evaluated-contribution")
      .map((a) => {
        const identity = canonicalReviewIdentity(a.sourceUrl);
        return identity === undefined ? undefined : `${a.actor.id}:${identity}`;
      })
      .filter((key): key is string => key !== undefined),
  );
  for (const a of awards) {
    const reviewIdentity =
      a.category === "substantive-review"
        ? canonicalReviewIdentity(a.sourceUrl)
        : undefined;
    if (
      reviewIdentity !== undefined &&
      evaluatedReviews.has(`${a.actor.id}:${reviewIdentity}`)
    )
      continue;
    if (!a.amount || (projectId && a.projectId !== projectId)) continue;
    // The first contribution date comes from every counted record, not
    // only the surviving award: one work unit can have records in more than
    // one month, and the dedup below keeps only one of them. A published
    // debit is not a contribution and never sets it.
    if (a.category !== PENALTY_DEBIT_CATEGORY) {
      const first = firstContributionAt.get(a.actor.id);
      if (first === undefined || a.occurredAt < first)
        firstContributionAt.set(a.actor.id, a.occurredAt);
    }
    const key = JSON.stringify([
      a.projectId,
      a.actor.id,
      a.category,
      valueAwardKeys.has(a.key) ? a.occurredAt.slice(0, 7) : null,
      a.category === "substantive-review" && !a.provisional
        ? (reviewIdentity ?? a.sourceUrl.split("#")[0])
        : a.workUnitId,
    ]);
    const prior = groups.get(key);
    if (
      !prior ||
      a.amount > prior.amount ||
      (a.amount === prior.amount &&
        (a.occurredAt < prior.occurredAt ||
          (a.occurredAt === prior.occurredAt && a.sourceId < prior.sourceId)))
    )
      groups.set(key, a);
  }
  const members = new Map<string, PointsMember>();
  for (const a of groups.values()) {
    const m = members.get(a.actor.id) ?? {
      actor: a.actor,
      total: 0,
      monthly: 0,
      firstContributionAt: firstContributionAt.get(a.actor.id) ?? a.occurredAt,
      projects: 0,
      badges: [],
      awards: [],
    };
    m.total += a.amount;
    if (a.occurredAt.startsWith(month)) m.monthly += a.amount;
    if (!Number.isSafeInteger(m.total))
      throw new Error("Points total overflow");
    m.awards.push(a);
    members.set(a.actor.id, m);
  }
  // An assessed zero corrects an amount; it does not erase the contributor.
  // Keep these identities discoverable without counting zero awards as badges.
  for (const award of awards) {
    if (
      !valueAwardKeys.has(award.key) ||
      award.amount ||
      (projectId && award.projectId !== projectId)
    )
      continue;
    const member = members.get(award.actor.id);
    if (!member) {
      members.set(award.actor.id, {
        actor: award.actor,
        total: 0,
        monthly: 0,
        firstContributionAt: award.occurredAt,
        projects: 0,
        badges: [],
        awards: [],
      });
    } else if (
      member.total === 0 &&
      award.occurredAt < member.firstContributionAt
    ) {
      member.firstContributionAt = award.occurredAt;
    }
  }
  for (const m of members.values()) {
    m.actor = actors.get(m.actor.id)?.award.actor ?? m.actor;
    m.awards.sort(
      (a, b) =>
        b.occurredAt.localeCompare(a.occurredAt) || a.key.localeCompare(b.key),
    );
    // A debit counts against the totals but is not a contribution: it adds no
    // project and earns no badge.
    const counted = m.awards.filter(
      (a) => a.category !== PENALTY_DEBIT_CATEGORY,
    );
    m.projects = new Set(counted.map((a) => a.projectId)).size;
    m.badges = [
      ...(counted.some((a) => a.category !== "payout-received")
        ? ["First accepted contribution"]
        : []),
      ...(counted.some((a) => a.category === "payout-received")
        ? ["Verified payout"]
        : []),
      ...(counted.some((a) => a.category === "substantive-review")
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
