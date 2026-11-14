import { expect, test } from "bun:test";
import {
  appendPointAwards,
  emptyPointsJournal,
  latestPoints,
  type PointAward,
  type PointsJournal,
  pointKey,
  pointMembers,
} from "../src/lib/points";
import {
  applyPointsImplementationCorrections,
  type CorrectionActor,
  type CorrectionSource,
  createPointsCorrectionBaseline,
  type PointsImplementationCorrectionCandidate,
  type PointsImplementationCorrectionManifest,
} from "../src/lib/points-implementation-corrections";

const A: CorrectionActor = {
  id: "MDQ6VXNlcjQy",
  login: "author-a",
  kind: "User",
};
const B: CorrectionActor = {
  id: "MDQ6VXNlcjQz",
  login: "author-b",
  kind: "User",
};
const C: CorrectionActor = {
  id: "MDQ6VXNlcjQ0",
  login: "carrier",
  kind: "User",
};
const OCCURRED = "2026-01-01T00:00:00.000Z";
const BASELINE = "2026-11-01T00:00:00.000Z";
const COLLECTED = "2026-11-13T00:00:00.000Z";
const RECORDED = "2026-11-13T01:00:00.000Z";
const LATER = "2026-11-14T00:00:00.000Z";
const SOURCE = "PR_first";
const URL = "https://github.com/SlopDotCash/asi/pull/1";
const VALUE = "d".repeat(64);
const sha = (letter: string) => letter.repeat(40);
const total = (journal: PointsJournal) =>
  pointMembers(journal).reduce((sum, member) => sum + member.total, 0);
function award(
  who = C,
  amount = 13,
  source = SOURCE,
  unit = "wu_asi_pr_1",
  grouped = false,
): PointAward {
  return {
    key: pointKey(
      "asi",
      who.id,
      "merged-pull-request",
      source,
      grouped ? unit : undefined,
    ),
    actor: { id: who.id, login: who.login },
    projectId: "asi",
    category: "merged-pull-request",
    amount,
    occurredAt: OCCURRED,
    sourceId: source,
    sourceUrl:
      source === SOURCE ? URL : "https://github.com/SlopDotCash/asi/pull/2",
    workUnitId: unit,
    provisional: false,
  };
}
function initial(awards = [award()], grouped = false) {
  return appendPointAwards(
    emptyPointsJournal(BASELINE),
    awards,
    "a".repeat(64),
    grouped ? "slop-score-v2" : "slop-score-v1",
    BASELINE,
    grouped
      ? new Map(
          awards.map((row) => [
            row.key,
            {
              sourceId: `value:${VALUE}`,
              effectiveAt: BASELINE,
              reason: "Retained grouped assessment.",
            },
          ]),
        )
      : undefined,
  );
}
function source(): CorrectionSource {
  return {
    repository: "SlopDotCash/asi",
    repositoryNodeId: "R_kgDOT23CXA",
    sourceId: SOURCE,
    sourceUrl: URL,
    headSha: sha("b"),
    occurredAt: OCCURRED,
    author: C,
    complete: true,
    commitCount: 2,
    commits: [
      {
        sha: sha("a"),
        parentCount: 1,
        author: A,
        additions: 1,
        deletions: 0,
        firstAcceptedSourceId: SOURCE,
        files: [{ path: "one.ts", additions: 1, deletions: 0 }],
      },
      {
        sha: sha("b"),
        parentCount: 1,
        author: B,
        additions: 2,
        deletions: 1,
        firstAcceptedSourceId: SOURCE,
        files: [{ path: "two.ts", additions: 2, deletions: 1 }],
      },
    ],
  };
}
function candidate(
  journal: PointsJournal,
): PointsImplementationCorrectionCandidate {
  return {
    id: "correction_first",
    kind: "pull-request",
    projectId: "asi",
    sourceId: SOURCE,
    sourceUrl: URL,
    occurredAt: OCCURRED,
    workUnitId: "wu_asi_pr_1",
    sourceIds: [SOURCE],
    expectedPredecessors: [...latestPoints(journal).values()]
      .filter((row) => row.award.sourceId === SOURCE)
      .map((row) => ({ key: row.award.key, revisionId: row.id })),
    proof: {
      status: "complete",
      censusDigest: "c".repeat(64),
      sources: [source()],
    },
  };
}
function manifest(
  journal: PointsJournal,
  candidates = [candidate(journal)],
): PointsImplementationCorrectionManifest {
  return {
    schemaVersion: "1",
    rule: "historical-implementation-allocation-v1",
    generatedAt: COLLECTED,
    baseline: createPointsCorrectionBaseline(journal),
    candidates,
  };
}
function otherCandidate(
  journal: PointsJournal,
): PointsImplementationCorrectionCandidate {
  const otherSource = source();
  otherSource.sourceId = "PR_other";
  otherSource.sourceUrl = "https://github.com/SlopDotCash/asi/pull/2";
  otherSource.headSha = sha("c");
  otherSource.commitCount = 1;
  otherSource.commits = [
    {
      sha: sha("c"),
      parentCount: 1,
      author: B,
      additions: 1,
      deletions: 0,
      firstAcceptedSourceId: "PR_other",
    },
  ];
  return {
    id: "correction_other",
    kind: "pull-request",
    projectId: "asi",
    sourceId: "PR_other",
    sourceUrl: otherSource.sourceUrl,
    occurredAt: OCCURRED,
    workUnitId: "wu_other",
    sourceIds: ["PR_other"],
    expectedPredecessors: [...latestPoints(journal).values()]
      .filter((revision) => revision.award.sourceId === "PR_other")
      .map((revision) => ({
        key: revision.award.key,
        revisionId: revision.id,
      })),
    proof: {
      status: "complete",
      censusDigest: "c".repeat(64),
      sources: [otherSource],
    },
  };
}
function apply(
  journal: PointsJournal,
  input = manifest(journal),
  eligible = true,
  at = RECORDED,
  participationBans: ReadonlyMap<string, string> = new Map(),
) {
  return applyPointsImplementationCorrections(
    journal,
    input,
    input.candidates.map((row) => ({ candidateId: row.id, eligible })),
    at,
    participationBans,
  );
}
function amounts(journal: PointsJournal) {
  return Object.fromEntries(
    [...latestPoints(journal).values()]
      .filter((row) => row.award.sourceId === SOURCE)
      .map((row) => [row.award.actor.id, row.award.amount]),
  );
}
function complete(input: PointsImplementationCorrectionManifest) {
  const proof = input.candidates[0].proof;
  if (proof.status !== "complete") throw new Error("fixture proof is held");
  return proof;
}

