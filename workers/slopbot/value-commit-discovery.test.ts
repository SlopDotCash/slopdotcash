import { expect, test } from "bun:test";
import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import { GitHubError } from "./github";
import { sameRepositoryCommitHints } from "./value-commit-hints";
import type { EvidenceClient } from "./value-evidence";
import { collectRetainedMergeReferences } from "./value-retained-reference";

const repository = "example/toolkit";
const sha = "abcdef1234567890abcdef1234567890abcdef12";
const actor = { node_id: "maintainer", login: "maintainer", type: "User" };

function source(body: string) {
  return {
    repository,
    repositoryNodeId: "repository-node",
    repositoryDatabaseId: 42,
    pull: {
      node_id: "original-pr",
      number: 1,
      html_url: `https://github.com/${repository}/pull/1`,
      title: "Original change",
      body: null,
      user: actor,
      merged_by: null,
      state: "closed",
      merged_at: null,
      closed_at: "2026-10-01T00:00:00Z",
      merge_commit_sha: null,
      updated_at: "2026-10-01T00:00:00Z",
      head: { sha },
      base: { sha, ref: "main" },
      changed_files: 1,
      comments: 1,
      review_comments: 0,
      commits: 1,
    },
    comments: [
      {
        node_id: "acknowledgement",
        html_url: `https://github.com/${repository}/pull/1#issuecomment-1`,
        body,
        user: actor,
        created_at: "2026-10-02T00:00:00Z",
        updated_at: "2026-10-02T00:00:00Z",
      },
    ],
  };
}

for (const marker of [
  "elizaos-contribution-attribution:v2",
  "slop-contribution-attribution:v1",
]) {
  test(`retained merge discovery excludes ${marker} but binds the full acknowledgement`, async () => {
    // Both real failing sources included merge-related prose and ed25519 in
    // attribution. Neither the algorithm nor a skill revision names a merge.
    const body = `Merged as abcdef1 after the post-merge check.\n<!-- ${marker}\n{"signature_algorithm":"ed25519","receipt":"deadbee"}\n-->\n**Contribution skill revision**: fedcba9`;
    const evidence = source(body);
    const paths: string[] = [];
    const client: EvidenceClient = {
      async get<T>(path: string): Promise<T> {
        paths.push(path);
        if (path === `/repos/${repository}/commits/abcdef1`)
          return {
            sha,
            html_url: `https://github.com/${repository}/commit/${sha}`,
          } as T;
        const accepted = {
          number: 2,
          merged_at: "2026-10-01T12:00:00Z",
          merge_commit_sha: sha,
          merged_by: actor,
        };
        if (path === `/repos/${repository}/commits/${sha}/pulls?per_page=100`)
          return [accepted] as T;
        if (path === `/repos/${repository}/pulls/2`) return accepted as T;
        throw new Error(`Unexpected commit discovery: ${path}`);
      },
    };
    const result = await collectRetainedMergeReferences(client, evidence);
    expect(paths).toEqual([
      `/repos/${repository}/commits/abcdef1`,
      `/repos/${repository}/commits/${sha}/pulls?per_page=100`,
      `/repos/${repository}/pulls/2`,
    ]);
    expect(result).toEqual({
      references: [
        {
          commentNodeId: "acknowledgement",
          acknowledgementSha256: await sha256Hex(
            JSON.stringify([
              repository,
              evidence.repositoryNodeId,
              evidence.repositoryDatabaseId,
              evidence.pull.node_id,
              evidence.comments[0],
            ]),
          ),
          abbreviation: "abcdef1",
          commitSha: sha,
        },
      ],
      limitations: [],
    });
    expect(evidence.comments[0].body).toBe(body);
  });
}

test("commit discovery preserves prose and destination scope outside attribution", () => {
  expect(
    sameRepositoryCommitHints(
      repository,
      `ed25519 https://github.com/${repository}/commit/${sha} [deadbee](https://github.com/other/toolkit/commit/deadbee)`,
    ),
  ).toEqual(["ed25519", sha]);
});

test("a real commit provider failure still prevents retained merge collection", async () => {
  const failure = new GitHubError(503, "GitHub unavailable");
  const client: EvidenceClient = {
    async get() {
      throw failure;
    },
  };
  await expect(
    collectRetainedMergeReferences(client, source("Merged abcdef1")),
  ).rejects.toBe(failure);
});
