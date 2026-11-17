//@ backend dafny
// spec/points/census.md, "Every retained item has a deterministic, fail-closed selection decision with all its reasons"; spec/points/census.md, "A maintainer claim counts only from a trusted association or a claim label, and a claim comment lapses after seven days"
import { type AuthorKind, type ClaimComment, type ClaimEvidence, type ClaimSource, type Item, type ItemKind, claimCommentCounts, claimSource, claimedFrom } from "../../../gen/points__census.ts";

export interface Actor { id: string; login: string; kind: string }

export interface Comment { id: string; author: Actor | null; association: string; createdAt: number; body: string }

export interface GitHubItem {
  id: number;
  kind: ItemKind;
  open: boolean;
  author: Actor | null;
  slopbot: boolean;
  title: string;
  body: string;
  labels: string[];
  assignees: Actor[];
  comments: Comment[];
  linkedPullRequests: number;
  draft: boolean;
  filesAvailable: boolean;
  reviewDecision: string;
  activeReviewRequests: number;
}

export interface ClaimDecision { source: ClaimSource; comment: number }

export type Priority = "urgent" | "high" | "normal" | "low";

export interface Fence { marker: number; length: number; restBlank: boolean }

/** @throws {never} */
export function isSpace(code: number): boolean {
  return (code >= 9 && code <= 13) || code === 32 || code === 160 || code === 5760 || (code >= 8192 && code <= 8202)
    || code === 8232 || code === 8233 || code === 8239 || code === 8287 || code === 12288 || code === 65279;
}

/** @throws {never} */
export function isLineTerminator(code: number): boolean {
  return code === 10 || code === 13 || code === 8232 || code === 8233;
}

/** @throws {never} */
export function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

/** @throws {never} */
export function isWordCode(code: number): boolean {
  return isDigit(code) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;
}

/** @throws {never} */
export function foldCode(code: number): number {
  //@ ensures (code >= 65 && code <= 90) ==> \result === code + 32
  //@ ensures !(code >= 65 && code <= 90) ==> \result === code
  return code >= 65 && code <= 90 ? code + 32 : code;
}

/** @throws {never} */
export function phraseAt(text: string, start: number, phrase: string): number {
  //@ requires 0 <= start && start <= text.length
  //@ ensures \result === -1 || (start <= \result && \result <= text.length)
  if (text.length - start < phrase.length) return -1;
  let i = 0;
  while (i < phrase.length) {
    //@ invariant 0 <= i && i <= phrase.length
    const expected = phrase.charCodeAt(i);
    const actual = foldCode(text.charCodeAt(start + i));
    const separator = expected === 45 && (actual === 45 || actual === 32);
    if (!separator && actual !== expected) return -1;
    i = i + 1;
  }
  return start + phrase.length;
}

/** @throws {never} */
export function skipSpaces(text: string, start: number): number {
  //@ requires 0 <= start && start <= text.length
  //@ ensures start <= \result && \result <= text.length
  let i = start;
  while (i < text.length && isSpace(text.charCodeAt(i))) {
    //@ invariant start <= i && i <= text.length
    i = i + 1;
  }
  return i;
}

/** @throws {never} */
export function wholeAt(text: string, start: number, phrases: string[]): boolean {
  //@ requires 0 <= start && start <= text.length
  for (const phrase of phrases) {
    if (phraseAt(text, start, phrase) === text.length) return true;
  }
  return false;
}

/** @throws {never} */
export function labelSlugAt(text: string, start: number): boolean {
  //@ requires 0 <= start && start <= text.length
  let i = skipSpaces(text, start);
  if (i >= text.length || text.charCodeAt(i) !== 58) return false;
  i = skipSpaces(text, i + 1);
  if (i >= text.length) return false;
  const first = foldCode(text.charCodeAt(i));
  if (!(isDigit(first) || (first >= 97 && first <= 122))) return false;
  i = i + 1;
  while (i < text.length) {
    //@ invariant 0 <= i && i <= text.length
    const code = foldCode(text.charCodeAt(i));
    if (!(isDigit(code) || (code >= 97 && code <= 122) || code === 46 || code === 95 || code === 47 || code === 45)) return false;
    i = i + 1;
  }
  return true;
}

/** @throws {never} */
export function claimWordThenSlug(text: string, words: string[]): boolean {
  for (const word of words) {
    const end = phraseAt(text, 0, word);
    if (end === text.length || (end > 0 && labelSlugAt(text, end))) return true;
  }
  return false;
}

