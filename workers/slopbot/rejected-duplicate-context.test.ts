import { expect, test } from "bun:test";
import {
  commit,
  file,
  integrated,
  makeOriginal,
  repository,
} from "../../tests/value-promotion-fixture";
import { retainedCopyBindings } from "./value-retained-copy";
import { prepareWorkUnitEvidence } from "./value-work-unit";

// Synthetic copies exercise source integrity, never model output.
function sources() {
  const original = makeOriginal();
  const carrier = structuredClone(original);
  const maintainer = {
    node_id: "U_maintainer",
    login: "maintainer",
    type: "User",
  };
  const followup = commit("4".repeat(40));
  followup.parents = [{ sha: original.evidence.pull.head.sha }];
  followup.author = maintainer;
  Object.assign(carrier.evidence.pull, {
    node_id: "PR_carrier",
    number: 2,
    html_url: `https://github.com/${repository.id}/pull/2`,
    user: maintainer,
    merged_by: maintainer,
    merged_at: "2026-10-02T10:00:00Z",
    closed_at: "2026-10-02T10:00:00Z",
    merge_commit_sha: integrated,
    head: { sha: followup.sha },
    commits: 2,
  });
  carrier.evidence.commits.push(followup);
  carrier.evidence.commitAttribution.push({
    sha: followup.sha,
    actorNodeIds: [maintainer.node_id],
    changedPaths: ["followup.ts"],
    files: [{ ...file, filename: "followup.ts" }],
    limitations: [],
  });
  carrier.evidence.files.push({ ...file, filename: "followup.ts" });
  const merge = carrier.evidence.mergeCommitEvidence;
  if (!merge) throw new Error("Missing fixture merge");
  merge.sha = integrated;
  merge.parents = [{ sha: followup.sha }];
  const duplicate = structuredClone(original);
  const later = { node_id: "U_later", login: "later", type: "User" };
  Object.assign(duplicate.evidence.pull, {
    node_id: "PR_duplicate",
    number: 3,
    html_url: `https://github.com/${repository.id}/pull/3`,
    user: later,
    merged_by: null,
    merged_at: null,
    merge_commit_sha: null,
    closed_at: "2026-10-02T09:00:00Z",
    head: { sha: "5".repeat(40) },
  });
  duplicate.evidence.mergeCommitEvidence = null;
  duplicate.evidence.commits[0].sha = "5".repeat(40);
  duplicate.evidence.commits[0].author = later;
  duplicate.evidence.commits[0].commit.author.date = "2026-10-02T08:00:00Z";
  duplicate.evidence.commitAttribution[0].sha = "5".repeat(40);
  duplicate.evidence.commitAttribution[0].actorNodeIds = [later.node_id];
  duplicate.evidence.comments = [
    {
      node_id: "IC_duplicate",
      html_url: `${duplicate.evidence.pull.html_url}#issuecomment-1`,
      body: "Closing as a duplicate of #1, incorporated in #2. The full fix is preserved.",
      user: maintainer,
      created_at: "2026-10-02T08:59:59Z",
      updated_at: "2026-10-02T08:59:59Z",
    },
  ];
  duplicate.evidence.relatedPullRequests = [original, carrier].map(
    ({ evidence }) => ({
      id: evidence.pull.node_id,
      number: evidence.pull.number,
      url: evidence.pull.html_url,
      repository: repository.id,
    }),
  );
  return { original, carrier, duplicate };
}

test("a rejected later duplicate retains every source and ordinary original claims", async () => {
  const { original, carrier, duplicate } = sources();
  const baseline = await prepareWorkUnitEvidence(
    [original, carrier],
    [repository],
  );
  const result = await prepareWorkUnitEvidence(
    [original, carrier, duplicate],
    [repository],
  );
  expect(result.limitations).toEqual([]);
  expect(result.sources).toHaveLength(3);
  expect(result.claims).toEqual(baseline.claims);
  expect(result.claims.every((claim) => claim.retainedCopy === undefined)).toBe(
    true,
  );
  const retained = await retainedCopyBindings([original, carrier, duplicate], {
    acceptedSubset: true,
  });
  expect(retained.bindings.size).toBe(0);
});

