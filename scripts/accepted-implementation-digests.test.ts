import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AcceptedImplementationSource,
  readAcceptedImplementationProofs,
} from "./accepted-implementation-digests";
import { changeDigest } from "./pull-request-git-files";
import { publicGitProcess } from "./value-merge-ingestion";

test("rewritten accepted work matches across branch trees only with complete native proof", async () => {
  const directory = await mkdtemp(join(tmpdir(), "slop-native-accepted-"));
  const git = (args: string[], input?: string) => {
    const command = publicGitProcess(directory, args);
    return execFileSync(command.file, command.args, {
      ...command.options,
      input,
      encoding: "utf8",
    }).trim();
  };
  const blob = (text: string) => git(["hash-object", "-w", "--stdin"], text);
  function commit(
    message: string,
    feature: string,
    parents: string[],
    advanced = false,
  ) {
    const entries = [`100644 blob ${blob(feature)}\tfeature.txt`];
    if (advanced) entries.push(`100644 blob ${blob("unrelated\n")}\tother.txt`);
    const tree = git(["mktree"], `${entries.join("\n")}\n`);
    const sha = git([
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
    return { sha, tree };
  }
  function source(
    id: string,
    head: { sha: string },
    accepted: { sha: string; tree: string },
    parents: { sha: string; tree: string }[],
  ): AcceptedImplementationSource {
    return {
      id,
      headSha: head.sha,
      mergeSha: accepted.sha,
      mergeParentShas: parents.map((parent) => parent.sha),
      mergeTreeSha: accepted.tree,
      firstParentTreeSha: parents[0].tree,
    };
  }

  try {
    git(["init", "--bare", "--template=", "--quiet"]);
    const unchanged = "existing\n";
    const change = `${unchanged}accepted\n`;
    const different = `${unchanged}different\n`;
    const base = commit("base", unchanged, []);
    const advanced = commit("advance branch", unchanged, [base.sha], true);
    const first = commit("original", change, [base.sha]);
    const later = commit("rewritten submission", change, [base.sha]);
    const squash = commit(
      "accept on advanced branch",
      change,
      [advanced.sha],
      true,
    );
    const merge = commit(
      "merge on advanced branch",
      change,
      [advanced.sha, later.sha],
      true,
    );
    const modified = commit(
      "accept a different result",
      different,
      [advanced.sha],
      true,
    );
    const empty = commit(
      "no accepted changes",
      unchanged,
      [advanced.sha],
      true,
    );
    const direct = source("PR_first", first, first, [base]);
    const rewritten = source("PR_later", later, squash, [advanced]);
    const merged = source("PR_merge", later, merge, [advanced, later]);
    const expected = await changeDigest(directory, base.tree, first.tree);
    const proof = await readAcceptedImplementationProofs(directory, [
      direct,
      source("PR_modified", later, modified, [advanced]),
      source("PR_wrongparent", later, squash, [base]),
      source("PR_wrongtree", later, { ...squash, tree: first.tree }, [
        advanced,
      ]),
      source("PR_empty", later, empty, [advanced]),
      { ...rewritten, id: "PR_missing", mergeSha: "a".repeat(40) },
      rewritten,
      merged,
    ]);
    expect(proof.digests).toEqual(
      new Map([
        [direct.id, expected],
        [rewritten.id, expected],
        [merged.id, expected],
      ]),
    );
    expect(proof.unavailable).toEqual(
      new Set(["PR_wrongparent", "PR_wrongtree", "PR_missing"]),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