test("old v1 pool is shared in whole Points without revaluing or rewriting its history", () => {
  const journal = initial();
  const result = apply(journal);
  expect(result.dispositions).toEqual([
    { candidateId: "correction_first", status: "applied" },
  ]);
  expect(result.journal.revisions.slice(0, journal.revisions.length)).toEqual(
    journal.revisions,
  );
  expect(journal.revisions[0].sourceRule).toBe("slop-score-v1");
  expect(amounts(result.journal)).toEqual({ [A.id]: 3, [B.id]: 10, [C.id]: 0 });
  expect(total(result.journal)).toBe(13);
  expect(result.journal.coverage).toEqual(journal.coverage);
  for (const revision of result.journal.revisions.slice(
    journal.revisions.length,
  )) {
    expect(revision.award.occurredAt).toBe(OCCURRED);
    expect(revision.award.sourceId).toBe(SOURCE);
    expect(revision.award.workUnitId).toBe("wu_asi_pr_1");
    expect(revision.sourceDigest).toBe(result.manifestDigest);
    expect(revision.decision?.reason).toContain("unchanged historical");
  }
});

test("participation bans hold positive shares on or after the ban, preserving earlier work", () => {
  for (const [bannedAt, held] of [
    ["2025-12-31T23:59:59.000Z", true],
    [OCCURRED, true],
    ["2026-01-01T00:00:00.001Z", false],
  ] as const) {
    const journal = initial();
    const result = apply(
      journal,
      manifest(journal),
      true,
      RECORDED,
      new Map([[A.id, bannedAt]]),
    );
    expect(result.dispositions[0].status).toBe(held ? "held" : "applied");
    if (held) expect(result.journal).toBe(journal);
    else expect(amounts(result.journal)[A.id]).toBe(3);
    expect(total(result.journal)).toBe(13);
  }
});

test("a banned zero-share recipient does not block or redistribute the unchanged pool", () => {
  const journal = initial([award(C, 1)]);
  const result = apply(
    journal,
    manifest(journal),
    true,
    RECORDED,
    new Map([[A.id, OCCURRED]]),
  );
  expect(result.dispositions[0].status).toBe("applied");
  expect(amounts(result.journal)).toEqual({ [C.id]: 0, [B.id]: 1 });
});

