import { expect, test } from "bun:test";
import {
  collect,
  fixture,
  policy,
  repository,
} from "../../tests/value-binary-fixture";
import { prepareWorkUnitEvidence } from "./value-work-unit";

async function ownParent() {
  const evidence = await collect(fixture({ direct: true, textOnly: true }));
  const first = evidence.commits[0];
  if (!first.author || !evidence.mergeCommitEvidence)
    throw new Error("Incomplete fixture");
  const head = "d".repeat(40);
  evidence.commits.push({
    ...structuredClone(first),
    sha: head,
    parents: [{ sha: first.sha }],
  });
  evidence.commitAttribution.push({
    sha: head,
    actorNodeIds: [first.author.node_id],
    changedPaths: ["fix.ts"],
    files: [structuredClone(evidence.files[0])],
    limitations: [],
  });
  evidence.pull.head.sha = head;
  evidence.pull.merge_commit_sha = head;
  evidence.pull.commits = 2;
  evidence.mergeCommitEvidence = {
    ...evidence.mergeCommitEvidence,
    sha: head,
    parents: [{ sha: first.sha }],
  };
  evidence.acceptedRange = {
    headSha: head,
    mergeSha: head,
    parentSha: first.sha,
    files: [{ path: "fix.ts", blobSha: "e".repeat(40), alreadyPresent: false }],
  };
  return evidence;
}

test("a complete fast-forward PR retains its own earlier parent claim", async () => {
  const evidence = await ownParent();
  const result = await prepareWorkUnitEvidence(
    [{ evidence, policy }],
    [repository],
  );
  expect(result.limitations).toEqual([]);
  expect(result.claims.map((claim) => claim.commitSha).sort()).toEqual(
    evidence.commits.map((commit) => commit.sha).sort(),
  );
});

for (const fault of ["incomplete", "wrong-base", "different-merge"] as const) {
  test(`an unproved accepted parent remains held for ${fault}`, async () => {
    const evidence = await ownParent();
    if (fault === "incomplete") evidence.pull.commits = 3;
    if (fault === "wrong-base") evidence.pull.base.sha = "f".repeat(40);
    if (fault === "different-merge")
      evidence.pull.merge_commit_sha = "f".repeat(40);
    const currentPolicy = { ...policy, sha: evidence.pull.base.sha };
    const result = await prepareWorkUnitEvidence(
      [{ evidence, policy: currentPolicy }],
      [repository],
    );
    expect(
      result.limitations.some((reason) => reason.includes("imported squash")),
    ).toBe(true);
  });
}
