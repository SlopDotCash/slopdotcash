import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { correctionClaimCommit } from "../src/lib/points-implementation-corrections";
import { makeOriginal, repository } from "../tests/value-promotion-fixture";
import type { CombinedParentValueMergeResolution } from "../workers/slopbot/value-evidence-types";
import { mergeInput } from "../workers/slopbot/value-merge-profile";
import { mergeResolutionLineCounts } from "../workers/slopbot/value-merge-resolution";
import { prepareWorkUnitEvidence } from "../workers/slopbot/value-work-unit";
import { verifyMergeObjectStore } from "./value-merge-objects";
import {
  collectMergeResolutions,
  collectVerifiedMergeResolutions,
} from "./value-merge-resolution";

function fixture() {
  const path = mkdtempSync(join(tmpdir(), "slop-octopus-"));
  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_NAME: "Fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "Fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "init.defaultBranch",
    GIT_CONFIG_VALUE_0: "main",
  };
  const git = (args: string[], input?: string) =>
    execFileSync("git", ["--git-dir", path, ...args], {
      env,
      input,
      encoding: "utf8",
    }).trim();
  git(["init", "--bare", "--template=", path]);
  const tree = (text: string) =>
    git(
      ["mktree"],
      `100644 blob ${git(["hash-object", "-w", "--stdin"], text)}\tfix.ts\n`,
    );
  const baseTree = tree("common\n");
  const commit = (value: string, parents: string[], message: string) =>
    git(["commit-tree", value, ...parents.flatMap((p) => ["-p", p])], message);
  const base = commit(baseTree, [], "base");
  const parents = Array.from({ length: 9 }, (_, i) =>
    commit(baseTree, [base], `branch ${i}`),
  );
  const head = commit(tree("common\naccepted repair\n"), parents, "octopus");
  const source = makeOriginal();
  const native = {
    ...source.evidence.commits[0],
    sha: head,
    parents: parents.map((sha) => ({ sha })),
  };
  source.evidence.commits = [native];
  source.evidence.pull.head.sha = head;
  source.evidence.pull.commits = 1;
  source.evidence.pull.merged_at = "2026-10-27T00:00:00Z";
  source.evidence.pull.closed_at = source.evidence.pull.merged_at;
  source.evidence.pull.merge_commit_sha = head;
  source.evidence.commitAttribution = [];
  source.evidence.files[0].filename = "fix.ts";
  return { path, source, native };
}

test("canonical collector retains a nine-parent delta through work-unit and Points scope", async () => {
  const input = fixture();
  try {
    verifyMergeObjectStore([mergeInput(input.source.evidence)], input.path);
    const resolutions = await collectVerifiedMergeResolutions(
      mergeInput(input.source.evidence),
      input.path,
    );
    const evidence = {
      ...input.source.evidence,
      mergeResolutions: resolutions,
    };
    const resolution = evidence.mergeResolutions?.[0];
    expect(resolution?.kind).toBe("combined-parent-delta");
    if (resolution?.kind !== "combined-parent-delta") throw Error("fixture");
    expect(resolution.parents).toHaveLength(9);
    expect(resolution).not.toHaveProperty("automaticTree");
    expect(mergeResolutionLineCounts(resolution, input.native)).toEqual([
      { path: "fix.ts", additions: 1, deletions: 0 },
    ]);
    const grouped = await prepareWorkUnitEvidence(
      [{ ...input.source, evidence }],
      [repository],
    );
    expect(grouped.limitations).toEqual([]);
    expect(grouped.claims.map((claim) => claim.path)).toEqual(["fix.ts"]);
    expect(
      correctionClaimCommit({
        sha: input.native.sha,
        parentCount: 9,
        parentShas: input.native.parents.map((p) => p.sha),
        author: null,
        additions: null,
        deletions: null,
        firstAcceptedSourceId: input.source.evidence.pull.node_id,
        mergeResolution: resolution,
      }),
    ).toBe(true);
  } finally {
    rmSync(input.path, { recursive: true, force: true });
  }
});

for (const fault of [
  "order",
  "parent-tree",
  "blob",
  "mode",
  "truncated",
  "counter",
  "hash",
  "mixed-prefix",
  "overlapping-hunk",
] as const) {
  test(`combined-parent evidence refuses ${fault}`, async () => {
    const input = fixture();
    try {
      const evidence = await collectMergeResolutions(
        input.source.evidence,
        input.path,
      );
      const value = structuredClone(
        evidence.mergeResolutions?.[0],
      ) as CombinedParentValueMergeResolution;
      if (fault === "order") value.parents.reverse();
      if (fault === "parent-tree") value.parentTrees.pop();
      if (fault === "blob") value.files[0].parents[0].blobSha = "f".repeat(40);
      if (fault === "mode") value.files[0].result.mode = "120000";
      if (fault === "truncated") value.patch = value.patch.slice(0, -10);
      if (fault === "counter")
        value.patch = value.patch.replace(/\+1,2/, "+1,3");
      if (fault === "hash") value.patchSha256 = "0".repeat(64);
      if (fault === "mixed-prefix")
        value.patch = value.patch.replace(
          "+++++++++accepted",
          "+-+++++++accepted",
        );
      if (fault === "overlapping-hunk") {
        const start = value.patch.indexOf("@@@@@@@@@@ ");
        value.patch += value.patch.slice(start);
      }
      if (fault !== "hash")
        value.patchSha256 = createHash("sha256")
          .update(value.patch)
          .digest("hex");
      expect(mergeResolutionLineCounts(value, input.native)).toBeNull();
    } finally {
      rmSync(input.path, { recursive: true, force: true });
    }
  });
}