test("the current ban map is mandatory and validates immutable IDs and canonical dates", () => {
  const journal = initial();
  const input = manifest(journal);
  expect(() =>
    Reflect.apply(applyPointsImplementationCorrections, undefined, [
      journal,
      input,
      [{ candidateId: input.candidates[0].id, eligible: true }],
      RECORDED,
    ]),
  ).toThrow("participation bans are required");
  for (const bans of [
    new Map([["bad actor id", OCCURRED]]),
    new Map([[A.id, "2026-01-01T00:00:00Z"]]),
    new Map([[A.id, "not-a-date"]]),
  ])
    expect(() => apply(journal, input, true, RECORDED, bans)).toThrow(
      "invalid participation ban",
    );
});

test("complete zero-line evidence uses actor-ID ties, while zero recipients cannot inflate the pool", () => {
  const journal = initial([award(C, 1)]);
  const input = manifest(journal);
  for (const commit of complete(input).sources[0].commits) {
    commit.additions = 0;
    commit.deletions = 0;
    commit.files = [];
  }
  const result = apply(journal, input);
  expect(amounts(result.journal)).toEqual({ [C.id]: 0, [A.id]: 1 });
  expect(total(result.journal)).toBe(1);
});

test("a sole verified recipient keeps the pool when line counts are unavailable", () => {
  const journal = initial();
  const input = manifest(journal);
  const evidence = complete(input).sources[0];
  evidence.commits = [evidence.commits[0]];
  evidence.commitCount = 1;
  evidence.headSha = evidence.commits[0].sha;
  evidence.commits[0].additions = null;
  evidence.commits[0].deletions = null;
  delete evidence.commits[0].files;
  expect(amounts(apply(journal, input).journal)).toEqual({
    [A.id]: 13,
    [C.id]: 0,
  });
});

test("a bot primary commit uses the eligible source creator without altering its identity", () => {
  const journal = initial();
  const input = manifest(journal);
  const evidence = complete(input).sources[0];
  const bot: CorrectionActor = {
    id: "BOT_dependabot",
    login: "dependabot[bot]",
    kind: "Bot",
  };
  evidence.author = A;
  for (const commit of evidence.commits) commit.author = bot;
  expect(amounts(apply(journal, input).journal)).toEqual({
    [A.id]: 13,
    [C.id]: 0,
  });
  expect(evidence.commits[0].author).toEqual(bot);
  evidence.author = bot;
  const held = apply(journal, input);
  expect(held.journal).toBe(journal);
  expect(held.dispositions[0].status).toBe("held");
});

test("retained-copy metadata cannot override a linked eligible primary user", () => {
  const journal = initial();
  const input = manifest(journal);
  complete(input).sources[0].commits[0].retainedCopy = {
    originalSourceId: "PR_original",
    originalCommitSha: sha("c"),
    boundPaths: ["one.ts"],
    bindingDigest: "e".repeat(64),
  };
  expect(() => apply(journal, input)).toThrow(
    "linked author must not be overridden",
  );
});

test("multiple recipients with missing counts, missing identities or an incomplete census stay held", () => {
  for (const failure of ["lines", "identity", "census"] as const) {
    const journal = initial();
    const input = manifest(journal);
    const evidence = complete(input).sources[0];
    if (failure === "lines") evidence.commits[0].additions = null;
    if (failure === "identity") {
      evidence.author = null;
      evidence.commits[0].author = null;
    }
    if (failure === "census") evidence.commitCount += 1;
    const result = apply(journal, input);
    expect(result.journal).toBe(journal);
    expect(result.dispositions[0].status).toBe("held");
  }
});

test("merge commits and commits already accepted elsewhere supply no implementation share", () => {
  const journal = initial();
  const input = manifest(journal);
  const evidence = complete(input).sources[0];
  evidence.commits[0].parentCount = 2;
  evidence.commits[1].firstAcceptedSourceId = "PR_earlier";
  const result = apply(journal, input);
  expect(result.journal).toBe(journal);
  expect(result.dispositions[0].status).toBe("held");
});

test("current zero pools remain zero and exactly unchanged recipients cause no revisions", () => {
  const zero = initial([award(C, 0)]);
  expect(apply(zero).journal).toBe(zero);
  expect(apply(zero).dispositions[0].status).toBe("unchanged");
  const unchanged = initial([award(A, 3), award(B, 10), award(C, 0)]);
  const input = manifest(unchanged);
  complete(input).sources[0].commits[0].author = { ...A, login: "renamed-a" };
  expect(apply(unchanged, input).journal).toBe(unchanged);
});