/** @throws {never} */
export function normalizeLabel(label: string): string {
  return label.trim().toLowerCase();
}

/** @throws {never} */
export function isIssueClaimLabel(normalized: string): boolean {
  if (claimWordThenSlug(normalized, ["claimed", "in-progress", "working"])) return true;
  const status = phraseAt(normalized, 0, "status:");
  return status > 0 && wholeAt(normalized, skipSpaces(normalized, status), ["claimed", "in-progress"]);
}

/** @throws {never} */
export function isReviewClaimLabel(normalized: string): boolean {
  if (claimWordThenSlug(normalized, ["review-claimed", "review-in-progress"])) return true;
  const review = phraseAt(normalized, 0, "review:");
  return review > 0 && wholeAt(normalized, skipSpaces(normalized, review), ["claimed"]);
}

/** @throws {never} */
export function isBlockedLabel(normalized: string): boolean {
  if (wholeAt(normalized, 0, ["blocked", "do-not-merge", "human-only", "needs-human", "needs-human-input", "needs-human-review", "needs-human-verify", "needs-human-verification", "needs-shaw"])) {
    return true;
  }
  const status = phraseAt(normalized, 0, "status");
  if (status < 0) return false;
  const separator = skipSpaces(normalized, status);
  if (separator >= normalized.length) return false;
  const code = normalized.charCodeAt(separator);
  if (code !== 58 && code !== 47) return false;
  return wholeAt(normalized, skipSpaces(normalized, separator + 1), ["blocked", "proposal", "human-only", "needs-human", "needs-human-input", "needs-human-review", "needs-human-verify", "needs-human-verification", "needs-shaw"]);
}

/** @throws {never} */
export function isSecuritySeparator(code: number): boolean {
  return code === 45 || code === 95 || code === 32;
}

/** @throws {never} */
export function leakWordEnd(label: string, start: number, stem: string): number {
  //@ requires 0 <= start && start <= label.length
  //@ ensures \result === -1 || (start <= \result && \result <= label.length)
  const afterStem = phraseAt(label, start, stem);
  if (afterStem < 0) return -1;
  const direct = phraseAt(label, afterStem, "leak");
  if (direct >= 0) return direct;
  if (afterStem < label.length && isSecuritySeparator(label.charCodeAt(afterStem))) {
    return phraseAt(label, afterStem + 1, "leak");
  }
  return -1;
}

/** @throws {never} */
export function securityWordEndsAt(label: string, start: number, end: number): boolean {
  //@ requires 0 <= start && start <= label.length
  return end >= 0 && (end === label.length || isSecuritySeparator(label.charCodeAt(end)));
}

/** @throws {never} */
export function isSecuritySensitiveLabel(label: string): boolean {
  let start = 0;
  while (start < label.length) {
    //@ invariant 0 <= start && start <= label.length
    if (start === 0 || isSecuritySeparator(label.charCodeAt(start - 1))) {
      if (securityWordEndsAt(label, start, phraseAt(label, start, "security"))
        || securityWordEndsAt(label, start, phraseAt(label, start, "vulnerability"))
        || securityWordEndsAt(label, start, phraseAt(label, start, "cve"))
        || securityWordEndsAt(label, start, leakWordEnd(label, start, "credential"))
        || securityWordEndsAt(label, start, leakWordEnd(label, start, "secret"))) {
        return true;
      }
    }
    start = start + 1;
  }
  return false;
}

/** @throws {never} */
export function isEpicLabel(label: string): boolean {
  const text = label.trim();
  const end = phraseAt(text, 0, "epic");
  if (end < 0) return false;
  if (end === text.length) return true;
  const digits = skipSpaces(text, end);
  if (digits === end || digits >= text.length) return false;
  let i = digits;
  while (i < text.length) {
    //@ invariant digits <= i && i <= text.length
    if (!isDigit(text.charCodeAt(i))) return false;
    i = i + 1;
  }
  return true;
}

/** @throws {never} */
export function bracketMentionsEpic(title: string, open: number): boolean {
  //@ requires 0 <= open && open < title.length
  let close = open + 1;
  while (close < title.length && title.charCodeAt(close) !== 93) {
    //@ invariant open < close && close <= title.length
    close = close + 1;
  }
  if (close >= title.length) return false;
  let i = open + 1;
  while (i + 4 <= close) {
    //@ invariant open < i && i <= close
    const end = phraseAt(title, i, "epic");
    if (end === i + 4 && !isWordCode(title.charCodeAt(i - 1)) && (end === close || !isWordCode(title.charCodeAt(end)))) return true;
    i = i + 1;
  }
  return false;
}

