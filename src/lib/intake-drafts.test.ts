import { describe, expect, test } from "bun:test";
import {
  clearAllDrafts,
  type DraftOwner,
  EMPTY_DRAFT,
  loadDraft,
  needsDraft,
  pruneDrafts,
  saveDraft,
} from "./intake-drafts";

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    items,
    get length() {
      return items.size;
    },
    key: (index: number) => [...items.keys()][index] ?? null,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
    removeItem: (key: string) => {
      items.delete(key);
    },
  };
}

const draft = { ...EMPTY_DRAFT, summary: "secret", description: "details" };

function submission(
  id: string,
  state: string,
  failureCode: string | null = null,
  advisory: unknown = null,
): DraftOwner {
  return { id, origin: "slop", state, failureCode, advisory };
}

describe("intake drafts", () => {
  test("only a submission that can still be sent keeps its draft", () => {
    expect(needsDraft(submission("a", "draft"))).toBe(true);
    expect(needsDraft(submission("a", "uncertain"))).toBe(true);
    expect(needsDraft(submission("a", "failed", "invalid"))).toBe(true);
    for (const done of [
      submission("a", "submitted", null, { ghsa: "x" }),
      submission("a", "receipt-verified", null, { ghsa: "x" }),
      submission("a", "abandoned"),
      submission("a", "failed", "author-mismatch"),
      submission("a", "failed", "already-recorded"),
      submission("a", "failed", "not-private-report"),
      submission("a", "failed", "unverifiable", { ghsa: "x" }),
      { ...submission("a", "draft"), origin: "direct" as const },
    ])
      expect(needsDraft(done)).toBe(false);
  });

  test("loading the list removes drafts of finished, failed, abandoned and unknown submissions", () => {
    const storage = memoryStorage();
    for (const id of ["live", "abandoned", "mismatch", "verified", "orphan"])
      saveDraft(id, draft, storage);
    storage.setItem("unrelated", "kept");
    pruneDrafts(
      [
        submission("live", "draft"),
        submission("abandoned", "abandoned"),
        submission("mismatch", "failed", "author-mismatch"),
        submission("verified", "receipt-verified", null, { ghsa: "x" }),
      ],
      storage,
    );
    expect([...storage.items.keys()].sort()).toEqual([
      "slop-intake-draft:live",
      "unrelated",
    ]);
    expect(loadDraft("live", storage)).toEqual(draft);
  });

  test("sign-out removes every draft", () => {
    const storage = memoryStorage();
    saveDraft("one", draft, storage);
    saveDraft("two", draft, storage);
    clearAllDrafts(storage);
    expect(storage.items.size).toBe(0);
    expect(loadDraft("one", storage)).toBeNull();
  });

  test("unavailable storage is ignored", () => {
    expect(() => pruneDrafts([], null)).not.toThrow();
    expect(loadDraft("x", null)).toBeNull();
  });

  test("a draft that storage refuses is reported unsaved", () => {
    const full = memoryStorage();
    full.setItem = () => {
      throw new DOMException("quota", "QuotaExceededError");
    };
    expect(saveDraft("x", draft, full)).toBe(false);
    expect(saveDraft("x", draft, null)).toBe(false);
    expect(saveDraft("x", draft, memoryStorage())).toBe(true);
  });
});
