import { expect, spyOn, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findRegisteredRepositoryById } from "../src/lib/repositories.mjs";
import { fixture, repository } from "../tests/value-binary-fixture";
import { publicationCommitPages } from "../workers/slopbot/value-commit-pages";
import { collectValueEvidence } from "../workers/slopbot/value-evidence";
import type { EvidenceClient } from "../workers/slopbot/value-evidence-types";
import { valueSourceDigest } from "../workers/slopbot/value-review";
import { loadValueInputs, type ValueInputProgress } from "./value-ingestion";
import * as valueMergeIngestion from "./value-merge-ingestion";
import {
  hydrateValueMergeSource,
  recoverValueSourceFiles,
} from "./value-merge-ingestion";

async function example(
  check: (data: Awaited<ReturnType<typeof setup>>) => Promise<void>,
) {
  const data = await setup();
  try {
    await check(data);
  } finally {
    rmSync(data.directory, { recursive: true, force: true });
  }
}
async function setup(mode = "100644", absent = false) {
  const directory = mkdtempSync(join(tmpdir(), "slop-native-files-"));
  const git = (args: string[], input?: Uint8Array | string) =>
    execFileSync("git", ["-C", directory, ...args], {
      input,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Fixture",
        GIT_AUTHOR_EMAIL: "fixture@example.invalid",
        GIT_COMMITTER_NAME: "Fixture",
        GIT_COMMITTER_EMAIL: "fixture@example.invalid",
      },
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  git(["init", "--bare", "--template="]);
  const body = Buffer.from("export const fixed = true;\n".repeat(25000));
  const binary = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0xff, 9]);
  const empty = git(["mktree"], "");
  const textSha = git(["hash-object", "-w", "--stdin"], body),
    binarySha = git(["hash-object", "-w", "--stdin"], binary);
  const tree = git(
    ["mktree"],
    absent
      ? ""
      : `100644 blob ${binarySha}\tcapture.webm\n${mode} blob ${textSha}\tfix.ts\n`,
  );
  const base = git(["commit-tree", empty], "base"),
    head = git(["commit-tree", tree, "-p", base], "head"),
    merged = git(["commit-tree", tree, "-p", base, "-p", head], "merge");
  const source = fixture({ direct: true });
  const originalHead = source.pull.head.sha,
    originalBase = source.pull.base.sha,
    originalMerged = source.pull.merge_commit_sha;
  if (!originalMerged) throw new Error("Missing fixture merge");
  source.pull.head.sha = head;
  source.pull.base.sha = base;
  source.pull.merge_commit_sha = merged;
  const map: Record<string, string> = {
    [originalHead]: head,
    [originalBase]: base,
    [originalMerged]: merged,
  };
  const reverse = Object.fromEntries(
    Object.entries(map).map(([a, b]) => [b, a]),
  );
  source.bind(base, new Map(), []);
  source.bind(
    head,
    new Map([
      ["fix.ts", body],
      ["capture.webm", binary],
    ]),
    [base],
  );
  source.bind(
    merged,
    new Map([
      ["fix.ts", body],
      ["capture.webm", binary],
    ]),
    [base, head],
  );
  source.files[0].additions = 25000;
  delete source.files[0].patch;
  const client: EvidenceClient = {
    ...source.client,
    async get<T>(path: string): Promise<T | null> {
      if (path.includes("/contents/")) return null;
      let requested = path;
      for (const [a, b] of Object.entries(reverse))
        requested = requested.replaceAll(a, b);
      const result = await source.client.get<unknown>(requested);
      if (result === null) return null;
      const normalized = JSON.parse(
        JSON.stringify(result, (_key, value) =>
          typeof value === "string" ? (map[value] ?? value) : value,
        ),
      );
      if (path.includes("/commits/") && !path.includes("/git/"))
        normalized.stats = { additions: 25000, deletions: 0, total: 25000 };
      return normalized as T;
    },
  };
  const evidence = await collectValueEvidence(
    client,
    repository.id,
    1,
    repository,
  );
  return {
    directory,
    source,
    client,
    evidence,
    body,
    head,
    repository: {
      id: 42,
      node_id: "R_binary",
      private: false,
      full_name: repository.id,
    },
  };
}