test("the complete manifest replays once and never revives later corrections or revocations", () => {
  const journal = initial();
  const input = manifest(journal);
  const first = apply(journal, input);
  expect(apply(first.journal, input, true, LATER).journal).toBe(first.journal);
  const revoked = appendPointAwards(
    first.journal,
    [...latestPoints(first.journal).values()].map((row) => ({
      ...row.award,
      amount: 0,
    })),
    "e".repeat(64),
    "slop-score-v2",
    LATER,
  );
  const replay = apply(revoked, input, true, LATER);
  expect(replay.journal).toBe(revoked);
  expect(replay.dispositions[0].status).toBe("already-applied");
  expect(total(replay.journal)).toBe(0);
});

test("a later ban does not make a recorded manifest replay rewrite history", () => {
  const journal = initial();
  const input = manifest(journal);
  const first = apply(journal, input);
  const replay = apply(
    first.journal,
    input,
    true,
    LATER,
    new Map([[A.id, OCCURRED]]),
  );
  expect(replay.journal).toBe(first.journal);
  expect(replay.dispositions[0].status).toBe("already-applied");
});

test("unrelated appends preserve the baseline prefix, but changed selected predecessors refuse", () => {
  const journal = initial();
  const input = manifest(journal);
  const unrelated = appendPointAwards(
    journal,
    [award(A, 5, "PR_other", "wu_other")],
    "e".repeat(64),
    "slop-score-v1",
    COLLECTED,
  );
  expect(apply(unrelated, input).dispositions[0].status).toBe("applied");
  const changed = appendPointAwards(
    journal,
    [award(C, 12)],
    "f".repeat(64),
    "slop-score-v1",
    COLLECTED,
  );
  expect(() => apply(changed, input)).toThrow("selected predecessors changed");
  input.baseline.revisionIdsDigest = "0".repeat(64);
  expect(() => apply(journal, input)).toThrow("baseline is not");
});

test("a new connected grouped pool invalidates a stale ordinary correction", () => {
  const journal = initial();
  const input = manifest(journal);
  const unit = `wu_${"f".repeat(64)}`;
  const current = appendPointAwards(
    journal,
    [award(A, 7, SOURCE, unit, true)],
    "e".repeat(64),
    "slop-score-v2",
    COLLECTED,
  );
  expect(() => apply(current, input)).toThrow("current source scope adds");
});

test("updated held work and its new sibling remain intact while unrelated work corrects", () => {
  const original = award();
  const journal = initial([original, award(C, 9, "PR_other", "wu_other")]);
  const held = candidate(journal);
  held.proof = { status: "held" };
  const input = manifest(journal, [held, otherCandidate(journal)]);
  const sibling = award(A, 7, SOURCE, `wu_${"f".repeat(64)}`, true);
  const updated = { ...original, amount: 17 };
  const current = appendPointAwards(
    journal,
    [updated, sibling],
    "e".repeat(64),
    "slop-score-v2",
    COLLECTED,
  );
  const result = apply(current, input);
  expect(result.dispositions.map((row) => row.status)).toEqual([
    "held",
    "applied",
  ]);
  expect(result.journal.revisions.slice(0, current.revisions.length)).toEqual(
    current.revisions,
  );
  expect(latestPoints(result.journal).get(updated.key)?.award).toEqual(updated);
  expect(latestPoints(result.journal).get(sibling.key)?.award).toEqual(sibling);
  expect(
    latestPoints(result.journal).get(
      pointKey("asi", B.id, "merged-pull-request", "PR_other"),
    )?.award.amount,
  ).toBe(9);
  expect(total(result.journal)).toBe(total(current));
});