/** @throws {never} */
export function isEpicTitle(title: string): boolean {
  const start = skipSpaces(title, 0);
  if (start >= title.length) return false;
  if (title.charCodeAt(start) === 91) return bracketMentionsEpic(title, start);
  const end = phraseAt(title, start, "epic");
  if (end < 0) return false;
  const colon = skipSpaces(title, end);
  return colon < title.length && title.charCodeAt(colon) === 58;
}

/** @throws {never} */
export function isEpicIssue(title: string, labels: string[]): boolean {
  if (isEpicTitle(title)) return true;
  for (const label of labels) {
    if (isEpicLabel(label)) return true;
  }
  return false;
}

/** @throws {never} */
export function isContributorReadyLabel(normalized: string): boolean {
  return normalized === "bug-confirmed" || normalized === "demo-blocker" || normalized === "good first issue"
    || normalized === "help wanted" || normalized === "launch-qa" || normalized === "mission-ready"
    || normalized === "needs-review" || normalized === "needs testing" || normalized === "p0" || normalized === "p1"
    || normalized === "p2" || normalized === "priority: high" || normalized === "triage-reviewed";
}

/** @throws {never} */
export function isConfirmationLabel(normalized: string): boolean {
  return normalized === "confirmed" || normalized === "status: confirmed" || normalized === "status: triaged"
    || normalized === "triaged" || normalized === "validated";
}

/** @throws {never} */
export function hasConfirmationLabel(labels: string[]): boolean {
  for (const label of labels) {
    if (isConfirmationLabel(normalizeLabel(label))) return true;
  }
  return false;
}

/** @throws {never} */
export function workItemPriority(labels: string[]): Priority {
  let high = false;
  let low = false;
  for (const label of labels) {
    const name = normalizeLabel(label);
    if (name === "blocker" || name === "critical" || name === "p0" || name === "priority: critical" || name === "priority: urgent" || name === "urgent") {
      return "urgent";
    }
    if (name === "high priority" || name === "p1" || name === "priority: high") high = true;
    if (name === "low priority" || name === "p3" || name === "p4" || name === "priority: low") low = true;
  }
  if (high) return "high";
  if (low) return "low";
  return "normal";
}

/** @throws {never} */
export function listMarkerEnd(line: string, start: number): number {
  //@ requires 0 <= start && start <= line.length
  //@ ensures \result === -1 || (start < \result && \result <= line.length)
  if (start >= line.length) return -1;
  const first = line.charCodeAt(start);
  let i = start;
  if (first === 45 || first === 42 || first === 43) {
    i = start + 1;
  } else {
    while (i < line.length && isDigit(line.charCodeAt(i))) {
      //@ invariant start <= i && i <= line.length
      i = i + 1;
    }
    if (i === start || i >= line.length) return -1;
    const close = line.charCodeAt(i);
    if (close !== 46 && close !== 41) return -1;
    i = i + 1;
  }
  const after = skipSpaces(line, i);
  return after === i ? -1 : after;
}

/** @throws {never} */
export function leadingSpaces(line: string): number {
  //@ ensures 0 <= \result && \result <= 3 && \result <= line.length
  let i = 0;
  while (i < 3 && i < line.length && isSpace(line.charCodeAt(i))) {
    //@ invariant 0 <= i && i <= 3 && i <= line.length
    i = i + 1;
  }
  return i;
}

/** @throws {never} */
export function fenceOf(line: string): Fence {
  const none: Fence = { marker: 0, length: 0, restBlank: false };
  const indent = leadingSpaces(line);
  if (indent >= line.length) return none;
  let start = indent;
  const first = line.charCodeAt(indent);
  if (first !== 96 && first !== 126) {
    const marker = listMarkerEnd(line, indent);
    if (marker < 0 || marker >= line.length) return none;
    start = marker;
  }
  const code = line.charCodeAt(start);
  if (code !== 96 && code !== 126) return none;
  let end = start;
  while (end < line.length && line.charCodeAt(end) === code) {
    //@ invariant start <= end && end <= line.length
    end = end + 1;
  }
  if (end - start < 3) return none;
  let i = end;
  while (i < line.length) {
    //@ invariant end <= i && i <= line.length
    if (isLineTerminator(line.charCodeAt(i))) return none;
    i = i + 1;
  }
  return { marker: code, length: end - start, restBlank: line.slice(end).trim().length === 0 };
}