for (const broken of [
  "editor",
  "edited",
  "proposed",
  "quoted",
  "late",
  "reference",
  "extra",
  "missing",
  "wrong-author",
  "disconnected",
  "cycle",
  "early-duplicate",
  "wrong-merger",
  "original-extra",
  "unmatched-original",
  "in-base",
  "wrong-repository",
  "unrelated-number",
] as const) {
  test(`a rejected duplicate remains held for ${broken} evidence`, async () => {
    const f = sources();
    if (broken === "editor")
      f.duplicate.evidence.comments[0].user = f.duplicate.evidence.pull.user;
    if (broken === "edited")
      f.duplicate.evidence.comments[0].updated_at = "2026-10-03T00:00:00Z";
    if (broken === "proposed")
      f.duplicate.evidence.comments[0].body = `Will be ${f.duplicate.evidence.comments[0].body}`;
    if (broken === "quoted")
      f.duplicate.evidence.comments[0].body = `> ${f.duplicate.evidence.comments[0].body}`;
    if (broken === "late")
      f.duplicate.evidence.comments[0].created_at =
        f.duplicate.evidence.comments[0].updated_at = "2026-10-03T00:00:00Z";
    if (broken === "reference")
      f.duplicate.evidence.relatedPullRequests[0].id = "PR_wrong";
    if (broken === "extra") {
      const extra = { ...file, filename: "extra.ts" };
      f.duplicate.evidence.files.push(extra);
      f.duplicate.evidence.commitAttribution[0].files?.push(extra);
      f.duplicate.evidence.commitAttribution[0].changedPaths?.push(
        extra.filename,
      );
    }
    if (broken === "missing")
      f.original.evidence.limitations.push("missing file");
    if (broken === "wrong-author")
      f.carrier.evidence.commits[0].author = f.carrier.evidence.pull.user;
    if (broken === "disconnected")
      f.carrier.evidence.commits[1].parents = [{ sha: "9".repeat(40) }];
    if (broken === "cycle")
      f.carrier.evidence.commits[1].parents.push({
        sha: f.carrier.evidence.commits[1].sha,
      });
    if (broken === "wrong-merger")
      f.carrier.evidence.pull.merged_by = f.original.evidence.pull.user;
    if (broken === "original-extra") f.original.evidence.pull.commits++;
    if (broken === "unmatched-original")
      f.original.evidence.files[0].patch += "\n+another";
    if (broken === "in-base")
      f.carrier.evidence.acceptedRange = {
        headSha: f.carrier.evidence.pull.head.sha,
        mergeSha: integrated,
        parentSha: f.original.evidence.commits[0].sha,
        files: [
          {
            path: file.filename,
            blobSha: "a".repeat(40),
            alreadyPresent: true,
          },
        ],
      };
    if (broken === "wrong-repository")
      f.duplicate.evidence.relatedPullRequests[0].repository = "other/repo";
    if (broken === "unrelated-number")
      f.duplicate.evidence.comments[0].body =
        "Closing as a duplicate of #19, incorporated in #2.";
    if (broken === "early-duplicate")
      f.duplicate.evidence.commits[0].commit.author.date =
        "2026-09-01T00:00:00Z";
    if (broken === "wrong-author") {
      await expect(
        prepareWorkUnitEvidence(
          [f.original, f.carrier, f.duplicate],
          [repository],
        ),
      ).rejects.toThrow("Joint sources disagree about an immutable commit");
      return;
    }
    const result = await prepareWorkUnitEvidence(
      [f.original, f.carrier, f.duplicate],
      [repository],
    );
    expect(result.limitations).toContain(
      "PR_duplicate: matching copied edits require authenticated retention acknowledgement",
    );
  });
}
