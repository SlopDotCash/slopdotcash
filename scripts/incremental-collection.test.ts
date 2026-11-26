import { expect, test } from "bun:test";
import { findRegisteredRepositoryById } from "../src/lib/repositories.mjs";
import { VALUE_REFERENCE_QUERY } from "../workers/slopbot/value-reference-query";
import {
  ATTRIBUTION_AUDIT_ONE_IN,
  ATTRIBUTION_CHANGED_CODE_AUDIT_ONE_IN,
  ATTRIBUTION_REFRESH_MS,
  ATTRIBUTION_RULES_DIGEST,
  ATTRIBUTION_RULES_VERSION,
  attributionRefreshAge,
  attributionRulesDigest,
  CollectionMemoSession,
  openCollectionMemo,
  parseCollectionMemo,
  watchAttribution,
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
  // The reused entry carries forward for the next collection, keeping the
  // time it was computed so the rolling refresh still reaches it.
  const carried = second.next.get("PR_two");
  const { computedAt, ...rest } = carried ?? { computedAt: null };
  const { computedAt: _first, ...original } = first.next.get("PR_two") ?? {
    computedAt: null,
  };
  expect(rest).toEqual(original);
  expect(computedAt).toBe("2026-11-19T01:00:00.000Z");
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

test("only other attribution rules, a forced run or no memo is full", async () => {
  const first = firstSession();
  await collect(world(), first);
  const memo = parseCollectionMemo(
    first.serialize(cutoff, "2026-11-19T01:00:00.000Z"),
  );
  expect(memo.attributionRulesVersion).toBe(ATTRIBUTION_RULES_VERSION);
  const at = (
    now: string,
    codeDigest = digest,
    forceFull = false,
    rulesVersion = ATTRIBUTION_RULES_VERSION,
  ) =>
    openCollectionMemo({
      memo,
      forceFull,
      now: new Date(now),
      codeDigest,
      rulesVersion,
    });
  const same = at("2026-11-19T06:00:00.000Z");
  expect(same.mode).toBe("incremental");
  expect(same.auditOneIn).toBe(ATTRIBUTION_AUDIT_ONE_IN);
  // Other code with the same rules keeps the saved answers and audits more.
  const changed = at("2026-11-19T06:00:00.000Z", "a".repeat(64));
  expect(changed.mode).toBe("incremental");
  expect(changed.prior.size).toBe(1);
  expect(changed.auditOneIn).toBe(ATTRIBUTION_CHANGED_CODE_AUDIT_ONE_IN);
  expect(changed.reason).toBe(
    `code changed since the previous memo; auditing 1 in ${ATTRIBUTION_CHANGED_CODE_AUDIT_ONE_IN}`,
  );
  // A raised rules version discards every saved answer.
  const rules = at(
    "2026-11-19T06:00:00.000Z",
    digest,
    false,
    ATTRIBUTION_RULES_VERSION + 1,
  );
  expect(rules.mode).toBe("full");
  expect(rules.reason).toBe("attribution rules changed");
  expect(rules.prior.size).toBe(0);
  const forced = at("2026-11-19T06:00:00.000Z", digest, true);
  expect(forced.mode).toBe("full");
  // A full run keeps immutable commit statistics but no attribution entries.
  expect(forced.prior.size).toBe(0);
  expect(
    openCollectionMemo({
      memo: null,
      forceFull: false,
      now: new Date("2026-11-19T06:00:00.000Z"),
      codeDigest: digest,
    }).mode,
  ).toBe("full");
});

test("a week-old memo is not a full run; each answer is refreshed on its own age", async () => {
  const first = firstSession();
  await collect(world(), first);
  const memo = parseCollectionMemo(
    first.serialize(cutoff, "2026-11-19T01:00:00.000Z"),
  );
  const age = attributionRefreshAge("PR_two");
  expect(age).toBeGreaterThanOrEqual(ATTRIBUTION_REFRESH_MS / 2);
  expect(age).toBeLessThanOrEqual(ATTRIBUTION_REFRESH_MS);
  const open = (offset: number) =>
    openCollectionMemo({
      memo,
      forceFull: false,
      now: new Date(Date.parse("2026-11-19T01:00:00.000Z") + offset),
      codeDigest: digest,
    });
  const young = open(age - 1);
  expect(young.mode).toBe("incremental");
  expect(young.prior.has("PR_two")).toBe(true);
  expect(young.expired).toBe(0);
  const old = open(ATTRIBUTION_REFRESH_MS + 1);
  expect(old.mode).toBe("incremental");
  expect(old.prior.has("PR_two")).toBe(false);
  expect(old.expired).toBe(1);
});

test("answers are refreshed on spread ages, not all on one day", () => {
  const ages = Array.from({ length: 400 }, (_, index) =>
    attributionRefreshAge(`PR_${index}`),
  );
  const half = ATTRIBUTION_REFRESH_MS / 2;
  const early = ages.filter((age) => age < half + half / 2).length;
  expect(early).toBeGreaterThan(120);
  expect(early).toBeLessThan(280);
});

test("an expired answer is computed live and dated by this run", async () => {
  const first = firstSession();
  await collect(world(), first);
  const memo = parseCollectionMemo(
    first.serialize(cutoff, "2026-11-19T01:00:00.000Z"),
  );
  const later = openCollectionMemo({
    memo,
    forceFull: false,
    now: new Date(
      Date.parse("2026-11-19T01:00:00.000Z") + ATTRIBUTION_REFRESH_MS + 1,
    ),
    codeDigest: digest,
  });
  const again = await collect(world(), later);
  expect(later.stats.reused).toBe(0);
  expect(later.stats.live).toBe(1);
  expect(again.reads.some((path) => path.endsWith("/pulls/2"))).toBe(true);
  const next = parseCollectionMemo(
    later.serialize(cutoff, "2026-11-27T00:00:00.000Z"),
  );
  expect(next.attributions[0]?.computedAt).toBe("2026-11-27T00:00:00.000Z");
});

test("changed code audits one in ten reusable answers", () => {
  const session = new CollectionMemoSession(
    "incremental",
    digest,
    cutoff,
    "test",
    [],
    [],
    ATTRIBUTION_CHANGED_CODE_AUDIT_ONE_IN,
  );
  const sampled = Array.from({ length: 2000 }, (_, index) =>
    session.audits(`PR_${index}`, cutoff),
  ).filter(Boolean).length;
  expect(sampled).toBeGreaterThan(140);
  expect(sampled).toBeLessThan(260);
});

test("a version 1 memo is read as rules version 1, dated at its last full run", () => {
  const first = firstSession();
  const current = JSON.parse(
    first.serialize(cutoff, "2026-11-19T01:00:00.000Z"),
  );
  current.attributions = [
    {
      outcomeId: "PR_two",
      fence: {
        number: 2,
        url: `https://github.com/${repo}/pull/2`,
        headRefOid: head,
        mergedAt: "2026-11-10T10:00:00.000Z",
        updatedAt: "2026-11-10T10:00:00.000Z",
        repositoryNodeId: "R_x",
        eligibleCommitShas: [head],
      },
      pulls: [],
      references: [],
      incoming: [],
      result: { kind: "none" },
    },
  ];
  const { attributionRulesVersion: _version, ...v1 } = current;
  v1.format = "slop-collection-memo-v1";
  v1.lastFullAt = "2026-11-18T00:00:00.000Z";
  const memo = parseCollectionMemo(JSON.stringify(v1));
  expect(memo.attributionRulesVersion).toBe(1);
  expect(memo.attributions[0]?.computedAt).toBe("2026-11-18T00:00:00.000Z");
});

test("the attribution rules pin matches its sources", () => {
  const actual = attributionRulesDigest();
  if (actual !== ATTRIBUTION_RULES_DIGEST)
    throw new Error(
      `The attribution rules changed (scripts/collection-memo.ts ATTRIBUTION_RULES_SOURCES). If a saved attribution answer could now come out differently, raise ATTRIBUTION_RULES_VERSION. Then set ATTRIBUTION_RULES_DIGEST to ${actual}.`,
    );
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

test("a slow attribution is named with its minutes and how it was answered", async () => {
  const lines: string[] = [];
  const log = { thresholdMs: 0, write: (line: string) => lines.push(line) };
  const first = firstSession();
  await loadValueInputs(
    github(world()).client,
    [],
    transport,
    undefined,
    [outcome(world())],
    undefined,
    { session: first, cutoffAt: cutoff, log },
  );
  expect(lines).toContain(
    `[slop.cash] slow attribution: ${repo}#2 took 0.0 minutes, computed live\n`,
  );
  lines.length = 0;
  const second = reopen(first);
  await loadValueInputs(
    github(world()).client,
    [],
    transport,
    undefined,
    [outcome(world())],
    undefined,
    { session: second, cutoffAt: cutoff, log },
  );
  expect(lines).toContain(
    `[slop.cash] slow attribution: ${repo}#2 took 0.0 minutes, reused from the memo\n`,
  );
  // The reuse counts are reported when the attribution phase ends, so a run
  // that fails afterwards has still printed them.
  expect(lines.at(-1)).toBe(
    `[slop.cash] collection memo: commit statistics 0 reused, 0 read; attributions 1 reused, 0 computed live, 0 past their refresh age, 0 audited (1 in ${ATTRIBUTION_AUDIT_ONE_IN}), 0 audit mismatches, 0 changed since the last collection\n`,
  );
});

test("an attribution still running past the threshold is named before it ends", async () => {
  const lines: string[] = [];
  const done = watchAttribution("o/r#7", {
    thresholdMs: 10,
    write: (line) => lines.push(line),
  });
  await new Promise((resolve) => setTimeout(resolve, 60));
  expect(lines).toEqual([
    "[slop.cash] slow attribution still running: o/r#7, over 0.0 minutes\n",
  ]);
  done("computed live, hold");
  expect(lines[1]).toMatch(
    /^\[slop\.cash\] slow attribution: o\/r#7 took 0\.0 minutes, computed live, hold\n$/u,
  );
  const quiet: string[] = [];
  watchAttribution("o/r#8", {
    thresholdMs: 60_000,
    write: (line) => quiet.push(line),
  })("computed live");
  expect(quiet).toEqual([]);
});