/** @throws {never} */
export function isQuoteLine(line: string): boolean {
  const indent = leadingSpaces(line);
  return indent < line.length && line.charCodeAt(indent) === 62;
}

/** @throws {never} */
export function isIndentedCode(line: string): boolean {
  return line.startsWith("\t") || line.startsWith("    ");
}

/** @throws {never} */
export function withoutPairs(text: string, code: number): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    //@ invariant 0 <= i && i <= text.length
    if (i + 1 < text.length && text.charCodeAt(i) === code && text.charCodeAt(i + 1) === code) {
      i = i + 2;
    } else {
      out = out + text.slice(i, i + 1);
      i = i + 1;
    }
  }
  return out;
}

/** @throws {never} */
export function normalizedLine(line: string): string {
  const trimmed = line.trim();
  const marker = listMarkerEnd(trimmed, 0);
  const content = marker < 0 ? trimmed : trimmed.slice(marker);
  return withoutPairs(withoutPairs(content, 42), 95);
}

/** @throws {never} */
export function markdownLines(body: string): string[] {
  const lines: string[] = [];
  let fenceMarker = 0;
  let fenceLength = 0;
  let offset = 0;
  while (offset <= body.length) {
    //@ invariant 0 <= offset && offset <= body.length + 1
    //@ decreases body.length + 1 - offset
    let end = offset;
    while (end < body.length && body.charCodeAt(end) !== 10) {
      //@ invariant offset <= end && end <= body.length
      end = end + 1;
    }
    const raw = body.slice(offset, end);
    const line = raw.endsWith("\r") ? raw.slice(0, raw.length - 1) : raw;
    const fence = fenceOf(line);
    if (fence.marker !== 0) {
      if (fenceMarker === 0) {
        fenceMarker = fence.marker;
        fenceLength = fence.length;
      } else if (fence.marker === fenceMarker && fence.length >= fenceLength && fence.restBlank) {
        fenceMarker = 0;
        fenceLength = 0;
      }
    } else if (fenceMarker === 0 && !isQuoteLine(line) && !isIndentedCode(line)) {
      const normalized = normalizedLine(line);
      if (!normalized.startsWith("`")) lines.push(normalized);
    }
    offset = end + 1;
  }
  return lines;
}

/** @throws {never} */
export function lineSegments(line: string): string[] {
  const segments: string[] = [];
  let start = 0;
  let i = 0;
  while (i < line.length) {
    //@ invariant 0 <= start && start <= i && i <= line.length
    if (isLineTerminator(line.charCodeAt(i))) {
      segments.push(line.slice(start, i));
      start = i + 1;
    }
    i = i + 1;
  }
  segments.push(line.slice(start));
  return segments;
}

/** @throws {never} */
export function optionalCode(text: string, at: number, code: number): number {
  //@ requires 0 <= at && at <= text.length
  //@ ensures at <= \result && \result <= text.length
  return at < text.length && text.charCodeAt(at) === code ? at + 1 : at;
}

/** @throws {never} */
export function humanOnlyAfterNo(text: string, start: number): boolean {
  //@ requires 0 <= start && start <= text.length
  const human = phraseAt(text, start, "human-only");
  if (human < 0) return false;
  const word = skipSpaces(text, human);
  if (word === human) return false;
  for (const kind of ["comment", "contribution", "epic", "issue", "report", "request", "review", "work"]) {
    const end = phraseAt(text, word, kind);
    if (end >= 0 && skipSpaces(text, optionalCode(text, end, 96)) === text.length) return true;
  }
  return false;
}

/** @throws {never} */
export function isHumanOnlySegment(text: string): boolean {
  let i = skipSpaces(text, 0);
  if (i < text.length && (text.charCodeAt(i) === 45 || text.charCodeAt(i) === 42)) i = skipSpaces(text, i + 1);
  const assistance = phraseAt(text, i, "ai assistance");
  const attribution = phraseAt(text, i, "attribution");
  const declared = assistance >= 0 ? assistance : attribution;
  if (declared >= 0) {
    const colon = skipSpaces(text, declared);
    if (colon < text.length && text.charCodeAt(colon) === 58) i = skipSpaces(text, colon + 1);
  }
  i = optionalCode(text, i, 96);
  const no = phraseAt(text, i, "no");
  if (no >= 0) {
    const separator = skipSpaces(text, no);
    if (separator < text.length) {
      const code = text.charCodeAt(separator);
      if ((code === 45 || code === 8212 || code === 58) && humanOnlyAfterNo(text, skipSpaces(text, separator + 1))) return true;
    }
  }
  return humanOnlyAfterNo(text, i);
}

