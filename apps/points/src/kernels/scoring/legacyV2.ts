//@ backend dafny
// spec/points/scoringPolicy.md, "A scored source records its provenance and keeps the 10-Point minimum"; spec/points/scoringPolicy.md, "A valid ratification takes precedence and a later assessment cannot replace it"; spec/points/scoringPolicy.md, "The acceptance instant selects the policy"

export const scoreV2EffectiveAt = 1785542400000;
export const outcomeFirstPolicyAt = 1790812800000;
export const paymentReviewPolicyAt = 1791588095388;
export const valuePolicyAt = 1793491200000;

export const materialTestAdditions = 10;
export const materialTestChurn = 20;
export const resolvedIssueCap = 5;
export const materialTestChangeCap = 5;
export const evidencePointCap = 900;
export const substantiveReviewCap = 10;
export const evaluatedContributionCap = 3;
export const legacyResolvedIssuePoints = 120;
export const legacyMaterialTestPoints = 120;
export const legacyReviewPoints = 90;
export const firstReviewPoints = 30;
export const outcomeReviewPoints = 10;

export type LegacyCategory =
  | "merged-pull-request"
  | "resolved-issue"
  | "material-test-change"
  | "evidence"
  | "substantive-review"
  | "evaluated-contribution";

export interface CapUsage {
  mergedPullRequests: number;
  resolvedIssues: number;
  materialTestChanges: number;
  evidenceCategories: number;
  substantiveReviews: number;
  evaluatedContributions: number;
  evidencePoints: number;
}

export interface LegacyAward { scored: boolean; points: number; usage: CapUsage }

export type V2Points = { kind: "skipped" } | { kind: "invalid" } | { kind: "scored"; points: number };

export interface V2Event {
  category: LegacyCategory;
  suppliedPoints: number;
  eventThirds: number;
  occurredAt: number;
  scoreDecisionSourceId: string;
}

export type ReviewTiming = "first-before-cutoff" | "outcome-candidate" | "unchanged-outcome";

export interface ResolvedIssue { closed: boolean; closedByMergedPullRequest: boolean; notPlanned: boolean; confirmed: boolean }

export interface ChangedFile { path: string; additions: number; deletions: number }

export interface TestStats { additions: number; churn: number }

export const emptyUsage: CapUsage = {
  mergedPullRequests: 0,
  resolvedIssues: 0,
  materialTestChanges: 0,
  evidenceCategories: 0,
  substantiveReviews: 0,
  evaluatedContributions: 0,
  evidencePoints: 0,
};

/** @throws {never} */
export function isScoreV2(occurredAt: number): boolean {
  //@ ensures \result === (occurredAt >= scoreV2EffectiveAt)
  return occurredAt >= scoreV2EffectiveAt;
}

/** @throws {never} */
export function mergedPullRequestCredit(ordinal: number): number {
  //@ requires ordinal >= 1
  //@ ensures 1 <= \result && \result <= 10
  //@ ensures \result * \result * ordinal >= 100
  //@ ensures \result === 1 || (\result - 1) * (\result - 1) * ordinal < 100
  let k = 1;
  while (k < 10 && k * k * ordinal < 100) {
    //@ invariant 1 <= k && k <= 10
    //@ invariant k === 1 || (k - 1) * (k - 1) * ordinal < 100
    k = k + 1;
  }
  return k;
}

/** @throws {never} */
//@ pure
export function thirdsSum(values: number[]): number {
  //@ decreases values.length
  if (values.length === 0) return 0;
  return thirdsSum(values.slice(0, values.length - 1)) + values[values.length - 1];
}