test("a no-write component preserves newer recipients and siblings without blocking another correction", () => {
  const oldA = award(A, 3);
  const oldB = award(B, 10);
  const journal = initial([
    oldA,
    oldB,
    award(C, 0),
    award(C, 9, "PR_other", "wu_other"),
  ]);
  const input = manifest(journal, [
    candidate(journal),
    otherCandidate(journal),
  ]);
  const sibling = award(A, 7, SOURCE, `wu_${"f".repeat(64)}`, true);
  const current = appendPointAwards(
    journal,
    [{ ...oldA, amount: 4 }, { ...oldB, amount: 9 }, sibling],
    "e".repeat(64),
    "slop-score-v2",
    COLLECTED,
  );
  const result = apply(current, input);
  expect(result.dispositions.map((row) => row.status)).toEqual([
    "unchanged",
    "applied",
  ]);
  expect(result.journal.revisions.slice(0, current.revisions.length)).toEqual(
    current.revisions,
  );
  expect(latestPoints(result.journal).get(oldA.key)?.award.amount).toBe(4);
  expect(latestPoints(result.journal).get(oldB.key)?.award.amount).toBe(9);
  expect(latestPoints(result.journal).get(sibling.key)?.award).toEqual(sibling);
  expect(
    latestPoints(result.journal).get(
      pointKey("asi", B.id, "merged-pull-request", "PR_other"),
    )?.award.amount,
  ).toBe(9);
  expect(total(result.journal)).toBe(total(current));
});

test("source-head and chronology mismatches cannot support a complete proof", () => {
  const journal = initial();
  const missingHead = manifest(journal);
  complete(missingHead).sources[0].headSha = sha("f");
  expect(() => apply(journal, missingHead)).toThrow(
    "does not reach the source head",
  );
  const future = manifest(journal);
  complete(future).sources[0].occurredAt = COLLECTED;
  expect(() => apply(journal, future)).toThrow("invalid source identity");
});

test("every private eligibility entry is mandatory and no financial reason is returned", () => {
  const journal = initial();
  const input = manifest(journal);
  const run = (eligibility: { candidateId: string; eligible: boolean }[]) =>
    applyPointsImplementationCorrections(
      journal,
      input,
      eligibility,
      RECORDED,
      new Map(),
    );
  expect(() => run([])).toThrow("every candidate exactly once");
  expect(() => run([{ candidateId: "unknown", eligible: true }])).toThrow();
  expect(() =>
    run([
      { candidateId: input.candidates[0].id, eligible: true },
      { candidateId: input.candidates[0].id, eligible: true },
    ]),
  ).toThrow();
  const result = apply(journal, input, false);
  expect(result.journal).toBe(journal);
  expect(result.dispositions).toEqual([
    { candidateId: "correction_first", status: "retained" },
  ]);
  expect(Object.keys(result.dispositions[0]).sort()).toEqual([
    "candidateId",
    "status",
  ]);
});

test("verified complete retained copies use the original source creator and accepted line counts", () => {
  const journal = initial();
  const input = manifest(journal);
  const accepted = complete(input).sources[0];
  accepted.commits = [accepted.commits[0]];
  accepted.commitCount = 1;
  accepted.headSha = accepted.commits[0].sha;
  accepted.commits[0].author = null;
  const original: CorrectionSource = {
    ...structuredClone(accepted),
    sourceId: "PR_original",
    sourceUrl: "https://github.com/SlopDotCash/asi/pull/3",
    occurredAt: null,
    author: A,
  };
  original.commits[0].sha = sha("c");
  original.headSha = sha("c");
  original.commits[0].firstAcceptedSourceId = null;
  accepted.commits[0].retainedCopy = {
    originalSourceId: original.sourceId,
    originalCommitSha: sha("c"),
    boundPaths: ["one.ts"],
    bindingDigest: "f".repeat(64),
  };
  input.candidates[0].sourceIds.push(original.sourceId);
  complete(input).sources.push(original);
  expect(amounts(apply(journal, input).journal)).toEqual({
    [C.id]: 0,
    [A.id]: 13,
  });
  accepted.commits[0].retainedCopy.boundPaths = [];
  expect(() => apply(journal, input)).toThrow(
    "complete accepted-path bindings",
  );
});

function grouped() {
  const units = [`wu_${"a".repeat(64)}`, `wu_${"b".repeat(64)}`];
  const journal = initial(
    [award(C, 7, SOURCE, units[0], true), award(C, 11, SOURCE, units[1], true)],
    true,
  );
  const evidence = source();
  const candidates: PointsImplementationCorrectionCandidate[] = units.map(
    (unit, index) => ({
      id: `correction_unit_${index}`,
      kind: "work-unit",
      projectId: "asi",
      sourceId: SOURCE,
      sourceUrl: URL,
      occurredAt: OCCURRED,
      workUnitId: unit,
      sourceIds: [SOURCE],
      expectedPredecessors: [...latestPoints(journal).values()]
        .filter((row) => row.award.workUnitId === unit)
        .map((row) => ({ key: row.award.key, revisionId: row.id })),
      proof: {
        status: "complete",
        censusDigest: "c".repeat(64),
        sources: [structuredClone(evidence)],
        decisionDigest: VALUE,
        expectedClaimIds: [`claim_${index}`],
        claims: [
          {
            id: `claim_${index}`,
            sourceId: SOURCE,
            commitSha: evidence.commits[index].sha,
            path: index === 0 ? "one.ts" : "two.ts",
          },
        ],
      },
    }),
  );
  return { journal, input: manifest(journal, candidates), units };
}

