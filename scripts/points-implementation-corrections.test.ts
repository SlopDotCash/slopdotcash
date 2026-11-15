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
import { sha256Hex as resolutionDigest, sha256Hex } from "../src/lib/sha256";

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

function octoberReplacement(
  occurredAt = "2026-10-23T00:00:00.000Z",
  awards = [award(A, 10), award(C, 20)],
) {
  const journal = initial(awards.map((row) => ({ ...row, occurredAt })));
  const input = manifest(journal);
  const row = input.candidates[0];
  const proof = complete(input);
  const accepted = proof.sources[0];
  row.occurredAt = occurredAt;
  accepted.occurredAt = occurredAt;
  accepted.commits[1].author = C;
  const originalId = "PR_original";
  proof.sources.push({
    ...accepted,
    sourceId: originalId,
    sourceUrl: "https://github.com/SlopDotCash/asi/pull/10",
    headSha: sha("c"),
    occurredAt: null,
    author: A,
    commitCount: 1,
    commits: [
      {
        ...accepted.commits[0],
        sha: sha("c"),
        firstAcceptedSourceId: null,
      },
    ],
  });
  row.sourceIds.push(originalId);
  proof.originalContributor = {
    originalSourceId: originalId,
    originalCommitSha: sha("c"),
    acceptedCommitSha: sha("a"),
    boundPaths: ["one.ts"],
    bindingDigest: "f".repeat(64),
  };
  return { journal, input, proof };
}

test("verified October replacements preserve the full pool for the original contributor", () => {
  const { journal, input } = octoberReplacement();
  const result = apply(journal, input);
  expect(amounts(result.journal)).toEqual({ [A.id]: 30, [C.id]: 0 });
  expect(total(result.journal)).toBe(total(journal));
  expect(result.journal.revisions.slice(0, journal.revisions.length)).toEqual(
    journal.revisions,
  );
  const legacy = octoberReplacement();
  const legacyInput = manifest(result.journal);
  legacyInput.candidates[0].occurredAt = input.candidates[0].occurredAt;
  complete(legacyInput).sources = legacy.proof.sources.slice(0, 1);
  expect(apply(result.journal, legacyInput, true, LATER).journal).toBe(
    result.journal,
  );
  expect(apply(journal, input, false).journal).toBe(journal);
  expect(
    apply(
      journal,
      input,
      true,
      RECORDED,
      new Map([[A.id, "2026-10-01T00:00:00.000Z"]]),
    ).journal,
  ).toBe(journal);
});

test("an already correct October replacement records the verified allocation decision once", () => {
  const { journal, input } = octoberReplacement(undefined, [award(A, 30)]);
  const result = apply(journal, input);
  expect(amounts(result.journal)).toEqual({ [A.id]: 30 });
  expect(result.journal.revisions.at(-1)?.decision?.delta).toBe(0);
  expect(result.journal.revisions.length).toBe(journal.revisions.length + 1);
  const replay = apply(result.journal, input, true, LATER);
  expect(replay.journal).toBe(result.journal);
});

function octoberOriginalWithFollowup() {
  const sample = octoberReplacement();
  const original = sample.proof.sources[1];
  const contributorCommit = original.commits[0];
  contributorCommit.parentShas = [sha("0")];
  const baseSync = {
    ...contributorCommit,
    sha: sha("d"),
    parentCount: 2,
    parentShas: [contributorCommit.sha, sha("9")],
    additions: null,
    deletions: null,
  };
  const followup = {
    ...contributorCommit,
    sha: sha("e"),
    author: C as CorrectionActor | null,
    parentShas: [baseSync.sha] as string[] | undefined,
  };
  original.headSha = followup.sha;
  original.commits = [followup, baseSync, contributorCommit];
  original.commitCount = original.commits.length;
  return { ...sample, original, contributorCommit, followup, baseSync };
}

test("an authenticated carrier follow-up in the original PR preserves original contributor credit", () => {
  const { journal, input } = octoberOriginalWithFollowup();
  const result = apply(journal, input);
  expect(result.dispositions[0].status).toBe("applied");
  expect(amounts(result.journal)).toEqual({ [A.id]: 30, [C.id]: 0 });
  expect(total(result.journal)).toBe(total(journal));
});

test("October original-PR follow-ups require complete acyclic Git evidence and the same linked carrier", () => {
  const cases = [
    (sample: ReturnType<typeof octoberOriginalWithFollowup>) => {
      sample.followup.parentShas = undefined;
    },
    (sample: ReturnType<typeof octoberOriginalWithFollowup>) => {
      sample.followup.parentShas = [sha("8")];
    },
    (sample: ReturnType<typeof octoberOriginalWithFollowup>) => {
      sample.followup.author = null;
    },
    (sample: ReturnType<typeof octoberOriginalWithFollowup>) => {
      sample.followup.author = B;
    },
    (sample: ReturnType<typeof octoberOriginalWithFollowup>) => {
      sample.baseSync.parentShas = [
        sample.contributorCommit.sha,
        sample.followup.sha,
      ];
    },
    (sample: ReturnType<typeof octoberOriginalWithFollowup>) => {
      sample.original.headSha = sample.baseSync.sha;
      sample.contributorCommit.parentShas = [sample.followup.sha];
      sample.followup.parentShas = [sha("8")];
      sample.baseSync.parentShas = [sample.contributorCommit.sha, sha("7")];
    },
  ];
  for (const mutate of cases) {
    const sample = octoberOriginalWithFollowup();
    mutate(sample);
    const result = apply(sample.journal, sample.input);
    expect(result.dispositions[0].status).toBe("held");
    expect(result.journal).toBe(sample.journal);
  }
  const malformed = octoberOriginalWithFollowup();
  malformed.baseSync.parentShas = [
    malformed.contributorCommit.sha,
    malformed.contributorCommit.sha,
  ];
  expect(() => apply(malformed.journal, malformed.input)).toThrow(
    "invalid commit proof",
  );
});

test("October replacement proof holds competing contributors and rejects false anchors", () => {
  const { journal, input, proof } = octoberReplacement();
  proof.sources[0].commits[1].author = B;
  expect(apply(journal, input).journal).toBe(journal);
  proof.sources[0].commits[1].author = C;
  if (!proof.originalContributor) throw new Error("missing original proof");
  proof.originalContributor.boundPaths = ["unrelated.ts"];
  expect(() => apply(journal, input)).toThrow(
    "does not bind verified accepted work",
  );
  const september = octoberReplacement("2026-09-23T00:00:00.000Z");
  expect(() => apply(september.journal, september.input)).toThrow(
    "outside the October replacement rule",
  );
});

function octoberExactReplacement() {
  const sample = octoberReplacement();
  const accepted = sample.proof.sources[0];
  const original = sample.proof.sources[1];
  original.headSha = accepted.commits[0].sha;
  original.commits[0].sha = accepted.commits[0].sha;
  accepted.commits[0].parentShas = [sha("0")];
  accepted.commits[1].parentShas = [accepted.commits[0].sha];
  const binding = sample.proof.originalContributor;
  if (!binding) throw new Error("missing exact-source fixture binding");
  binding.exactAcceptance = true;
  binding.originalCommitSha = accepted.commits[0].sha;
  return sample;
}

test("exact October objects preserve the original allocation and private eligibility gates", () => {
  const sample = octoberExactReplacement();
  const result = apply(sample.journal, sample.input);
  expect(result.dispositions[0].status).toBe("applied");
  expect(amounts(result.journal)).toEqual({ [A.id]: 30, [C.id]: 0 });
  expect(total(result.journal)).toBe(total(sample.journal));
  expect(
    result.journal.revisions.slice(0, sample.journal.revisions.length),
  ).toEqual(sample.journal.revisions);
  expect(apply(sample.journal, sample.input, false).journal).toBe(
    sample.journal,
  );
  expect(
    apply(
      sample.journal,
      sample.input,
      true,
      RECORDED,
      new Map([[A.id, "2026-10-01T00:00:00.000Z"]]),
    ).journal,
  ).toBe(sample.journal);
  expect(apply(result.journal, sample.input, true, LATER).journal).toBe(
    result.journal,
  );
});

test("exact October source objects require authenticated descendant follow-ups", () => {
  const cases = [
    (sample: ReturnType<typeof octoberExactReplacement>) => {
      sample.proof.sources[0].commits[1].parentShas = [sha("f")];
    },
    (sample: ReturnType<typeof octoberExactReplacement>) => {
      sample.proof.sources[0].commits[1].author = null;
    },
    (sample: ReturnType<typeof octoberExactReplacement>) => {
      sample.proof.sources[0].commits[1].author = B;
    },
    (sample: ReturnType<typeof octoberExactReplacement>) => {
      sample.proof.sources[0].commits[0].parentShas = [sha("b")];
    },
  ];
  for (const mutate of cases) {
    const sample = octoberExactReplacement();
    mutate(sample);
    const result = apply(sample.journal, sample.input);
    expect(result.dispositions[0].status).toBe("held");
    expect(result.journal).toBe(sample.journal);
  }
  const missing = octoberExactReplacement();
  missing.proof.sources[0].commits[1].parentShas = undefined;
  expect(() => apply(missing.journal, missing.input)).toThrow(
    "exact original-contributor proof does not bind the original head",
  );
});

test("retained acknowledgement bindings with unchanged SHAs keep their prior schema and behavior", () => {
  const sample = octoberExactReplacement();
  delete sample.proof.originalContributor?.exactAcceptance;
  delete sample.proof.sources[0].commits[1].parentShas;
  const result = apply(sample.journal, sample.input);
  expect(result.dispositions[0].status).toBe("applied");
  expect(amounts(result.journal)).toEqual({ [A.id]: 30, [C.id]: 0 });
});

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

