import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  base: "a".repeat(40),
  head: "b".repeat(40),
  merge: "c".repeat(40),
  verifier: vi.fn(),
  logs: vi.fn(),
}));
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const execFileSync = vi.fn((_file, args: string[]) =>
    args.includes("FETCH_HEAD") ? fixture.head : fixture.base,
  );
  return { ...actual, execFileSync, default: { ...actual, execFileSync } };
});
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    appendFile: fixture.logs,
    default: { ...actual, appendFile: fixture.logs },
  };
});
vi.mock("./check-funding-record-pr", () => ({
  checkFundingRecordPr: fixture.verifier,
  canonicalFundingDecisionBytes: (value: unknown) => JSON.stringify(value),
}));

import { mergeVerifiedFunding } from "./merge-verified-funding";

function setup() {
  const pr = {
    number: 7,
    state: "open",
    draft: false,
    merged: false,
    mergeable: true,
    mergeable_state: "clean",
    merge_commit_sha: fixture.merge,
    base: {
      ref: "develop",
      sha: fixture.base,
      repo: { full_name: "example/site" },
    },
    head: { sha: fixture.head },
    user: { login: "contributor" },
    labels: [],
    assignees: [],
    requested_reviewers: [],
    requested_teams: [],
  };
  const protection = {
    requiresStatusChecks: true,
    requiresStrictStatusChecks: true,
    requiredStatusCheckContexts: ["Skill, data, build, and browser checks"],
    isAdminEnforced: true,
    requiresApprovingReviews: true,
    requiredApprovingReviewCount: 1,
    dismissesStaleReviews: true,
    requiresConversationResolution: true,
    allowsForcePushes: false,
    allowsDeletions: false,
    bypassPullRequestAllowances: { totalCount: 0 },
  };
  const state = {
    pr,
    protection: protection as typeof protection | null,
    reviewResolved: true,
    reviewTruncated: false,
    reviews: [] as {
      id: number;
      user: { id: number; login: string };
      state: string;
      commit_id: string;
    }[],
    quality: "success",
    qualityHead: fixture.head,
    checkConclusion: "success",
    base: fixture.base,
    driftAfterApproval: false,
    dispatchFails: false,
    calls: [] as {
      path: string;
      method: string;
      body: Record<string, unknown>;
    }[],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const path = url.replace("https://api.github.com/", "");
      const method = init.method ?? "GET";
      const body = init.body ? JSON.parse(String(init.body)) : {};
      state.calls.push({ path, method, body });
      let value: unknown;
      if (path.endsWith("/dispatches")) {
        return new Response(null, { status: state.dispatchFails ? 503 : 204 });
      }
      if (method === "PUT" && path.endsWith("/merge")) {
        pr.merged = true;
        value = { merged: true, sha: fixture.merge };
      } else if (path.includes("/git/commits/")) {
        value = { parents: [{ sha: fixture.base }, { sha: fixture.head }] };
      } else if (method === "POST" && path.endsWith("/reviews")) {
        if (state.driftAfterApproval) state.base = "d".repeat(40);
        value = {};
      } else if (path === "graphql")
        value = {
          data: {
            repository: {
              defaultBranchRef: {
                name: "develop",
                branchProtectionRule: state.protection,
              },
              pullRequest: {
                reviewThreads: {
                  nodes: [{ isResolved: state.reviewResolved }],
                  pageInfo: { hasNextPage: state.reviewTruncated },
                },
              },
            },
          },
        };
      else if (path.includes("pulls?")) value = [pr];
      else if (path.endsWith("pulls/7")) value = pr;
      else if (path.endsWith("git/ref/heads/develop"))
        value = { object: { sha: state.base } };
      else if (path.includes("/reviews?")) value = state.reviews;
      else if (path.includes("/runs?"))
        value = {
          workflow_runs: [
            {
              id: 9,
              head_sha: state.qualityHead,
              event: "pull_request",
              path: ".github/workflows/deploy.yml",
              status: "completed",
              conclusion: state.quality,
              pull_requests: [{ number: 7 }],
            },
          ],
        };
      else if (path.includes("/check-runs?"))
        value = {
          total_count: 1,
          check_runs: [
            {
              name: "Quality",
              status: "completed",
              conclusion: state.checkConclusion,
            },
          ],
        };
      else if (path.includes("/status?"))
        value = { total_count: 0, state: "pending" };
      else throw new Error(`Unexpected request: ${method} ${path}`);
      return Response.json(value);
    }),
  );
  return state;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("GITHUB_REPOSITORY", "example/site");
  vi.stubEnv("GITHUB_TOKEN", "test-only-token");
  vi.stubEnv("GITHUB_REF", "refs/heads/develop");
  vi.stubEnv("FUNDING_MERGE_LOG", "/unused-test-log");
  vi.stubEnv("SLOP_FUNDING_AUTOMERGE_ENABLED", "true");
  fixture.verifier.mockImplementation(async () => ({
    decision: "verified-records",
    mergeAuthorized: false,
    baseSha: fixture.base,
    checkerRevision: fixture.base,
    headSha: fixture.head,
    pullRequestNumber: 7,
    checkedAt: new Date().toISOString(),
    records: [
      {
        recordBytesSha256: "d".repeat(64),
        verifierVersion: "test-v1",
        verifierOutputCanonical: "{}",
        verifierOutputSha256: "e".repeat(64),
      },
    ],
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("trusted funding merge orchestration", () => {
  it("reverifies, approves exact head, rechecks, SHA-locks merge, dispatches protected release", async () => {
    const state = setup();
    await mergeVerifiedFunding();
    expect(fixture.verifier).toHaveBeenCalledWith({
      baseSha: fixture.base,
      headSha: fixture.head,
      pullRequestNumber: 7,
    });
    const review = state.calls.find(
      (c) => c.method === "POST" && c.path.endsWith("/reviews"),
    );
    expect(review?.body.commit_id).toBe(fixture.head);
    expect(review?.body.body).toContain("output SHA-256");
    expect(state.calls.find((c) => c.method === "PUT")?.body).toEqual({
      sha: fixture.head,
      merge_method: "merge",
    });
    expect(state.calls.at(-1)?.body).toEqual({ ref: "develop" });
    expect(state.calls.filter((c) => c.path === "graphql")).toHaveLength(2);
  });
  it.each([
    "protection",
    "review",
    "truncation",
    "quality",
    "wrong-head",
    "checks",
    "changes-requested",
    "base-drift",
  ])("never approves or merges with %s", async (failure) => {
    const state = setup();
    if (failure === "protection") state.protection = null;
    if (failure === "review") state.reviewResolved = false;
    if (failure === "truncation") state.reviewTruncated = true;
    if (failure === "quality") state.quality = "failure";
    if (failure === "wrong-head") state.qualityHead = fixture.base;
    if (failure === "checks") state.checkConclusion = "failure";
    if (failure === "base-drift") state.base = fixture.head;
    if (failure === "changes-requested")
      state.reviews = [
        {
          id: 1,
          user: { id: 2, login: "reviewer" },
          state: "CHANGES_REQUESTED",
          commit_id: fixture.head,
        },
      ];
    await mergeVerifiedFunding();
    expect(
      state.calls.some(
        (c) => c.method === "PUT" || c.path.endsWith("/reviews"),
      ),
    ).toBe(false);
    expect(fixture.logs).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('"refused"'),
      expect.anything(),
    );
  });
  it("will not merge if base changes after approval", async () => {
    const state = setup();
    state.driftAfterApproval = true;
    await mergeVerifiedFunding();
    expect(state.calls.some((c) => c.path.endsWith("/reviews"))).toBe(true);
    expect(state.calls.some((c) => c.method === "PUT")).toBe(false);
  });
  it("fails visibly when a completed merge cannot dispatch deployment", async () => {
    const state = setup();
    state.dispatchFails = true;
    await expect(mergeVerifiedFunding()).rejects.toThrow("HTTP 503");
    expect(fixture.logs).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('"mergeSha"'),
      expect.anything(),
    );
  });
  it("does not grant write authority to mixed or failed evidence", async () => {
    const state = setup();
    fixture.verifier.mockResolvedValue({ decision: "human-review-required" });
    await mergeVerifiedFunding();
    expect(state.calls).toHaveLength(1);
  });
  it("honors revocation before touching GitHub", async () => {
    const state = setup();
    vi.stubEnv("SLOP_FUNDING_AUTOMERGE_ENABLED", "false");
    await expect(mergeVerifiedFunding()).rejects.toThrow("explicit activation");
    expect(state.calls).toHaveLength(0);
  });
});