test("native public objects recover complete text and binary through the normal collector", async () =>
  example(async (x) => {
    expect(
      x.evidence.limitations.some((l) => l.startsWith("Full diff required")),
    ).toBe(true);
    const recovered = await recoverValueSourceFiles(
      {
        evidence: x.evidence,
        policy: { sha: x.source.pull.base.sha, text: "fixture" },
      },
      x.client,
      x.repository,
      x.directory,
      repository,
    );
    expect(recovered.evidence.limitations).toEqual([]);
    expect(recovered.evidence.files[0].patch?.split("\n").length).toBe(25001);
    expect(recovered.evidence.files[1].addedBinary?.headSha).toBe(x.head);
    expect(recovered.evidence.pull).toEqual(x.evidence.pull);
  }));

test("native recovery reuses exact commit pages and rechecks live PR evidence", async () =>
  example(async (x) => {
    const policy = { sha: x.source.pull.base.sha, text: "fixture" };
    const recover = (evidence: typeof x.evidence, client: EvidenceClient) =>
      recoverValueSourceFiles(
        { evidence, policy },
        client,
        x.repository,
        x.directory,
        repository,
      );
    const commitPage = /\/commits\/[a-f0-9]{40}\?per_page=100&page=/u;
    const beforeLive = x.source.calls.length;
    const live = await recover(x.evidence, x.client);
    const liveReads = x.source.calls.slice(beforeLive);
    const client = publicationCommitPages()(x.client);
    const initial = await collectValueEvidence(
      client,
      repository.id,
      1,
      repository,
    );
    expect(initial).toEqual({
      ...x.evidence,
      collectedAt: initial.collectedAt,
    });

    const beforeRecovery = x.source.calls.length;
    const recovered = await recover(initial, client);
    expect(recovered).toEqual({
      ...live,
      evidence: {
        ...live.evidence,
        collectedAt: recovered.evidence.collectedAt,
      },
    });
    const recoveryReads = x.source.calls.slice(beforeRecovery);
    expect(
      liveReads.filter((path) => commitPage.test(path)).length,
    ).toBeGreaterThan(0);
    expect(recoveryReads).toEqual(
      liveReads.filter((path) => !commitPage.test(path)),
    );

    x.source.pull.title = "changed";
    await expect(recover(initial, client)).rejects.toThrow("Source changed");
  }));

test("missing, invalid and failed commit pages are read again", async () => {
  const root = `/repos/${repository.id}`;
  const identity = { id: 42, node_id: "R_binary", private: false };
  const sha = "a".repeat(40);
  const path = `${root}/commits/${sha}?per_page=100&page=1`;
  const valid = {
    sha,
    html_url: `https://github.com/${repository.id}/commit/${sha}`,
    parents: [],
    stats: { additions: 0, deletions: 0, total: 0 },
    files: [],
  };
  let reads = 0;
  const failures = [
    null,
    { ...valid, sha: "b".repeat(40) },
    { ...valid, files: [null] },
  ];
  const client = publicationCommitPages()({
    async get<T>(request: string): Promise<T | null> {
      if (request === root) return identity as T;
      if (request !== path) throw new Error("Unexpected request");
      reads += 1;
      if (reads === 1) throw new Error("Unavailable");
      return (reads <= 4 ? failures[reads - 2] : valid) as T | null;
    },
  });
  await client.get(root);
  await expect(client.get(path)).rejects.toThrow("Unavailable");
  for (const response of failures)
    expect(await client.get<object>(path)).toEqual(response);
  expect(await client.get<typeof valid>(path)).toEqual(valid);
  const replay = await client.get<typeof valid>(path);
  expect(replay).toEqual(valid);
  if (!replay) throw new Error("Missing replay");
  replay.stats.total = 99;
  expect(await client.get<typeof valid>(path)).toEqual(valid);
  expect(reads).toBe(5);
});

