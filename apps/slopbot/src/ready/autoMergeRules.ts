// spec/slopbot/readyLabel.md, "The pilot workflow merges only on Slop's own repository when switched on, into the registered integration branch, and never touches `.github/`"
import {
  type AutoMergeLabelSource,
  permissionLookupLimit,
  pilotRepositoryId,
  readyLabelName,
  slopbotBotId,
  slopbotBotLogin,
} from "../../gen/slopbot__readyLabel.ts";

export const neverBases: ReadonlyArray<string> = ["main"];
export const projectFilePath = ".github/slop-project.json";

export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

export interface ParsedPull {
  readonly number: number;
  readonly state: string;
  readonly merged: boolean;
  readonly draft: boolean;
  readonly mergeable: boolean | null;
  readonly mergeableState: string;
  readonly headSha: string;
  readonly baseRef: string;
  readonly baseRepositoryId: number;
  readonly authorId: number;
  readonly changedFiles: number;
  readonly labels: ReadonlyArray<string>;
}

export interface ParsedReview {
  readonly userId: number;
  readonly login: string;
  readonly state: string;
  readonly commit: string | null;
}

export interface LabelEventSummary {
  readonly labelledAt: number;
  readonly labelSource: AutoMergeLabelSource;
  readonly forcePushedAfterLabel: boolean;
}

export interface ReviewSummary {
  readonly approvals: ReadonlyArray<ParsedReview>;
  readonly requests: ReadonlyArray<ParsedReview>;
  readonly headSeenBeforeLabel: boolean;
}

function ok<T>(value: T): ParseResult<T> {
  return { ok: true, value };
}

function fail<T>(reason: string): ParseResult<T> {
  return { ok: false, reason };
}

function asRecord(value: unknown, what: string): ParseResult<Readonly<Record<string, unknown>>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return fail(`${what} is unreadable`);
  return ok(value as Readonly<Record<string, unknown>>);
}

function asText(value: unknown, what: string): ParseResult<string> {
  if (typeof value !== "string" || value.length === 0) return fail(`${what} is unreadable`);
  return ok(value);
}

function asInteger(value: unknown, what: string): ParseResult<number> {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return fail(`${what} is unreadable`);
  return ok(value);
}

function asTime(value: unknown, what: string): ParseResult<number> {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(parsed)) return fail(`${what} has no readable time`);
  return ok(parsed);
}

/** @throws {never} */
export function isGithubPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower === ".github" || lower.startsWith(".github/");
}

/** @throws {never} */
export function mergeComment(headSha: string, approvers: ReadonlyArray<string>): string {
  return [
    `Merged automatically by this repository's ready auto-merge workflow at ${headSha}.`,
    `It carried the \`${readyLabelName}\` label and was approved at that commit by ${approvers.join(", ")}.`,
    "Slopbot applied the label and did not merge.",
  ].join(" ");
}

/** @throws {never} */
export function parseRepositoryMeta(data: unknown, repository: string): ParseResult<{ readonly defaultBranch: string }> {
  const repo = asRecord(data, "the repository");
  if (!repo.ok) return repo;
  if (repo.value.id !== pilotRepositoryId || repo.value.full_name !== repository) return fail("the repository is not the pilot repository");
  const defaultBranch = asText(repo.value.default_branch, "the default branch");
  if (!defaultBranch.ok) return defaultBranch;
  return ok({ defaultBranch: defaultBranch.value });
}

/** @throws {never} */
export function parseLabelledPullNumbers(issues: ReadonlyArray<unknown>): ParseResult<ReadonlyArray<number>> {
  const numbers: number[] = [];
  for (const raw of issues) {
    const item = asRecord(raw, "a labelled item");
    if (!item.ok) return item;
    if (item.value.pull_request == null) continue;
    const number = asInteger(item.value.number, "a pull request number");
    if (!number.ok) return number;
    numbers.push(number.value);
  }
  return ok(numbers.sort((a, b) => a - b));
}

