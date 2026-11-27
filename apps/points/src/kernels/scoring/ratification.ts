//@ backend dafny
// spec/points/scoringPolicy.md, "A valid ratification takes precedence and a later assessment cannot replace it"

export interface RatificationRecord {
  schemaVersion: string;
  ruleVersion: string;
  projectId: string;
  pullRequestNodeId: string;
  headSha: string;
  workUnitId: string;
  tier: string;
  scoreThirds: number;
  proposalReviewNodeIds: string[];
  coRatifierNodeIds: string[];
  reason: string;
  supersedes: string | null;
}

export interface ApprovalRecord {
  schemaVersion: string;
  ruleVersion: string;
  projectId: string;
  pullRequestNodeId: string;
  headSha: string;
  workUnitId: string;
  tier: string;
  decision: string;
  reason: string;
}

export interface RatificationContext {
  projectId: string;
  pullRequestNodeId: string;
  headSha: string;
  sourceNodeId: string;
  authorAssociation: string;
  createdAt: string;
  updatedAt: string;
}

export type RecordCheck =
  | "valid"
  | "unsupported-version"
  | "unregistered-project"
  | "invalid-pull-request"
  | "invalid-head"
  | "invalid-work-unit"
  | "tier-mismatch"
  | "invalid-proposals"
  | "missing-proposal"
  | "invalid-co-ratifiers"
  | "missing-co-ratifier"
  | "invalid-reason"
  | "invalid-supersedes";

export type ContextCheck = "valid" | "not-maintainer" | "edited" | "different-head" | "supersedes-itself";

export type ApprovalCheck = "valid" | "invalid-header" | "different-decision" | "invalid-reason";

export interface FencedRecord { count: number; text: string }

export const ruleVersion = "slop-score-v2";
export const maximumRecordLine = 32768;

/** @throws {never} */
export function isNodeIdCode(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95 || code === 61 || code === 45;
}

/** @throws {never} */
export function isNodeId(text: string): boolean {
  //@ ensures \result ==> 4 <= text.length && text.length <= 256
  if (text.length < 4 || text.length > 256) return false;
  let i = 0;
  while (i < text.length) {
    //@ invariant 0 <= i && i <= text.length
    if (!isNodeIdCode(text.charCodeAt(i))) return false;
    i = i + 1;
  }
  return true;
}

/** @throws {never} */
export function isGitSha(text: string): boolean {
  //@ ensures \result ==> text.length === 40
  if (text.length !== 40) return false;
  let i = 0;
  while (i < 40) {
    //@ invariant 0 <= i && i <= 40
    const code = text.charCodeAt(i);
    if (!((code >= 48 && code <= 57) || (code >= 97 && code <= 102))) return false;
    i = i + 1;
  }
  return true;
}

/** @throws {never} */
export function isWorkUnitCode(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 97 && code <= 122) || code === 95 || code === 45;
}

/** @throws {never} */
export function isWorkUnitId(text: string): boolean {
  //@ ensures \result ==> 6 <= text.length && text.length <= 131
  if (text.length < 6 || text.length > 131 || !text.startsWith("wu_")) return false;
  const first = text.charCodeAt(3);
  if (!((first >= 48 && first <= 57) || (first >= 97 && first <= 122))) return false;
  let i = 4;
  while (i < text.length) {
    //@ invariant 4 <= i && i <= text.length
    if (!isWorkUnitCode(text.charCodeAt(i))) return false;
    i = i + 1;
  }
  return true;
}

/** @throws {never} */
//@ pure
export function tierThirds(tier: string): number {
  return tier === "micro" ? 1 : tier === "small" ? 3 : tier === "medium" ? 9 : tier === "large" ? 24 : tier === "xl" ? 45 : tier === "exceptional" ? 75 : 0;
}

/** @throws {never} */
export function distinctNodeIds(ids: string[], limit: number): boolean {
  //@ ensures \result ==> ids.length <= limit
  if (ids.length > limit) return false;
  let i = 0;
  while (i < ids.length) {
    //@ invariant 0 <= i && i <= ids.length
    if (!isNodeId(ids[i])) return false;
    let j = 0;
    while (j < i) {
      //@ invariant 0 <= j && j <= i
      if (ids[j] === ids[i]) return false;
      j = j + 1;
    }
    i = i + 1;
  }
  return true;
}