test("an octopus with a newly added path stays held until every parent snapshot is representable", async () => {
  const input = fixture();
  try {
    const parents = input.native.parents.map((parent) => parent.sha);
    const env = {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_AUTHOR_NAME: "Fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.invalid",
      GIT_COMMITTER_NAME: "Fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    };
    const git = (args: string[], text?: string) =>
      execFileSync("git", ["--git-dir", input.path, ...args], {
        env,
        input: text,
        encoding: "utf8",
      }).trim();
    const blob = git(["hash-object", "-w", "--stdin"], "new path\n");
    const old = git(["ls-tree", input.native.sha, "--", "fix.ts"]);
    const tree = git(["mktree"], `${old}\n100644 blob ${blob}\tnew.ts\n`);
    const head = git(
      ["commit-tree", tree, ...parents.flatMap((parent) => ["-p", parent])],
      "New path merge",
    );
    input.source.evidence.pull.head.sha = head;
    input.source.evidence.commits[0].sha = head;
    await expect(
      collectMergeResolutions(input.source.evidence, input.path),
    ).rejects.toThrow("complete regular-file snapshots");
  } finally {
    rmSync(input.path, { recursive: true, force: true });
  }
});

/** `git merge one two` from the base: a three-parent octopus whose two
 * branches edit different lines of one file. */
function threeParentOctopus(result: string) {
  const path = mkdtempSync(join(tmpdir(), "slop-octopus-three-"));
  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_NAME: "Fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "Fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "init.defaultBranch",
    GIT_CONFIG_VALUE_0: "main",
  };
  const git = (args: string[], text?: string) =>
    execFileSync("git", ["--git-dir", path, ...args], {
      env,
      input: text,
      encoding: "utf8",
    }).trim();
  git(["init", "--bare", "--template=", path]);
  const tree = (text: string) =>
    git(
      ["mktree"],
      `100644 blob ${git(["hash-object", "-w", "--stdin"], text)}\tfix.ts\n`,
    );
  const commit = (value: string, parents: string[], message: string) =>
    git(["commit-tree", value, ...parents.flatMap((p) => ["-p", p])], message);
  const base = commit(tree("a\nb\nc\nd\ne\n"), [], "base");
  const one = commit(tree("A\nb\nc\nd\ne\n"), [base], "branch one");
  const two = commit(tree("a\nb\nc\nd\nE\n"), [base], "branch two");
  const parents = [base, one, two];
  const head = commit(tree(result), parents, "octopus");
  const source = makeOriginal();
  const native = {
    ...source.evidence.commits[0],
    sha: head,
    parents: parents.map((sha) => ({ sha })),
  };
  source.evidence.commits = [native];
  source.evidence.pull.head.sha = head;
  source.evidence.pull.commits = 1;
  source.evidence.pull.merged_at = "2026-10-27T00:00:00Z";
  source.evidence.pull.closed_at = source.evidence.pull.merged_at;
  source.evidence.pull.merge_commit_sha = head;
  source.evidence.commitAttribution = [];
  source.evidence.files[0].filename = "fix.ts";
  return { path, source, native };
}

test("a clean three-parent octopus records no resolution edit", async () => {
  const input = threeParentOctopus("A\nb\nc\nd\nE\n");
  try {
    verifyMergeObjectStore([mergeInput(input.source.evidence)], input.path);
    const resolutions = await collectVerifiedMergeResolutions(
      mergeInput(input.source.evidence),
      input.path,
    );
    const resolution = resolutions[0];
    expect(resolutions).toHaveLength(1);
    if (resolution?.kind !== "combined-parent-delta") throw Error("fixture");
    expect(resolution.paths).toEqual([]);
    expect(resolution.patch).toBe("");
    expect(mergeResolutionLineCounts(resolution, input.native)).toEqual([]);
  } finally {
    rmSync(input.path, { recursive: true, force: true });
  }
});

test("a three-parent octopus keeps an edit absent from every parent", async () => {
  const input = threeParentOctopus("A\nb\nc\nresolved\nd\nE\n");
  try {
    verifyMergeObjectStore([mergeInput(input.source.evidence)], input.path);
    const resolutions = await collectVerifiedMergeResolutions(
      mergeInput(input.source.evidence),
      input.path,
    );
    const resolution = resolutions[0];
    if (resolution?.kind !== "combined-parent-delta") throw Error("fixture");
    expect(resolution.paths).toEqual(["fix.ts"]);
    expect(mergeResolutionLineCounts(resolution, input.native)).toEqual([
      { path: "fix.ts", additions: 1, deletions: 0 },
    ]);
  } finally {
    rmSync(input.path, { recursive: true, force: true });
  }
});
