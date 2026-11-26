import { expect, test } from "bun:test";
import { sha256Hex } from "../src/lib/sha256";
import type { AcceptedImplementationSource } from "./accepted-implementation-digests";
import {
  ImplementationMemo,
  ImplementationMemoAuditError,
} from "./accepted-implementation-memo";
import {
  IMPLEMENTATION_MEMO_AUDIT_ONE_IN,
  IMPLEMENTATION_MEMO_CHANGED_CODE_AUDIT_ONE_IN,
  IMPLEMENTATION_MEMO_RULES_DIGEST,
  IMPLEMENTATION_MEMO_RULES_SOURCES,
  IMPLEMENTATION_MEMO_RULES_VERSION,
  rulesDigest,
} from "./collection-memo";
import {
  readImplementationProofs,
  readPreviousImplementationSources,
} from "./generate-leaderboard";

const repo = "R_eliza";
const codeDigest = "c".repeat(64);
const at = "2026-11-01T00:00:00.000Z";
const prior = {
  id: "PR_one",
  number: 9,
  url: "https://github.com/elizaOS/eliza/pull/9",
  mergedAt: "2026-10-01T00:00:00.000Z",
};
const source: AcceptedImplementationSource = {
  id: prior.id,
  headSha: "a".repeat(40),
  mergeSha: "b".repeat(40),
  mergeParentShas: ["1".repeat(40), "a".repeat(40)],
  mergeTreeSha: "2".repeat(40),
  firstParentTreeSha: "3".repeat(40),
};
const digest = "d".repeat(64);
const observation = { kind: "candidate", shape: "18/47/0", source } as const;

test("restored evidence is reusable only with the same public identity and native acceptance", () => {
  const memo = new ImplementationMemo();
  memo.rememberPrevious(repo, prior, observation);
  memo.rememberDigest(repo, source, digest);
  const bytes = memo.serialize(codeDigest, at);
  const restored = ImplementationMemo.parse(bytes, codeDigest, new Date(at));
  expect(restored.previous(repo, prior)).toEqual(observation);
  expect(restored.previous(repo, { ...prior, mergedAt: at })).toBeUndefined();
  expect(restored.previous("R_other", prior)).toBeUndefined();
  expect(restored.digest(repo, source)).toBe(digest);
  expect(restored.digest("R_other", source)).toBeUndefined();
  expect(
    restored.digest(repo, {
      ...source,
      mergeParentShas: ["4".repeat(40), source.headSha],
    }),
  ).toBeUndefined();
  expect(
    restored.digest(repo, {
      ...source,
      firstParentTreeSha: "4".repeat(40),
    }),
  ).toBeUndefined();
  expect(restored.serialize(codeDigest, at)).toBe(bytes);
});

test("a verified ordinary acceptance survives a warm read without trusting the old shape-only memo", () => {
  const memo = new ImplementationMemo();
  const squash = { ...source, mergeParentShas: [source.mergeParentShas[0]] };
  const accepted = { kind: "accepted-ordinary", source: squash } as const;
  memo.rememberPrevious(repo, prior, accepted);
  const bytes = memo.serialize(codeDigest, at);
  const read = (received: string, now = at) =>
    ImplementationMemo.parse(received, codeDigest, new Date(now));
  const restored = read(bytes);
  expect(restored.previous(repo, prior)).toEqual(accepted);
  expect(restored.previous("R_other", prior)).toBeUndefined();
  expect(
    read(
      restored.serialize(codeDigest, "2026-11-05T00:00:00.000Z"),
      "2026-11-09T00:00:00.000Z",
    ).previous(repo, prior),
  ).toBeUndefined();
  expect(() =>
    read(
      bytes.replace(
        "slop-accepted-implementation-memo-v3",
        "slop-accepted-implementation-memo-v2",
      ),
    ),
  ).toThrow("format or rules version");
  for (const invalid of [
    { ...squash, mergeSha: squash.headSha },
    { ...squash, mergeParentShas: source.mergeParentShas },
    { ...squash, mergeTreeSha: squash.firstParentTreeSha },
  ]) {
    const edited = JSON.parse(bytes);
    edited.previous[0].observation.source = invalid;
    expect(() => read(JSON.stringify(edited))).toThrow();
  }
});

test("recollection discards only observations made in the failed pass", () => {
  const memo = new ImplementationMemo();
  memo.rememberPrevious(repo, prior, observation);
  const restored = ImplementationMemo.parse(
    memo.serialize(codeDigest, at),
    codeDigest,
    new Date(at),
  );
  const current = {
    ...prior,
    id: "PR_current",
    number: 10,
    url: "https://github.com/elizaOS/eliza/pull/10",
  };
  const currentSource = { ...source, id: current.id };
  const currentObservation = { ...observation, source: currentSource };
  restored.rememberPrevious(repo, current, currentObservation);
  restored.rememberDigest(repo, currentSource, digest);
  expect(restored.previous(repo, current)).toEqual(currentObservation);
  restored.beginPass();
  expect(restored.previous(repo, current)).toBeUndefined();
  expect(restored.previous(repo, prior)).toEqual(observation);
  expect(restored.digest(repo, currentSource)).toBe(digest);
});

