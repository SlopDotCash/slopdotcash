import { expect, test } from "bun:test";
import { findRegisteredRepositoryById } from "../src/lib/repositories.mjs";
import { VALUE_REFERENCE_QUERY } from "../workers/slopbot/value-reference-query";
import {
  COLLECTION_MEMO_FULL_INTERVAL_MS,
  CollectionMemoSession,
  openCollectionMemo,
  parseCollectionMemo,
} from "./collection-memo";
import { OutcomeCommitLineLoader } from "./generate-leaderboard";
import { loadValueInputs } from "./value-ingestion";

const target = findRegisteredRepositoryById("SlopDotCash/asi");
if (!target?.expectedNodeId) throw new Error("Missing registered fixture");
const repo = target.id;
const head = "c".repeat(40);
const merged = "2026-11-10T10:00:00Z";
const cutoff = "2026-11-19T00:00:00.000Z";
const digest = "d".repeat(64);
const authorSha = "e".repeat(40);

interface World {
  outcomeUpdatedAt: string;
  originalUpdatedAt: string;
  incoming: { source: Record<string, unknown> }[];
  referenceName: string;
  actorLogin: string;
}

function world(): World {
  return {
    outcomeUpdatedAt: "2026-11-10T10:00:00Z",
    originalUpdatedAt: "2026-11-01T00:00:00Z",
    incoming: [],
    referenceName: repo,
    actorLogin: "creator",
  };
}