/** @throws {never} */
export function hasHumanOnlyDeclaration(body: string): boolean {
  for (const line of markdownLines(body)) {
    for (const segment of lineSegments(line)) {
      if (isHumanOnlySegment(segment)) return true;
    }
  }
  return false;
}

/** @throws {never} */
export function isClaimLine(line: string, review: boolean): boolean {
  let i = phraseAt(line, 0, "claiming");
  if (i < 0) return false;
  if (review) {
    const word = skipSpaces(line, i);
    if (word === i) return false;
    i = phraseAt(line, word, "review");
    if (i < 0) return false;
  }
  if (i >= line.length || line.charCodeAt(i) !== 58) return false;
  const rest = skipSpaces(line, i + 1);
  return rest < line.length;
}

/** @throws {never} */
export function hasClaimLine(body: string, review: boolean): boolean {
  for (const line of markdownLines(body)) {
    if (isClaimLine(line, review)) return true;
  }
  return false;
}

/** @throws {never} */
export function sameActor(left: Actor, right: Actor): boolean {
  return left.id === right.id || left.login.toLowerCase() === right.login.toLowerCase();
}

/** @throws {never} */
export function isTrustedClaimAssociation(association: string): boolean {
  return association === "COLLABORATOR" || association === "MEMBER" || association === "OWNER";
}

/** @throws {never} */
export function compareCodeUnits(left: string, right: string): number {
  let i = 0;
  while (i < left.length && i < right.length) {
    //@ invariant 0 <= i && i <= left.length && i <= right.length
    const a = left.charCodeAt(i);
    const b = right.charCodeAt(i);
    if (a !== b) return a < b ? -1 : 1;
    i = i + 1;
  }
  return left.length === right.length ? 0 : (left.length < right.length ? -1 : 1);
}

/** @throws {never} */
export function hasClaimLabel(labels: string[], review: boolean): boolean {
  for (const label of labels) {
    const normalized = normalizeLabel(label);
    if (review ? isReviewClaimLabel(normalized) : isIssueClaimLabel(normalized)) return true;
  }
  return false;
}

/** @throws {never} */
export function hasCreditedAssignee(item: GitHubItem): boolean {
  for (const actor of item.assignees) {
    const author = item.author;
    const isAuthor = item.kind === "PullRequestItem" && author !== null && sameActor(actor, author);
    if (actor.kind !== "Bot" && !isAuthor) return true;
  }
  return false;
}

/** @throws {never} */
export function claimCommentOf(item: GitHubItem, comment: Comment): ClaimComment {
  //@ ensures \result.createdAt === comment.createdAt
  //@ ensures comment.author === null ==> !\result.trustedAssociation
  const author = comment.author;
  const itemAuthor = item.author;
  return {
    botAuthor: author !== null && author.kind === "Bot",
    trustedAssociation: author !== null && isTrustedClaimAssociation(comment.association),
    byItemAuthor: author !== null && itemAuthor !== null && sameActor(author, itemAuthor),
    claimLine: hasClaimLine(comment.body, item.kind === "PullRequestItem"),
    createdAt: comment.createdAt,
  };
}

/** @throws {never} */
export function claimEvidence(item: GitHubItem): ClaimEvidence {
  //@ ensures \result.kind === item.kind && \result.comments.length === item.comments.length
  //@ ensures \result.openLinkedPullRequest === (item.linkedPullRequests > 0)
  const comments: ClaimComment[] = [];
  let i = 0;
  while (i < item.comments.length) {
    //@ invariant 0 <= i && i <= item.comments.length && comments.length === i
    comments.push(claimCommentOf(item, item.comments[i]));
    i = i + 1;
  }
  return {
    kind: item.kind,
    otherAssignee: hasCreditedAssignee(item),
    openLinkedPullRequest: item.linkedPullRequests > 0,
    comments: comments,
    claimLabel: hasClaimLabel(item.labels, item.kind === "PullRequestItem"),
  };
}

