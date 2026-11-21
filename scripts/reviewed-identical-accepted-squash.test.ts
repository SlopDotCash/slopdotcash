import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256Hex } from "../src/lib/sha256";
import {
  changeDigest,
  readPullRequestGitFiles,
} from "./pull-request-git-files";
import { verifyHistoricalIdenticalAcceptedChanges } from "./run-reviewed-historical-points";
import { publicGitProcess } from "./value-merge-ingestion";

for (const scenario of [
  "identical two-parent merges",
  "identical accepted squashes",
  "one shared multicommit acceptance",
  "different squash with the same line counts",
] as const) {
  test(`reviewed identical accepted changes check ${scenario}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "slop-identical-squash-"));
    function git(args: string[], input?: string) {
      const command = publicGitProcess(directory, args);
      return execFileSync(command.file, command.args, {
        ...command.options,
        encoding: "utf8",
        input,
      }).trim();
    }
    function commit(
      message: string,
      contents: string,
      parents: string[],
      unrelated = false,
    ) {
      const entries = [
        `100644 blob ${git(["hash-object", "-w", "--stdin"], contents)}\tfeature.txt`,
      ];
      if (unrelated)
        entries.push(
          `100644 blob ${git(["hash-object", "-w", "--stdin"], "other\n")}\tunrelated.txt`,
        );
      const tree = git(["mktree"], `${entries.join("\n")}\n`);
      return git([
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.test",
        "commit-tree",
        tree,
        ...parents.flatMap((parent) => ["-p", parent]),
        "-m",
        message,
      ]);
    }
    try {
      git(["init", "--bare", "--template=", "--quiet"]);
      const old = "existing\n";
      const changed = `${old}accepted\n`;
      const base = commit("base", old, []);
      const shared = scenario === "one shared multicommit acceptance";
      const laterBase = shared ? base : commit("later base", old, [base]);
      const laterParent = shared
        ? base
        : commit("advanced base", old, [laterBase], true);
      const earlierWork = commit("earlier submission", changed, [base]);
      const earlierHead = shared
        ? commit("submitter synchronization", changed, [earlierWork, base])
        : earlierWork;
      const laterHead = shared
        ? earlierHead
        : commit("later submission", changed, [laterBase]);
      const twoParent = shared || scenario === "identical two-parent merges";
      const earlierParents = twoParent ? [base, earlierHead] : [base];
      const laterParents = twoParent ? [laterParent, laterHead] : [laterParent];
      const earlierMerge = commit(
        "earlier acceptance",
        changed,
        earlierParents,
      );
      const laterMerge = shared
        ? earlierMerge
        : commit(
            "later acceptance",
            scenario === "different squash with the same line counts"
              ? `${old}different\n`
              : changed,
            laterParents,
            true,
          );
      const repository = {
        id: 1,
        node_id: "R_feed",
        private: false,
        full_name: "feedforagents/feed",
      };
      const pulls = [
        {
          number: 1,
          node_id: "PR_earlier",
          merged_at: "2026-10-04T00:00:00.000Z",
          base: { sha: base },
          head: { sha: earlierHead },
          merge_commit_sha: earlierMerge,
          commits: shared ? 2 : 1,
          changed_files: 1,
        },
        {
          number: 2,
          node_id: "PR_later",
          merged_at: "2026-10-04T01:00:00.000Z",
          base: { sha: laterBase },
          head: { sha: laterHead },
          merge_commit_sha: laterMerge,
          commits: shared ? 2 : 1,
          changed_files: 1,
        },
      ].map((pull) => ({
        ...pull,
        state: "closed",
        html_url: `https://github.com/${repository.full_name}/pull/${pull.number}`,
        user: { node_id: `actor_${pull.number}`, type: "User" as const },
      }));
      function correctionSource(pull: (typeof pulls)[number]) {
        return {
          repository: repository.full_name,
          repositoryNodeId: repository.node_id,
          sourceId: pull.node_id,
          sourceUrl: `https://github.com/${repository.full_name}/pull/${pull.number}`,
          occurredAt: pull.merged_at,
          headSha: pull.head.sha,
          author: {
            id: pull.user.node_id,
            login: `fixture-${pull.number}`,
            kind: pull.user.type,
          },
          complete: true,
          commitCount: pull.commits,
          commits: [
            {
              sha: shared ? earlierWork : pull.head.sha,
              parentCount: 1,
              parentShas: [pull.base.sha],
              author: null,
              additions: 1,
              deletions: 0,
              files: [{ path: "feature.txt", additions: 1, deletions: 0 }],
              firstAcceptedSourceId: pull.node_id,
            },
            ...(shared
              ? [
                  {
                    sha: earlierHead,
                    parentCount: 2,
                    parentShas: [earlierWork, base],
                    author: null,
                    additions: 0,
                    deletions: 0,
                    files: [],
                    firstAcceptedSourceId: pulls[0].node_id,
                  },
                ]
              : []),
          ],
        };
      }
      const retirement = {
        sourceId: pulls[1].node_id,
        workUnitId: "ordinary",
        source: correctionSource(pulls[1]),
        earlierSources: [correctionSource(pulls[0])],
        identicalAcceptedChange: {
          earlierSourceId: pulls[0].node_id,
          earlierMergeSha: earlierMerge,
          mergeSha: laterMerge,
          diffSha256: await changeDigest(directory, base, earlierMerge),
        },
        coverage: [],
        evidence: "",
        evidenceSha256: sha256Hex(""),
        expectedPredecessors: [],
      };
      const packet = {
        sourceAudit: {
          repository: repository.full_name,
          repositoryNodeId: repository.node_id,
          from: "2026-09-27T00:00:00.000Z",
          through: "2026-11-01T00:00:00.000Z",
          sources: pulls.map((pull) => ({
            id: pull.node_id,
            number: pull.number,
            headSha: pull.head.sha,
            mergedAt: pull.merged_at,
          })),
        },
        duplicateRetirements: [retirement],
      };
      const root = `/repos/${repository.full_name}`;
      const github = {
        async get<T>(path: string): Promise<T> {
          if (path === root) return repository as T;
          const pull = pulls.find(
            (candidate) => path === `${root}/pulls/${candidate.number}`,
          );
          if (!pull) throw new Error("Unexpected GitHub route");
          return pull as T;
        },
      };
      const proof = verifyHistoricalIdenticalAcceptedChanges(
        packet,
        github,
        async (_repository, _objects, read) => read(directory),
      );
      if (scenario === "different squash with the same line counts") {
        await expect(proof).rejects.toThrow(
          "Accepted Git file changes differ from the submitted source",
        );
      } else {
        expect(await proof).toEqual(
          new Set([sha256Hex(JSON.stringify(retirement))]),
        );
      }
      if (shared) {
        const priorBase = pulls[1].base.sha;
        pulls[1].base.sha = earlierWork;
        await expect(
          verifyHistoricalIdenticalAcceptedChanges(
            packet,
            github,
            async (_repo, _objects, read) => read(directory),
          ),
        ).rejects.toThrow("differing submitted bases");
        pulls[1].base.sha = priorBase;
        retirement.source.commits[1] = retirement.source.commits[0];
        await expect(
          verifyHistoricalIdenticalAcceptedChanges(
            packet,
            github,
            async (_repo, _objects, read) => read(directory),
          ),
        ).rejects.toThrow("incomplete submitted commits");
      }
      if (!twoParent)
        await expect(
          readPullRequestGitFiles(directory, {
            repository,
            head: laterHead,
            merge: {
              sha: laterMerge,
              parents: laterParents.map((sha) => ({ sha })),
            },
          }),
        ).rejects.toThrow(
          "File recovery requires an exact two-parent accepted merge",
        );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
