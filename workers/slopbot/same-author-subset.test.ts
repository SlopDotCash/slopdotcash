import { expect, test } from "bun:test";
import {
  makeOriginal,
  integrated,
  repository,
  file,
} from "../../tests/value-promotion-fixture";
import { prepareWorkUnitEvidence } from "./value-work-unit";
import { retainedCopyBindings } from "./value-retained-copy";

function sources() {
  const original = makeOriginal();
  Object.assign(original.evidence.pull, {
    merged_at: null,
    merged_by: null,
    merge_commit_sha: null,
    closed_at: "2026-10-01T09:00:00Z",
  });
  original.evidence.mergeCommitEvidence = null;
  original.evidence.commits[0].author = null;
  original.evidence.commitAttribution[0].actorNodeIds = [];
  const accepted = structuredClone(original);
  Object.assign(accepted.evidence.pull, {
    node_id: "PR_accepted",
    number: 2,
    html_url: `https://github.com/${repository.id}/pull/2`,
    merged_at: "2026-10-02T09:00:00Z",
    closed_at: "2026-10-02T09:00:00Z",
    merged_by: original.evidence.pull.user,
    merge_commit_sha: integrated,
  });
  const copied = accepted.evidence.commits[0];
  copied.sha = "7".repeat(40);
  accepted.evidence.pull.head.sha = copied.sha;
  accepted.evidence.commitAttribution[0].sha = copied.sha;
  const extra = structuredClone(copied);
  extra.sha = "8".repeat(40);
  extra.parents = [{ sha: copied.sha }];
  accepted.evidence.commits.push(extra);
  accepted.evidence.pull.commits = 2;
  accepted.evidence.pull.head.sha = extra.sha;
  accepted.evidence.files.push({ ...file, filename: "extra.ts" });
  accepted.evidence.commitAttribution.push({
    sha: extra.sha,
    actorNodeIds: [],
    changedPaths: ["extra.ts"],
    files: [{ ...file, filename: "extra.ts" }],
    limitations: [],
  });
  original.evidence.relatedPullRequests = [
    {
      id: accepted.evidence.pull.node_id,
      number: 2,
      url: accepted.evidence.pull.html_url,
      repository: repository.id,
    },
  ];
  return { original, accepted };
}

test("same-author consolidation binds an exact partial reopen without inventing a merger acknowledgement", async () => {
  const { original, accepted } = sources();
  const result = await prepareWorkUnitEvidence(
    [original, accepted],
    [repository],
  );
  expect(result.limitations).toEqual([]);
  expect(result.sources).toHaveLength(2);
  expect(result.claims.filter((claim) => claim.retainedCopy)).toHaveLength(1);
  expect(
    result.claims.find((claim) => claim.retainedCopy)?.creditPullRequestId,
  ).toBe(original.evidence.pull.node_id);
  expect(
    (await retainedCopyBindings([original, accepted])).limitations.length,
  ).toBeGreaterThan(0);
});

for (const invalid of [
  "different-author",
  "different-creator",
  "later-original",
  "incomplete",
  "wrong-reference",
  "no-anchor",
  "bot",
] as const) {
  test(`same-author subset refuses ${invalid}`, async () => {
    const { original, accepted } = sources();
    if (invalid === "different-author")
      accepted.evidence.commits[0].author = {
        node_id: "U_other",
        login: "other",
        type: "User",
      };
    if (invalid === "different-creator")
      accepted.evidence.pull.user = {
        node_id: "U_other",
        login: "other",
        type: "User",
      };
    if (invalid === "later-original") original.evidence.pull.number = 3;
    if (invalid === "incomplete")
      original.evidence.limitations.push("Missing source");
    if (invalid === "wrong-reference")
      original.evidence.relatedPullRequests[0].id = "PR_other";
    if (invalid === "no-anchor")
      accepted.evidence.commitAttribution[0].files![0].patch += "\n+different";
    if (invalid === "bot")
      original.evidence.commits[0].author =
        accepted.evidence.commits[0].author = {
          node_id: "B_bot",
          login: "bot",
          type: "Bot",
        };
    const result = await prepareWorkUnitEvidence(
      [original, accepted],
      [repository],
    );
    if (invalid === "wrong-reference" || invalid === "no-anchor") {
      expect(
        result.claims.every((claim) => claim.retainedCopy === undefined),
      ).toBe(true);
    } else {
      expect(result.limitations.length).toBeGreaterThan(0);
    }
  });
}

test("a matching path cannot hide a different linked primary author", async () => {
  const { original, accepted } = sources();
  const second = structuredClone(original.evidence.commits[0]);
  second.sha = "9".repeat(40);
  second.parents = [{ sha: original.evidence.pull.head.sha }];
  second.author = { node_id: "U_owner", login: "owner", type: "User" };
  original.evidence.commits.push(second);
  original.evidence.pull.head.sha = second.sha;
  original.evidence.pull.commits++;
  original.evidence.files.push({ ...file, filename: "other.ts" });
  original.evidence.commitAttribution.push({
    sha: second.sha,
    actorNodeIds: ["U_owner"],
    changedPaths: ["other.ts"],
    files: [{ ...file, filename: "other.ts" }],
    limitations: [],
  });
  const copy = structuredClone(second);
  copy.sha = "a".repeat(40);
  copy.parents = [{ sha: accepted.evidence.pull.head.sha }];
  copy.author = { node_id: "U_different", login: "different", type: "User" };
  accepted.evidence.commits.push(copy);
  accepted.evidence.pull.head.sha = copy.sha;
  accepted.evidence.pull.commits++;
  accepted.evidence.files.push({ ...file, filename: "other.ts" });
  accepted.evidence.commitAttribution.push({
    sha: copy.sha,
    actorNodeIds: ["U_different"],
    changedPaths: ["other.ts"],
    files: [{ ...file, filename: "other.ts" }],
    limitations: [],
  });
  const result = await prepareWorkUnitEvidence(
    [original, accepted],
    [repository],
  );
  expect(result.limitations).toContain(
    "PR_original: retained primary author identity differs between commits",
  );
});