/** @throws {never} */
export function shareScoreThirds(total: number, actors: number, minimumPerActor: number): number[] {
  //@ requires actors >= 1 && total >= minimumPerActor && (minimumPerActor === 0 || minimumPerActor === 1)
  //@ ensures \result.length === actors
  //@ ensures forall(i, 0 <= i && i < actors ==> \result[i] >= minimumPerActor)
  //@ ensures (total >= actors || minimumPerActor === 0) ==> forall(i, 0 <= i && i < actors ==> \result[i] === Math.floor(total / actors) + (i < total % actors ? 1 : 0))
  //@ ensures (total >= actors || minimumPerActor === 0) ==> thirdsSum(\result) === total
  //@ ensures (total < actors && minimumPerActor === 1) ==> forall(i, 0 <= i && i < actors ==> \result[i] === 1)
  //@ ensures (total < actors && minimumPerActor === 1) ==> thirdsSum(\result) === actors
  //@ ensures forall(i, 0 <= i && i < actors ==> forall(j, i < j && j < actors ==> \result[i] >= \result[j] && \result[i] - \result[j] <= 1))
  const base = Math.floor(total / actors);
  const extra = total % actors;
  //@ assert total >= 0
  //@ assert total === base * actors + extra && 0 <= extra && extra < actors && base >= 0
  const shares: number[] = [];
  let i = 0;
  while (i < actors) {
    //@ invariant 0 <= i && i <= actors && shares.length === i
    //@ invariant base === 0 && minimumPerActor === 1 ==> forall(k, 0 <= k && k < i ==> shares[k] === 1)
    //@ invariant base === 0 && minimumPerActor === 1 ==> thirdsSum(shares) === i
    //@ invariant !(base === 0 && minimumPerActor === 1) ==> forall(k, 0 <= k && k < i ==> shares[k] === base + (k < extra ? 1 : 0))
    //@ invariant !(base === 0 && minimumPerActor === 1) ==> thirdsSum(shares) === base * i + (i < extra ? i : extra)
    //@ ghost let before: number[] = shares
    shares.push(base === 0 && minimumPerActor === 1 ? 1 : base + (i < extra ? 1 : 0));
    //@ assert shares.slice(0, i) === before
    i = i + 1;
  }
  return shares;
}

/** @throws {never} */
export function unratifiedMergeScoreThirds(mergedAt: number): number {
  //@ ensures mergedAt >= outcomeFirstPolicyAt ==> \result === 3
  //@ ensures mergedAt < outcomeFirstPolicyAt ==> \result === 1
  return mergedAt >= outcomeFirstPolicyAt ? 3 : 1;
}

/** @throws {never} */
//@ pure
export function legacyCapReached(usage: CapUsage, category: LegacyCategory, points: number): boolean {
  return category === "resolved-issue" ? usage.resolvedIssues >= resolvedIssueCap
    : category === "material-test-change" ? usage.materialTestChanges >= materialTestChangeCap
    : category === "evidence" ? usage.evidencePoints + points > evidencePointCap
    : category === "substantive-review" ? usage.substantiveReviews >= substantiveReviewCap
    : category === "evaluated-contribution" ? usage.evaluatedContributions >= evaluatedContributionCap
    : false;
}

/** @throws {never} */
export function legacyAward(usage: CapUsage, category: LegacyCategory, points: number): LegacyAward {
  //@ requires usage.mergedPullRequests >= 0
  //@ ensures !\result.scored ==> \result.usage === usage && \result.points === 0
  //@ ensures \result.scored && category === "merged-pull-request" ==> \result.points >= 30
  //@ ensures \result.scored && category !== "merged-pull-request" ==> \result.points === points
  //@ ensures \result.usage.resolvedIssues <= resolvedIssueCap || \result.usage.resolvedIssues === usage.resolvedIssues
  //@ ensures \result.usage.materialTestChanges <= materialTestChangeCap || \result.usage.materialTestChanges === usage.materialTestChanges
  //@ ensures \result.usage.substantiveReviews <= substantiveReviewCap || \result.usage.substantiveReviews === usage.substantiveReviews
  if (legacyCapReached(usage, category, points)) return { scored: false, points: 0, usage: usage };
  switch (category) {
    case "merged-pull-request":
      return {
        scored: true,
        points: 30 * mergedPullRequestCredit(usage.mergedPullRequests + 1),
        usage: { ...usage, mergedPullRequests: usage.mergedPullRequests + 1 },
      };
    case "resolved-issue":
      return { scored: true, points: points, usage: { ...usage, resolvedIssues: usage.resolvedIssues + 1 } };
    case "material-test-change":
      return { scored: true, points: points, usage: { ...usage, materialTestChanges: usage.materialTestChanges + 1 } };
    case "evidence":
      return {
        scored: true,
        points: points,
        usage: { ...usage, evidencePoints: usage.evidencePoints + points, evidenceCategories: usage.evidenceCategories + 1 },
      };
    case "substantive-review":
      return { scored: true, points: points, usage: { ...usage, substantiveReviews: usage.substantiveReviews + 1 } };
    case "evaluated-contribution":
      return { scored: true, points: points, usage: { ...usage, evaluatedContributions: usage.evaluatedContributions + 1 } };
  }
}