/** @throws {never} */
export function parsePullPayload(data: unknown): ParseResult<ParsedPull> {
  const pull = asRecord(data, "the pull request");
  if (!pull.ok) return pull;
  const head = asRecord(pull.value.head, "the head");
  if (!head.ok) return head;
  const base = asRecord(pull.value.base, "the base");
  if (!base.ok) return base;
  const baseRepo = asRecord(base.value.repo, "the base repository");
  if (!baseRepo.ok) return baseRepo;
  const author = asRecord(pull.value.user, "the author");
  if (!author.ok) return author;
  if (typeof pull.value.merged !== "boolean" || typeof pull.value.draft !== "boolean") return fail("the pull request is unreadable");
  if (pull.value.mergeable !== null && typeof pull.value.mergeable !== "boolean") return fail("the pull request is unreadable");
  if (!Array.isArray(pull.value.labels)) return fail("the labels are unreadable");
  const number = asInteger(pull.value.number, "the number");
  if (!number.ok) return number;
  const state = asText(pull.value.state, "the state");
  if (!state.ok) return state;
  const mergeableState = asText(pull.value.mergeable_state, "the mergeable state");
  if (!mergeableState.ok) return mergeableState;
  const headSha = asText(head.value.sha, "the head commit");
  if (!headSha.ok) return headSha;
  const baseRef = asText(base.value.ref, "the base branch");
  if (!baseRef.ok) return baseRef;
  const baseRepositoryId = asInteger(baseRepo.value.id, "the base repository");
  if (!baseRepositoryId.ok) return baseRepositoryId;
  const authorId = asInteger(author.value.id, "the author");
  if (!authorId.ok) return authorId;
  const changedFiles = asInteger(pull.value.changed_files, "the changed file count");
  if (!changedFiles.ok) return changedFiles;
  const labels: string[] = [];
  for (const rawLabel of pull.value.labels) {
    const label = asRecord(rawLabel, "a label");
    if (!label.ok) return label;
    const name = asText(label.value.name, "a label");
    if (!name.ok) return name;
    labels.push(name.value);
  }
  return ok({
    number: number.value,
    state: state.value,
    merged: pull.value.merged,
    draft: pull.value.draft,
    mergeable: pull.value.mergeable,
    mergeableState: mergeableState.value,
    headSha: headSha.value,
    baseRef: baseRef.value,
    baseRepositoryId: baseRepositoryId.value,
    authorId: authorId.value,
    changedFiles: changedFiles.value,
    labels,
  });
}

/** @throws {never} */
export function mergeabilityProblem(pull: ParsedPull, defaultBranch: string): string | null {
  if (pull.state !== "open" || pull.merged) return "it is not open";
  if (pull.draft) return "it is a draft";
  if (!pull.labels.includes(readyLabelName)) return `it does not carry ${readyLabelName}`;
  if (pull.baseRepositoryId !== pilotRepositoryId) return "its base is another repository";
  if (neverBases.includes(pull.baseRef) || pull.baseRef === defaultBranch) return `its base is ${pull.baseRef}, which this workflow never merges into`;
  if (pull.mergeable !== true) return pull.mergeable === null ? "GitHub has not worked out whether it can merge yet" : "GitHub reports it cannot merge";
  if (pull.mergeableState !== "clean") return `GitHub reports its merge state as ${pull.mergeableState}, not clean`;
  return null;
}

/** @throws {never} */
export function parseRegisteredIntegrationBranch(data: unknown, repository: string, baseRef: string): ParseResult<boolean> {
  const file = asRecord(data, projectFilePath);
  if (!file.ok) return file;
  if (file.value.encoding !== "base64") return fail(`${projectFilePath} is unreadable`);
  const encoded = asText(file.value.content, projectFilePath);
  if (!encoded.ok) return encoded;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded.value, "base64").toString("utf8")) as unknown;
  } catch {
    return fail(`${projectFilePath} on ${baseRef} is not valid JSON`);
  }
  const declared = asRecord(parsed, projectFilePath);
  if (!declared.ok) return declared;
  const declaredRepo = asRecord(declared.value.repository, `${projectFilePath} repository`);
  if (!declaredRepo.ok) return declaredRepo;
  return ok(
    declaredRepo.value.fullName === repository &&
      declaredRepo.value.id === String(pilotRepositoryId) &&
      declaredRepo.value.integrationBranch === baseRef,
  );
}

