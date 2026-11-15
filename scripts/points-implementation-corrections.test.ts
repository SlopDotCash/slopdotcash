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
