import { afterAll, beforeAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireRepository } from "./acquire";

let root: string;
let repository: string;
let commitSha: string;
let treeSha: string;
let entries: { mode: string; type: string; sha: string; path: string }[];
let corrupt: "none" | "blob" | "tree" | "orphan" | "redirect" = "none";
let server: ReturnType<typeof Bun.serve>;
const methods: string[] = [];
const git = (...args: string[]) => {
  const result = spawnSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    cwd: repository,
  });
  if (result.status !== 0) throw new Error(result.stderr.toString());
  return result.stdout;
};

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "slop-acquisition-test-"));
  repository = join(root, "repo");
  await mkdir(repository);
  git("init", "-q");
  await mkdir(join(repository, "nested"));
  await writeFile(
    join(repository, "nested", "payload.sh"),
    `#!/bin/sh\ntouch ${join(root, "executed")}\n`,
    { mode: 0o755 },
  );
  await writeFile(
    join(repository, "package.json"),
    JSON.stringify({
      scripts: { preinstall: `touch ${join(root, "executed")}` },
    }),
  );
  await symlink("../../private", join(repository, "link"));
  git("add", ".");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "--no-gpg-sign",
    "-qm",
    "Harmless source fixture",
  );
  commitSha = git("rev-parse", "HEAD").toString().trim();
  treeSha = git("rev-parse", "HEAD^{tree}").toString().trim();
  entries = git("ls-tree", "-r", "-t", "HEAD")
    .toString()
    .trim()
    .split("\n")
    .map((line) => {
      const [head, path] = line.split("\t");
      const [mode, type, sha] = head.split(" ");
      return { mode, type, sha, path };
    });
  server = Bun.serve({
    port: 0,
    fetch(request) {
      methods.push(request.method);
      const path = new URL(request.url).pathname;
      if (corrupt === "redirect")
        return Response.redirect("https://example.invalid/", 302);
      if (path.endsWith(`/commits/${commitSha}`))
        return Response.json({ sha: commitSha, tree: { sha: treeSha } });
      if (path.endsWith(`/trees/${treeSha}`))
        return Response.json({
          sha: treeSha,
          truncated: false,
          tree:
            corrupt === "tree"
              ? entries.slice(1)
              : corrupt === "orphan"
                ? [
                    ...entries,
                    {
                      ...entries.find((entry) => entry.type === "blob"),
                      path: "missing/file",
                    },
                  ]
                : entries,
        });
      const sha = path.split("/").at(-1) ?? "";
      if (entries.some((entry) => entry.sha === sha && entry.type === "blob")) {
        const content = git("cat-file", "blob", sha);
        return Response.json({
          sha,
          encoding: "base64",
          size: content.length,
          content:
            corrupt === "blob"
              ? Buffer.from("changed").toString("base64")
              : content.toString("base64"),
        });
      }
      return new Response(null, { status: 404 });
    },
  });
});
afterAll(async () => {
  server.stop(true);
  await rm(root, { recursive: true, force: true });
});
const fetchFixture: typeof fetch = ((
  request: string | URL | Request,
  init?: RequestInit,
) => {
  const url = new URL(String(request));
  expect(url.origin).toBe("https://api.github.com");
  expect(init?.redirect).toBe("error");
  expect(new Headers(init?.headers).has("authorization")).toBe(false);
  return fetch(
    `http://localhost:${server.port}${url.pathname}${url.search}`,
    init,
  );
}) as typeof fetch;

test("acquires exact real Git objects without checkout, hooks, symlink following or execution", async () => {
  corrupt = "none";
  const acquired = await acquireRepository({
    repository: "fixture/repo",
    commitSha,
    directory: root,
    fetch: fetchFixture,
  });
  const inventory = JSON.parse(
    await readFile(join(acquired.directory, "inventory.json"), "utf8"),
  );
  expect(inventory.commitSha).toBe(commitSha);
  expect(inventory.treeSha).toBe(treeSha);
  expect(inventory.records).toHaveLength(3);
  expect(
    inventory.records.every(
      (row: { state: string }) => row.state === "quarantined",
    ),
  ).toBe(true);
  expect(inventory.visibilityGaps).toContain("symbolic-link-not-followed");
  const payload = inventory.records.find(
    (row: { path: string }) => row.path === "nested/payload.sh",
  );
  expect(
    await readFile(join(acquired.directory, "objects", payload.sha256), "utf8"),
  ).toBe(await readFile(join(repository, "nested", "payload.sh"), "utf8"));
  expect((await readdir(acquired.directory)).sort()).toEqual([
    "inventory.json",
    "objects",
  ]);
  expect(await readdir(root)).not.toContain("executed");
  expect(new Set(methods)).toEqual(new Set(["GET"]));
});

test("altered blobs, incomplete trees and redirects leave no completed acquisition", async () => {
  for (const mode of ["blob", "tree", "orphan", "redirect"] as const) {
    corrupt = mode;
    const before = await readdir(root);
    await expect(
      acquireRepository({
        repository: "fixture/repo",
        commitSha,
        directory: root,
        fetch: fetchFixture,
      }),
    ).rejects.toThrow();
    expect(await readdir(root)).toEqual(before);
  }
});