/** @throws {never} */
export function parseLabelEventTime(events: ReadonlyArray<unknown>): ParseResult<LabelEventSummary> {
  let newest: { readonly at: number; readonly event: Readonly<Record<string, unknown>> } | null = null;
  let lastForcePush = Number.NEGATIVE_INFINITY;
  for (const raw of events) {
    const event = asRecord(raw, "an event");
    if (!event.ok) return event;
    const kind = asText(event.value.event, "an event");
    if (!kind.ok) return kind;
    if (kind.value === "head_ref_force_pushed") {
      const at = asTime(event.value.created_at, "a force push");
      if (!at.ok) return at;
      lastForcePush = Math.max(lastForcePush, at.value);
      continue;
    }
    if (kind.value !== "labeled" && kind.value !== "unlabeled") continue;
    const label = asRecord(event.value.label, "a label event");
    if (!label.ok) return label;
    if (label.value.name !== readyLabelName) continue;
    const at = asTime(event.value.created_at, "a label event");
    if (!at.ok) return at;
    if (newest === null || at.value >= newest.at) newest = { at: at.value, event: event.value };
  }
  if (newest === null) return fail("its event history shows no ready label");
  if (newest.event.event !== "labeled") return fail("the newest ready label event is a removal");
  const actor = asRecord(newest.event.actor, "the labelling account");
  if (!actor.ok) return actor;
  if (actor.value.id !== slopbotBotId || actor.value.login !== slopbotBotLogin || actor.value.type !== "Bot") {
    return fail(`the ready label was last added by ${String(actor.value.login)}, not Slopbot`);
  }
  if (lastForcePush >= newest.at) return fail("the head was force pushed after Slopbot added the label");
  return ok({ labelledAt: newest.at, labelSource: "LabelBySlopbot", forcePushedAfterLabel: false });
}

/** @throws {never} */
export function parseReviewSummary(reviews: ReadonlyArray<unknown>, headSha: string, authorId: number, labelledAt: number): ParseResult<ReviewSummary> {
  const latest = new Map<number, ParsedReview>();
  let headSeenBeforeLabel = false;
  for (const raw of reviews) {
    const review = asRecord(raw, "a review");
    if (!review.ok) return review;
    const state = asText(review.value.state, "a review");
    if (!state.ok) return state;
    const commit = typeof review.value.commit_id === "string" ? review.value.commit_id : null;
    if (commit === headSha && state.value !== "PENDING") {
      const submitted = asTime(review.value.submitted_at, "a review");
      if (!submitted.ok) return submitted;
      if (submitted.value <= labelledAt) headSeenBeforeLabel = true;
    }
    if (review.value.user === null) continue;
    const user = asRecord(review.value.user, "a reviewer");
    if (!user.ok) return user;
    if (user.value.type !== "User") continue;
    if (state.value !== "APPROVED" && state.value !== "CHANGES_REQUESTED" && state.value !== "DISMISSED") continue;
    const userId = asInteger(user.value.id, "a reviewer");
    if (!userId.ok) return userId;
    const login = asText(user.value.login, "a reviewer");
    if (!login.ok) return login;
    latest.set(userId.value, { userId: userId.value, login: login.value, state: state.value, commit });
  }
  const approvals: ParsedReview[] = [];
  const requests: ParsedReview[] = [];
  for (const review of latest.values()) {
    if (review.userId === authorId) continue;
    if (review.state === "APPROVED" && review.commit === headSha) approvals.push(review);
    if (review.state === "CHANGES_REQUESTED") requests.push(review);
  }
  if (approvals.length === 0) return fail("no approval stands at its head commit");
  if (approvals.length + requests.length > permissionLookupLimit) return fail("it has too many reviews to check");
  return ok({ approvals, requests, headSeenBeforeLabel });
}

/** @throws {never} */
export function parsePermissionWrites(data: unknown, review: ParsedReview): ParseResult<boolean> {
  const what = `the permission of ${review.login}`;
  const permission = asRecord(data, what);
  if (!permission.ok) return permission;
  const user = asRecord(permission.value.user, what);
  if (!user.ok) return user;
  return ok(
    user.value.id === review.userId &&
      (permission.value.permission === "admin" || permission.value.permission === "write"),
  );
}

/** @throws {never} */
export function parseWorkflowPathProblem(files: ReadonlyArray<unknown>, expectedCount: number): ParseResult<string | null> {
  if (files.length !== expectedCount) return fail("the changed file list is incomplete");
  for (const raw of files) {
    const file = asRecord(raw, "a changed file");
    if (!file.ok) return file;
    const filename = asText(file.value.filename, "a changed file");
    if (!filename.ok) return filename;
    const paths = [filename.value];
    if (file.value.previous_filename !== undefined && file.value.previous_filename !== null) {
      const previous = asText(file.value.previous_filename, "a renamed file");
      if (!previous.ok) return previous;
      paths.push(previous.value);
    }
    for (const path of paths) {
      if (isGithubPath(path)) return ok(`it touches ${path}, and nothing under .github/ merges this way`);
    }
  }
  return ok(null);
}