/** @throws {never} */
export function isLowerHexDigit(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 97 && code <= 102);
}

/** @throws {never} */
export function isValueDecisionSourceId(text: string): boolean {
  //@ ensures \result ==> text.length === 70
  if (text.length !== 70 || !text.startsWith("value:")) return false;
  let i = 6;
  while (i < 70) {
    //@ invariant 6 <= i && i <= 70
    if (!isLowerHexDigit(text.charCodeAt(i))) return false;
    i = i + 1;
  }
  return true;
}

/** @throws {never} */
export function v2EventPoints(event: V2Event): V2Points {
  //@ ensures \result.kind === "scored" ==> \result.points >= 0
  //@ ensures \result.kind === "scored" && event.category !== "merged-pull-request" ==> \result.points >= 10
  //@ ensures \result.kind === "scored" && \result.points === 0 ==> event.category === "merged-pull-request"
  //@ ensures (event.category === "resolved-issue" || event.category === "material-test-change" || event.category === "evidence") ==> \result.kind === "skipped"
  if (event.category === "resolved-issue" || event.category === "material-test-change" || event.category === "evidence") {
    return { kind: "skipped" };
  }
  const points = event.suppliedPoints >= 0
    ? event.suppliedPoints
    : event.category === "merged-pull-request"
      ? 10 * unratifiedMergeScoreThirds(event.occurredAt)
      : event.category === "substantive-review"
        ? firstReviewPoints
        : 10 * Math.max(1, event.eventThirds);
  const assessedZero = points === 0 && event.category === "merged-pull-request" && isValueDecisionSourceId(event.scoreDecisionSourceId);
  if (event.category !== "merged-pull-request" && points % 10 !== 0) return { kind: "invalid" };
  if (points < 0 || (points === 0 && !assessedZero)) return { kind: "invalid" };
  return { kind: "scored", points: points };
}

/** @throws {never} */
export function changedAcceptedOutcome(state: string, reviewedCommit: string, mergedHead: string): boolean {
  //@ ensures \result ==> state === "CHANGES_REQUESTED" && reviewedCommit.length > 0
  return state === "CHANGES_REQUESTED" && reviewedCommit.length > 0 && reviewedCommit.toLowerCase() !== mergedHead.toLowerCase();
}

/** @throws {never} */
export function reviewTiming(submittedAt: number, cutoff: number, changedOutcome: boolean): ReviewTiming {
  //@ ensures submittedAt < cutoff ==> \result === "first-before-cutoff"
  //@ ensures \result === "outcome-candidate" ==> changedOutcome && submittedAt >= cutoff
  if (submittedAt < cutoff) return "first-before-cutoff";
  return changedOutcome ? "outcome-candidate" : "unchanged-outcome";
}

/** @throws {never} */
export function reviewAwardPoints(outcomeBound: boolean): number {
  //@ ensures outcomeBound ==> \result === outcomeReviewPoints
  //@ ensures !outcomeBound ==> \result === firstReviewPoints
  return outcomeBound ? outcomeReviewPoints : firstReviewPoints;
}

/** @throws {never} */
export function outcomeReviewWinner(candidates: number): number {
  //@ requires candidates >= 0
  //@ ensures candidates === 0 ==> \result === -1
  //@ ensures candidates > 0 ==> \result === candidates - 1
  return candidates > 0 ? candidates - 1 : -1;
}

/** @throws {never} */
export function qualifiesResolvedIssue(issue: ResolvedIssue): boolean {
  //@ ensures !issue.closed ==> !\result
  //@ ensures issue.closed && issue.closedByMergedPullRequest ==> \result
  //@ ensures issue.closed && !issue.closedByMergedPullRequest && issue.notPlanned ==> !\result
  if (!issue.closed) return false;
  if (issue.closedByMergedPullRequest) return true;
  return !issue.notPlanned && issue.confirmed;
}