/** @throws {never} */
//@ pure
export function validReason(reason: string): boolean {
  return reason.length >= 12 && reason.length <= 4096;
}

/** @throws {never} */
export function checkRatificationRecord(record: RatificationRecord, projectRegistered: boolean): RecordCheck {
  //@ ensures \result === "valid" ==> tierThirds(record.tier) === record.scoreThirds && record.scoreThirds >= 1
  //@ ensures \result === "valid" ==> record.headSha.length === 40 && validReason(record.reason)
  if (record.schemaVersion !== "1" || record.ruleVersion !== ruleVersion) return "unsupported-version";
  if (!projectRegistered) return "unregistered-project";
  if (!isNodeId(record.pullRequestNodeId)) return "invalid-pull-request";
  if (!isGitSha(record.headSha)) return "invalid-head";
  if (!isWorkUnitId(record.workUnitId)) return "invalid-work-unit";
  const thirds = tierThirds(record.tier);
  if (thirds === 0 || record.scoreThirds !== thirds) return "tier-mismatch";
  if (!distinctNodeIds(record.proposalReviewNodeIds, 16)) return "invalid-proposals";
  if (record.tier !== "micro" && record.proposalReviewNodeIds.length === 0) return "missing-proposal";
  if (!distinctNodeIds(record.coRatifierNodeIds, 8)) return "invalid-co-ratifiers";
  if ((record.tier === "xl" || record.tier === "exceptional") && record.coRatifierNodeIds.length < 1) return "missing-co-ratifier";
  if (!validReason(record.reason)) return "invalid-reason";
  const supersedes = record.supersedes;
  if (supersedes !== null && !isNodeId(supersedes)) return "invalid-supersedes";
  return "valid";
}

/** @throws {never} */
export function isMaintainerAssociation(association: string): boolean {
  return association === "OWNER" || association === "MEMBER" || association === "COLLABORATOR";
}

/** @throws {never} */
export function checkRatificationContext(record: RatificationRecord, context: RatificationContext): ContextCheck {
  //@ ensures \result === "valid" ==> record.headSha === context.headSha.toLowerCase()
  //@ ensures \result === "valid" ==> context.createdAt === context.updatedAt
  if (!isMaintainerAssociation(context.authorAssociation)) return "not-maintainer";
  if (context.createdAt !== context.updatedAt) return "edited";
  if (record.projectId !== context.projectId || record.pullRequestNodeId !== context.pullRequestNodeId
    || record.headSha !== context.headSha.toLowerCase()) {
    return "different-head";
  }
  if (record.supersedes === context.sourceNodeId) return "supersedes-itself";
  return "valid";
}

/** @throws {never} */
export function checkApproval(approval: ApprovalRecord, expected: RatificationRecord): ApprovalCheck {
  //@ ensures \result === "valid" ==> approval.tier === expected.tier && approval.headSha === expected.headSha
  if (approval.schemaVersion !== "1" || approval.ruleVersion !== ruleVersion || approval.decision !== "approve") return "invalid-header";
  if (approval.projectId !== expected.projectId || approval.pullRequestNodeId !== expected.pullRequestNodeId
    || approval.headSha !== expected.headSha || approval.workUnitId !== expected.workUnitId || approval.tier !== expected.tier) {
    return "different-decision";
  }
  if (!validReason(approval.reason)) return "invalid-reason";
  return "valid";
}

/** @throws {never} */
export function isLineBreak(code: number): boolean {
  return code === 10 || code === 13 || code === 8232 || code === 8233;
}

/** @throws {never} */
export function isLineStart(body: string, at: number): boolean {
  //@ requires 0 <= at && at <= body.length
  return at === 0 || isLineBreak(body.charCodeAt(at - 1));
}