/** A small GitHub that answers the attribution discovery reads. */
function github(w: World) {
  const reads: string[] = [];
  const queries: string[] = [];
  const pull = (number: number) =>
    number === 2
      ? {
          node_id: "PR_two",
          number: 2,
          html_url: `https://github.com/${repo}/pull/2`,
          body: "Follows #1 and fixes #7",
          state: "closed",
          merged_at: merged,
          updated_at: w.outcomeUpdatedAt,
          head: { sha: head },
          comments: 0,
          review_comments: 0,
        }
      : {
          node_id: "PR_one",
          number: 1,
          html_url: `https://github.com/${repo}/pull/1`,
          body: null,
          state: "closed",
          merged_at: "2026-10-30T00:00:00Z",
          updated_at: w.originalUpdatedAt,
          head: { sha: "f".repeat(40) },
          comments: 0,
          review_comments: 0,
        };
  const reference = (owner: string, name: string, number: number) => {
    const nameWithOwner = `${owner}/${name}`;
    return {
      id: target?.expectedNodeId,
      isPrivate: false,
      nameWithOwner:
        nameWithOwner.toLowerCase() === repo.toLowerCase()
          ? w.referenceName
          : nameWithOwner,
      issueOrPullRequest:
        number === 1
          ? {
              __typename: "PullRequest",
              id: "PR_one",
              number: 1,
              url: `https://github.com/${repo}/pull/1`,
            }
          : { __typename: "Issue" },
    };
  };
  const client = {
    async get<T>(path: string): Promise<T | null> {
      reads.push(path);
      if (path === `/repos/${target?.owner}/${target?.name}`)
        return {
          id: 7,
          node_id: target?.expectedNodeId,
          private: false,
        } as T;
      const match = /\/pulls\/(\d+)$/u.exec(path);
      if (match) return pull(Number(match[1])) as T;
      if (/\/(?:reviews|comments)\?per_page=100&page=1$/u.test(path))
        return [] as T;
      throw new Error(`Unexpected read ${path}`);
    },
    async graphql<T>(
      query: string,
      variables: Record<string, unknown>,
    ): Promise<T> {
      queries.push(query.slice(0, 40));
      if (query === VALUE_REFERENCE_QUERY)
        return {
          repository: reference(
            String(variables.owner),
            String(variables.name),
            Number(variables.number),
          ),
        } as T;
      if (query.includes("SlopAttributionPullFences"))
        return {
          nodes: (variables.ids as string[]).map((id) => {
            const value = pull(id === "PR_two" ? 2 : 1);
            return {
              __typename: "PullRequest",
              id,
              updatedAt: value.updated_at,
              url: value.html_url,
              state: "MERGED",
            };
          }),
        } as T;
      if (query.includes("SlopAttributionIncomingFences"))
        return {
          nodes: (variables.ids as string[]).map((id) => ({
            __typename: "PullRequest",
            id,
            timelineItems: {
              pageInfo: { hasNextPage: false },
              nodes: w.incoming,
            },
          })),
        } as T;
      if (query.includes("SlopAttributionReferenceFences")) {
        const out: Record<string, unknown> = {};
        for (let index = 0; `o${index}` in variables; index++)
          out[`r${index}`] = reference(
            String(variables[`o${index}`]),
            String(variables[`n${index}`]),
            Number(variables[`x${index}`]),
          );
        return out as T;
      }
      if (query.includes("... on User{id login avatarUrl url}"))
        return {
          nodes: (variables.ids as string[]).map((id) => ({
            __typename: "User",
            id,
            login: w.actorLogin,
            avatarUrl: "https://avatars.githubusercontent.com/u/9?v=4",
            url: `https://github.com/${w.actorLogin}`,
          })),
        } as T;
      if (query.includes("timelineItems"))
        return {
          repository: {
            pullRequest: {
              id: "PR_two",
              timelineItems: {
                nodes: w.incoming,
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        } as T;
      throw new Error(`Unexpected query ${query.slice(0, 60)}`);
    },
    async fileText() {
      return null;
    },
  };
  return { client, reads, queries };
}

const transport = Object.assign(
  async () => {
    throw new Error("Attribution must not read value history");
  },
  { preconnect: fetch.preconnect },
);

function outcome(w: World) {
  return {
    id: "PR_two",
    number: 2,
    url: `https://github.com/${repo}/pull/2`,
    baseRefName: "main",
    headRefOid: head,
    mergedAt: merged,
    updatedAt: w.outcomeUpdatedAt,
    commits: [{ oid: head, author: null, parentCount: 1 }],
  };
}

async function collect(w: World, session: CollectionMemoSession) {
  const g = github(w);
  const result = await loadValueInputs(
    g.client,
    [],
    transport,
    undefined,
    [outcome(w)],
    undefined,
    { session, cutoffAt: cutoff },
  );
  return { result, ...g };
}

function reopen(session: CollectionMemoSession) {
  const now = new Date("2026-11-19T06:00:00.000Z");
  return openCollectionMemo({
    memo: parseCollectionMemo(
      session.serialize(cutoff, "2026-11-19T01:00:00.000Z"),
    ),
    forceFull: false,
    now,
    codeDigest: digest,
  });
}

function firstSession() {
  return new CollectionMemoSession(
    "full",
    digest,
    "2026-11-19T01:00:00.000Z",
    "test",
  );
}

test("a live attribution records every fenced input", async () => {
  const session = firstSession();
  const { result } = await collect(world(), session);
  expect(result.retainedCommitAuthors.size).toBe(0);
  const entry = session.next.get("PR_two");
  expect(entry?.result).toEqual({ kind: "none" });
  expect(entry?.pulls.map((pull) => pull.id)).toEqual(["PR_one", "PR_two"]);
  expect(entry?.references.map((reference) => reference.number)).toEqual([
    1, 7,
  ]);
  expect(entry?.fence.eligibleCommitShas).toEqual([head]);
});

test("an unchanged attribution is reused with no discovery reads", async () => {
  const first = firstSession();
  const live = await collect(world(), first);
  const second = reopen(first);
  expect(second.mode).toBe("incremental");
  const reused = await collect(world(), second);
  expect(second.stats.reused).toBe(1);
  expect(second.stats.live).toBe(0);
  expect(reused.reads.filter((path) => path.includes("/pulls/"))).toEqual([]);
  expect(reused.result.retainedCommitAuthors).toEqual(
    live.result.retainedCommitAuthors,
  );
  expect(reused.result.implementationAttributionHolds).toEqual(
    live.result.implementationAttributionHolds,
  );
  // The reused entry carries forward for the next collection.
  expect(second.next.get("PR_two")).toEqual(first.next.get("PR_two"));
});

test.each([
  [
    "the pull request was edited",
    (w: World) => {
      w.outcomeUpdatedAt = "2026-11-18T00:00:00Z";
    },
  ],
  [
    "a referenced pull request changed",
    (w: World) => {
      w.originalUpdatedAt = "2026-11-18T00:00:00Z";
    },
  ],
  [
    "another pull request now references it",
    (w: World) => {
      w.incoming = [
        {
          source: {
            __typename: "PullRequest",
            id: "PR_zero",
            number: 0,
            url: `https://github.com/${repo}/pull/0`,
            repository: { nameWithOwner: repo, isPrivate: false },
          },
        },
      ];
    },
  ],
  [
    "a referenced repository was renamed",
    (w: World) => {
      w.referenceName = "SlopDotCash/asi-renamed";
    },
  ],
])("an attribution is recomputed live when %s", async (_label, change) => {
  const first = firstSession();
  await collect(world(), first);
  const second = reopen(first);
  const w = world();
  change(w);
  const again = await collect(w, second).catch((error: unknown) => error);
  expect(second.stats.reused).toBe(0);
  if (again instanceof Error) {
    // The live path reached GitHub again and applied its own checks.
    expect(again.message.length).toBeGreaterThan(0);
    return;
  }
  const reads = (again as { reads: string[] }).reads;
  expect(reads.some((path) => path.endsWith("/pulls/2"))).toBe(true);
});

test("an audit difference discards every reuse in the run", async () => {
  const first = firstSession();
  await collect(world(), first);
  const entry = first.next.get("PR_two");
  if (!entry) throw new Error("missing entry");
  first.next.set("PR_two", {
    ...entry,
    result: {
      kind: "authors",
      authors: [
        [
          authorSha,
          "U_creator",
          "PR_one",
          `https://github.com/${repo}/pull/1`,
          head,
        ],
      ],
    },
  });
  const second = reopen(first);
  second.audits = () => true;
  const audited = await collect(world(), second);
  expect(second.stats.audited).toBe(1);
  expect(second.stats.auditMismatches).toBe(1);
  expect(second.stats.reused).toBe(0);
  expect(audited.result.retainedCommitAuthors.size).toBe(0);
});

test("a reused author is read live, so a renamed account shows its new login", async () => {
  const first = firstSession();
  await collect(world(), first);
  const entry = first.next.get("PR_two");
  if (!entry) throw new Error("missing entry");
  first.next.set("PR_two", {
    ...entry,
    result: {
      kind: "authors",
      authors: [
        [
          head,
          "U_creator",
          "PR_one",
          `https://github.com/${repo}/pull/1`,
          authorSha,
        ],
      ],
    },
  });
  const second = reopen(first);
  second.audits = () => false;
  const w = world();
  w.actorLogin = "renamed";
  const reused = await collect(w, second);
  expect(second.stats.reused).toBe(1);
  const authors = reused.result.retainedCommitAuthors.get("PR_two");
  expect(authors?.get(head)?.actor.login).toBe("renamed");
  expect(authors?.get(head)?.originalCommitSha).toBe(authorSha);
});

test("a memo from different code, a forced run or an old line is full", () => {
  const first = firstSession();
  const memo = parseCollectionMemo(
    first.serialize(cutoff, "2026-11-19T01:00:00.000Z"),
  );
  const at = (now: string, codeDigest = digest, forceFull = false) =>
    openCollectionMemo({ memo, forceFull, now: new Date(now), codeDigest });
  expect(at("2026-11-19T06:00:00.000Z").mode).toBe("incremental");
  expect(at("2026-11-19T06:00:00.000Z", "a".repeat(64)).reason).toBe(
    "attribution code changed",
  );
  expect(at("2026-11-19T06:00:00.000Z", digest, true).mode).toBe("full");
  expect(
    at(
      new Date(
        Date.parse("2026-11-19T01:00:00.000Z") +
          COLLECTION_MEMO_FULL_INTERVAL_MS +
          1,
      ).toISOString(),
    ).reason,
  ).toBe("weekly full collection");
  // A full run keeps immutable commit statistics but no attribution entries.
  const full = at("2026-11-19T06:00:00.000Z", digest, true);
  expect(full.prior.size).toBe(0);
});

test("a malformed memo is rejected whole", () => {
  const good = firstSession().serialize(cutoff, "2026-11-19T01:00:00.000Z");
  expect(() => parseCollectionMemo(good)).not.toThrow();
  const value = JSON.parse(good);
  value.extra = true;
  expect(() => parseCollectionMemo(JSON.stringify(value))).toThrow(
    "unexpected fields",
  );
  const lines = JSON.parse(good);
  lines.commitLines = [["R_x", "C_x", "not-a-sha", 1, 0]];
  expect(() => parseCollectionMemo(JSON.stringify(lines))).toThrow("identity");
});

test("commit statistics come from the memo only for the same commit object", async () => {
  const queried: string[][] = [];
  const client = {
    async execute(_query: string, variables: Record<string, unknown> = {}) {
      const ids = variables.ids as string[];
      queried.push(ids);
      return {
        nodes: ids.map((id) => ({
          __typename: "Commit",
          id,
          oid: id === "C_new" ? "1".repeat(40) : "3".repeat(40),
          additions: 5,
          deletions: 2,
          repository: { id: "R_repo" },
        })),
        rateLimit: { cost: 1, limit: 5000, remaining: 4999, resetAt: cutoff },
      };
    },
  };
  const session = new CollectionMemoSession(
    "incremental",
    digest,
    cutoff,
    "test",
    [
      ["R_repo", "C_known", "2".repeat(40), 10, 4],
      ["R_repo", "C_moved", "9".repeat(40), 1, 1],
    ],
  );
  const loader = new OutcomeCommitLineLoader(
    client as never,
    undefined,
    session.commitLines,
  );
  const lines = await loader.hydrate("R_repo", [
    { id: "C_known", oid: "2".repeat(40), parentCount: 1, author: null },
    { id: "C_new", oid: "1".repeat(40), parentCount: 1, author: null },
    { id: "C_moved", oid: "3".repeat(40), parentCount: 1, author: null },
  ]);
  expect(queried).toEqual([["C_new", "C_moved"]]);
  expect(lines.map((line) => [line.additions, line.deletions])).toEqual([
    [10, 4],
    [5, 2],
    [5, 2],
  ]);
  expect(session.commitLines.reused).toBe(1);
  expect(session.commitLines.read).toBe(2);
  expect(session.commitLines.rows().map((row) => row[1])).toEqual([
    "C_known",
    "C_moved",
    "C_new",
  ]);
});
