import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture, repository } from "../tests/value-binary-fixture";
import { collectValueEvidence } from "../workers/slopbot/value-evidence";
import type { EvidenceClient } from "../workers/slopbot/value-evidence-types";
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

test("native file recovery rejects a changed live source", async () =>
  example(async (x) => {
    x.source.pull.title = "changed";
    await expect(
      recoverValueSourceFiles(
        {
          evidence: x.evidence,
          policy: { sha: x.source.pull.base.sha, text: "fixture" },
        },
        x.client,
        x.repository,
        x.directory,
        repository,
      ),
    ).rejects.toThrow("Source changed");
  }));

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
