import { expect, spyOn, test } from "bun:test";
import type { PullRequestRecord } from "../src/lib/leaderboard-types";
import { verifyPullRequestEvidence } from "./generate-leaderboard";

// The production i/I pair used by scripts/leaderboard-locale.test.ts:
// English collation orders i2Yg before IwgQ, while Turkish collation treats
// I as the uppercase of dotless ı, which precedes i, reversing the pair.
const ENGLISH_FIRST_ID = "PR_kwDOMT5cIs8AAAABG3i2Yg";
const TURKISH_FIRST_ID = "PR_kwDOMT5cIs8AAAABG3IwgQ";

const AUTHOR = {
  id: "U_evidence_author",
  login: "evidence-author",
  avatarUrl: "https://github.com/evidence-author.png",
  url: "https://github.com/evidence-author",
  kind: "User" as const,
};

function logText(marker: string): string {
  return [
    `2026-10-01T00:00:11Z worker-7 request completed route=/api/census status=200 duration_ms=183 trace=${marker}`,
    `2026-10-01T00:00:12Z worker-7 cache warmed entries=512 shard=alpha region=icn1`,
    `2026-10-01T00:00:13Z worker-7 upload sealed digest=sha256:${marker} bytes=2048`,
    `2026-10-01T00:00:14Z worker-7 request completed route=/api/ledger status=200 duration_ms=97 trace=${marker}`,
  ].join("\n");
}

function makePullRequest(id: string, n: number): PullRequestRecord {
  const head = n.toString(16).padStart(40, "0");
  const asset = `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
  const body = [
    `<!-- evidence-head:${head} -->`,
    "<!-- evidence-row:backend-logs -->",
    `[run log](https://github.com/user-attachments/assets/${asset})`,
  ].join("\n");
  return {
    id,
    number: 1000 + n,
    title: `evidence candidate ${n}`,
    url: `https://github.com/SlopDotCash/slopdotcash/pull/${1000 + n}`,
    body,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    lastEditedAt: "2026-10-01T00:00:00.000Z",
    editor: null,
    mergedAt: "2026-10-02T00:00:00.000Z",
    closedAt: "2026-10-02T00:00:00.000Z",
    headRefOid: head,
    isDraft: false,
    reviewDecision: "APPROVED",
    activeReviewRequestCount: 0,
    author: AUTHOR,
    assignees: [],
    labels: [],
    files: [],
    comments: [],
    reviews: [],
    closingIssueIds: [],
    additions: 10,
    deletions: 2,
    changedFiles: 1,
    commitCount: 1,
  };
}

function buildPullRequests(): PullRequestRecord[] {
  const pullRequests: PullRequestRecord[] = [];
  // These 63 IDs precede both members of the i/I pair under English and
  // Turkish collation, placing the pair at selection positions 64 and 65.
  for (let i = 1; i <= 63; i += 1) {
    pullRequests.push(
      makePullRequest(`PR_kwDOMT5cIs8AAAABF${String(i).padStart(3, "0")}`, i),
    );
  }
  pullRequests.push(makePullRequest(ENGLISH_FIRST_ID, 1001));
  pullRequests.push(makePullRequest(TURKISH_FIRST_ID, 1002));
  return pullRequests;
}

async function withDefaultLocale<T>(
  locale: string,
  run: () => Promise<T>,
): Promise<T> {
  const original = String.prototype.localeCompare;
  const spy = spyOn(String.prototype, "localeCompare").mockImplementation(
    function (
      this: string,
      other: string,
      locales?: Intl.LocalesArgument,
      options?: Intl.CollatorOptions,
    ) {
      return original.call(this, other, locales ?? locale, options);
    },
  );
  try {
    return await run();
  } finally {
    spy.mockRestore();
  }
}

async function verifyUnderDefaultLocale(locale: string) {
  const fetched: string[] = [];
  const evidenceFetch = async (input: unknown) => {
    const url =
      typeof input === "string"
        ? input
        : String((input as { url: string }).url);
    fetched.push(url);
    const bytes = new TextEncoder().encode(logText(url));
    return new Response(bytes, {
      headers: {
        "content-type": "text/plain",
        "content-length": String(bytes.length),
      },
    });
  };
  const result = await withDefaultLocale(locale, () =>
    verifyPullRequestEvidence(buildPullRequests(), {
      evidenceFetch: evidenceFetch as typeof fetch,
      evidenceToken: "",
      evidenceRetryDelayMs: 0,
    }),
  );
  return { fetched, result };
}

test("evidence trust selection at the 64-candidate cap ignores the host locale", async () => {
  const english = await verifyUnderDefaultLocale("en");
  const turkish = await verifyUnderDefaultLocale("tr");
  const englishIds = english.result.artifacts
    .map((artifact) => artifact.pullRequestId)
    .sort((left, right) => left.localeCompare(right, "en"));
  const turkishIds = turkish.result.artifacts
    .map((artifact) => artifact.pullRequestId)
    .sort((left, right) => left.localeCompare(right, "en"));

  expect(english.result.status).toBe("suppressed-limit");
  expect(turkish.result.status).toBe("suppressed-limit");
  expect(english.result.sourceCount).toBe(65);
  expect(turkish.result.sourceCount).toBe(65);
  expect(english.result.artifacts).toHaveLength(64);
  expect(turkish.result.artifacts).toHaveLength(64);
  expect(english.fetched).toHaveLength(64);
  expect(turkish.fetched).toHaveLength(64);
  expect(turkishIds).toEqual(englishIds);
  expect(englishIds).toContain(ENGLISH_FIRST_ID);
  expect(englishIds).not.toContain(TURKISH_FIRST_ID);
});