test("grouped work units use their exact claim scopes and preserve each existing unit total", () => {
  const { journal, input, units } = grouped();
  const result = apply(journal, input);
  expect(result.dispositions.map((row) => row.status)).toEqual([
    "applied",
    "applied",
  ]);
  const rows = [...latestPoints(result.journal).values()];
  expect(
    rows.find(
      (row) => row.award.actor.id === A.id && row.award.workUnitId === units[0],
    )?.award.amount,
  ).toBe(7);
  expect(
    rows.find(
      (row) => row.award.actor.id === B.id && row.award.workUnitId === units[1],
    )?.award.amount,
  ).toBe(11);
  for (const row of result.journal.revisions.slice(journal.revisions.length))
    expect(row.decision?.sourceId).toBe(`value:${VALUE}`);
  expect(total(result.journal)).toBe(18);
});

test("an incomplete or privately ineligible grouped member retains the entire connected component", () => {
  const { journal, input } = grouped();
  input.candidates[1].proof = { status: "held" };
  const held = apply(journal, input);
  expect(held.journal).toBe(journal);
  expect(held.dispositions.map((row) => row.status)).toEqual(["held", "held"]);
  const second = grouped();
  const retained = applyPointsImplementationCorrections(
    second.journal,
    second.input,
    [
      { candidateId: second.input.candidates[0].id, eligible: true },
      { candidateId: second.input.candidates[1].id, eligible: false },
    ],
    RECORDED,
    new Map(),
  );
  expect(retained.journal).toBe(second.journal);
  expect(retained.dispositions.map((row) => row.status)).toEqual([
    "retained",
    "retained",
  ]);
});

test("a prospective ban on one grouped recipient holds the whole connected source", () => {
  const { journal, input } = grouped();
  const result = apply(
    journal,
    input,
    true,
    RECORDED,
    new Map([[A.id, OCCURRED]]),
  );
  expect(result.journal).toBe(journal);
  expect(result.dispositions.map((row) => row.status)).toEqual([
    "held",
    "held",
  ]);
  expect(total(result.journal)).toBe(18);
});

// One retained decision spans PR #1 and PR #2. The leaderboard records each
// unit at the latest acceptance among its own claim sources, while the
// collector proves every unit with the decision's whole source scope.
function staggeredGroup() {
  const units = [`wu_${"a".repeat(64)}`, `wu_${"b".repeat(64)}`];
  const second = "PR_second";
  const secondUrl = "https://github.com/SlopDotCash/asi/pull/2";
  const awards = [
    award(C, 7, SOURCE, units[0], true),
    {
      ...award(C, 11, second, units[1], true),
      occurredAt: COLLECTED,
      sourceUrl: secondUrl,
    },
  ];
  const journal = initial(awards, true);
  const evidence = source();
  const first: CorrectionSource = {
    ...evidence,
    headSha: sha("a"),
    commitCount: 1,
    commits: [evidence.commits[0]],
  };
  const later: CorrectionSource = {
    ...evidence,
    sourceId: second,
    sourceUrl: secondUrl,
    occurredAt: COLLECTED,
    commitCount: 1,
    commits: [{ ...evidence.commits[1], firstAcceptedSourceId: second }],
  };
  const candidates: PointsImplementationCorrectionCandidate[] = awards.map(
    (row, index) => ({
      id: `correction_unit_${index}`,
      kind: "work-unit",
      projectId: "asi",
      sourceId: row.sourceId,
      sourceUrl: row.sourceUrl,
      occurredAt: row.occurredAt,
      workUnitId: units[index],
      sourceIds: [SOURCE, second],
      expectedPredecessors: [...latestPoints(journal).values()]
        .filter((revision) => revision.award.workUnitId === units[index])
        .map((revision) => ({
          key: revision.award.key,
          revisionId: revision.id,
        })),
      proof: {
        status: "complete",
        censusDigest: "c".repeat(64),
        sources: [structuredClone(first), structuredClone(later)],
        decisionDigest: VALUE,
        expectedClaimIds: [`claim_${index}`],
        claims: [
          {
            id: `claim_${index}`,
            sourceId: row.sourceId,
            commitSha: evidence.commits[index].sha,
            path: index === 0 ? "one.ts" : "two.ts",
          },
        ],
      },
    }),
  );
  return { journal, input: manifest(journal, candidates), units };
}