/** @throws {never} */
export function isTestDirectoryName(name: string): boolean {
  return name === "__tests__" || name === "test" || name === "tests" || name === "spec" || name === "specs" || name === "e2e";
}

/** @throws {never} */
export function hasDirectory(path: string, name: string): boolean {
  return path.startsWith(name + "/") || path.includes("/" + name + "/");
}

/** @throws {never} */
export function hasTestDirectory(path: string): boolean {
  let start = 0;
  let i = 0;
  while (i < path.length) {
    //@ invariant 0 <= start && start <= i && i <= path.length
    if (path.charCodeAt(i) === 47) {
      if (isTestDirectoryName(path.slice(start, i))) return true;
      start = i + 1;
    }
    i = i + 1;
  }
  return false;
}

/** @throws {never} */
export function isLowerAlphanumeric(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 97 && code <= 122);
}

/** @throws {never} */
export function extensionDot(path: string): number {
  //@ ensures \result >= -1 && \result < path.length
  let i = path.length;
  while (i > 0 && isLowerAlphanumeric(path.charCodeAt(i - 1))) {
    //@ invariant 0 <= i && i <= path.length
    i = i - 1;
  }
  if (i === path.length || i === 0 || path.charCodeAt(i - 1) !== 46) return -1;
  return i - 1;
}

/** @throws {never} */
export function isTestNameStem(stem: string): boolean {
  const marker = stem.endsWith("test") || stem.endsWith("spec");
  if (!marker) return false;
  if (stem.length === 4) return true;
  const before = stem.charCodeAt(stem.length - 5);
  return before === 46 || before === 95 || before === 45;
}

/** @throws {never} */
export function isRecognizedTestFile(path: string): boolean {
  const normalized = path.toLowerCase();
  if (hasDirectory(normalized, "__snapshots__") || hasDirectory(normalized, "fixtures") || hasDirectory(normalized, "testdata")) {
    return false;
  }
  if (hasTestDirectory(normalized) || normalized.endsWith(".feature")) return true;
  const dot = extensionDot(normalized);
  if (dot < 0) return false;
  const stem = normalized.slice(0, dot);
  return isTestNameStem(stem) || stem.endsWith("_test");
}

/** @throws {never} */
export function materialTestStats(files: ChangedFile[]): TestStats {
  //@ requires forall(k, 0 <= k && k < files.length ==> files[k].additions >= 0 && files[k].deletions >= 0)
  //@ ensures \result.additions >= 0 && \result.churn >= \result.additions
  let additions = 0;
  let churn = 0;
  let i = 0;
  while (i < files.length) {
    //@ invariant 0 <= i && i <= files.length
    //@ invariant additions >= 0 && churn >= additions
    const file = files[i];
    if (isRecognizedTestFile(file.path)) {
      additions = additions + file.additions;
      churn = churn + file.additions + file.deletions;
    }
    i = i + 1;
  }
  return { additions: additions, churn: churn };
}

/** @throws {never} */
export function hasMaterialTestChange(files: ChangedFile[]): boolean {
  //@ requires forall(k, 0 <= k && k < files.length ==> files[k].additions >= 0 && files[k].deletions >= 0)
  const stats = materialTestStats(files);
  return stats.additions >= materialTestAdditions && stats.churn >= materialTestChurn;
}

/** @throws {never} */
export function isNearMaterialTestChange(files: ChangedFile[]): boolean {
  //@ requires forall(k, 0 <= k && k < files.length ==> files[k].additions >= 0 && files[k].deletions >= 0)
  const stats = materialTestStats(files);
  if (stats.additions >= materialTestAdditions && stats.churn >= materialTestChurn) return false;
  return stats.additions >= 5 || stats.churn >= 10;
}

/** @throws {never} */
export function legacyPointsOfThirds(thirds: number): number {
  //@ requires thirds >= 1
  //@ ensures \result === 10 * thirds && \result >= 10
  return 10 * thirds;
}