/** @throws {never} */
export function skipFenceIndent(body: string, at: number): number {
  //@ requires 0 <= at && at <= body.length
  //@ ensures at <= \result && \result <= body.length
  let i = at;
  while (i < body.length && i < at + 3 && body.charCodeAt(i) === 32) {
    //@ invariant at <= i && i <= body.length
    i = i + 1;
  }
  return i;
}

/** @throws {never} */
export function skipBlanks(body: string, at: number): number {
  //@ requires 0 <= at && at <= body.length
  //@ ensures at <= \result && \result <= body.length
  let i = at;
  while (i < body.length && (body.charCodeAt(i) === 32 || body.charCodeAt(i) === 9)) {
    //@ invariant at <= i && i <= body.length
    i = i + 1;
  }
  return i;
}

/** @throws {never} */
export function newlineEnd(body: string, at: number): number {
  //@ requires 0 <= at && at <= body.length
  //@ ensures \result === -1 || (at < \result && \result <= body.length)
  if (at < body.length && body.charCodeAt(at) === 10) return at + 1;
  if (at + 1 < body.length && body.charCodeAt(at) === 13 && body.charCodeAt(at + 1) === 10) return at + 2;
  return -1;
}

/** @throws {never} */
export function codePoints(text: string, from: number, to: number): number {
  //@ requires 0 <= from && from <= to && to <= text.length
  //@ ensures 0 <= \result && \result <= to - from
  let count = 0;
  let i = from;
  while (i < to) {
    //@ invariant from <= i && i <= to
    //@ invariant 0 <= count && count <= i - from
    const code = text.charCodeAt(i);
    const pair = code >= 55296 && code <= 56319 && i + 1 < to && text.charCodeAt(i + 1) >= 56320 && text.charCodeAt(i + 1) <= 57343;
    i = pair ? i + 2 : i + 1;
    count = count + 1;
  }
  return count;
}

/** @throws {never} */
export function fencedRecordEnd(body: string, at: number, name: string): number {
  //@ requires 0 <= at && at <= body.length
  //@ ensures \result === -1 || (at < \result && \result <= body.length)
  const open = skipFenceIndent(body, at);
  if (!body.startsWith("```" + name, open)) return -1;
  const content = newlineEnd(body, skipBlanks(body, open + 3 + name.length));
  if (content < 0) return -1;
  let end = content;
  while (end < body.length && body.charCodeAt(end) !== 10 && body.charCodeAt(end) !== 13) {
    //@ invariant content <= end && end <= body.length
    end = end + 1;
  }
  if (end === content || codePoints(body, content, end) > maximumRecordLine) return -1;
  const close = newlineEnd(body, end);
  if (close < 0) return -1;
  const fence = skipFenceIndent(body, close);
  if (!body.startsWith("```", fence)) return -1;
  const after = skipBlanks(body, fence + 3);
  return after === body.length || isLineBreak(body.charCodeAt(after)) ? after : -1;
}

/** @throws {never} */
export function recordLine(body: string, at: number, name: string): string {
  //@ requires 0 <= at && at <= body.length
  const open = skipFenceIndent(body, at);
  if (!body.startsWith("```" + name, open)) return "";
  const content = newlineEnd(body, skipBlanks(body, open + 3 + name.length));
  if (content < 0) return "";
  let end = content;
  while (end < body.length && body.charCodeAt(end) !== 10 && body.charCodeAt(end) !== 13) {
    //@ invariant content <= end && end <= body.length
    end = end + 1;
  }
  return body.slice(content, end);
}

/** @throws {never} */
export function fencedRecord(body: string, name: string): FencedRecord {
  //@ ensures \result.count >= 0
  //@ ensures \result.count === 0 ==> \result.text === ""
  let count = 0;
  let text = "";
  let at = 0;
  while (at <= body.length) {
    //@ invariant 0 <= at && at <= body.length + 1
    //@ invariant count >= 0
    //@ invariant count === 0 ==> text === ""
    //@ decreases body.length + 1 - at
    const end = isLineStart(body, at) ? fencedRecordEnd(body, at, name) : -1;
    if (end > 0) {
      if (count === 0) text = recordLine(body, at, name);
      count = count + 1;
      at = end + 1;
    } else {
      at = at + 1;
    }
  }
  return { count: count, text: text };
}