/** @throws {never} */
export function latestClaimComment(comments: Comment[], claim: ClaimEvidence, referenceTime: number): number {
  //@ requires claim.comments.length === comments.length
  //@ ensures -1 <= \result && \result < comments.length
  //@ ensures \result >= 0 ==> claimCommentCounts(claim, claim.comments[\result], referenceTime)
  //@ ensures forall(k, 0 <= k && k < comments.length && claimCommentCounts(claim, claim.comments[k], referenceTime) ==> \result >= 0)
  let best = -1;
  let i = 0;
  while (i < comments.length) {
    //@ invariant 0 <= i && i <= comments.length
    //@ invariant -1 <= best && best < i
    //@ invariant best >= 0 ==> claimCommentCounts(claim, claim.comments[best], referenceTime)
    //@ invariant forall(k, 0 <= k && k < i && claimCommentCounts(claim, claim.comments[k], referenceTime) ==> best >= 0)
    if (claimCommentCounts(claim, claim.comments[i], referenceTime)) {
      if (best < 0 || comments[i].createdAt > comments[best].createdAt
        || (comments[i].createdAt === comments[best].createdAt && compareCodeUnits(comments[i].id, comments[best].id) < 0)) {
        best = i;
      }
    }
    i = i + 1;
  }
  return best;
}

/** @throws {never} */
export function claimDecision(item: GitHubItem, referenceTime: number): ClaimDecision {
  //@ ensures -1 <= \result.comment && \result.comment < item.comments.length
  //@ ensures \result.comment >= 0 ==> \result.source === "CommentClaim"
  const claim = claimEvidence(item);
  const source = claimSource(claim, referenceTime);
  return { source: source, comment: source === "CommentClaim" ? latestClaimComment(item.comments, claim, referenceTime) : -1 };
}

/** @throws {never} */
export function authorKind(item: GitHubItem): AuthorKind {
  //@ ensures item.author === null ==> \result === "UnknownAuthor"
  const author = item.author;
  if (author === null || author.kind === "Unknown") return "UnknownAuthor";
  if (author.kind === "Bot") return item.slopbot ? "SlopbotAuthor" : "BotAuthor";
  return "HumanAuthor";
}

/** @throws {never} */
export function hasBlockedLabel(labels: string[]): boolean {
  for (const label of labels) {
    if (isBlockedLabel(normalizeLabel(label))) return true;
  }
  return false;
}

/** @throws {never} */
export function hasSecurityLabel(labels: string[]): boolean {
  for (const label of labels) {
    if (isSecuritySensitiveLabel(label)) return true;
  }
  return false;
}

/** @throws {never} */
export function hasContributorReadyLabel(labels: string[]): boolean {
  for (const label of labels) {
    if (isContributorReadyLabel(normalizeLabel(label))) return true;
  }
  return false;
}

/** @throws {never} */
export function censusItem(item: GitHubItem, referenceTime: number): Item {
  //@ ensures \result.id === item.id && \result.kind === item.kind && \result.open === item.open
  //@ ensures item.author === null ==> \result.author === "UnknownAuthor"
  //@ ensures !\result.humanGated
  //@ ensures item.kind === "IssueItem" ==> \result.diffAvailable && !\result.draft && !\result.reviewRequested && !\result.approved && !\result.changesRequested
  //@ ensures item.kind === "PullRequestItem" ==> \result.contributorReady && !\result.epic
  const pullRequest = item.kind === "PullRequestItem";
  const epic = !pullRequest && isEpicIssue(item.title, item.labels);
  return {
    id: item.id,
    kind: item.kind,
    open: item.open,
    author: authorKind(item),
    diffAvailable: !pullRequest || item.filesAvailable,
    hasAssignee: hasCreditedAssignee(item),
    claimed: claimedFrom(claimEvidence(item), referenceTime),
    draft: pullRequest && item.draft,
    reviewRequested: pullRequest && item.activeReviewRequests > 0,
    approved: pullRequest && item.reviewDecision === "APPROVED",
    changesRequested: pullRequest && item.reviewDecision === "CHANGES_REQUESTED",
    securityLabel: hasSecurityLabel(item.labels),
    humanGated: false,
    epic: epic,
    contributorReady: pullRequest || (!epic && hasContributorReadyLabel(item.labels)),
    blockedLabel: hasBlockedLabel(item.labels),
  };
}
