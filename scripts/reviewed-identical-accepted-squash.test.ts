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
  "surviving carrier of an identical original merge",
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
      const surviving =
        scenario === "surviving carrier of an identical original merge";
      const laterBase =
        shared || surviving ? base : commit("later base", old, [base]);
      const laterParent =
        shared || surviving
          ? base
          : commit("advanced base", old, [laterBase], true);
      const earlierWork = commit("earlier submission", changed, [base]);
      const firstSubmission = shared
        ? commit("submitter synchronization", changed, [earlierWork, base])
        : earlierWork;
      const laterHead = shared
        ? firstSubmission
        : commit("later submission", changed, [laterBase]);
      const originalMerge = surviving
        ? commit("original accepted object", changed, [base, laterHead])
        : undefined;
      const earlierHead = originalMerge
        ? commit("carrier submission", changed, [originalMerge])
        : firstSubmission;
      const twoParent =
        shared || surviving || scenario === "identical two-parent merges";
      const earlierParents = twoParent ? [base, earlierHead] : [base];
      const laterParents = twoParent ? [laterParent, laterHead] : [laterParent];
      const earlierMerge = commit(
        "earlier acceptance",
        changed,
        earlierParents,
      );
      const laterMerge = shared
        ? earlierMerge
        : (originalMerge ??
          commit(
            "later acceptance",
            scenario === "different squash with the same line counts"
              ? `${old}different\n`
              : changed,
            laterParents,
            true,
          ));
      let branchTip = surviving
        ? commit(
            "later work on published branch",
            changed,
            [earlierMerge],
            true,
          )
        : earlierMerge;
      let commitAuthor = "actor_2";
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
          base: { sha: base, ref: "develop", repo: repository },
          head: { sha: earlierHead },
          merge_commit_sha: earlierMerge,
          commits: surviving ? 3 : shared ? 2 : 1,
          changed_files: 1,
        },
        {
          number: 2,
          node_id: "PR_later",
          merged_at: "2026-10-04T01:00:00.000Z",
          base: { sha: laterBase, ref: "develop", repo: repository },
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
        const author = {
          id: pull.user.node_id,
          login: `fixture-${pull.number}`,
          kind: pull.user.type,
        };
        return {
          repository: repository.full_name,
          repositoryNodeId: repository.node_id,
          sourceId: pull.node_id,
          sourceUrl: `https://github.com/${repository.full_name}/pull/${pull.number}`,
          occurredAt: pull.merged_at,
          headSha: pull.head.sha,
          author,
          complete: true,
          commitCount: pull.commits,
          commits:
            surviving && pull.number === 1
              ? git(["rev-list", "--parents", pull.head.sha, `^${base}`])
                  .split("\n")
                  .map((row) => {
                    const [sha, ...parentShas] = row.split(" ");
                    return {
                      sha,
                      parentShas,
                      parentCount: parentShas.length,
                      author: null,
                      additions: 0,
                      deletions: 0,
                      firstAcceptedSourceId: pull.node_id,
                    };
                  })
              : [
                  {
                    sha: shared ? earlierWork : pull.head.sha,
                    parentCount: 1,
                    parentShas: [pull.base.sha],
                    author: surviving ? author : null,
                    additions: 1,
                    deletions: 0,
                    files: [
                      { path: "feature.txt", additions: 1, deletions: 0 },
                    ],
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
      const retirement: NonNullable<
        import("./reviewed-historical-points").HistoricalPointsPacket["duplicateRetirements"]
      >[number] = {
        sourceId: pulls[1].node_id,
        workUnitId: "ordinary",
        source: correctionSource(pulls[1]),
        earlierSources: [correctionSource(pulls[0])],
        identicalAcceptedChange: {
          earlierSourceId: pulls[0].node_id,
          earlierMergeSha: earlierMerge,
          mergeSha: laterMerge,
          diffSha256: await changeDigest(directory, base, earlierMerge),
          ...(surviving ? { survivingCarrier: true as const } : {}),
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
          if (surviving && path === `${root}/git/ref/heads/develop`)
            return {
              ref: "refs/heads/develop",
              object: { sha: branchTip, type: "commit" },
            } as T;
          if (surviving && path === `${root}/commits/${laterHead}`)
            return {
              sha: laterHead,
              author: { node_id: commitAuthor, type: "User" },
            } as T;
          const pull = pulls.find(
            (candidate) => path === `${root}/pulls/${candidate.number}`,
          );
          if (!pull) throw new Error("Unexpected GitHub route");
          return structuredClone(pull) as T;
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
      if (surviving) {
        const beforeImportChecks: (() => Promise<void>)[] = [];
        const verify = (duringNative?: () => void) =>
          verifyHistoricalIdenticalAcceptedChanges(
            packet,
            github,
            async (_repository, objects, read) => {
              if (retirement.identicalAcceptedChange?.survivingCarrier)
                expect(objects).toContain(branchTip);
              const result = await read(directory);
              duringNative?.();
              return result;
            },
            { integrationBranch: "develop", beforeImportChecks },
          );
        const published = branchTip;
        const moved = commit("carrier as side parent", changed, [
          laterMerge,
          earlierMerge,
        ]);
        await expect(verify()).resolves.toHaveProperty("size", 1);
        expect(beforeImportChecks).toHaveLength(1);
        await expect(
          verify(() => {
            branchTip = moved;
          }),
        ).rejects.toThrow("integration branch changed");
        await expect(beforeImportChecks[0]()).rejects.toThrow(
          "integration branch changed",
        );
        await expect(verify()).rejects.toThrow("published first-parent edge");
        branchTip = published;
        commitAuthor = "other_actor";
        await expect(verify()).rejects.toThrow(
          "original commit author changed",
        );
        commitAuthor = "actor_2";
        if (!retirement.identicalAcceptedChange)
          throw Error("Missing fixture proof");
        delete retirement.identicalAcceptedChange.survivingCarrier;
        await expect(verify()).rejects.toThrow("already carries");
      }
      if (shared) {
        const thirdPull = {
          ...structuredClone(pulls[1]),
          number: 3,
          node_id: "PR_third",
          html_url: `https://github.com/${repository.full_name}/pull/3`,
          merged_at: "2026-10-04T02:00:00.000Z",
        };
        pulls.push(thirdPull);
        const third = {
          ...retirement,
          sourceId: thirdPull.node_id,
          source: correctionSource(thirdPull),
        };
        const batch = {
          sourceAudit: {
            ...packet.sourceAudit,
            sources: [
              ...packet.sourceAudit.sources,
              {
                id: thirdPull.node_id,
                number: thirdPull.number,
                headSha: thirdPull.head.sha,
                mergedAt: thirdPull.merged_at,
              },
            ],
          },
          duplicateRetirements: [retirement, third],
        };
        let acquisitions = 0;
        expect(
          await verifyHistoricalIdenticalAcceptedChanges(
            batch,
            github,
            async (_repo, objects, read) => {
              acquisitions++;
              expect(objects.toSorted()).toEqual(
                [earlierMerge, earlierHead, base].toSorted(),
              );
              return read(directory);
            },
          ),
        ).toEqual(
          new Set(
            [retirement, third].map((item) => sha256Hex(JSON.stringify(item))),
          ),
        );
        expect(acquisitions).toBe(1);
        await expect(
          verifyHistoricalIdenticalAcceptedChanges(
            batch,
            github,
            async (_repo, _objects, read) => {
              const valid = await read(directory);
              thirdPull.base.sha = earlierWork;
              return valid;
            },
          ),
        ).rejects.toThrow("changed during verification");
        thirdPull.base.sha = base;
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
  }, 45_000);
}
