import { expect, test } from "bun:test";
import { implementationLineWeights } from "../src/lib/commit-credit";
import { workUnitLineWeights } from "../src/lib/implementation-lines";
import { sha256Hex } from "../src/lib/sha256";
import {
  PENALIZED_AUTHOR,
  PROJECT_OWNER,
} from "../tests/penalty-score-fixture";
import { fixture, policy, repository } from "../tests/value-binary-fixture";
import { collectValueEvidence } from "../workers/slopbot/value-evidence";
import { mergeResolutionLineCounts } from "../workers/slopbot/value-merge-resolution";
import { prepareWorkUnitEvidence } from "../workers/slopbot/value-work-unit";
import type {
  WorkUnitClaim,
  WorkUnitEvidence,
} from "../workers/slopbot/value-work-unit-types";

test("line weights sum additions and deletions for primary authors and verified fallbacks", () => {
  expect(
    implementationLineWeights(PROJECT_OWNER, [
      { author: PENALIZED_AUTHOR, additions: 3, deletions: 2 },
      { author: PENALIZED_AUTHOR, additions: 0, deletions: 4 },
      { author: null, additions: 2, deletions: 3 },
      {
        author: { ...PENALIZED_AUTHOR, id: "U_kgDOD-0LXg" },
        additions: 4,
        deletions: 1,
      },
    ]),
  ).toEqual(
    new Map([
      [PENALIZED_AUTHOR.id, 9n],
      [PROJECT_OWNER.id, 10n],
    ]),
  );
});

test("line weights distinguish verified zeros from unavailable or invalid counts", () => {
  expect(
    implementationLineWeights(PROJECT_OWNER, [
      { author: PENALIZED_AUTHOR, additions: 0, deletions: 0 },
    ]),
  ).toEqual(new Map([[PENALIZED_AUTHOR.id, 0n]]));
  for (const additions of [undefined, -1, 0.5, Number.NaN]) {
    expect(
      implementationLineWeights(PROJECT_OWNER, [
        { author: PENALIZED_AUTHOR, additions, deletions: 0 },
      ]),
    ).toBeNull();
  }
  const maximum = Number.MAX_SAFE_INTEGER;
  expect(
    implementationLineWeights(PROJECT_OWNER, [
      { author: PENALIZED_AUTHOR, additions: maximum, deletions: maximum },
    ]),
  ).toEqual(new Map([[PENALIZED_AUTHOR.id, BigInt(maximum) * 2n]]));
});

function retainedLineEvidence() {
  const originalSha = "a".repeat(40);
  const acceptedSha = "b".repeat(40);
  const claim: WorkUnitClaim = {
    id: "c".repeat(64),
    repositoryNodeId: "R_fixture",
    commitSha: originalSha,
    path: "src/fix.ts",
    carrierPullRequestIds: ["PR_original", "PR_copy"],
    creditPullRequestId: "PR_original",
    implementationActorNodeIds: [PENALIZED_AUTHOR.id],
    retainedCopy: {
      acceptancePullRequestId: "PR_copy",
      acceptedCommitSha: acceptedSha,
      preexistingCommitShas: [],
    },
  };
  const source = (
    id: string,
    sha: string,
    additions: number,
    deletions: number,
  ) => ({
    evidence: {
      pull: { node_id: id },
      commitAttribution: [
        {
          sha,
          limitations: [],
          files: [
            {
              filename: claim.path,
              status: "modified",
              additions,
              deletions,
            },
          ],
        },
      ],
    },
  });
  const evidence = {
    sources: [
      source("PR_original", originalSha, 900, 100),
      source("PR_copy", acceptedSha, 8, 2),
    ],
    claims: [claim],
  } as unknown as WorkUnitEvidence;
  return { claim, evidence };
}

test("retained-copy line weights use the accepted file's delta and original recipient", () => {
  const { claim, evidence } = retainedLineEvidence();
  expect(workUnitLineWeights(evidence, [claim])).toEqual(
    new Map([[PENALIZED_AUTHOR.id, 10n]]),
  );
  delete claim.retainedCopy;
  expect(workUnitLineWeights(evidence, [claim])).toEqual(
    new Map([[PENALIZED_AUTHOR.id, 1_000n]]),
  );
});

test("incomplete retained-copy evidence cannot borrow the original file's larger line count", () => {
  const { claim, evidence } = retainedLineEvidence();
  evidence.sources[1].evidence.commitAttribution[0].files = [];
  expect(workUnitLineWeights(evidence, [claim])).toBeNull();
  evidence.sources = [];
  expect(workUnitLineWeights(evidence, [claim])).toBeNull();
});

test("a repeated claim cannot multiply its line weight", () => {
  const { claim, evidence } = retainedLineEvidence();
  expect(workUnitLineWeights(evidence, [claim, claim])).toBeNull();
});

test("current primary commit authors allocate a retained valuation without changing its old claim", () => {
  const { claim, evidence } = retainedLineEvidence();
  const original = evidence.sources[0].evidence;
  original.pull.user = { node_id: PROJECT_OWNER.id, type: "User" } as never;
  original.commits = [
    {
      sha: claim.commitSha,
      parents: [{ sha: "c".repeat(40) }],
      author: { node_id: PROJECT_OWNER.id, type: "User" },
    },
  ] as never;
  expect(workUnitLineWeights(evidence, [claim])).toEqual(
    new Map([[PROJECT_OWNER.id, 10n]]),
  );
  expect(claim.implementationActorNodeIds).toEqual([PENALIZED_AUTHOR.id]);
});