test("copying forward a memo cannot re-age an explicit negative observation", () => {
  const memo = new ImplementationMemo();
  memo.rememberPrevious(repo, prior, { kind: "ineligible" });
  memo.rememberDigest(repo, source, digest);
  const bytes = memo.serialize(codeDigest, at);
  const nextAt = "2026-11-06T00:00:00.000Z";
  const next = ImplementationMemo.parse(bytes, codeDigest, new Date(nextAt));
  expect(next.previous(repo, prior)).toEqual({ kind: "ineligible" });
  const latest = ImplementationMemo.parse(
    next.serialize(codeDigest, nextAt),
    codeDigest,
    new Date("2026-11-09T00:00:00.000Z"),
  );
  expect(latest.previous(repo, prior)).toBeUndefined();
  expect(latest.digest(repo, source)).toBe(digest);
});

test("only an exact native proof can preserve an old prior identity", () => {
  const memo = new ImplementationMemo();
  const unproven = {
    ...prior,
    id: "PR_unproven",
    number: 11,
    url: "https://github.com/elizaOS/eliza/pull/11",
  };
  memo.rememberPrevious(repo, prior, observation);
  memo.rememberPrevious(repo, unproven, {
    ...observation,
    source: { ...source, id: unproven.id },
  });
  memo.rememberDigest(repo, source, digest);
  const nextAt = "2026-11-07T00:00:00.000Z";
  const next = ImplementationMemo.parse(
    memo.serialize(codeDigest, at),
    codeDigest,
    new Date(nextAt),
  );
  const latest = ImplementationMemo.parse(
    next.serialize(codeDigest, nextAt),
    codeDigest,
    new Date("2026-11-09T00:00:00.000Z"),
  );
  expect(latest.previous(repo, prior)).toEqual(observation);
  expect(latest.previous(repo, unproven)).toBeUndefined();
  expect(latest.previous("R_other", prior)).toBeUndefined();
});

test("invalid or contradictory trusted evidence cannot become a cache hit", () => {
  const memo = new ImplementationMemo();
  memo.rememberPrevious(repo, prior, observation);
  memo.rememberDigest(repo, source, digest);
  const bytes = memo.serialize(codeDigest, at);
  expect(() =>
    ImplementationMemo.parse(
      bytes,
      codeDigest,
      new Date(at),
      IMPLEMENTATION_MEMO_RULES_VERSION + 1,
    ),
  ).toThrow("format or rules version");
  expect(() =>
    ImplementationMemo.parse(
      bytes,
      codeDigest,
      new Date("2026-10-30T00:00:00.000Z"),
    ),
  ).toThrow("stale or future artifact");
  expect(() =>
    ImplementationMemo.parse(
      bytes,
      codeDigest,
      new Date("2026-11-09T00:00:00.000Z"),
    ),
  ).toThrow("stale or future artifact");
  expect(() => memo.rememberDigest(repo, source, sha256Hex(""))).toThrow(
    "empty or contradictory",
  );
  expect(() => memo.rememberDigest(repo, source, "f".repeat(64))).toThrow(
    "empty or contradictory",
  );
  const edited = JSON.parse(bytes);
  edited.previous[0].observation.source.id = "PR_other";
  expect(() =>
    ImplementationMemo.parse(JSON.stringify(edited), codeDigest, new Date(at)),
  ).toThrow("candidate pull request identity");
  edited.previous[0].observation = {
    kind: "ineligible",
    reason: "missing response",
  };
  expect(() =>
    ImplementationMemo.parse(JSON.stringify(edited), codeDigest, new Date(at)),
  ).toThrow("unexpected fields");
});

test("a memo written under other code is kept and audited more often; other rules discard it", () => {
  const memo = new ImplementationMemo();
  memo.rememberPrevious(repo, prior, observation);
  memo.rememberDigest(repo, source, digest);
  const bytes = memo.serialize(codeDigest, at);
  const same = ImplementationMemo.parse(bytes, codeDigest, new Date(at));
  expect(same.auditOneIn).toBe(IMPLEMENTATION_MEMO_AUDIT_ONE_IN);
  const changed = ImplementationMemo.parse(bytes, "e".repeat(64), new Date(at));
  expect(changed.auditOneIn).toBe(
    IMPLEMENTATION_MEMO_CHANGED_CODE_AUDIT_ONE_IN,
  );
  expect(changed.digest(repo, source)).toBe(digest);
  expect(changed.previous(repo, prior)).toEqual(observation);
  // The next memo is written under the code that produced it.
  expect(
    ImplementationMemo.parse(
      changed.serialize("e".repeat(64), at),
      "e".repeat(64),
      new Date(at),
    ).auditOneIn,
  ).toBe(IMPLEMENTATION_MEMO_AUDIT_ONE_IN);
});