test("the domain allocates the same Points when the verified head is listed first", () => {
  const journal = initial();
  const headLast = apply(journal);
  const input = manifest(journal);
  complete(input).sources[0].commits.reverse();
  const headFirst = apply(journal, input);
  expect(headFirst.dispositions).toEqual(headLast.dispositions);
  expect(
    [...latestPoints(headFirst.journal).values()].map(({ award }) => award),
  ).toEqual(
    [...latestPoints(headLast.journal).values()].map(({ award }) => award),
  );
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

function octoberGroupedReplacement() {
  const sample = octoberReplacement();
  const unit = `wu_${"e".repeat(64)}`;
  const journal = initial(
    [...latestPoints(sample.journal).values()].map(({ award: row }) => ({
      ...row,
      key: pointKey(
        row.projectId,
        row.actor.id,
        row.category,
        row.sourceId,
        unit,
      ),
      workUnitId: unit,
    })),
    true,
  );
  const accepted = sample.proof.sources[0];
  const claims = accepted.commits.flatMap((commit) =>
    (commit.files ?? []).map((file, index) => ({
      id: `claim_${commit.sha}_${index}`,
      sourceId: accepted.sourceId,
      commitSha: commit.sha,
      path: file.path,
    })),
  );
  const grouped: PointsImplementationCorrectionCandidate = {
    ...sample.input.candidates[0],
    kind: "work-unit",
    workUnitId: unit,
    expectedPredecessors: [...latestPoints(journal).values()].map((row) => ({
      key: row.award.key,
      revisionId: row.id,
    })),
    proof: {
      ...sample.proof,
      decisionDigest: VALUE,
      expectedClaimIds: claims.map((claim) => claim.id),
      claims,
    },
  };
  return { journal, input: manifest(journal, [grouped]), grouped };
}

test("October grouped replacement preserves the whole recorded value for its sole original contributor", () => {
  const { journal, input } = octoberGroupedReplacement();
  const result = apply(journal, input);
  expect(amounts(result.journal)).toEqual({ [A.id]: 30, [C.id]: 0 });
  expect(total(result.journal)).toBe(total(journal));
  expect(result.journal.revisions.slice(0, journal.revisions.length)).toEqual(
    journal.revisions,
  );
  expect(apply(result.journal, input, true, LATER).journal).toBe(
    result.journal,
  );
  expect(apply(journal, input, false).journal).toBe(journal);
});

test("exact grouped replacement requires and preserves its authenticated accepted parent graph", () => {
  const { journal, input, grouped } = octoberGroupedReplacement();
  if (grouped.proof.status !== "complete") throw Error("fixture");
  const proof = grouped.proof;
  const accepted = proof.sources[0];
  const original = proof.sources[1];
  original.headSha = accepted.commits[0].sha;
  original.commits[0].sha = accepted.commits[0].sha;
  accepted.commits[0].parentShas = [sha("0")];
  accepted.commits[1].parentShas = [accepted.commits[0].sha];
  if (!proof.originalContributor) throw Error("fixture");
  proof.originalContributor.exactAcceptance = true;
  proof.originalContributor.originalCommitSha = accepted.commits[0].sha;
  expect(amounts(apply(journal, input).journal)).toEqual({
    [A.id]: 30,
    [C.id]: 0,
  });
  delete accepted.commits[1].parentShas;
  expect(() => apply(journal, input)).toThrow("original head");
});

for (const fault of [
  "partial-claims",
  "foreign-source",
  "extra-original",
  "third-author",
  "missing-files",
  "wrong-value",
] as const)
  test(`October grouped replacement refuses ${fault}`, () => {
    const { journal, input, grouped } = octoberGroupedReplacement();
    if (grouped.kind !== "work-unit" || grouped.proof.status !== "complete")
      throw Error("fixture");
    const proof = grouped.proof;
    if (fault === "partial-claims") {
      proof.claims.pop();
    }
    if (fault === "foreign-source")
      proof.claims[0].sourceId = proof.sources[1].sourceId;
    if (fault === "extra-original") {
      const other = structuredClone(proof.sources[1]);
      other.sourceId = "PR_second_original";
      other.sourceUrl = "https://github.com/SlopDotCash/asi/pull/11";
      proof.sources.push(other);
      grouped.sourceIds.push(other.sourceId);
    }
    if (fault === "third-author") proof.sources[0].commits[1].author = B;
    if (fault === "missing-files") delete proof.sources[0].commits[1].files;
    if (fault === "wrong-value") proof.decisionDigest = "b".repeat(64);
    if (fault === "third-author")
      expect(apply(journal, input).journal).toBe(journal);
    else expect(() => apply(journal, input)).toThrow();
  });

function mergedDonorGroupedReplacement() {
  const sample = octoberGroupedReplacement();
  if (sample.grouped.proof.status !== "complete") throw Error("fixture");
  const proof = sample.grouped.proof;
  const accepted = proof.sources[0];
  const donor = proof.sources[1];
  donor.occurredAt = "2026-10-23T00:00:03.000Z";
  donor.headSha = accepted.commits[0].sha;
  donor.commits[0].sha = donor.headSha;
  donor.commits[0].firstAcceptedSourceId = accepted.sourceId;
  accepted.commits[0].parentShas = [sha("0")];
  accepted.commits[1].parentShas = [accepted.commits[0].sha];
  if (!proof.originalContributor) throw Error("fixture");
  proof.originalContributor.exactAcceptance = true;
  proof.originalContributor.originalCommitSha = donor.headSha;
  return { ...sample, accepted, donor };
}

test("joint valuation can retain a later-marked-merged donor as the sole October original", () => {
  const { journal, input } = mergedDonorGroupedReplacement();
  const result = apply(journal, input);
  expect(amounts(result.journal)).toEqual({ [A.id]: 30, [C.id]: 0 });
  expect(total(result.journal)).toBe(total(journal));
  expect(apply(result.journal, input, true, LATER).journal).toBe(
    result.journal,
  );
  expect(apply(journal, input, false).journal).toBe(journal);
});

for (const fault of [
  "earlier-owner",
  "other-sha",
  "unclaimed-donor",
  "unverified-copy",
  "ordinary-pool",
  "partial-claims",
] as const)
  test(`merged donor original proof refuses ${fault}`, () => {
    const { journal, input, grouped, donor } = mergedDonorGroupedReplacement();
    if (grouped.proof.status !== "complete" || grouped.kind !== "work-unit")
      throw Error("fixture");
    if (fault === "earlier-owner")
      donor.commits[0].firstAcceptedSourceId = donor.sourceId;
    if (fault === "other-sha") {
      donor.headSha = sha("e");
      donor.commits[0].sha = sha("e");
    }
    if (fault === "unclaimed-donor") {
      donor.commits.push({ ...donor.commits[0], sha: sha("d") });
      donor.commitCount++;
    }
    if (fault === "unverified-copy")
      delete grouped.proof.originalContributor?.exactAcceptance;
    if (fault === "ordinary-pool")
      Object.assign(grouped, { kind: "pull-request" });
    if (fault === "partial-claims") {
      grouped.proof.claims.pop();
    }
    expect(() => apply(journal, input)).toThrow();
  });

function donorCompletedGroupedReplacement() {
  const sample = mergedDonorGroupedReplacement();
  const { donor, accepted, grouped } = sample;
  if (grouped.proof.status !== "complete" || !grouped.proof.originalContributor)
    throw Error("fixture");
  grouped.proof.originalContributor.acceptedSourceId = accepted.sourceId;
  grouped.sourceId = donor.sourceId;
  grouped.sourceUrl = donor.sourceUrl;
  const occurredAt = donor.occurredAt;
  if (!occurredAt) throw Error("fixture");
  grouped.occurredAt = occurredAt;
  const journal = initial(
    [...latestPoints(sample.journal).values()].map(({ award: row }) => ({
      ...row,
      key: pointKey(
        row.projectId,
        row.actor.id,
        row.category,
        donor.sourceId,
        row.workUnitId,
      ),
      sourceId: donor.sourceId,
      sourceUrl: donor.sourceUrl,
      occurredAt,
    })),
    true,
  );
  grouped.expectedPredecessors = [...latestPoints(journal).values()].map(
    (row) => ({ key: row.award.key, revisionId: row.id }),
  );
  return { ...sample, journal, input: manifest(journal, [grouped]) };
}

test("a donor-completed joint pool keeps its date and value while binding first acceptance", () => {
  const { journal, input, donor } = donorCompletedGroupedReplacement();
  const result = apply(journal, input);
  expect(
    Object.fromEntries(
      [...latestPoints(result.journal).values()].map(({ award }) => [
        award.actor.id,
        award.amount,
      ]),
    ),
  ).toEqual({ [A.id]: 30, [C.id]: 0 });
  expect(total(result.journal)).toBe(total(journal));
  for (const { award } of latestPoints(result.journal).values()) {
    expect(award.sourceId).toBe(donor.sourceId);
    expect(award.occurredAt).toBe(String(donor.occurredAt));
  }
  expect(apply(result.journal, input, true, LATER).journal).toBe(
    result.journal,
  );
});

for (const fault of [
  "missing-carrier",
  "ordinary-pool",
  "wrong-original",
  "later-carrier",
  "unverified-carrier",
] as const) {
  test(`donor-completed binding rejects ${fault}`, () => {
    const { journal, input, grouped, accepted } =
      donorCompletedGroupedReplacement();
    if (
      grouped.proof.status !== "complete" ||
      !grouped.proof.originalContributor
    )
      throw Error("fixture");
    const binding = grouped.proof.originalContributor;
    if (fault === "missing-carrier") binding.acceptedSourceId = "PR_missing";
    if (fault === "ordinary-pool")
      Object.assign(grouped, { kind: "pull-request" });
    if (fault === "wrong-original")
      binding.originalSourceId = accepted.sourceId;
    if (fault === "later-carrier")
      accepted.occurredAt = "2026-10-24T00:00:00.000Z";
    if (fault === "unverified-carrier") delete binding.exactAcceptance;
    expect(() => apply(journal, input)).toThrow();
  });
}

test("same-carrier unaccepted context remains connected without receiving claims", () => {
  const { journal, input, grouped, accepted } =
    donorCompletedGroupedReplacement();
  if (grouped.proof.status !== "complete") throw Error("fixture");
  const context: CorrectionSource = {
    ...structuredClone(accepted),
    sourceId: "PR_context",
    sourceUrl: "https://github.com/SlopDotCash/asi/pull/3",
    occurredAt: null,
  };
  for (const commit of context.commits) commit.firstAcceptedSourceId = null;
  grouped.sourceIds.push(context.sourceId);
  grouped.proof.sources.push(context);
  const result = apply(journal, input);
  expect(total(result.journal)).toBe(total(journal));
  expect(
    [...latestPoints(result.journal).values()].find(
      (r) => r.award.actor.id === A.id,
    )?.award.amount,
  ).toBe(30);
  context.author = B;
  expect(() => apply(journal, input)).toThrow();
  context.author = accepted.author;
  context.occurredAt = accepted.occurredAt;
  expect(() => apply(journal, input)).toThrow();
});

function laterAcceptedFollowup() {
  const sample = octoberGroupedReplacement();
  const { grouped } = sample;
  if (grouped.proof.status !== "complete" || !grouped.proof.originalContributor)
    throw Error("fixture");
  const accepted = grouped.proof.sources[0];
  const followup: CorrectionSource = {
    ...structuredClone(accepted),
    sourceId: "PR_followup",
    sourceUrl: "https://github.com/SlopDotCash/asi/pull/4",
    headSha: sha("9"),
    occurredAt: "2026-10-24T00:00:00.000Z",
    commits: [
      {
        sha: sha("9"),
        parentCount: 1,
        parentShas: [accepted.headSha],
        author: C,
        firstAcceptedSourceId: "PR_followup",
        additions: 3,
        deletions: 0,
        files: [{ path: "followup.ts", additions: 3, deletions: 0 }],
      },
    ],
    commitCount: 1,
  };
  grouped.proof.sources.push(followup);
  grouped.sourceIds.push(followup.sourceId);
  grouped.proof.claims.push({
    id: "claim_followup",
    sourceId: followup.sourceId,
    commitSha: followup.headSha,
    path: "followup.ts",
  });
  grouped.proof.expectedClaimIds.push("claim_followup");
  grouped.proof.originalContributor.acceptedSourceId = accepted.sourceId;
  grouped.proof.originalContributor.followups = [
    {
      sourceId: followup.sourceId,
      ancestorSha: accepted.headSha,
      commits: [{ sha: followup.headSha, parentShas: [accepted.headSha] }],
    },
  ];
  grouped.sourceId = followup.sourceId;
  grouped.sourceUrl = followup.sourceUrl;
  grouped.occurredAt = String(followup.occurredAt);
  const journal = initial(
    [...latestPoints(sample.journal).values()].map(({ award: row }) => ({
      ...row,
      key: pointKey(
        row.projectId,
        row.actor.id,
        row.category,
        followup.sourceId,
        row.workUnitId,
      ),
      sourceId: followup.sourceId,
      sourceUrl: followup.sourceUrl,
      occurredAt: String(followup.occurredAt),
    })),
    true,
  );
  grouped.expectedPredecessors = [...latestPoints(journal).values()].map(
    (row) => ({ key: row.award.key, revisionId: row.id }),
  );
  return {
    ...sample,
    journal,
    input: manifest(journal, [grouped]),
    accepted,
    followup,
  };
}

test("one original retains the full joint value across later accepted carrier follow-ups", () => {
  const { journal, input, followup } = laterAcceptedFollowup();
  const result = apply(journal, input);
  expect(
    [...latestPoints(result.journal).values()].find(
      (row) => row.award.actor.id === A.id,
    )?.award.amount,
  ).toBe(30);
  expect(total(result.journal)).toBe(total(journal));
  for (const row of latestPoints(result.journal).values()) {
    expect(row.award.sourceId).toBe(followup.sourceId);
    expect(row.award.occurredAt).toBe(String(followup.occurredAt));
  }
  expect(apply(result.journal, input, true, LATER).journal).toBe(
    result.journal,
  );
});
for (const fault of [
  "other-author",
  "earlier-source",
  "wrong-ancestor",
  "unrelated-parent",
  "partial-claims",
  "unbound-source",
  "duplicate-binding",
] as const) {
  test(`joint accepted follow-up rejects ${fault}`, () => {
    const { journal, input, grouped, followup } = laterAcceptedFollowup();
    if (
      grouped.proof.status !== "complete" ||
      !grouped.proof.originalContributor?.followups
    )
      throw Error("fixture");
    const bindings = grouped.proof.originalContributor.followups;
    if (fault === "other-author") followup.commits[0].author = B;
    if (fault === "earlier-source")
      followup.occurredAt = "2026-10-01T00:00:00.000Z";
    if (fault === "wrong-ancestor") bindings[0].ancestorSha = sha("8");
    if (fault === "unrelated-parent")
      bindings[0].commits[0].parentShas = [sha("8")];
    if (fault === "partial-claims") {
      grouped.proof.claims.pop();
    }
    if (fault === "unbound-source") bindings.length = 0;
    if (fault === "duplicate-binding")
      bindings.push(structuredClone(bindings[0]));
    expect(() => apply(journal, input)).toThrow();
  });
}

function referencedFollowup() {
  const sample = laterAcceptedFollowup();
  if (
    sample.grouped.proof.status !== "complete" ||
    !sample.grouped.proof.originalContributor?.followups
  )
    throw Error("fixture");
  const accepted = sample.accepted,
    followup = sample.followup;
  const reference = {
    sourceDigest: "a".repeat(64),
    pull: {
      node_id: followup.sourceId,
      number: 4,
      html_url: followup.sourceUrl,
      title: "Follow-up",
      body: "Promote the accepted fix from #1.",
      user: { node_id: C.id, login: C.login, type: C.kind },
      merged_by: { node_id: C.id, login: C.login, type: C.kind },
      state: "closed",
      merged_at: followup.occurredAt,
      closed_at: followup.occurredAt,
      merge_commit_sha: sha("7"),
      updated_at: followup.occurredAt,
      head: { sha: followup.headSha },
      base: { sha: sha("8"), ref: "main" },
      changed_files: 1,
      comments: 0,
      review_comments: 0,
      commits: 1,
    },
    target: {
      id: accepted.sourceId,
      number: 1,
      url: accepted.sourceUrl,
      repository: accepted.repository,
    },
  };
  const binding = sample.grouped.proof.originalContributor.followups[0];
  Object.assign(binding, {
    commits: [],
    reference: { ...reference, digest: sha256Hex(JSON.stringify(reference)) },
  });
  return { ...sample, binding };
}

test("resolved carrier statement permits a later accepted follow-up on a divergent branch", () => {
  const { journal, input, followup } = referencedFollowup();
  followup.commits[0].parentShas = [sha("8")];
  const result = apply(journal, input);
  expect(
    [...latestPoints(result.journal).values()].find(
      (row) => row.award.actor.id === A.id,
    )?.award.amount,
  ).toBe(30);
  expect(total(result.journal)).toBe(total(journal));
});
for (const fault of [
  "changed-statement",
  "foreign-link-label",
  "wrong-target",
  "wrong-number",
  "wrong-head",
  "different-unit",
] as const) {
  test(`referenced follow-up rejects ${fault}`, () => {
    const { journal, input, grouped, binding } = referencedFollowup();
    if (!binding.reference) throw Error("fixture");
    const r = binding.reference;
    if (fault === "changed-statement") r.pull.body = "unrelated";
    if (fault === "foreign-link-label")
      r.pull.body = "Promote [#1](https://github.com/other/repo/pull/1).";
    if (fault === "wrong-target") r.target.id = "PR_other";
    if (fault === "wrong-number") r.target.number = 99;
    if (fault === "wrong-head") r.pull.head.sha = sha("6");
    if (fault !== "changed-statement") {
      const { digest: _, ...payload } = r;
      r.digest = sha256Hex(JSON.stringify(payload));
    }
    if (fault === "different-unit") grouped.workUnitId = `wu_${"f".repeat(64)}`;
    expect(() => apply(journal, input)).toThrow();
  });
}

test("canonical selected claims may omit superseded raw paths while preserving the full source proof", () => {
  const { journal, input, grouped } = octoberGroupedReplacement();
  if (grouped.proof.status !== "complete") throw Error("fixture");
  const commit = grouped.proof.sources[0].commits[0];
  const unclaimed = {
    ...structuredClone(commit),
    sha: sha("8"),
    author: C,
    files: [{ path: "superseded.sql", additions: 2, deletions: 0 }],
    additions: 2,
    deletions: 0,
  };
  grouped.proof.sources[0].commits.push(unclaimed);
  grouped.proof.sources[0].commitCount++;
  expect(
    [...latestPoints(apply(journal, input).journal).values()].find(
      (row) => row.award.actor.id === A.id,
    )?.award.amount,
  ).toBe(30);
});

test("authenticated review reference accepts another maintainer as merger", () => {
  const { journal, input, binding } = referencedFollowup();
  if (!binding.reference) throw Error("fixture");
  const ref = binding.reference;
  ref.pull.body = "No outgoing body reference";
  if (ref.pull.merged_by) ref.pull.merged_by.node_id = B.id;
  ref.acknowledgement = {
    node_id: "PRR_followup",
    body: "Promotes #1",
    user: { node_id: C.id, type: "User" },
    submitted_at: "2026-10-24T00:00:01Z",
  };
  const { digest: _, ...payload } = ref;
  ref.digest = sha256Hex(JSON.stringify(payload));
  expect(
    [...latestPoints(apply(journal, input).journal).values()].find(
      (row) => row.award.actor.id === A.id,
    )?.award.amount,
  ).toBe(30);
});

for (const fault of ["cycle", "foreign-node"] as const) {
  test(`native follow-up graph rejects ${fault}`, () => {
    const { journal, input, grouped } = laterAcceptedFollowup();
    if (
      grouped.proof.status !== "complete" ||
      !grouped.proof.originalContributor?.followups
    )
      throw Error("fixture");
    const binding = grouped.proof.originalContributor.followups[0];
    if (fault === "cycle") binding.commits[0].parentShas.push(sha("8"));
    binding.commits.push({
      sha: sha("8"),
      parentShas:
        fault === "cycle" ? [binding.commits[0].sha] : [binding.ancestorSha],
    });
    expect(() => apply(journal, input)).toThrow();
  });
}

function claimedResolution() {
  const sample = octoberGroupedReplacement();
  if (sample.grouped.proof.status !== "complete") throw Error("fixture");
  const source = sample.grouped.proof.sources[0];
  const patch = `diff --git a/merge.ts b/merge.ts\n--- a/merge.ts\n+++ b/merge.ts\n@@ -1 +1 @@\n-old\n+resolved\n`;
  const commit = {
    sha: sha("8"),
    parentCount: 2,
    parentShas: [sha("6"), sha("7")],
    author: C,
    additions: 1,
    deletions: 1,
    files: [{ path: "merge.ts", additions: 1, deletions: 1 }],
    firstAcceptedSourceId: source.sourceId,
    mergeResolution: {
      commitSha: sha("8"),
      parents: [sha("6"), sha("7")] as [string, string],
      gitVersion: "git version 2.56.0",
      automaticTree: sha("1"),
      resolvedTree: sha("2"),
      hadConflicts: true,
      patch,
      patchSha256: resolutionDigest(patch),
      paths: ["merge.ts"],
    },
  };
  source.commits.push(commit);
  source.commitCount++;
  sample.grouped.proof.claims.push({
    id: "claim_merge",
    sourceId: source.sourceId,
    commitSha: commit.sha,
    path: "merge.ts",
  });
  sample.grouped.proof.expectedClaimIds.push("claim_merge");
  return { ...sample, commit };
}
test("verified resolution claims preserve the original contributor's complete assessed pool", () => {
  const { journal, input } = claimedResolution();
  expect(
    [...latestPoints(apply(journal, input).journal).values()].find(
      (row) => row.award.actor.id === A.id,
    )?.award.amount,
  ).toBe(30);
});
for (const fault of ["missing", "hash", "author"] as const) {
  test(`claimed resolution rejects ${fault}`, () => {
    const { journal, input, commit } = claimedResolution();
    if (fault === "missing")
      delete (commit as { mergeResolution?: unknown }).mergeResolution;
    if (fault === "hash") commit.mergeResolution.patchSha256 = "0".repeat(64);
    if (fault === "author") commit.author = B;
    expect(() => apply(journal, input)).toThrow();
  });
}

test("resolution deltas retain the same immutable reported merge counts in other pools", () => {
  const { journal, grouped, commit } = claimedResolution();
  commit.additions = 100;
  commit.deletions = 80;
  const otherAward = {
    ...award(B, 10, "PR_other", "wu_other"),
    occurredAt: grouped.occurredAt,
  };
  const combined = appendPointAwards(
    journal,
    [otherAward],
    "9".repeat(64),
    "slop-score-v2",
    BASELINE,
  );
  const other = otherCandidate(combined);
  if (other.proof.status !== "complete") throw Error("fixture");
  other.occurredAt = grouped.occurredAt;
  other.proof.sources[0].occurredAt = grouped.occurredAt;
  other.proof.sources[0].headSha = sha("9");
  other.proof.sources[0].commits[0].sha = sha("9");
  const imported = {
    ...structuredClone(commit),
    firstAcceptedSourceId: SOURCE,
  };
  delete (imported as { mergeResolution?: unknown }).mergeResolution;
  delete (imported as { files?: unknown }).files;
  other.proof.sources[0].commits.push(imported);
  other.proof.sources[0].commitCount++;
  const result = apply(combined, manifest(combined, [grouped, other]));
  expect(total(result.journal)).toBe(total(combined));
  expect(amounts(result.journal)[A.id]).toBe(30);
});

function scopedUnlinkedOriginal() {
  const sample = mergedDonorGroupedReplacement();
  const { grouped, accepted, donor } = sample;
  if (grouped.proof.status !== "complete" || !grouped.proof.originalContributor)
    throw Error("fixture");
  donor.commits[0].author = null;
  accepted.commits[0].author = null;
  const third = structuredClone(accepted.commits[1]);
  third.sha = sha("f");
  third.author = B;
  third.parentShas = [accepted.headSha];
  accepted.commits.push(third);
  accepted.commitCount++;
  accepted.headSha = third.sha;
  grouped.proof.originalContributor.claimIds = grouped.proof.claims.map(
    (claim) => claim.id,
  );
  return sample;
}

test("reviewed native unit awards the original creator without rewriting null commit authors", () => {
  const { journal, input, donor, accepted } = scopedUnlinkedOriginal();
  const result = apply(journal, input);
  expect(amounts(result.journal)).toEqual({ [A.id]: 30, [C.id]: 0 });
  expect(donor.commits[0].author).toBeNull();
  expect(accepted.commits).toHaveLength(3);
  expect(total(result.journal)).toBe(total(journal));
  expect(apply(result.journal, input, true, LATER).journal).toBe(
    result.journal,
  );
  expect(apply(journal, input, false).journal).toBe(journal);
});

for (const fault of [
  "claim-scope",
  "third-author-claim",
  "missing-origin",
  "disconnected-followup",
  "linked-other-origin",
  "wrong-copy",
] as const)
  test(`native unit original proof refuses ${fault}`, () => {
    const { journal, input, donor, accepted, grouped } =
      scopedUnlinkedOriginal();
    if (
      grouped.proof.status !== "complete" ||
      !grouped.proof.originalContributor
    )
      throw Error("fixture");
    if (fault === "claim-scope")
      grouped.proof.originalContributor.claimIds = [];
    if (fault === "third-author-claim")
      grouped.proof.claims[1].commitSha = sha("f");
    if (fault === "missing-origin") {
      grouped.proof.claims = grouped.proof.claims.slice(1);
      grouped.proof.expectedClaimIds = grouped.proof.claims.map(
        (claim) => claim.id,
      );
      grouped.proof.originalContributor.claimIds = [
        ...grouped.proof.expectedClaimIds,
      ];
    }
    if (fault === "disconnected-followup")
      accepted.commits[1].parentShas = [sha("0")];
    if (fault === "linked-other-origin") donor.commits[0].author = B;
    if (fault === "wrong-copy") accepted.commits[0].author = B;
    expect(() => apply(journal, input)).toThrow();
  });

test("scoped native original keeps maintainer follow-ups in the original PR with its initiator", () => {
  const { journal, input, donor, accepted, grouped } = scopedUnlinkedOriginal();
  if (grouped.proof.status !== "complete" || !grouped.proof.originalContributor)
    throw Error("fixture");
  donor.commits.push(structuredClone(accepted.commits[1]));
  donor.commitCount++;
  donor.headSha = donor.commits[1].sha;
  const binding = grouped.proof.originalContributor;
  binding.originalCommitSha = donor.headSha;
  binding.acceptedCommitSha = donor.headSha;
  const files = donor.commits[1].files;
  if (!files) throw Error("fixture");
  binding.boundPaths = files.map((file) => file.path);
  expect(amounts(apply(journal, input).journal)).toEqual({
    [A.id]: 30,
    [C.id]: 0,
  });
  donor.commits[0].author = C;
  accepted.commits[0].author = C;
  expect(() => apply(journal, input)).toThrow("unit scope");
});

test("scoped original preserves later-merged other-donor context without awarding it", () => {
  const { journal, input, donor, accepted, grouped } = scopedUnlinkedOriginal();
  if (grouped.proof.status !== "complete") throw Error("fixture");
  const other = structuredClone(donor);
  other.sourceId = "PR_other_donor";
  other.sourceUrl = "https://github.com/SlopDotCash/asi/pull/12";
  other.author = B;
  other.headSha = accepted.commits[2].sha;
  other.commits = [structuredClone(accepted.commits[2])];
  other.commitCount = 1;
  other.occurredAt = "2026-10-23T00:00:04.000Z";
  grouped.proof.sources.push(other);
  grouped.sourceIds.push(other.sourceId);
  expect(amounts(apply(journal, input).journal)).toEqual({
    [A.id]: 30,
    [C.id]: 0,
  });
  other.commits[0].firstAcceptedSourceId = other.sourceId;
  expect(amounts(apply(journal, input).journal)).toEqual({
    [A.id]: 30,
    [C.id]: 0,
  });
});

test("a grouped unit retains later connected sources without moving its own completion", () => {
  const { journal, input } = grouped();
  const later = {
    ...source(),
    sourceId: "PR_later",
    sourceUrl: "https://github.com/SlopDotCash/asi/pull/3",
    occurredAt: "2026-01-02T00:00:00.000Z",
    headSha: sha("8"),
    commits: [
      {
        sha: sha("8"),
        parentCount: 1,
        author: B,
        additions: 1,
        deletions: 0,
        firstAcceptedSourceId: "PR_later",
        files: [{ path: "later.ts", additions: 1, deletions: 0 }],
      },
    ],
    commitCount: 1,
  };
  for (const candidate of input.candidates) {
    if (candidate.proof.status !== "complete") throw Error("fixture");
    candidate.sourceIds.push(later.sourceId);
    candidate.proof.sources.push(structuredClone(later));
  }
  const result = apply(journal, input);
  expect(total(result.journal)).toBe(total(journal));
  for (const row of latestPoints(result.journal).values())
    expect(row.award.occurredAt).toBe(OCCURRED);
  const first = input.candidates[0];
  if (first.kind !== "work-unit" || first.proof.status !== "complete")
    throw Error("fixture");
  first.proof.claims[0] = {
    ...first.proof.claims[0],
    sourceId: later.sourceId,
    commitSha: sha("8"),
    path: "later.ts",
  };
  expect(() => apply(journal, input)).toThrow("invalid source identity");
});

test("scoped native sync-head donor receives its complete reviewed pool", () => {
  const { journal, input, donor, accepted, grouped } = scopedUnlinkedOriginal();
  if (grouped.proof.status !== "complete" || !grouped.proof.originalContributor)
    throw Error("fixture");
  const sync = structuredClone(accepted.commits[1]);
  sync.sha = sha("8");
  sync.parentCount = 2;
  sync.parentShas = [donor.headSha, sha("9")];
  sync.additions = 100;
  sync.deletions = 50;
  delete sync.files;
  donor.commits.push(structuredClone(sync));
  donor.commitCount++;
  donor.headSha = sync.sha;
  accepted.commits.push(sync);
  accepted.commitCount++;
  accepted.commits[1].parentShas = [sync.sha];
  const binding = grouped.proof.originalContributor;
  binding.originalCommitSha = sync.sha;
  binding.acceptedCommitSha = sync.sha;
  binding.boundPaths = [...new Set(grouped.proof.claims.map((c) => c.path))];
  const result = apply(journal, input);
  expect(amounts(result.journal)).toEqual({ [A.id]: 30, [C.id]: 0 });
  expect(total(result.journal)).toBe(total(journal));
  expect(apply(result.journal, input, true, LATER).journal).toBe(
    result.journal,
  );
  sync.author = null;
  donor.commits[1].author = null;
  expect(() => apply(journal, input)).toThrow("unit scope");
  sync.author = B;
  donor.commits[1].author = B;
  expect(() => apply(journal, input)).toThrow("unit scope");
});

test("scoped native unit preserves its pool and unrelated work in a later carrier", () => {
  const { journal, input, grouped, accepted, followup } =
    laterAcceptedFollowup();
  if (grouped.proof.status !== "complete" || !grouped.proof.originalContributor)
    throw Error("fixture");
  const original = grouped.proof.sources[1];
  original.headSha = accepted.commits[0].sha;
  original.commits[0].sha = accepted.commits[0].sha;
  accepted.commits[0].parentShas = [sha("0")];
  accepted.commits[1].parentShas = [accepted.commits[0].sha];
  grouped.proof.originalContributor.exactAcceptance = true;
  grouped.proof.originalContributor.originalCommitSha = original.headSha;
  grouped.proof.originalContributor.acceptedCommitSha = original.headSha;
  grouped.proof.originalContributor.claimIds = [
    ...grouped.proof.expectedClaimIds,
  ];
  const unrelated = structuredClone(followup.commits[0]);
  unrelated.sha = sha("8");
  unrelated.author = B;
  unrelated.parentShas = [accepted.headSha];
  followup.commits.push(unrelated);
  followup.commitCount++;
  const binding = grouped.proof.originalContributor.followups?.[0];
  if (!binding) throw Error("fixture");
  binding.commits.push({
    sha: unrelated.sha,
    parentShas: [...unrelated.parentShas],
  });
  followup.commits[0].parentShas = [unrelated.sha];
  binding.commits[0].parentShas = [unrelated.sha];
  const result = apply(journal, input);
  expect(
    Object.fromEntries(
      [...latestPoints(result.journal).values()].map(({ award }) => [
        award.actor.id,
        award.amount,
      ]),
    ),
  ).toEqual({ [A.id]: 30, [C.id]: 0 });
  expect(total(result.journal)).toBe(total(journal));
  expect(followup.commits[1].author).toEqual(B);
  expect(apply(result.journal, input, true, LATER).journal).toBe(
    result.journal,
  );
  expect(apply(journal, input, false).journal).toBe(journal);
  const lastClaim = grouped.proof.claims.at(-1);
  if (!lastClaim) throw Error("Missing fixture claim");
  lastClaim.commitSha = unrelated.sha;
  expect(() => apply(journal, input)).toThrow("unit scope");
});

test("a scoped original can retain later accepted commits outside the first carrier", () => {
  const { journal, input, donor, accepted, grouped } = scopedUnlinkedOriginal();
  if (grouped.proof.status !== "complete" || !grouped.proof.originalContributor)
    throw Error("fixture");
  const extra = structuredClone(accepted.commits[0]);
  extra.sha = sha("6");
  extra.author = A;
  extra.firstAcceptedSourceId = "PR_later_origin";
  extra.parentShas = [donor.headSha];
  donor.commits.push(extra);
  donor.commitCount++;
  donor.headSha = extra.sha;
  const result = apply(journal, input);
  expect(amounts(result.journal)).toEqual({ [A.id]: 30, [C.id]: 0 });
  expect(total(result.journal)).toBe(total(journal));
  expect(donor.commits).toHaveLength(2);
});

for (const fault of ["third-party", "disconnected", "earlier-owner"] as const) {
  test(`partial native claim scope refuses ${fault} in a selected follow-up`, () => {
    const { journal, input, grouped, accepted, followup } =
      laterAcceptedFollowup();
    if (
      grouped.proof.status !== "complete" ||
      !grouped.proof.originalContributor
    )
      throw Error("fixture");
    const original = grouped.proof.sources[1];
    original.headSha = accepted.commits[0].sha;
    original.commits[0].sha = original.headSha;
    accepted.commits[0].parentShas = [sha("0")];
    accepted.commits[1].parentShas = [original.headSha];
    const binding = grouped.proof.originalContributor;
    binding.exactAcceptance = true;
    binding.originalCommitSha = original.headSha;
    binding.acceptedCommitSha = original.headSha;
    binding.claimIds = [...grouped.proof.expectedClaimIds];
    if (fault === "third-party") followup.author = B;
    if (fault === "disconnected") {
      followup.commits[0].parentShas = [sha("7")];
      const followupBinding = binding.followups?.[0];
      if (!followupBinding) throw Error("fixture");
      followupBinding.commits[0].parentShas = [sha("7")];
    }
    if (fault === "earlier-owner")
      followup.commits[0].firstAcceptedSourceId = original.sourceId;
    expect(() => apply(journal, input)).toThrow();
  });
}

test("selected maintainer repairs may precede the original PR's later head", () => {
  const { journal, input, donor, accepted } = scopedUnlinkedOriginal();
  const later = structuredClone(donor.commits[0]);
  later.sha = sha("6");
  later.author = A;
  later.parentShas = [donor.headSha];
  donor.commits.push(later);
  donor.commitCount++;
  donor.headSha = later.sha;
  accepted.commits.push(structuredClone(later));
  accepted.commitCount++;
  const result = apply(journal, input);
  expect(amounts(result.journal)).toEqual({ [A.id]: 30, [C.id]: 0 });
  expect(total(result.journal)).toBe(total(journal));
});

test("a later original-author completion can bind an already accepted scoped unit", () => {
  const { journal, grouped, accepted, donor } =
    donorCompletedGroupedReplacement();
  if (grouped.proof.status !== "complete" || !grouped.proof.originalContributor)
    throw Error("fixture");
  const binding = grouped.proof.originalContributor;
  binding.claimIds = [...grouped.proof.expectedClaimIds];
  const completion = structuredClone(donor);
  completion.sourceId = "PR_original_completion";
  completion.sourceUrl = "https://github.com/SlopDotCash/asi/pull/4";
  completion.occurredAt = "2026-10-25T00:00:00.000Z";
  completion.commits = [structuredClone(accepted.commits[1])];
  completion.commitCount = 1;
  completion.headSha = completion.commits[0].sha;
  grouped.proof.sources.push(completion);
  grouped.sourceIds.push(completion.sourceId);
  binding.followups = [
    {
      sourceId: completion.sourceId,
      ancestorSha: binding.originalCommitSha,
      commits: [
        {
          sha: completion.headSha,
          parentShas: [binding.originalCommitSha],
        },
      ],
    },
  ];
  grouped.sourceId = completion.sourceId;
  grouped.sourceUrl = completion.sourceUrl;
  grouped.occurredAt = completion.occurredAt;
  const shifted = initial(
    [...latestPoints(journal).values()].map(({ award: row }) => ({
      ...row,
      key: pointKey(
        row.projectId,
        row.actor.id,
        row.category,
        completion.sourceId,
        row.workUnitId,
      ),
      sourceId: completion.sourceId,
      sourceUrl: completion.sourceUrl,
      occurredAt: String(completion.occurredAt),
    })),
    true,
  );
  grouped.expectedPredecessors = [...latestPoints(shifted).values()].map(
    (row) => ({ key: row.award.key, revisionId: row.id }),
  );
  const shiftedInput = manifest(shifted, [grouped]);
  const corrected = apply(shifted, shiftedInput).journal;
  expect(
    Object.fromEntries(
      [...latestPoints(corrected).values()].map(({ award }) => [
        award.actor.id,
        award.amount,
      ]),
    ),
  ).toEqual({ [A.id]: 30, [C.id]: 0 });
  expect(total(corrected)).toBe(total(shifted));
  completion.author = B;
  expect(() => apply(shifted, shiftedInput)).toThrow("unit scope");
  completion.author = donor.author;
  binding.followups[0].commits[0].parentShas = [sha("7")];
  expect(() => apply(shifted, shiftedInput)).toThrow("unit scope");
});

function multiOriginalPrUnit() {
  const sample = scopedUnlinkedOriginal();
  const { donor, accepted, grouped } = sample;
  if (grouped.proof.status !== "complete" || !grouped.proof.originalContributor)
    throw Error("fixture");
  const second = structuredClone(donor);
  second.sourceId = "PR_second_original";
  second.sourceUrl = "https://github.com/SlopDotCash/asi/pull/5";
  second.headSha = sha("6");
  second.commits[0].sha = second.headSha;
  second.commits[0].parentShas = [sha("0")];
  second.commits[0].additions = 1;
  second.commits[0].deletions = 0;
  second.commits[0].files = [{ path: "second.ts", additions: 1, deletions: 0 }];
  accepted.commits.push(structuredClone(second.commits[0]));
  accepted.commitCount++;
  grouped.proof.sources.push(second);
  grouped.sourceIds.push(second.sourceId);
  const secondClaim = {
    id: "claim_second_original",
    sourceId: accepted.sourceId,
    commitSha: second.headSha,
    path: "second.ts",
  };
  grouped.proof.claims.push(secondClaim);
  grouped.proof.expectedClaimIds.push(secondClaim.id);
  const firstBinding = grouped.proof.originalContributor;
  const secondBinding = {
    ...structuredClone(firstBinding),
    originalSourceId: second.sourceId,
    originalCommitSha: second.headSha,
    acceptedCommitSha: second.headSha,
    boundPaths: ["second.ts"],
    claimIds: [secondClaim.id],
  };
  delete grouped.proof.originalContributor;
  grouped.proof.originalContributorParts = [firstBinding, secondBinding];
  return { ...sample, second };
}

test("one contributor retains one whole unit across separate original PRs", () => {
  const { journal, input } = multiOriginalPrUnit();
  const result = apply(journal, input);
  expect(amounts(result.journal)).toEqual({ [A.id]: 30, [C.id]: 0 });
  expect(total(result.journal)).toBe(total(journal));
  expect(apply(result.journal, input, true, LATER).journal).toBe(
    result.journal,
  );
  expect(apply(journal, input, false).journal).toBe(journal);
});

for (const fault of [
  "missing-claim",
  "repeated-claim",
  "different-origin",
  "duplicate-original",
  "ordinary",
  "unscoped",
  "late-acceptance",
  "expected-scope",
] as const) {
  test(`multi-original native unit rejects ${fault}`, () => {
    const { journal, input, grouped, second, accepted } = multiOriginalPrUnit();
    if (
      grouped.proof.status !== "complete" ||
      !grouped.proof.originalContributorParts
    )
      throw Error("fixture");
    const parts = grouped.proof.originalContributorParts;
    if (fault === "missing-claim")
      parts[0].claimIds = parts[0].claimIds?.slice(1);
    if (fault === "repeated-claim")
      parts[1].claimIds?.push(parts[0].claimIds?.[0] ?? "missing_claim");
    if (fault === "different-origin") second.author = B;
    if (fault === "duplicate-original")
      parts[1].originalSourceId = parts[0].originalSourceId;
    if (fault === "ordinary") Object.assign(grouped, { kind: "pull-request" });
    if (fault === "unscoped") delete parts[0].claimIds;
    if (fault === "expected-scope") grouped.proof.expectedClaimIds.pop();
    if (fault === "late-acceptance")
      accepted.occurredAt = "2026-10-26T00:00:00.000Z";
    expect(() => apply(journal, input)).toThrow();
  });
}

function acknowledgedRepair() {
  const sample = scopedUnlinkedOriginal();
  const { donor, accepted, grouped } = sample;
  if (grouped.proof.status !== "complete" || !grouped.proof.originalContributor)
    throw Error("fixture");
  const commit = accepted.commits[1];
  commit.author = B;
  const pull = {
    node_id: accepted.sourceId,
    number: Number(accepted.sourceUrl.split("/").at(-1)),
    html_url: accepted.sourceUrl,
    state: "closed",
    head: { sha: accepted.headSha },
    body: `Retains #${donor.sourceUrl.split("/").at(-1)} at ${accepted.headSha}`,
    merged_at: accepted.occurredAt,
    updated_at: "2026-10-24T00:00:00Z",
    merged_by: { node_id: C.id, type: "User" },
  } as import("../workers/slopbot/value-evidence-types").Pull;
  const reference = {
    sourceDigests: {
      [donor.sourceId]: "1".repeat(64),
      [accepted.sourceId]: "2".repeat(64),
    },
    pull,
    acceptingPull: structuredClone(pull),
    headSha: accepted.headSha,
    acknowledgement: {
      node_id: "IC_repair",
      body: pull.body ?? "",
      user: { node_id: C.id, type: "User" },
      created_at: "2026-10-23T00:00:01Z",
      updated_at: "2026-10-23T00:00:01Z",
    },
  };
  const repair = {
    sourceId: accepted.sourceId,
    commitSha: commit.sha,
    authorNodeId: B.id,
    reference: { ...reference, digest: sha256Hex(JSON.stringify(reference)) },
  };
  grouped.proof.originalContributor.repairs = [repair];
  return { ...sample, repair, commit };
}

test("accepted merger acknowledgement binds a distinct repair author without moving the original's pool", () => {
  const { journal, input, commit } = acknowledgedRepair();
  const result = apply(journal, input);
  expect(amounts(result.journal)).toEqual({ [A.id]: 30, [C.id]: 0 });
  expect(commit.author).toEqual(B);
  expect(total(result.journal)).toBe(total(journal));
  expect(apply(result.journal, input, true, LATER).journal).toBe(
    result.journal,
  );
});

for (const fault of [
  "missing",
  "digest",
  "actor",
  "source",
  "head",
  "number",
  "reference",
  "edited",
  "future",
  "ancestor",
  "duplicate",
  "unused",
  "cycle",
  "source-digest",
] as const) {
  test(`accepted repair refuses ${fault}`, () => {
    const { journal, input, grouped, repair, commit } = acknowledgedRepair();
    if (
      grouped.proof.status !== "complete" ||
      !grouped.proof.originalContributor
    )
      throw Error("fixture");
    const reference = repair.reference;
    if (fault === "missing") delete grouped.proof.originalContributor.repairs;
    if (fault === "actor") reference.acknowledgement.user.node_id = B.id;
    if (fault === "source") repair.sourceId = "PR_unrelated";
    if (fault === "head") reference.pull.head.sha = sha("9");
    if (fault === "number") reference.pull.number = 999;
    if (fault === "reference")
      reference.acknowledgement.body = `Unrelated #999 ${reference.headSha}`;
    if (fault === "edited")
      reference.acknowledgement.updated_at = "2026-10-24T00:00:00Z";
    if (fault === "future")
      reference.acknowledgement.created_at =
        reference.acknowledgement.updated_at = "2026-10-25T00:00:00Z";
    if (fault === "ancestor") commit.parentShas = [sha("9")];
    if (fault === "cycle") commit.parentShas = [reference.headSha];
    if (fault === "duplicate")
      grouped.proof.originalContributor.repairs?.push(structuredClone(repair));
    if (fault === "unused") repair.commitSha = sha("9");
    if (fault === "source-digest") reference.sourceDigests = {};
    const { digest: _, ...payload } = reference;
    reference.digest =
      fault === "digest" ? "0".repeat(64) : sha256Hex(JSON.stringify(payload));
    expect(() => apply(journal, input)).toThrow();
  });
}

function reviewedOriginalReplacement() {
  const sample = mergedDonorGroupedReplacement();
  const { donor, accepted, grouped } = sample;
  if (grouped.proof.status !== "complete" || !grouped.proof.originalContributor)
    throw Error("fixture");
  const historical = structuredClone(accepted.commits[0]);
  historical.author = A;
  donor.commits = [
    { ...structuredClone(historical), sha: sha("e"), parentShas: [sha("d")] },
  ];
  donor.headSha = sha("e");
  donor.commitCount = 1;
  const retained = {
    sourceDigest: "8".repeat(64),
    currentSourceDigest: sha256Hex(JSON.stringify(donor)),
    review: {
      id: 23,
      node_id: "PRR_historical",
      html_url: `${donor.sourceUrl}#pullrequestreview-23`,
      user: { node_id: C.id, login: C.login, type: "User" },
      body: "Reviewed",
      state: "COMMENTED",
      submitted_at: "2026-10-22T00:00:00Z",
      commit_id: historical.sha,
    },
    commits: [historical],
  };
  const binding = grouped.proof.originalContributor;
  binding.claimIds = grouped.proof.claims.map((claim) => claim.id);
  binding.reviewedOriginal = {
    ...retained,
    digest: sha256Hex(JSON.stringify(retained)),
  };
  return { ...sample, binding };
}

test("reviewed original revision preserves the current source and applies the complete October pool once", () => {
  const { journal, input, donor } = reviewedOriginalReplacement();
  const before = structuredClone(donor);
  const result = apply(journal, input);
  expect(amounts(result.journal)).toEqual({ [A.id]: 30, [C.id]: 0 });
  expect(donor).toEqual(before);
  expect(total(result.journal)).toBe(total(journal));
  expect(apply(result.journal, input, true, LATER).journal).toBe(
    result.journal,
  );
});

for (const fault of [
  "digest",
  "current-head",
  "review-source",
  "review-head",
  "review-time",
  "author",
  "parent",
  "outside-october",
] as const) {
  test(`reviewed original proof refuses ${fault}`, () => {
    const { journal, input, donor, grouped, binding } =
      reviewedOriginalReplacement();
    const retained = binding.reviewedOriginal;
    if (!retained?.review) throw Error("fixture");
    if (fault === "digest") retained.digest = "9".repeat(64);
    if (fault === "current-head") donor.headSha = sha("f");
    if (fault === "review-source")
      retained.review.html_url =
        "https://github.com/other/repo/pull/1#pullrequestreview-23";
    if (fault === "review-head") retained.review.commit_id = sha("9");
    if (fault === "review-time")
      retained.review.submitted_at = "2026-10-24T00:00:00Z";
    if (fault === "author") retained.commits[0].author = B;
    if (fault === "parent") retained.commits[0].parentShas = [sha("9")];
    if (fault === "outside-october")
      grouped.occurredAt = "2026-11-01T00:00:00.000Z";
    if (fault !== "digest") {
      const { digest: _, ...payload } = retained;
      retained.digest = sha256Hex(JSON.stringify(payload));
    }
    expect(() => apply(journal, input)).toThrow();
  });
}

function reviewedBranchParts() {
  const sample = multiOriginalPrUnit();
  const { grouped, donor, accepted, second } = sample;
  if (
    grouped.proof.status !== "complete" ||
    !grouped.proof.originalContributorParts
  )
    throw Error("fixture");
  const parts = grouped.proof.originalContributorParts;
  const originals = [
    structuredClone(accepted.commits[0]),
    structuredClone(second.commits[0]),
  ];
  for (const commit of originals) commit.author = A;
  accepted.commits[0].author = A;
  const acceptedSecond = accepted.commits.find(
    (commit) => commit.sha === second.headSha,
  );
  if (!acceptedSecond) throw Error("fixture");
  acceptedSecond.author = A;
  second.commits[0].author = A;
  donor.commits = [
    { ...structuredClone(originals[0]), sha: sha("e"), parentShas: [sha("d")] },
  ];
  donor.headSha = sha("e");
  for (const [index, part] of parts.entries()) {
    part.originalSourceId = donor.sourceId;
    const retained = {
      sourceDigest: "8".repeat(64),
      currentSourceDigest: sha256Hex(JSON.stringify(donor)),
      review: {
        id: 23 + index,
        node_id: `PRR_historical_${index}`,
        html_url: `${donor.sourceUrl}#pullrequestreview-${23 + index}`,
        user: { node_id: C.id, login: C.login, type: "User" },
        body: "Reviewed",
        state: "COMMENTED",
        submitted_at: "2026-10-22T00:00:00Z",
        commit_id: originals[index].sha,
      },
      commits: [originals[index]],
    };
    part.reviewedOriginal = {
      ...retained,
      digest: sha256Hex(JSON.stringify(retained)),
    };
  }
  return sample;
}

test("separate reviewed branches from one original PR preserve one complete unit", () => {
  const { journal, input } = reviewedBranchParts();
  const result = apply(journal, input);
  expect(amounts(result.journal)).toEqual({ [A.id]: 30, [C.id]: 0 });
  expect(total(result.journal)).toBe(total(journal));
  expect(apply(result.journal, input, true, LATER).journal).toBe(
    result.journal,
  );
});
for (const fault of [
  "overlap",
  "different-author",
  "duplicate-anchor",
] as const) {
  test(`reviewed branch parts reject ${fault}`, () => {
    const { journal, input, grouped } = reviewedBranchParts();
    if (
      grouped.proof.status !== "complete" ||
      !grouped.proof.originalContributorParts
    )
      throw Error("fixture");
    const [first, second] = grouped.proof.originalContributorParts;
    if (fault === "overlap") second.claimIds = first.claimIds;
    if (fault === "duplicate-anchor")
      second.originalCommitSha = first.originalCommitSha;
    if (fault === "different-author") {
      const retained = second.reviewedOriginal;
      if (!retained) throw Error("fixture");
      retained.commits[0].author = B;
      const { digest: _, ...payload } = retained;
      retained.digest = sha256Hex(JSON.stringify(payload));
    }
    expect(() => apply(journal, input)).toThrow();
  });
}

test("verified nine-parent delta uses the existing author fallback and keeps its pool", () => {
  const { journal, input, units } = grouped();
  const first = input.candidates[0];
  if (first.proof.status !== "complete" || first.kind !== "work-unit")
    throw Error("fixture");
  const source = first.proof.sources[0];
  source.author = A;
  const parents = Array.from({ length: 9 }, (_, i) =>
    (i + 1).toString(16).repeat(40),
  );
  const blob = "c".repeat(40),
    result = "d".repeat(40),
    path = "one.ts";
  const patch = `diff --combined ${path}\nindex ${parents.map(() => blob).join(",")}..${result}\n${parents.map(() => `--- a/${path}\n`).join("")}+++ b/${path}\n@@@@@@@@@@ ${parents.map(() => "-1 ").join("")}+1,2 @@@@@@@@@@\n         old\n+++++++++new\n`;
  const commit = source.commits[0];
  commit.parentCount = 9;
  commit.parentShas = parents;
  commit.author = null;
  commit.mergeResolution = {
    kind: "combined-parent-delta",
    commitSha: commit.sha,
    parents,
    parentTrees: parents.map(() => "e".repeat(40)),
    gitVersion: "git version 2.56.0",
    resolvedTree: "f".repeat(40),
    patch,
    patchSha256: sha256Hex(patch),
    paths: [path],
    files: [
      {
        path,
        parents: parents.map(() => ({ mode: "100644", blobSha: blob })),
        result: { mode: "100644", blobSha: result },
      },
    ],
  };
  const other = input.candidates[1];
  if (other.proof.status !== "complete") throw Error("fixture");
  other.proof.sources[0].author = A;
  other.proof.sources[0].commits[0] = structuredClone(commit);
  const value = apply(journal, input);
  expect(
    [...latestPoints(value.journal).values()].find(
      (row) => row.award.workUnitId === units[0] && row.award.actor.id === A.id,
    )?.award.amount,
  ).toBe(7);
  expect(total(value.journal)).toBe(total(journal));
  expect(apply(value.journal, input, true, LATER).journal).toBe(value.journal);
});

function scopedCopiedOriginal() {
  const sample = octoberGroupedReplacement();
  if (
    sample.grouped.proof.status !== "complete" ||
    !sample.grouped.proof.originalContributor
  )
    throw Error("fixture");
  const proof = sample.grouped.proof,
    accepted = proof.sources[0],
    original = proof.sources[1];
  const binding = proof.originalContributor;
  if (!binding) throw Error("fixture binding");
  binding.claimIds = proof.claims.map((c) => c.id);
  binding.copiedClaims = [
    {
      claimId: proof.claims[0].id,
      originalCommitSha: original.commits[0].sha,
      acceptedCommitSha: accepted.commits[0].sha,
      path: proof.claims[0].path,
      bindingDigest: VALUE,
    },
  ];
  original.commits[0].parentShas = [sha("0")];
  accepted.commits[0].parentShas = [sha("0")];
  accepted.commits[1].parentShas = [accepted.commits[0].sha];
  const other = structuredClone(accepted.commits[1]);
  other.sha = sha("9");
  other.author = B;
  other.parentShas = [accepted.commits[1].sha];
  accepted.commits.push(other);
  accepted.commitCount++;
  accepted.headSha = other.sha;
  return { ...sample, accepted, original, binding };
}

test("a copied reviewed unit preserves the original pool while retaining unrelated carrier work", () => {
  const { journal, input, accepted } = scopedCopiedOriginal();
  const before = JSON.stringify(input);
  const result = apply(journal, input);
  expect(amounts(result.journal)).toEqual({ [A.id]: 30, [C.id]: 0 });
  expect(accepted.commits).toHaveLength(3);
  expect(JSON.stringify(input)).toBe(before);
  expect(apply(result.journal, input, true, LATER).journal).toBe(
    result.journal,
  );
});
for (const fault of [
  "claim-id",
  "copy-path",
  "copy-author",
  "first-acceptance",
  "missing-binding",
  "foreign-claim",
  "native-flag",
  "outer-anchor",
  "original-sha",
  "accepted-sha",
  "duplicate-id",
  "merged-original",
  "competing-anchor",
] as const) {
  test(`copied reviewed unit refuses ${fault}`, () => {
    const { journal, input, grouped, accepted, binding } =
      scopedCopiedOriginal();
    if (grouped.proof.status !== "complete" || !binding?.copiedClaims)
      throw Error("fixture");
    if (fault === "claim-id") binding.copiedClaims[0].claimId = "different";
    if (fault === "copy-path") binding.copiedClaims[0].path = "other.ts";
    if (fault === "copy-author") accepted.commits[0].author = B;
    if (fault === "first-acceptance")
      accepted.commits[0].firstAcceptedSourceId = "PR_elsewhere";
    const copies = binding.copiedClaims;
    if (fault === "missing-binding") delete binding.copiedClaims;
    if (fault === "native-flag") binding.exactAcceptance = true;
    if (fault === "outer-anchor")
      binding.acceptedCommitSha = accepted.commits[1].sha;
    if (fault === "original-sha") copies[0].originalCommitSha = sha("8");
    if (fault === "accepted-sha")
      copies[0].acceptedCommitSha = accepted.commits[1].sha;
    if (fault === "duplicate-id") copies.push({ ...copies[0] });
    if (fault === "merged-original")
      grouped.proof.sources[1].occurredAt = grouped.occurredAt;
    if (fault === "competing-anchor") {
      copies.unshift({
        ...copies[0],
        claimId: grouped.proof.claims[1].id,
        acceptedCommitSha: accepted.commits[1].sha,
      });
    }
    if (fault === "foreign-claim") {
      grouped.proof.claims[1].commitSha = accepted.commits[2].sha;
    }
    expect(() => apply(journal, input)).toThrow();
  });
}

test("native unit credits its sole primary initiator while retaining the PR creator", () => {
  const { journal, input, donor, accepted, grouped } = scopedUnlinkedOriginal();
  if (grouped.proof.status !== "complete" || !grouped.proof.originalContributor)
    throw Error("fixture");
  donor.author = C;
  donor.commits[0].author = A;
  accepted.commits[0].author = A;
  grouped.proof.originalContributor.originatingActor = A;
  const result = apply(journal, input);
  expect(amounts(result.journal)).toEqual({ [A.id]: 30, [C.id]: 0 });
  expect(donor.author).toEqual(C);
  expect(donor.commits[0].author).toEqual(A);
  expect(total(result.journal)).toBe(total(journal));
  expect(apply(result.journal, input, true, LATER).journal).toBe(
    result.journal,
  );
  expect(apply(journal, input, false).journal).toBe(journal);
});

for (const fault of [
  "wrong-origin",
  "null-author",
  "bot",
  "mixed-authors",
  "wrong-accepted",
  "missing-scope",
] as const) {
  test(`sole primary origin refuses ${fault}`, () => {
    const { journal, input, donor, accepted, grouped } =
      scopedUnlinkedOriginal();
    if (
      grouped.proof.status !== "complete" ||
      !grouped.proof.originalContributor
    )
      throw Error("fixture");
    donor.author = C;
    donor.commits[0].author = A;
    accepted.commits[0].author = A;
    const binding = grouped.proof.originalContributor;
    binding.originatingActor = A;
    if (fault === "wrong-origin") binding.originatingActor = B;
    if (fault === "null-author") donor.commits[0].author = null;
    if (fault === "bot") {
      donor.commits[0].author = { ...A, kind: "Bot" };
      binding.originatingActor = donor.commits[0].author;
    }
    if (fault === "mixed-authors") {
      donor.commits.push(structuredClone(accepted.commits[1]));
      donor.commitCount++;
      donor.headSha = donor.commits[1].sha;
    }
    if (fault === "wrong-accepted") accepted.commits[0].author = B;
    if (fault === "missing-scope") delete binding.claimIds;
    expect(() => apply(journal, input)).toThrow();
  });
}

function historicalAcknowledgedRepair() {
  const input = acknowledgedRepair();
  const reference = input.repair.reference;
  const text = reference.acknowledgement.body;
  delete (reference as Partial<typeof reference>).acknowledgement;
  Object.assign(reference, {
    bodyEdit: {
      id: reference.pull.node_id,
      body: reference.pull.body,
      headRefOid: reference.pull.head.sha,
      mergedAt: reference.pull.merged_at,
      updatedAt: reference.pull.updated_at,
      lastEditedAt: "2026-10-24T00:00:00Z",
      editor: { id: C.id, type: "User" },
      author: { id: C.id, type: "User" },
    },
    historicalBodyEdit: {
      id: "UCE_authenticated",
      createdAt: "2026-10-22T22:00:00Z",
      editedAt: "2026-10-22T22:00:00Z",
      updatedAt: "2026-10-22T22:00:00Z",
      deletedAt: null,
      diff: text,
      editor: { id: C.id, type: "User" },
      headCommit: {
        sha: reference.headSha,
        committedAt: "2026-10-22T21:00:00Z",
      },
    },
  });
  const { digest: _, ...payload } = reference;
  reference.digest = sha256Hex(JSON.stringify(payload));
  return input;
}

test("an authenticated historical body keeps an original's pool after later body edits", () => {
  const { journal, input } = historicalAcknowledgedRepair();
  const result = apply(journal, input);
  expect(amounts(result.journal)).toEqual({ [A.id]: 30, [C.id]: 0 });
  expect(apply(result.journal, input, true, LATER).journal).toBe(
    result.journal,
  );
});
for (const fault of [
  "actor",
  "date",
  "text",
  "head",
  "future-head",
  "deleted",
  "missing-editor",
  "missing-head",
] as const) {
  test(`historical repair domain refuses ${fault}`, () => {
    const { journal, input, repair } = historicalAcknowledgedRepair();
    const reference = repair.reference as typeof repair.reference & {
      historicalBodyEdit: {
        id: string;
        createdAt: string;
        editedAt: string;
        updatedAt: string;
        deletedAt: string | null;
        diff: string;
        editor: { id: string; type: string } | null;
        headCommit: { sha: string; committedAt: string } | null;
      };
    };
    const historical = reference.historicalBodyEdit;
    if (fault === "actor" && historical.editor) historical.editor.id = B.id;
    if (fault === "date")
      historical.createdAt =
        historical.editedAt =
        historical.updatedAt =
          "2026-10-25T00:00:00Z";
    if (fault === "text") historical.diff = `Other #999 ${reference.headSha}`;
    if (fault === "head" && historical.headCommit)
      historical.headCommit.sha = sha("9");
    if (fault === "future-head" && historical.headCommit)
      historical.headCommit.committedAt = "2026-10-23T00:00:00Z";
    if (fault === "deleted") historical.deletedAt = historical.editedAt;
    if (fault === "missing-editor") historical.editor = null;
    if (fault === "missing-head") historical.headCommit = null;
    const { digest: _, ...payload } = reference;
    reference.digest = sha256Hex(JSON.stringify(payload));
    expect(() => apply(journal, input)).toThrow();
  });
}

test("native original keeps the existing creator fallback for an agent primary", () => {
  const { journal, input, donor, accepted } = scopedUnlinkedOriginal();
  const agent = { id: "U_kgDOC972lw", login: "cursoragent", kind: "User" };
  donor.commits[0].author = agent;
  accepted.commits[0].author = agent;
  expect(amounts(apply(journal, input).journal)).toEqual({
    [A.id]: 30,
    [C.id]: 0,
  });
  expect(donor.commits[0].author).toEqual(agent);
});

function nullResolutionUnit() {
  const sample = scopedUnlinkedOriginal();
  const { grouped, accepted, donor } = sample;
  if (grouped.proof.status !== "complete" || !grouped.proof.originalContributor)
    throw Error("fixture");
  const patch =
    "diff --git a/merge.ts b/merge.ts\n--- a/merge.ts\n+++ b/merge.ts\n@@ -1 +1 @@\n-old\n+resolved\n";
  const commit = {
    sha: sha("8"),
    parentCount: 2,
    parentShas: [accepted.headSha, donor.headSha],
    author: null,
    additions: 1,
    deletions: 1,
    files: [{ path: "merge.ts", additions: 1, deletions: 1 }],
    firstAcceptedSourceId: accepted.sourceId,
    mergeResolution: {
      commitSha: sha("8"),
      parents: [accepted.headSha, donor.headSha] as [string, string],
      gitVersion: "git version 2.56.0",
      automaticTree: sha("1"),
      resolvedTree: sha("2"),
      hadConflicts: true,
      patch,
      patchSha256: resolutionDigest(patch),
      paths: ["merge.ts"],
    },
  };
  accepted.commits.push(commit);
  accepted.commitCount++;
  accepted.headSha = commit.sha;
  const claim = {
    id: "claim_null_resolution",
    sourceId: accepted.sourceId,
    commitSha: commit.sha,
    path: "merge.ts",
  };
  grouped.proof.claims.push(claim);
  grouped.proof.expectedClaimIds.push(claim.id);
  const binding = grouped.proof.originalContributor;
  binding.claimIds = [...grouped.proof.expectedClaimIds];
  binding.resolutionAcceptance = {
    sourceDigest: "1".repeat(64),
    pull: {
      node_id: accepted.sourceId,
      html_url: accepted.sourceUrl,
      head: { sha: accepted.headSha },
      state: "closed",
      merged_at: accepted.occurredAt,
      user: { node_id: C.id, login: C.login, type: "User" },
      merged_by: { node_id: C.id, login: C.login, type: "User" },
    } as NonNullable<typeof binding.resolutionAcceptance>["pull"],
  };
  return { ...sample, commit, binding };
}

test("a verified native resolution retains its null primary and the original's whole pool", () => {
  const { journal, input, commit } = nullResolutionUnit();
  expect(amounts(apply(journal, input).journal)).toEqual({
    [A.id]: 30,
    [C.id]: 0,
  });
  expect(commit.author).toBeNull();
});
for (const fault of [
  "foreign-author",
  "missing-resolution",
  "wrong-merger",
  "wrong-head",
  "wrong-source",
  "wrong-hash",
  "ordinary-null",
] as const) {
  test(`native resolution fallback refuses ${fault}`, () => {
    const { journal, input, commit, binding } = nullResolutionUnit();
    if (fault === "foreign-author")
      (commit as { author: CorrectionActor | null }).author = B;
    if (fault === "missing-resolution")
      delete (commit as { mergeResolution?: unknown }).mergeResolution;
    if (
      fault === "wrong-merger" &&
      binding.resolutionAcceptance?.pull.merged_by
    )
      binding.resolutionAcceptance.pull.merged_by.node_id = B.id;
    if (fault === "wrong-head" && binding.resolutionAcceptance)
      binding.resolutionAcceptance.pull.head.sha = sha("9");
    if (fault === "wrong-source" && binding.resolutionAcceptance)
      binding.resolutionAcceptance.pull.node_id = "PR_wrong";
    if (fault === "wrong-hash")
      commit.mergeResolution.patchSha256 = "0".repeat(64);
    if (fault === "ordinary-null") commit.parentCount = 1;
    expect(() => apply(journal, input)).toThrow();
  });
}

test("a later null-author resolution cannot reuse the first carrier's merger proof", () => {
  const { journal, input, grouped, accepted, followup } =
    laterAcceptedFollowup();
  if (grouped.proof.status !== "complete" || !grouped.proof.originalContributor)
    throw Error("fixture");
  const original = grouped.proof.sources[1];
  original.headSha = accepted.commits[0].sha;
  original.commits[0].sha = accepted.commits[0].sha;
  accepted.commits[0].parentShas = [sha("0")];
  accepted.commits[1].parentShas = [accepted.commits[0].sha];
  const binding = grouped.proof.originalContributor;
  binding.exactAcceptance = true;
  binding.originalCommitSha = original.headSha;
  binding.acceptedCommitSha = original.headSha;
  binding.claimIds = [...grouped.proof.expectedClaimIds];
  const commit = followup.commits[0];
  commit.author = null;
  commit.parentCount = 2;
  commit.parentShas = [accepted.headSha, sha("7")];
  const patch =
    "diff --git a/later.ts b/later.ts\n--- a/later.ts\n+++ b/later.ts\n@@ -1 +1 @@\n-old\n+resolved\n";
  commit.files = [{ path: "later.ts", additions: 1, deletions: 1 }];
  commit.mergeResolution = {
    commitSha: commit.sha,
    parents: [...commit.parentShas] as [string, string],
    gitVersion: "git version 2.56.0",
    automaticTree: sha("1"),
    resolvedTree: sha("2"),
    hadConflicts: true,
    patch,
    patchSha256: resolutionDigest(patch),
    paths: ["later.ts"],
  };
  const claim = grouped.proof.claims.find(
    (item) => item.sourceId === followup.sourceId,
  );
  if (!claim) throw Error("fixture claim");
  claim.path = "later.ts";
  const native = binding.followups?.[0].commits.find(
    (item) => item.sha === commit.sha,
  );
  if (!native) throw Error("fixture parent proof");
  native.parentShas = [...commit.parentShas];
  binding.resolutionAcceptance = {
    sourceDigest: "1".repeat(64),
    pull: {
      node_id: accepted.sourceId,
      html_url: accepted.sourceUrl,
      head: { sha: accepted.headSha },
      state: "closed",
      merged_at: accepted.occurredAt,
      user: { node_id: C.id, login: C.login, type: "User" },
      merged_by: { node_id: C.id, login: C.login, type: "User" },
    } as NonNullable<typeof binding.resolutionAcceptance>["pull"],
  };
  expect(() => apply(journal, input)).toThrow("unit scope");
});

function pairedNullRepair() {
  const sample = acknowledgedRepair();
  const { grouped, accepted, donor, commit } = sample;
  if (grouped.proof.status !== "complete" || !grouped.proof.originalContributor)
    throw Error("fixture");
  commit.author = null;
  const reference = structuredClone(sample.repair.reference);
  reference.acknowledgement.body = `Final source ${accepted.headSha}`;
  const originalAcknowledgement = {
    pull: {
      ...reference.pull,
      node_id: donor.sourceId,
      number: Number(donor.sourceUrl.split("/").at(-1)),
      html_url: donor.sourceUrl,
      head: { sha: donor.headSha },
      merged_at: donor.occurredAt,
      created_at: "2026-10-21T00:00:00Z",
    },
    comment: {
      node_id: "IC_original_pair",
      html_url: `${donor.sourceUrl}#issuecomment-10`,
      body: `Finished in integration #${reference.pull.number}`,
      user: { node_id: C.id, login: C.login, type: "User" },
      created_at: "2026-10-22T23:59:58Z",
      updated_at: "2026-10-22T23:59:58Z",
    },
  };
  const payload = {
    ...reference,
    acceptingPull: {
      ...reference.acceptingPull,
      created_at: "2026-10-22T00:00:00Z",
    },
    acknowledgement: {
      ...reference.acknowledgement,
      created_at: "2026-10-22T23:59:59Z",
      updated_at: "2026-10-22T23:59:59Z",
      html_url: `${accepted.sourceUrl}#issuecomment-11`,
    },
    originalAcknowledgement,
  };
  const { digest: _, ...bound } = payload;
  const repair = {
    ...sample.repair,
    authorNodeId: null,
    reference: { ...bound, digest: sha256Hex(JSON.stringify(bound)) },
  };
  grouped.proof.originalContributor.repairs = [repair];
  return { ...sample, repair };
}

test("paired merger acknowledgements preserve null repair authors and award the original whole pool", () => {
  const { journal, input, commit } = pairedNullRepair();
  const result = apply(journal, input);
  expect(amounts(result.journal)).toEqual({ [A.id]: 30, [C.id]: 0 });
  expect(commit.author).toBeNull();
  expect(total(result.journal)).toBe(total(journal));
  expect(apply(result.journal, input, true, LATER).journal).toBe(
    result.journal,
  );
});

for (const fault of [
  "missing-pair",
  "original-actor",
  "accepted-actor",
  "original-url",
  "original-node",
  "original-head",
  "original-edited",
  "accepted-edited",
  "reversed",
  "late",
  "head",
  "reference",
  "author",
  "ancestor",
  "first-owner",
  "unselected",
] as const) {
  test(`paired null repair domain rejects ${fault}`, () => {
    const { journal, input, grouped, repair, commit } = pairedNullRepair();
    const reference = repair.reference;
    const original = reference.originalAcknowledgement;
    if (fault === "missing-pair")
      delete (reference as Partial<typeof reference>).originalAcknowledgement;
    if (fault === "original-actor") original.comment.user.node_id = B.id;
    if (fault === "accepted-actor")
      reference.acknowledgement.user.node_id = B.id;
    if (fault === "original-url")
      original.comment.html_url =
        "https://github.com/foreign/repo/pull/1#issuecomment-10";
    if (fault === "original-node") original.pull.node_id = "PR_foreign";
    if (fault === "original-head") original.pull.head.sha = sha("9");
    if (fault === "original-edited")
      original.comment.updated_at = "2026-10-23T00:00:02Z";
    if (fault === "accepted-edited")
      reference.acknowledgement.updated_at = "2026-10-23T00:00:02Z";
    if (fault === "reversed")
      original.comment.created_at = original.comment.updated_at =
        "2026-10-23T00:00:02Z";
    if (fault === "late")
      reference.acknowledgement.created_at =
        reference.acknowledgement.updated_at = "2026-10-30T00:00:00Z";
    if (fault === "head")
      reference.acknowledgement.body = `Final source ${sha("9")}`;
    if (fault === "reference") original.comment.body = "Integration #999";
    if (fault === "author") commit.author = B;
    if (fault === "ancestor") commit.parentShas = [sha("9")];
    if (fault === "first-owner") commit.firstAcceptedSourceId = "PR_other";
    if (fault === "unselected" && grouped.proof.status === "complete")
      grouped.proof.claims[1].commitSha = sha("f");
    const { digest: _, ...payload } = reference;
    reference.digest = sha256Hex(JSON.stringify(payload));
    expect(() => apply(journal, input)).toThrow();
  });
}

function bodyOriginalReplacement() {
  const sample = reviewedOriginalReplacement();
  const { binding, donor } = sample;
  const retained = binding.reviewedOriginal;
  if (!retained) throw Error("fixture");
  delete retained.review;
  const head = retained.commits.at(-1)?.sha;
  if (!head) throw Error("fixture head");
  const body = `Verified original head ${head}.`;
  const user = { node_id: C.id, login: C.login, type: "User" };
  retained.bodyReference = {
    kind: "pre-merge-body",
    headSha: head,
    headCommittedAt: "2026-10-20T00:00:00Z",
    createdAt: "2026-10-19T00:00:00Z",
    pull: {
      node_id: donor.sourceId,
      number: 10,
      html_url: donor.sourceUrl,
      state: "closed",
      merged_at: donor.occurredAt,
      updated_at: "2026-10-23T00:00:03Z",
      head: { sha: donor.headSha },
      body,
      user,
      merged_by: user,
    } as NonNullable<typeof retained.bodyReference>["pull"],
    metadata: {
      id: donor.sourceId,
      body,
      headRefOid: donor.headSha,
      mergedAt: donor.occurredAt ?? "",
      updatedAt: "2026-10-23T00:00:03Z",
      lastEditedAt: "2026-10-22T00:00:00Z",
      author: { id: C.id, type: "User" },
      editor: { id: C.id, type: "User" },
    },
  };
  const { digest: _, ...payload } = retained;
  retained.digest = sha256Hex(JSON.stringify(payload));
  return sample;
}
test("authenticated pre-merge body binds a historical native original without a formal review", () => {
  const { journal, input, donor } = bodyOriginalReplacement();
  const before = structuredClone(donor);
  expect(amounts(apply(journal, input).journal)).toEqual({
    [A.id]: 30,
    [C.id]: 0,
  });
  expect(donor).toEqual(before);
});
for (const fault of [
  "editor",
  "late",
  "head",
  "commit-time",
  "number",
  "author",
  "mixed-primary",
  "created-after-edit",
] as const) {
  test(`historical body original rejects ${fault}`, () => {
    const { journal, input, binding } = bodyOriginalReplacement();
    const retained = binding.reviewedOriginal,
      reference = retained?.bodyReference;
    if (!retained || !reference) throw Error("fixture");
    if (fault === "editor" && reference.metadata.editor)
      reference.metadata.editor.id = B.id;
    if (fault === "late")
      reference.metadata.lastEditedAt = "2026-10-24T00:00:00Z";
    if (fault === "head") reference.metadata.headRefOid = sha("9");
    if (fault === "commit-time")
      reference.headCommittedAt = "2026-10-22T00:00:01Z";
    if (fault === "number") reference.pull.number = 99;
    if (fault === "author") reference.metadata.author.id = B.id;
    if (fault === "created-after-edit")
      reference.createdAt = "2026-10-22T00:00:01Z";
    if (fault === "mixed-primary") retained.commits[0].author = B;
    const { digest: _, ...payload } = retained;
    retained.digest = sha256Hex(JSON.stringify(payload));
    expect(() => apply(journal, input)).toThrow();
  });
}

test("copied claim scope binds the sole primary without rewriting a maintainer PR creator", () => {
  const { journal, input, original, binding } = scopedCopiedOriginal();
  original.author = C;
  binding.originatingActor = A;
  const result = apply(journal, input);
  expect(amounts(result.journal)).toEqual({ [A.id]: 30, [C.id]: 0 });
  expect(original.author).toEqual(C);
  expect(total(result.journal)).toBe(total(journal));
  expect(apply(result.journal, input, true, LATER).journal).toBe(
    result.journal,
  );
});
for (const fault of [
  "different-primary",
  "different-accepted",
  "missing-copies",
  "missing-claims",
] as const) {
  test(`copied primary binding refuses ${fault}`, () => {
    const { journal, input, original, accepted, binding } =
      scopedCopiedOriginal();
    original.author = C;
    binding.originatingActor = A;
    if (fault === "different-primary") original.commits[0].author = B;
    if (fault === "different-accepted") accepted.commits[0].author = B;
    if (fault === "missing-copies") delete binding.copiedClaims;
    if (fault === "missing-claims") delete binding.claimIds;
    expect(() => apply(journal, input)).toThrow();
  });
}