test("a renamed file's changed lines count once across its new and old path claims", async () => {
  const f = fixture({ textOnly: true, direct: true });
  // GitHub lists an edited rename once, naming the old path previous_filename.
  Object.assign(f.files[0], { status: "renamed", previous_filename: "old.ts" });
  const evidence = await collectValueEvidence(
    f.client,
    repository.id,
    1,
    repository,
  );
  const joint = await prepareWorkUnitEvidence(
    [{ evidence, policy }],
    [repository],
  );
  expect(joint.limitations).toEqual([]);
  // The producer claims both paths of the renamed file for its commit.
  expect(joint.claims.map((claim) => claim.path).sort()).toEqual([
    "fix.ts",
    "old.ts",
  ]);
  expect(workUnitLineWeights(joint, joint.claims)).toEqual(
    new Map([["U_author", 1n]]),
  );
  for (const claim of joint.claims)
    expect(workUnitLineWeights(joint, [claim])).toEqual(
      new Map([["U_author", 1n]]),
    );
});

function resolutionEvidence() {
  const { claim, evidence } = retainedLineEvidence();
  const patch = `diff --git a/src/fix.ts b/src/fix.ts\nindex ${"1".repeat(40)}..${"2".repeat(40)} 100644\n--- a/src/fix.ts\n+++ b/src/fix.ts\n@@ -1,2 +1,2 @@\n-old\n+fixed\n context\n`;
  for (const [index, source] of evidence.sources.entries()) {
    const sha =
      index === 0 ? claim.commitSha : claim.retainedCopy?.acceptedCommitSha;
    if (!sha) throw Error("fixture");
    Object.assign(source.evidence.pull, {
      user: { node_id: PENALIZED_AUTHOR.id, type: "User" },
    });
    source.evidence.commits = [
      {
        sha,
        parents: [{ sha: "3".repeat(40) }, { sha: "4".repeat(40) }],
        author: { node_id: PENALIZED_AUTHOR.id, type: "User" },
      },
    ] as never;
    source.evidence.mergeResolutions = [
      {
        commitSha: sha,
        parents: ["3".repeat(40), "4".repeat(40)],
        gitVersion: "git version 2.56.0",
        automaticTree: "5".repeat(40),
        resolvedTree: "6".repeat(40),
        hadConflicts: true,
        patch,
        patchSha256: sha256Hex(patch),
        paths: [claim.path],
      },
    ];
  }
  return { claim, evidence };
}

test("canonical retained resolution claims count only the accepted resolution patch", () => {
  const { claim, evidence } = resolutionEvidence();
  expect(workUnitLineWeights(evidence, [claim])).toEqual(
    new Map([[PENALIZED_AUTHOR.id, 2n]]),
  );
  const file = evidence.sources[1].evidence.commitAttribution[0].files?.[0];
  if (!file) throw Error("fixture");
  file.additions = 5000;
  expect(workUnitLineWeights(evidence, [claim])).toEqual(
    new Map([[PENALIZED_AUTHOR.id, 2n]]),
  );
});
for (const fault of [
  "wrong-parent",
  "wrong-hash",
  "wrong-version",
  "missing-path",
  "truncated-hunk",
] as const) {
  test(`resolution claim refuses ${fault}`, () => {
    const { claim, evidence } = resolutionEvidence();
    const resolution = evidence.sources[1].evidence.mergeResolutions?.[0];
    if (!resolution) throw Error("fixture");
    if (fault === "wrong-parent") resolution.parents[0] = "7".repeat(40);
    if (fault === "wrong-hash") resolution.patchSha256 = "0".repeat(64);
    if (fault === "wrong-version") resolution.gitVersion = "git version 2.50.1";
    if (fault === "missing-path") resolution.paths = ["another.ts"];
    if (fault === "truncated-hunk") {
      resolution.patch = resolution.patch.replace(" context\n", "");
      resolution.patchSha256 = sha256Hex(resolution.patch);
    }
    expect(workUnitLineWeights(evidence, [claim])).toBeNull();
  });
}

test("resolution line counts support added, deleted and quoted-path text files", () => {
  for (const [path, before, after, hunk] of [
    ["new.ts", "/dev/null", "b/new.ts", "@@ -0,0 +1,1 @@\n+new\n"],
    ["old.ts", "a/old.ts", "/dev/null", "@@ -1,1 +0,0 @@\n-old\n"],
    ["a b.ts", '"a/a b.ts"', '"b/a b.ts"', "@@ -1 +1 @@\n-old\n+new\n"],
  ]) {
    const { evidence } = resolutionEvidence();
    const resolution = evidence.sources[0].evidence.mergeResolutions?.[0];
    const commit = evidence.sources[0].evidence.commits[0];
    if (!resolution) throw Error("fixture");
    resolution.paths = [path];
    resolution.patch = `diff --git ${before} ${after}\n--- ${before}\n+++ ${after}\n${hunk}`;
    resolution.patchSha256 = sha256Hex(resolution.patch);
    expect(mergeResolutionLineCounts(resolution, commit)?.[0].path).toBe(path);
  }
});