function nativeAttribution(x: Awaited<ReturnType<typeof setup>>) {
  const target = findRegisteredRepositoryById("SlopDotCash/asi");
  if (!target?.expectedNodeId) throw new Error("Missing registered fixture");
  const reads: string[] = [];
  let changedOriginal = false;
  const pullId = (number: number) =>
    number === 1 ? "PR_original" : `PR_accepted_${number}`;
  const remap = <T>(value: T): T =>
    JSON.parse(
      JSON.stringify(value)
        .replaceAll(repository.id, target.id)
        .replaceAll('"R_binary"', JSON.stringify(target.expectedNodeId)),
    );
  const github = {
    ...x.source.client,
    async get<T>(path: string): Promise<T | null> {
      reads.push(path);
      const rawPath = path
        .replaceAll(`${target.owner}/${target.name}`, repository.id)
        .replaceAll(target.id, repository.id)
        .replace(/\/(pulls|issues)\/[24](?=\/|$)/gu, "/$1/1");
      const result = await x.client.get<unknown>(rawPath);
      if (result === null) return null;
      if (rawPath === `/repos/${repository.id}`)
        (result as { full_name: string }).full_name = target.id;
      const pullNumber = /\/pulls\/([124])$/u.exec(path)?.[1];
      if (pullNumber) {
        const pull = result as typeof x.source.pull;
        pull.number = Number(pullNumber);
        pull.node_id = pullId(pull.number);
        pull.html_url = `https://github.com/${target.id}/pull/${pullNumber}`;
        if (pull.number === 1) {
          Object.assign(pull, {
            merged_at: null,
            merge_commit_sha: null,
            merged_by: null,
          });
          if (changedOriginal) pull.title = "Changed original";
        }
      }
      if (/\/pulls\/[124]\/commits\?/u.test(path))
        for (const commit of result as { author: unknown }[])
          commit.author = null;
      return remap(result) as T;
    },
    async graphql<T>(
      _query: string,
      variables: Record<string, unknown>,
    ): Promise<T> {
      const number = Number(variables.number);
      reads.push(`timeline:${number}`);
      return {
        repository: {
          pullRequest: {
            id: pullId(number),
            timelineItems: {
              nodes:
                number === 1
                  ? []
                  : [
                      {
                        source: {
                          __typename: "PullRequest",
                          id: pullId(1),
                          number: 1,
                          url: `https://github.com/${target.id}/pull/1`,
                          repository: {
                            nameWithOwner: target.id,
                            isPrivate: false,
                          },
                        },
                      },
                    ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      } as T;
    },
  };
  const transport = Object.assign(
    async () => {
      throw new Error("Historical attribution must not request value history");
    },
    { preconnect: fetch.preconnect },
  );
  const run = (onProgress?: (progress: ValueInputProgress) => void) =>
    loadValueInputs(
      github,
      [],
      transport,
      undefined,
      [2, 4].map((number) => ({
        id: pullId(number),
        number,
        baseRefName: "main",
        url: `https://github.com/${target.id}/pull/${number}`,
        headRefOid: x.source.pull.head.sha,
        mergedAt: x.source.pull.merged_at,
        updatedAt: x.source.pull.updated_at,
        commits: [
          {
            oid: number === 2 ? x.head : "d".repeat(40),
            author: null,
            parentCount: 1,
          },
        ],
      })),
      onProgress,
    );
  return { run, reads, target, changeOriginal: () => (changedOriginal = true) };
}

for (const changed of [false, true]) {
  test(`raw source-cache recovery ${changed ? "refuses changed live PR evidence" : "reuses immutable pages across source callers"}`, async () =>
    example(async (x) => {
      const f = nativeAttribution(x);
      const originalHydrations: {
        client: EvidenceClient;
        source: Parameters<typeof recoverValueSourceFiles>[0];
        recovered: Awaited<ReturnType<typeof recoverValueSourceFiles>>;
        reads: string[];
      }[] = [];
      // Keep native object verification while avoiding public acquisition in a fixture.
      const hydrate = spyOn(
        valueMergeIngestion,
        "hydrateValueMergeSource",
      ).mockImplementation(
        async (source, _recipe, identity, client, policy) => {
          if (!client || !policy)
            throw new Error("Missing native fixture client");
          const start = f.reads.length;
          const recovered = await recoverValueSourceFiles(
            source,
            client,
            identity,
            x.directory,
            policy,
          );
          if (source.evidence.pull.node_id === "PR_original")
            originalHydrations.push({
              client,
              source,
              recovered,
              reads: f.reads.slice(start),
            });
          return recovered;
        },
      );
      try {
        const result = f.run((progress) => {
          if (
            changed &&
            progress.phase === "commit-attributions" &&
            progress.completed === 1
          )
            f.changeOriginal();
        });
        if (changed) {
          await expect(result).rejects.toThrow("Source changed");
          expect(originalHydrations).toHaveLength(1);
          return;
        }
        const values = await result;
        expect(values.retainedCommitAuthors.size).toBe(0);
        expect([...values.implementationAttributionHolds.keys()]).toEqual([
          "PR_accepted_2",
          "PR_accepted_4",
        ]);
        expect(originalHydrations).toHaveLength(2);
        const [first, second] = originalHydrations;
        expect(second.client).not.toBe(first.client);
        expect(second.recovered).toEqual({
          ...first.recovered,
          evidence: {
            ...first.recovered.evidence,
            collectedAt: second.recovered.evidence.collectedAt,
          },
        });
        expect(
          await valueSourceDigest(
            second.recovered.evidence,
            second.recovered.policy,
          ),
        ).toBe(
          await valueSourceDigest(
            first.recovered.evidence,
            first.recovered.policy,
          ),
        );
        expect(second.source.evidence.files[0].patch).toBeUndefined();
        expect(
          second.recovered.evidence.limitations.some((problem) =>
            problem.startsWith("Full diff required:"),
          ),
        ).toBe(false);
        expect(
          second.recovered.evidence.files[0].patch?.split("\n"),
        ).toHaveLength(25001);
        const root = `/repos/${f.target.id}`;
        const commitPages = f.reads.filter((path) =>
          /\/commits\/[a-f0-9]{40}\?per_page=100&page=/u.test(path),
        );
        expect(commitPages.length).toBeGreaterThan(0);
        expect(new Set(commitPages).size).toBe(commitPages.length);
        expect(
          f.reads.filter(
            (path) => path === `${root}/pulls/1/commits?per_page=100&page=1`,
          ),
        ).toHaveLength(3);
        for (const path of [
          root,
          `${root}/pulls/1`,
          `${root}/pulls/1/commits?per_page=100&page=1`,
          `${root}/pulls/1/reviews?per_page=100&page=1`,
          `${root}/issues/1/comments?per_page=100&page=1`,
          `${root}/pulls/1/comments?per_page=100&page=1`,
          "timeline:1",
        ])
          for (const hydration of originalHydrations)
            expect(hydration.reads).toContain(path);
      } finally {
        hydrate.mockRestore();
      }
    }));
}

test("native file recovery rejects a foreign or private repository", async () =>
  example(async (x) => {
    for (const changed of [
      { ...x.repository, private: true },
      { ...x.repository, node_id: "wrong" },
      { ...x.repository, full_name: "foreign/repo" },
    ])
      await expect(
        recoverValueSourceFiles(
          {
            evidence: x.evidence,
            policy: { sha: x.source.pull.base.sha, text: "fixture" },
          },
          x.client,
          changed,
          x.directory,
          repository,
        ),
      ).rejects.toThrow("repository differs");
  }));

for (const mode of ["120000", "absent"]) {
  test(`native file recovery leaves ${mode} text unproven`, async () => {
    const x = await setup(mode, mode === "absent");
    try {
      const recovered = await recoverValueSourceFiles(
        {
          evidence: x.evidence,
          policy: { sha: x.source.pull.base.sha, text: "fixture" },
        },
        x.client,
        x.repository,
        x.directory,
        repository,
      );
      expect(
        recovered.evidence.limitations.some((line) => line.includes("fix.ts")),
      ).toBe(true);
    } finally {
      rmSync(x.directory, { recursive: true, force: true });
    }
  });
}

test("complete ordinary source needs no native recovery", async () =>
  example(async (x) => {
    const source = {
      evidence: { ...x.evidence, limitations: [] },
      policy: { sha: x.source.pull.base.sha, text: "fixture" },
    };
    expect(
      await hydrateValueMergeSource(
        source,
        undefined,
        x.repository,
        x.client,
        repository,
      ),
    ).toBe(source);
    await expect(
      hydrateValueMergeSource(
        source,
        { profile: "git-2.56.0-v2", inputSha256: "0".repeat(64) },
        x.repository,
        x.client,
        repository,
      ),
    ).rejects.toThrow("inputs differ");
  }));