test("a sibling unit accepted later does not refuse an earlier grouped unit", () => {
  const { journal, input, units } = staggeredGroup();
  const result = apply(journal, input);
  expect(result.dispositions.map((row) => row.status)).toEqual([
    "applied",
    "applied",
  ]);
  const rows = [...latestPoints(result.journal).values()];
  const earlier = rows.find(
    (row) => row.award.actor.id === A.id && row.award.workUnitId === units[0],
  );
  expect(earlier?.award.amount).toBe(7);
  expect(earlier?.award.occurredAt).toBe(OCCURRED);
  expect(
    rows.find(
      (row) => row.award.actor.id === B.id && row.award.workUnitId === units[1],
    )?.award.amount,
  ).toBe(11);
  expect(total(result.journal)).toBe(18);

  const future = staggeredGroup();
  const claim = future.input.candidates[0];
  if (claim.kind !== "work-unit" || claim.proof.status !== "complete")
    throw new Error("group fixture");
  claim.proof.claims[0] = {
    ...claim.proof.claims[0],
    sourceId: "PR_second",
    commitSha: sha("b"),
    path: "two.ts",
  };
  expect(() => apply(future.journal, future.input)).toThrow(
    "invalid source identity",
  );

  const ordinary = initial();
  const widened = manifest(ordinary);
  widened.candidates[0].sourceIds.push("PR_second");
  complete(widened).sources.push({
    ...source(),
    sourceId: "PR_second",
    sourceUrl: "https://github.com/SlopDotCash/asi/pull/2",
    occurredAt: COLLECTED,
  });
  expect(() => apply(ordinary, widened)).toThrow("invalid source identity");
});

test("partial unit scope, wrong decision, duplicated claims, and contradictory evidence refuse", () => {
  for (const failure of [
    "missing-unit",
    "scope",
    "value",
    "duplicate-claim",
    "immutable",
  ] as const) {
    const { journal, input } = grouped();
    const first = input.candidates[0];
    const second = input.candidates[1];
    if (
      first.kind !== "work-unit" ||
      first.proof.status !== "complete" ||
      second.kind !== "work-unit" ||
      second.proof.status !== "complete"
    )
      throw new Error("group fixture");
    if (failure === "missing-unit") input.candidates.pop();
    if (failure === "scope") first.proof.expectedClaimIds.push("claim_missing");
    if (failure === "value") first.proof.decisionDigest = "e".repeat(64);
    if (failure === "duplicate-claim") {
      first.proof.expectedClaimIds.push("claim_duplicate");
      first.proof.claims.push({
        ...first.proof.claims[0],
        id: "claim_duplicate",
      });
    }
    if (failure === "immutable") second.proof.sources[0].commits[0].author = B;
    expect(() => apply(journal, input)).toThrow();
  }
});

test("overlapping grouped scopes hold their connected component", () => {
  const { journal, input } = grouped();
  const first = input.candidates[0];
  const second = input.candidates[1];
  if (
    first.kind !== "work-unit" ||
    first.proof.status !== "complete" ||
    second.kind !== "work-unit" ||
    second.proof.status !== "complete"
  )
    throw new Error("group fixture");
  second.proof.claims[0] = { ...first.proof.claims[0], id: "claim_1" };
  const result = apply(journal, input);
  expect(result.journal).toBe(journal);
  expect(result.dispositions.map((row) => row.status)).toEqual([
    "held",
    "held",
  ]);
});

