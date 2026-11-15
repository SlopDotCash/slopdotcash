import { expect, test } from "bun:test";
import type { MergedPullRequestOutcome } from "../src/lib/leaderboard";
import {
  mirroredOctoberSources,
  nativeOriginalBeforePromotion,
} from "./collect-implementation-corrections";

const original = {
  id: "U_original",
  login: "original",
  kind: "User" as const,
  avatarUrl: "",
  url: "",
};
const maintainer = {
  id: "U_maintainer",
  login: "maintainer",
  kind: "User" as const,
  avatarUrl: "",
  url: "",
};
const sha = (c: string) => c.repeat(40);
for (const fault of [
  "none",
  "squash",
  "unlinked",
  "ancestor",
  "wrong-author",
  "early-maintainer",
  "stale",
  "different-owner",
  "wrong-repository",
  "later",
] as const) {
  test(`native original ${fault === "none" ? "survives promotion" : `holds ${fault}`}`, async () => {
    const first = {
      oid: sha("a"),
      author: original,
      parentCount: 1,
      additions: 1,
      deletions: 0,
    };
    const followup = {
      oid: sha("b"),
      author: maintainer,
      parentCount: 1,
      additions: 1,
      deletions: 0,
    };
    const small = {
      id: "PR_small",
      number: 2,
      url: "https://github.com/elizaOS/asi/pull/2",
      headRefOid: sha("b"),
      author: original,
      baseRefName: "develop",
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-02T00:00:00Z",
      mergedAt: "2026-09-02T00:00:00Z",
      commits: [first, followup],
      title: "fix",
      body: "",
      additions: 2,
      deletions: 0,
    } satisfies MergedPullRequestOutcome;
    const large = {
      ...small,
      id: "PR_large",
      number: 1,
      url: "https://github.com/elizaOS/asi/pull/1",
      headRefOid: sha("c"),
      author: maintainer,
      baseRefName: "staging",
      updatedAt: "2026-10-01T00:00:00Z",
      mergedAt: "2026-10-01T00:00:00Z",
      commits: [first, followup, { ...followup, oid: sha("c") }],
    };
    if (fault === "wrong-repository")
      small.url = "https://github.com/elizaOS/gaia/pull/2";
    if (fault === "later") small.mergedAt = "2026-10-02T00:00:00Z";
    const owners = new Map(
      [first, followup].map((c) => [`elizaos/asi\0${c.oid}`, small.id]),
    );
    if (fault === "different-owner")
      owners.set(`elizaos/asi\0${first.oid}`, large.id);
    const client = {
      async get<T>(path: string): Promise<T | null> {
        let value: unknown;
        if (path.includes("/pulls/")) {
          const o = path.endsWith("/2") ? small : large;
          value = {
            node_id: o.id,
            number: o.number,
            html_url: o.url,
            state: "closed",
            merged_at: o.mergedAt,
            updated_at:
              fault === "stale" ? "2026-10-02T00:00:00Z" : o.updatedAt,
            head: { sha: o.headRefOid },
            base: { ref: o.baseRefName },
            user: { node_id: o.author.id },
            commits: o.commits.length,
            merge_commit_sha: sha("d"),
          };
        } else if (path.includes("/git/commits/"))
          value = {
            sha: sha("d"),
            parents:
              fault === "squash"
                ? [{ sha: sha("b") }]
                : [{ sha: sha("e") }, { sha: sha("b") }],
          };
        else if (path.includes("/compare/"))
          value = {
            status: "ahead",
            behind_by: fault === "ancestor" ? 1 : 0,
            base_commit: { sha: sha("d") },
            merge_base_commit: {
              sha: fault === "ancestor" ? sha("e") : sha("d"),
            },
          };
        else {
          const head = path.includes(sha("b"));
          value = {
            sha: head ? sha("b") : sha("a"),
            parents: [{ sha: head ? sha("a") : sha("e") }],
            author:
              fault === "unlinked"
                ? null
                : {
                    node_id:
                      fault === "wrong-author"
                        ? "U_other"
                        : fault === "early-maintainer"
                          ? head
                            ? original.id
                            : maintainer.id
                          : head
                            ? maintainer.id
                            : original.id,
                  },
          };
        }
        return value as T;
      },
    };
    expect(
      await nativeOriginalBeforePromotion(client, large, small, owners),
    ).toBe(fault === "none");
    if (fault === "none" || fault === "squash") {
      const held = await mirroredOctoberSources(client, [large, small], owners);
      expect(held.has(large.id)).toBe(true);
      expect(held.has(small.id)).toBe(fault !== "none");
    }
  });
}