test("the implementation memo rules pin matches its sources", () => {
  // A failure here means a rule source changed. If the change could make a
  // saved digest or observation come out differently, raise
  // IMPLEMENTATION_MEMO_RULES_VERSION; then update the pinned digest.
  expect(
    rulesDigest(
      undefined,
      IMPLEMENTATION_MEMO_RULES_SOURCES,
      "implementation-memo-rules",
    ),
  ).toBe(IMPLEMENTATION_MEMO_RULES_DIGEST);
});

function restoredMemo(savedDigest = digest) {
  const memo = new ImplementationMemo();
  memo.rememberPrevious(repo, prior, observation);
  memo.rememberDigest(repo, source, savedDigest);
  const restored = ImplementationMemo.parse(
    memo.serialize(codeDigest, at),
    codeDigest,
    new Date(at),
  );
  restored.auditOneIn = 1;
  return restored;
}

const publicRepository = {
  full_name: "elizaOS/eliza",
  node_id: repo,
  private: false,
} as const;

test("an audited saved digest that still matches is kept; a different one discards every saved entry", async () => {
  const agreeing = restoredMemo();
  let reads = 0;
  const live = async () => {
    reads += 1;
    return {
      digests: new Map([[source.id, digest]]),
      unavailable: new Set<string>(),
    };
  };
  const proofs = await readImplementationProofs(
    live,
    publicRepository,
    [source],
    agreeing,
  );
  expect(reads).toBe(1);
  expect(proofs.digests.get(source.id)).toBe(digest);
  expect(agreeing.stats).toMatchObject({ audited: 1, auditMismatches: 0 });

  const disagreeing = restoredMemo("f".repeat(64));
  await expect(
    readImplementationProofs(live, publicRepository, [source], disagreeing),
  ).rejects.toBeInstanceOf(ImplementationMemoAuditError);
  expect(disagreeing.digest(repo, source)).toBeUndefined();
  expect(disagreeing.previous(repo, prior)).toBeUndefined();
  // With nothing saved left, the same read is simply live.
  const again = await readImplementationProofs(
    live,
    publicRepository,
    [source],
    disagreeing,
  );
  expect(again.digests.get(source.id)).toBe(digest);
});

test("an audit whose live read proves nothing keeps the saved digest", async () => {
  const memo = restoredMemo();
  const proofs = await readImplementationProofs(
    async () => ({ digests: new Map(), unavailable: new Set([source.id]) }),
    publicRepository,
    [source],
    memo,
  );
  expect(proofs.digests.get(source.id)).toBe(digest);
  expect(proofs.unavailable.size).toBe(0);
  expect(memo.stats.auditMismatches).toBe(0);
});

function priorNode(changedFiles: number) {
  return {
    __typename: "PullRequest",
    id: prior.id,
    number: prior.number,
    url: prior.url,
    state: "MERGED",
    mergedAt: prior.mergedAt,
    repository: { id: repo, isPrivate: false },
    headRefOid: source.headSha,
    changedFiles,
    additions: 47,
    deletions: 0,
    mergeCommit: {
      oid: source.mergeSha,
      tree: { oid: source.mergeTreeSha },
      parents: {
        totalCount: 2,
        nodes: [
          {
            oid: source.mergeParentShas[0],
            tree: { oid: source.firstParentTreeSha },
          },
          { oid: source.headSha, tree: { oid: "5".repeat(40) } },
        ],
      },
    },
    commits: {
      totalCount: 1,
      pageInfo: { hasNextPage: false },
      nodes: [{ commit: { oid: source.headSha, parents: { totalCount: 1 } } }],
    },
  };
}

test("an audited saved observation is read again; a different live one discards every saved entry", async () => {
  const client = (changedFiles: number) => ({
    execute: async () => ({ nodes: [priorNode(changedFiles)] }),
  });
  const agreeing = restoredMemo();
  const same = await readPreviousImplementationSources(
    client(18) as never,
    repo,
    new Set(["18/47/0"]),
    [prior],
    agreeing,
  );
  expect(same.candidates.get("18/47/0")).toEqual([source]);
  expect(agreeing.stats).toMatchObject({ audited: 1, auditMismatches: 0 });

  const disagreeing = restoredMemo();
  await expect(
    readPreviousImplementationSources(
      client(19) as never,
      repo,
      new Set(["18/47/0"]),
      [prior],
      disagreeing,
    ),
  ).rejects.toBeInstanceOf(ImplementationMemoAuditError);
  expect(disagreeing.digest(repo, source)).toBeUndefined();

  // A live read that proves nothing leaves the saved observation in use.
  const silent = restoredMemo();
  const kept = await readPreviousImplementationSources(
    { execute: async () => ({ nodes: [null] }) } as never,
    repo,
    new Set(["18/47/0"]),
    [prior],
    silent,
  );
  expect(kept.candidates.get("18/47/0")).toEqual([source]);
});