test("an overlapping ordinary and joint component stays unchanged while unrelated work corrects", () => {
  const unit = `wu_${"a".repeat(64)}`;
  const ordinary = award();
  const joint = award(C, 7, SOURCE, unit, true);
  const other = award(C, 9, "PR_other", "wu_other");
  const journal = initial([ordinary, joint, other], true);
  const predecessors = (key: string) => {
    const previous = latestPoints(journal).get(key);
    if (!previous) throw new Error("missing fixture predecessor");
    return [{ key, revisionId: previous.id }];
  };
  const own = candidate(journal);
  own.expectedPredecessors = predecessors(ordinary.key);
  const groupedCandidate: PointsImplementationCorrectionCandidate = {
    id: "correction_joint",
    kind: "work-unit",
    projectId: "asi",
    sourceId: SOURCE,
    sourceUrl: URL,
    occurredAt: OCCURRED,
    workUnitId: unit,
    sourceIds: [SOURCE],
    expectedPredecessors: predecessors(joint.key),
    proof: {
      status: "complete",
      censusDigest: "c".repeat(64),
      sources: [source()],
      decisionDigest: VALUE,
      expectedClaimIds: ["claim_joint"],
      claims: [
        {
          id: "claim_joint",
          sourceId: SOURCE,
          commitSha: sha("a"),
          path: "one.ts",
        },
      ],
    },
  };
  const otherSource = source();
  otherSource.sourceId = "PR_other";
  otherSource.sourceUrl = other.sourceUrl;
  otherSource.headSha = sha("c");
  otherSource.commitCount = 1;
  otherSource.commits = [
    {
      sha: sha("c"),
      parentCount: 1,
      author: B,
      additions: 1,
      deletions: 0,
      firstAcceptedSourceId: "PR_other",
    },
  ];
  const unrelated: PointsImplementationCorrectionCandidate = {
    id: "correction_unrelated",
    kind: "pull-request",
    projectId: "asi",
    sourceId: other.sourceId,
    sourceUrl: other.sourceUrl,
    occurredAt: OCCURRED,
    workUnitId: other.workUnitId,
    sourceIds: [other.sourceId],
    expectedPredecessors: predecessors(other.key),
    proof: {
      status: "complete",
      censusDigest: "c".repeat(64),
      sources: [otherSource],
    },
  };
  const input = manifest(journal, [own, groupedCandidate, unrelated]);
  const result = apply(journal, input);
  expect(result.dispositions.map((row) => row.status)).toEqual([
    "held",
    "held",
    "applied",
  ]);
  expect(latestPoints(result.journal).get(ordinary.key)?.award).toEqual(
    ordinary,
  );
  expect(latestPoints(result.journal).get(joint.key)?.award).toEqual(joint);
  expect(latestPoints(result.journal).get(other.key)?.award.amount).toBe(0);
  expect(
    latestPoints(result.journal).get(
      pointKey("asi", B.id, "merged-pull-request", "PR_other"),
    )?.award.amount,
  ).toBe(9);
  expect(total(result.journal)).toBe(total(journal));
  expect(result.journal.revisions.slice(0, journal.revisions.length)).toEqual(
    journal.revisions,
  );
});

test("duplicate candidate pools and forged commit/file counts refuse", () => {
  const journal = initial();
  const input = manifest(journal);
  input.candidates.push({
    ...structuredClone(input.candidates[0]),
    id: "correction_duplicate",
  });
  expect(() => apply(journal, input)).toThrow("selected more than once");
  const forged = manifest(journal);
  const files = complete(forged).sources[0].commits[0].files;
  if (!files) throw new Error("fixture files");
  files[0].additions = 100;
  expect(() => apply(journal, forged)).toThrow("file counts do not reconcile");
});

test("projection collisions hold the correction without changing other award categories", () => {
  const unrelated = award(A, 9, "PR_other", "wu_asi_pr_1");
  const nonMerge: PointAward = {
    ...award(A, 5, "PR_review", "review_unit"),
    category: "substantive-review",
    key: pointKey("asi", A.id, "substantive-review", "PR_review"),
    sourceUrl: `${URL}#pullrequestreview-1`,
  };
  const journal = initial([award(), unrelated, nonMerge]);
  const input = manifest(journal);
  const evidence = complete(input).sources[0];
  evidence.commits = [evidence.commits[0]];
  evidence.commitCount = 1;
  evidence.headSha = evidence.commits[0].sha;
  const result = apply(journal, input);
  expect(result.journal).toBe(journal);
  expect(result.dispositions[0].status).toBe("held");
  expect(latestPoints(result.journal).get(nonMerge.key)?.award).toEqual(
    nonMerge,
  );
});

test("a replay with only a partial recorded pool cannot be accepted as completed", () => {
  const journal = initial();
  const input = manifest(journal);
  const result = apply(journal, input);
  const partial = {
    ...result.journal,
    revisions: result.journal.revisions.slice(0, -1),
  };
  expect(() => apply(partial, input, true, LATER)).toThrow(
    "partial recorded pool",
  );
});
