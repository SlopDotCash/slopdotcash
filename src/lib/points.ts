/** Nonfinancial points. This module never supplies reward or settlement inputs. */

import { githubUserIdFromNodeId } from "./github-actor";
import type {
  GitHubActor,
  LeaderboardSnapshot,
  ScoreEvent,
} from "./leaderboard";
import type { PenaltyHistoryRecord } from "./leaderboard-types";
import {
  findHistoricalProject,
  findHistoricalRepository,
  isHistoricalProjectId,
  isHistoricalRepositoryId,
} from "./projects.mjs";
import {
  findRegisteredRepositoryById,
  REGISTERED_REPOSITORIES,
} from "./repositories.mjs";
import { assertPenaltyHistory } from "./score-penalties";
import { VALUE_SCORING_APPROVED_HISTORY_FROM } from "./scoring-policy";
import { sha256Hex } from "./sha256";

export const POINTS_RULE = "slop-points-v1";
export const POINTS_NOTICE =
  "Points have no cash value and cannot be transferred or redeemed.";
export interface PointAward {
  key: string;
  actor: Pick<GitHubActor, "id" | "login">;
  projectId: string;
  category: ScoreEvent["category"] | "payout-received" | "slopbot-penalty";
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
  penalty?: {
    category: string;
    debit: number;
    reversedAt: string | null;
    reversal: PenaltyHistoryRecord["reversal"];
  };
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
  "slopbot-penalty",
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
      ...("penalty" in r ? ["penalty"] : []),
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
      (a.category === "slopbot-penalty" ? a.amount > 0 : a.amount < 0) ||
      !iso(a.occurredAt) ||
      !iso(r.recordedAt) ||
      r.recordedAt > p.generatedAt ||
      !digestPattern.test(r.sourceDigest) ||
      !(
        [
          "slop-score-v1",
          "slop-score-v2",
          "github-merged-history-v1",
          "verified-payout-v1",
        ].includes(r.sourceRule) ||
        (a.category === "slopbot-penalty" &&
          /^slopbot-penalties-v[1-9][0-9]*$/u.test(r.sourceRule))
      ) ||
      typeof a.provisional !== "boolean" ||
      typeof a.sourceId !== "string" ||
      a.sourceId.length > 256 ||
      typeof a.workUnitId !== "string" ||
      a.workUnitId.length > 300
    )
      throw new Error("Invalid point award");
    if (a.category === "slopbot-penalty") {
      if (!r.penalty || !r.decision)
        throw new Error("Penalty evidence is required");
      exact(r.penalty, ["category", "debit", "reversedAt", "reversal"]);
      const evidence = r.penalty;
      const repository = new URL(a.sourceUrl).pathname.match(
        /^\/([^/]+\/[^/]+)\/pull\/[1-9][0-9]*$/u,
      )?.[1];
      if (
        !/^slopbot-penalties-v[1-9][0-9]*$/u.test(r.sourceRule) ||
        !/^[a-z_]{1,40}$/u.test(evidence.category) ||
        !Number.isSafeInteger(evidence.debit) ||
        evidence.debit < 1 ||
        a.provisional ||
        r.decision.sourceId !== a.sourceId ||
        -a.amount > evidence.debit ||
        a.workUnitId !== `${a.sourceId}:penalty` ||
        new URL(a.sourceUrl).origin !== "https://github.com" ||
        !repository ||
        findHistoricalRepository(repository)?.projectId !== a.projectId ||
        (evidence.reversedAt === null
          ? evidence.reversal !== null
          : !iso(evidence.reversedAt) ||
            evidence.reversedAt < a.occurredAt ||
            evidence.reversedAt > r.recordedAt ||
            a.amount !== 0 ||
            !["appeal_upheld", "maintainer_reopen"].includes(
              evidence.reversal ?? "",
            ))
      )
        throw new Error("Invalid penalty evidence");
    } else if (r.penalty !== undefined)
      throw new Error("Unexpected penalty evidence");
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
        (r.sourceRule !== "slop-score-v2" &&
          a.category !== "slopbot-penalty") ||
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
    if (
      prior?.penalty &&
      (prior.penalty.category !== r.penalty?.category ||
        prior.penalty.debit !== r.penalty?.debit ||
        prior.sourceRule !== r.sourceRule ||
        (prior.penalty.reversedAt !== null &&
          JSON.stringify(prior.penalty) !== JSON.stringify(r.penalty)))
    )
      throw new Error("Penalty history moved");
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
export function appendPointAwards(
  journal: PointsJournal,
  awards: PointAward[],
  sourceDigest: string,
  sourceRule: string,
  recordedAt: string,
  decisions?: ReadonlyMap<string, PointDecision>,
  penalties?: ReadonlyMap<string, NonNullable<PointRevision["penalty"]>>,
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
    const penalty = penalties?.get(award.key);
    if (
      previous &&
      JSON.stringify(previous.award) === JSON.stringify(award) &&
      JSON.stringify(previous.penalty) === JSON.stringify(penalty) &&
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
      ...(penalty ? { penalty } : {}),
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

/** Record actual debits against the same accepted-work projection as members.
 * A feed omission never reverses a debit. Only retained, identity-matched
 * Slopbot reversal evidence can do that, including outside the rolling window.
 */
export function reconcilePointPenalties(
  journal: PointsJournal,
  digest: string,
  recordedAt: string,
  snapshot?: LeaderboardSnapshot,
): PointsJournal {
  const candidates = new Map(
    [...latestPoints(journal)].filter(([, r]) => r.penalty),
  );
  for (const penalty of snapshot?.penalties ?? []) {
    const project = findHistoricalRepository(penalty.repository);
    if (!project || penalty.actor.kind !== "User")
      throw new Error("Invalid penalty identity");
    const award: PointAward = {
      key: pointKey(
        project.projectId,
        penalty.actor.id,
        "slopbot-penalty",
        penalty.source.id,
      ),
      actor: { id: penalty.actor.id, login: penalty.actor.login },
      projectId: project.projectId,
      category: "slopbot-penalty",
      amount: 0,
      occurredAt: penalty.occurredAt,
      sourceId: penalty.source.id,
      sourceUrl: penalty.source.url,
      workUnitId: penalty.id,
      provisional: false,
    };
    const evidence = {
      category: penalty.category,
      debit: penalty.debitThirds * POINTS_PER_THIRD,
      reversedAt: null,
      reversal: null,
    };
    const prior = candidates.get(award.key);
    if (
      prior &&
      (prior.sourceRule !== penalty.tableVersion ||
        prior.award.occurredAt !== award.occurredAt ||
        prior.penalty?.debit !== evidence.debit ||
        prior.penalty.category !== evidence.category)
    )
      throw new Error("Penalty identity changed");
    if (!prior)
      candidates.set(award.key, {
        id: "",
        previous: null,
        recordedAt,
        sourceDigest: digest,
        sourceRule: penalty.tableVersion,
        award,
        penalty: evidence,
      });
  }
  if (snapshot?.penaltyHistory !== undefined) {
    assertPenaltyHistory(
      snapshot.penaltyHistory,
      REGISTERED_REPOSITORIES.map((r) => r.projectId),
      snapshot.generatedAt,
    );
    const bySource = new Map(
      [...candidates.values()].map((r) => [r.award.sourceId, r]),
    );
    for (const evidence of snapshot.penaltyHistory) {
      const prior = bySource.get(evidence.itemNodeId);
      if (!prior) continue; // History alone cannot establish a new GitHub identity.
      if (
        prior.award.projectId !== evidence.projectId ||
        githubUserIdFromNodeId(prior.award.actor.id) !==
          evidence.authorGithubId ||
        prior.award.occurredAt !== evidence.recordedAt ||
        prior.sourceRule !== evidence.tableVersion ||
        prior.penalty?.debit !== evidence.debitThirds * POINTS_PER_THIRD ||
        prior.penalty.category !== evidence.category
      )
        throw new Error("Penalty reversal identity mismatch");
      if (evidence.reversedAt !== null) {
        if (
          prior.penalty.reversedAt !== null &&
          (prior.penalty.reversedAt !== evidence.reversedAt ||
            prior.penalty.reversal !== evidence.reversal)
        )
          throw new Error("Penalty reversal changed");
        candidates.set(prior.award.key, {
          ...prior,
          penalty: {
            ...prior.penalty,
            reversedAt: evidence.reversedAt,
            reversal: evidence.reversal,
          },
        });
      }
    }
  }
  const bucket = (award: PointAward) =>
    `${award.actor.id}\0${award.projectId}\0${award.occurredAt.slice(0, 7)}`;
  const available = new Map<string, number>();
  for (const member of pointMembers(journal)) {
    for (const award of member.awards) {
      if (award.amount <= 0 || award.category === "payout-received") continue;
      const key = bucket(award);
      available.set(key, (available.get(key) ?? 0) + award.amount);
    }
  }
  let result = journal;
  const latest = latestPoints(journal);
  for (const candidate of [...candidates.values()].sort(
    (a, b) =>
      a.award.occurredAt.localeCompare(b.award.occurredAt) ||
      a.award.workUnitId.localeCompare(b.award.workUnitId),
  )) {
    const evidence = candidate.penalty;
    if (!evidence) continue;
    const key = bucket(candidate.award);
    const debit =
      evidence.reversedAt === null
        ? Math.min(evidence.debit, available.get(key) ?? 0)
        : 0;
    available.set(key, (available.get(key) ?? 0) - debit);
    const award = { ...candidate.award, amount: -debit || 0 };
    const prior = latest.get(award.key);
    if (
      prior?.award.amount === award.amount &&
      JSON.stringify(prior.penalty) === JSON.stringify(evidence)
    )
      continue;
    result = appendPointAwards(
      result,
      [award],
      digest,
      candidate.sourceRule,
      recordedAt,
      new Map([
        [
          award.key,
          {
            sourceId: award.sourceId,
            effectiveAt:
              evidence.reversedAt ?? (prior ? recordedAt : award.occurredAt),
            reason:
              evidence.reversedAt !== null
                ? `Slopbot reversed the penalty: ${evidence.reversal}.`
                : `Slopbot ${evidence.category} penalty: ${evidence.debit} Points, limited to accepted work in ${award.occurredAt.slice(0, 7)}.`,
          },
        ],
      ]),
      new Map([[award.key, evidence]]),
    );
  }
  return result;
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
  const previousPoints = latestPoints(journal);
  const heldSources = new Set(
    (snapshot.source.heldWorkUnits ?? []).flatMap((unit) => unit.sourceNodeIds),
  );
  const previousJointSources = new Set(
    [...previousPoints.values()]
      .filter(
        ({ award }) =>
          award.category === "merged-pull-request" &&
          award.key !==
            pointKey(
              award.projectId,
              award.actor.id,
              award.category,
              award.sourceId,
            ),
      )
      .map(({ award }) => award.sourceId),
  );
  const previouslyAwardedJointSources = new Set(
    (snapshot.source.heldWorkUnits ?? [])
      .filter((unit) =>
        unit.sourceNodeIds.some((id) => previousJointSources.has(id)),
      )
      .flatMap((unit) => unit.sourceNodeIds),
  );
  const awards = snapshot.ledger
    .filter((e) => e.actor.kind === "User")
    .map(awardForScore)
    .filter((a) => !batchOwned.has(a.key))
    // Unavailable source is not evidence against a recorded award. A newly
    // verified merge can earn its minimum, but cannot add another award on
    // top of a retained joint decision or downgrade its own prior amount.
    .filter(
      (a) =>
        a.category !== "merged-pull-request" ||
        !a.provisional ||
        !heldSources.has(a.sourceId) ||
        (!previousPoints.has(a.key) &&
          !previouslyAwardedJointSources.has(a.sourceId)),
    );
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
  for (const previous of previousPoints.values()) {
    const a = previous.award;
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
      a.category !== "slopbot-penalty" &&
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
  return reconcilePointPenalties(result, digest, recordedAt, snapshot);
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
    if (revision.award.category === "slopbot-penalty") continue;
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
  const adjustments = new Map<string, PointAward[]>();
  for (const award of awards) {
    if (
      award.category !== "slopbot-penalty" ||
      !award.amount ||
      (projectId && award.projectId !== projectId)
    )
      continue;
    const actorAwards = adjustments.get(award.actor.id) ?? [];
    actorAwards.push(award);
    adjustments.set(award.actor.id, actorAwards);
  }
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
    if (a.category === "slopbot-penalty") continue;
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
    // one month, and the dedup below keeps only one of them.
    const first = firstContributionAt.get(a.actor.id);
    if (first === undefined || a.occurredAt < first)
      firstContributionAt.set(a.actor.id, a.occurredAt);
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
    for (const adjustment of adjustments.get(m.actor.id) ?? []) {
      m.total += adjustment.amount;
      if (adjustment.occurredAt.startsWith(month))
        m.monthly += adjustment.amount;
      m.awards.push(adjustment);
    }
    m.actor = actors.get(m.actor.id)?.award.actor ?? m.actor;
    m.awards.sort(
      (a, b) =>
        b.occurredAt.localeCompare(a.occurredAt) || a.key.localeCompare(b.key),
    );
    const earned = m.awards.filter((a) => a.category !== "slopbot-penalty");
    m.projects = new Set(earned.map((a) => a.projectId)).size;
    m.badges = [
      ...(earned.some((a) => a.category !== "payout-received")
        ? ["First accepted contribution"]
        : []),
      ...(m.awards.some((a) => a.category === "payout-received")
        ? ["Verified payout"]
        : []),
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
