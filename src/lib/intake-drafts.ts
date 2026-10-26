/**
 * Report drafts for automatic private intake. A draft holds the report text,
 * so it lives only in this tab's sessionStorage (OPEN_QUESTION 6) and is
 * removed as soon as its submission can no longer be sent, and on sign-out.
 * Storage may be unavailable; the draft then stays in memory only, so a
 * caller must not leave the page for GitHub without a saved draft.
 */

export type ReportDraft = {
  summary: string;
  description: string;
  severity: string;
  cvss: string;
  cwe: string;
};

export const EMPTY_DRAFT: ReportDraft = {
  summary: "",
  description: "",
  severity: "",
  cvss: "",
  cwe: "",
};

const PREFIX = "slop-intake-draft:";

/** Failure codes after which a submission can never be sent again. */
export const TERMINAL_FAILURES: readonly string[] = [
  "author-mismatch",
  "already-recorded",
  "not-private-report",
  "unverifiable",
];

/** The fields of a submission that decide whether its draft is still needed. */
export type DraftOwner = {
  id: string;
  origin: "slop" | "direct";
  state: string;
  failureCode: string | null;
  advisory: unknown;
};

type DraftStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
>;

function sessionStore(): DraftStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function draftKey(id: string): string {
  return `${PREFIX}${id}`;
}

/**
 * Whether the report text may still be sent: a draft not yet on GitHub, a
 * send whose outcome is being reconciled, or a fixable refusal.
 */
export function needsDraft(submission: DraftOwner): boolean {
  if (submission.origin !== "slop" || submission.advisory) return false;
  if (["draft", "submitting", "uncertain"].includes(submission.state))
    return true;
  return (
    submission.state === "failed" &&
    !TERMINAL_FAILURES.includes(submission.failureCode ?? "")
  );
}

export function loadDraft(
  id: string,
  storage: DraftStorage | null = sessionStore(),
): ReportDraft | null {
  try {
    const raw = storage?.getItem(draftKey(id)) ?? null;
    if (raw === null) return null;
    const value = JSON.parse(raw) as Partial<ReportDraft>;
    return { ...EMPTY_DRAFT, ...value };
  } catch {
    return null;
  }
}

/** Whether the draft was stored and survives a GitHub redirect. */
export function saveDraft(
  id: string,
  draft: ReportDraft,
  storage: DraftStorage | null = sessionStore(),
): boolean {
  if (storage === null) return false;
  try {
    storage.setItem(draftKey(id), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(
  id: string,
  storage: DraftStorage | null = sessionStore(),
): void {
  try {
    storage?.removeItem(draftKey(id));
  } catch {
    // Nothing stored.
  }
}

function draftIds(storage: DraftStorage): string[] {
  const ids: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(PREFIX)) ids.push(key.slice(PREFIX.length));
  }
  return ids;
}

/**
 * Keeps only the drafts of the signed-in reporter's submissions that can
 * still be sent. Drafts of finished, abandoned or terminally failed
 * submissions, and of submissions not in this account's list, are removed.
 */
export function pruneDrafts(
  submissions: readonly DraftOwner[],
  storage: DraftStorage | null = sessionStore(),
): void {
  if (storage === null) return;
  const live = new Set(
    submissions.filter(needsDraft).map((submission) => submission.id),
  );
  try {
    for (const id of draftIds(storage))
      if (!live.has(id)) storage.removeItem(draftKey(id));
  } catch {
    // Storage became unavailable; nothing more to remove.
  }
}

/** Removes every report draft in this tab, e.g. on sign-out. */
export function clearAllDrafts(
  storage: DraftStorage | null = sessionStore(),
): void {
  pruneDrafts([], storage);
}
