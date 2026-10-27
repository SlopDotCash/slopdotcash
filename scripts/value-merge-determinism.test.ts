import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import type { ValueEvidence } from "../workers/slopbot/value-evidence";
import { LEGACY_MERGE_PROFILE } from "../workers/slopbot/value-merge-profile";
import { collectMergeResolutions } from "./value-merge-resolution";

// Valid unrelated Git objects change Git's automatic hash abbreviation length.
// They must not change the retained proof for the same immutable merge.
function unrelatedObjects(count: number) {
  const header = Buffer.alloc(12);
  header.write("PACK");
  header.writeUInt32BE(2, 4);
  header.writeUInt32BE(count, 8);
  const chunks = [header];
  for (let index = 0; index < count; index++) {
    const bytes = Buffer.from(`unrelated fixture object ${index}\n`);
    let size = bytes.length;
    const objectHeader = [0x30 | (size & 15)];
    size >>>= 4;
    while (size) {
      objectHeader[objectHeader.length - 1] |= 0x80;
      objectHeader.push(size & 127);
      size >>>= 7;
    }
    chunks.push(Buffer.from(objectHeader), deflateSync(bytes));
  }
  const pack = Buffer.concat(chunks);
  return Buffer.concat([pack, createHash("sha1").update(pack).digest()]);
}

test("merge proof bytes do not depend on unrelated objects in the supplied bundle", async () => {
  const root = mkdtempSync(join(tmpdir(), "slop-merge-determinism-"));
  const compact = join(root, "compact.git");
  const expanded = join(root, "expanded.git");
  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: "Merge fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "Merge fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
    GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
  };
  const git = (repository: string, args: string[], input?: string | Buffer) =>
    execFileSync("git", ["--git-dir", repository, ...args], {
      env,
      input,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 20_000,
    }).trim();
  try {
    git(compact, ["init", "--bare", "--template=", compact]);
    git(expanded, ["init", "--bare", "--template=", expanded]);
    const tree = (text: string) => {
      const blob = git(compact, ["hash-object", "-w", "--stdin"], text);
      return git(compact, ["mktree"], `100644 blob ${blob}\twitness.txt\n`);
    };
    const commit = (text: string, parents: string[]) =>
      git(
        compact,
        ["commit-tree", tree(text), ...parents.flatMap((sha) => ["-p", sha])],
        "Synthetic merge fixture\n",
      );
    const base = commit("base\n", []);
    const left = commit("left\n", [base]);
    const right = commit("right\n", [base]);
    const merged = commit("resolved\n", [left, right]);
    writeFileSync(
      join(expanded, "objects/info/alternates"),
      `${compact}/objects\n`,
    );
    git(expanded, ["index-pack", "--stdin"], unrelatedObjects(70_000));
    const evidence = {
      pull: { head: { sha: merged } },
      files: [{ filename: "witness.txt" }],
      commits: [{ sha: merged, parents: [{ sha: left }, { sha: right }] }],
      commitAttribution: [],
    } as unknown as ValueEvidence;
    const first = await collectMergeResolutions(evidence, compact);
    const second = await collectMergeResolutions(evidence, expanded);
    expect(first.mergeResolutions?.[0].paths).toEqual(["witness.txt"]);
    expect(first.mergeResolutions?.[0].hadConflicts).toBe(true);
    expect(second.mergeResolutions).toEqual(first.mergeResolutions);
    expect(first.mergeResolutions?.[0].patch).toMatch(
      /\nindex [a-f0-9]{40}\.\.[a-f0-9]{40} 100644\n/u,
    );
    const legacy = await collectMergeResolutions(
      evidence,
      compact,
      LEGACY_MERGE_PROFILE,
    );
    const patchWithoutIndex = (patch?: string) =>
      patch?.replace(/^index .*$/gmu, "");
    expect(legacy.mergeResolutions?.[0].patch).toMatch(
      /\nindex [a-f0-9]{7}\.\.[a-f0-9]{7} 100644\n/u,
    );
    expect(patchWithoutIndex(legacy.mergeResolutions?.[0].patch)).toBe(
      patchWithoutIndex(first.mergeResolutions?.[0].patch),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
