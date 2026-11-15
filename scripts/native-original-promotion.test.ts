import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MergedPullRequestOutcome } from "../src/lib/leaderboard";
import { collect, fixture } from "../tests/value-binary-fixture";
import {
  mirroredOctoberSources,
  nativeOriginalBeforePromotion,
  nativeSyncOriginal,
} from "./collect-implementation-corrections";
import { collectVerifiedMergeResolutions } from "./value-merge-resolution";

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

async function synchronizedOriginal() {
  const directory = mkdtempSync(join(tmpdir(), "native-sync-original-"));
  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_NAME: "Promotion fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "Promotion fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
    GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
  };
  const git = (args: string[], input?: string) =>
    execFileSync("git", ["-C", directory, ...args], {
      env,
      input,
      encoding: "utf8",
      timeout: 20_000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  git(["init", "--bare", "--template="]);
  const tree = (text: string) => {
    const blob = git(["hash-object", "-w", "--stdin"], text);
    return git(["mktree"], `100644 blob ${blob}\tfix.ts\n`);
  };
  const commit = (text: string, parents: string[]) =>
    git(
      [
        "commit-tree",
        tree(text),
        ...parents.flatMap((parent) => ["-p", parent]),
      ],
      "Fixture\n",
    );
  const base = commit("base\n", []);
  const first = commit("base\noriginal\n", [base]);
  const repair = commit("base\noriginal\nrepair\n", [first]);
  const sync = commit("base\noriginal\nrepair\n", [repair, first]);
  const raw = await collect(fixture({ direct: true, textOnly: true }));
  const actors = [
    null,
    { node_id: maintainer.id, login: maintainer.login, type: "User" },
    { node_id: maintainer.id, login: maintainer.login, type: "User" },
  ];
  const shas = [first, repair, sync];
  raw.pull.user = { node_id: original.id, login: original.login, type: "User" };
  raw.pull.head.sha = sync;
  raw.pull.commits = 3;
  raw.commits = shas.map((sha, index) => ({
    ...raw.commits[0],
    sha,
    author: actors[index],
    committer: actors[index],
    parents: (index === 0
      ? [base]
      : index === 1
        ? [first]
        : [repair, first]
    ).map((sha) => ({ sha })),
  }));
  raw.commitAttribution = shas.map((sha, index) => ({
    ...raw.commitAttribution[0],
    sha,
    actorNodeIds: actors[index] ? [actors[index].node_id] : [],
  }));
  raw.mergeResolutions = await collectVerifiedMergeResolutions(raw, directory);
  const owners = new Map(
    shas.map((sha) => [
      `${raw.repository.toLowerCase()}\0${sha}`,
      raw.pull.node_id,
    ]),
  );
  return { directory, raw, owners, first, repair, sync, base };
}

for (const fault of [
  "none",
  "missing-resolution",
  "changed-resolution",
  "parent-order",
  "foreign-author",
  "prior-owner",
  "early-maintainer",
  "wrong-origin",
  "wrong-origin-kind",
  "incomplete",
] as const) {
  test(`native synchronization ${fault}`, async () => {
    const input = await synchronizedOriginal();
    try {
      const { raw, owners } = input;
      if (fault === "missing-resolution") raw.mergeResolutions = [];
      if (fault === "changed-resolution") {
        const resolution = raw.mergeResolutions?.[0];
        if (!resolution) throw Error("Missing canonical merge fixture");
        resolution.paths = ["fix.ts"];
      }
      if (fault === "parent-order") raw.commits[2].parents.reverse();
      if (fault === "foreign-author")
        raw.commits[1].author = {
          node_id: "U_other",
          login: "other",
          type: "User",
        };
      if (fault === "prior-owner")
        owners.set(
          `${raw.repository.toLowerCase()}\0${input.first}`,
          "PR_prior",
        );
      if (fault === "early-maintainer") {
        raw.commits[0].author = {
          node_id: maintainer.id,
          login: maintainer.login,
          type: "User",
        };
        raw.commits[1].author = {
          node_id: original.id,
          login: original.login,
          type: "User",
        };
      }
      if (fault === "wrong-origin-kind") raw.pull.user.type = "Bot";
      if (fault === "incomplete") raw.limitations.push("Missing source");
      const invoke = () =>
        nativeSyncOriginal(
          raw,
          fault === "wrong-origin" ? maintainer : original,
          maintainer,
          owners,
        );
      if (fault === "incomplete") expect(invoke).toThrow();
      else expect(invoke()).toBe(fault === "none");
    } finally {
      rmSync(input.directory, { recursive: true, force: true });
    }
  });
}
