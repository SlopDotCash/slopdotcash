/**
 * The maintainer share of one project month (operator decision, 18 November
 * 2026; PRD section 6).
 *
 * Input is the month's decision record: every outside pull request of the
 * project's repositories that was merged or closed in the UTC month by an
 * account other than its author. GitHub lets only an account with maintainer
 * rights merge or close another person's pull request, so the deciding
 * account is the maintainer. Bots and the author's own close are never
 * decisions, and they are left out when the record is collected
 * (`scripts/maintainer-decisions.ts`).
 *
 * The share is a part of the monthly amount, taken out before the points
 * split, so the month's total never exceeds its amount. It is split among
 * the deciding accounts in proportion to the pull requests each decided, by
 * largest remainder in the asset's base units. An account on the project's
 * payout exclusion list is left out of the split, like an excluded
 * contributor. With no counted decision the share is zero and the whole
 * amount stays with contributors.
 */

import { githubUserIdFromNodeId } from "../github-actor";
import { MAINTAINER_SHARE_LIMITS } from "../maintainer-share.mjs";
import { allocateWeightedRows } from "../weighted-allocation";

export interface MaintainerDecision {
  /** Canonical `owner/name` of the repository. */
  repository: string;
  number: number;
  outcome: "merged" | "closed";
  /** When GitHub recorded the merge or the close. */
  decidedAt: string;
  /** The pull request author's login, for the record only. */
  author: string;
  /** Numeric GitHub user ID of the deciding account. */
  githubUserId: string;
  /** The same account's GitHub node ID. */
  nodeId: string;
  login: string;
}

export interface MaintainerDecisionRecord {
  schemaVersion: "1";
  projectId: string;
  period: string;
  /** Repositories read, canonical `owner/name`, sorted. */
  repositories: string[];
  decisions: MaintainerDecision[];
}

export interface MaintainerShareRow {
  githubUserId: string;
  nodeId: string;
  login: string;
  decisions: number;
  amount: bigint;
}

export interface MaintainerShare {
  /** Base units taken out of the monthly amount; zero without a decision. */
  pool: bigint;
  rows: MaintainerShareRow[];
}

const ACTOR = /^[1-9][0-9]{0,19}$/u;
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const PERIOD = /^\d{4}-(?:0[1-9]|1[0-2])$/u;

function exactKeys(value: object, keys: string[]): boolean {
  return Object.keys(value).sort().join() === [...keys].sort().join();
}

/** Throws unless `value` is the complete decision record of this project month. */
export function assertMaintainerDecisionRecord(
  value: unknown,
  projectId: string,
  period: string,
): asserts value is MaintainerDecisionRecord {
  const record = value as MaintainerDecisionRecord;
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !exactKeys(value, [
      "decisions",
      "period",
      "projectId",
      "repositories",
      "schemaVersion",
    ]) ||
    record.schemaVersion !== "1" ||
    record.projectId !== projectId ||
    record.period !== period ||
    !PERIOD.test(period) ||
    !Array.isArray(record.repositories) ||
    record.repositories.length === 0 ||
    record.repositories.some(
      (repository, index) =>
        typeof repository !== "string" ||
        !REPOSITORY.test(repository) ||
        (index > 0 && record.repositories[index - 1] >= repository),
    ) ||
    !Array.isArray(record.decisions)
  )
    throw new TypeError("Maintainer decision record is invalid");
  const [year, month] = period.split("-").map(Number);
  const from = Date.UTC(year, month - 1, 1);
  const to = Date.UTC(year, month, 1);
  const seen = new Set<string>();
  for (const decision of record.decisions) {
    const decidedAt =
      typeof decision?.decidedAt === "string"
        ? Date.parse(decision.decidedAt)
        : Number.NaN;
    const key = `${decision?.repository}#${decision?.number}`;
    if (
      typeof decision !== "object" ||
      decision === null ||
      !exactKeys(decision, [
        "author",
        "decidedAt",
        "githubUserId",
        "login",
        "nodeId",
        "number",
        "outcome",
        "repository",
      ]) ||
      !record.repositories.includes(decision.repository) ||
      !Number.isSafeInteger(decision.number) ||
      decision.number <= 0 ||
      (decision.outcome !== "merged" && decision.outcome !== "closed") ||
      !Number.isFinite(decidedAt) ||
      new Date(decidedAt).toISOString() !== decision.decidedAt ||
      decidedAt < from ||
      decidedAt >= to ||
      typeof decision.author !== "string" ||
      !LOGIN.test(decision.author) ||
      typeof decision.githubUserId !== "string" ||
      !ACTOR.test(decision.githubUserId) ||
      typeof decision.nodeId !== "string" ||
      githubUserIdFromNodeId(decision.nodeId) !== decision.githubUserId ||
      typeof decision.login !== "string" ||
      !LOGIN.test(decision.login) ||
      decision.login.toLowerCase() === decision.author.toLowerCase() ||
      seen.has(key)
    )
      throw new TypeError(
        `Maintainer decision record has an invalid decision: ${key}`,
      );
    seen.add(key);
  }
}

/**
 * Splits `basisPoints` of `cap` among the deciding accounts. The newest
 * login of an account names its row.
 */
export function maintainerShare(input: {
  cap: bigint;
  basisPoints: number;
  decisions: readonly MaintainerDecision[];
  excludedGithubUserIds: ReadonlySet<string>;
}): MaintainerShare {
  if (
    input.cap < 0n ||
    !Number.isSafeInteger(input.basisPoints) ||
    input.basisPoints < MAINTAINER_SHARE_LIMITS.min ||
    input.basisPoints > MAINTAINER_SHARE_LIMITS.max
  )
    throw new RangeError("Maintainer share is outside its limits");
  const counted = new Map<
    string,
    {
      githubUserId: string;
      nodeId: string;
      login: string;
      decisions: number;
      at: string;
    }
  >();
  for (const decision of input.decisions) {
    if (input.excludedGithubUserIds.has(decision.githubUserId)) continue;
    const row = counted.get(decision.githubUserId);
    if (!row)
      counted.set(decision.githubUserId, {
        githubUserId: decision.githubUserId,
        nodeId: decision.nodeId,
        login: decision.login,
        decisions: 1,
        at: decision.decidedAt,
      });
    else {
      row.decisions += 1;
      if (decision.decidedAt > row.at) {
        row.at = decision.decidedAt;
        row.login = decision.login;
        row.nodeId = decision.nodeId;
      }
    }
  }
  const pool =
    counted.size === 0 ? 0n : (input.cap * BigInt(input.basisPoints)) / 10_000n;
  if (pool === 0n) return { pool: 0n, rows: [] };
  const rows = allocateWeightedRows(
    pool,
    [...counted.values()],
    (row) => BigInt(row.decisions),
    // Equal remainders go to the lower immutable account ID first.
    (left, right) =>
      left.githubUserId.length - right.githubUserId.length ||
      left.githubUserId.localeCompare(right.githubUserId),
  )
    .map(({ row, amount }) => ({
      githubUserId: row.githubUserId,
      nodeId: row.nodeId,
      login: row.login,
      decisions: row.decisions,
      amount,
    }))
    .sort(
      (left, right) =>
        left.githubUserId.length - right.githubUserId.length ||
        left.githubUserId.localeCompare(right.githubUserId),
    );
  return { pool, rows };
}
