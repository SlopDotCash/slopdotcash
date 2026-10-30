import { afterAll, beforeAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { AcquisitionRefusal, acquireRepository } from "./acquire";
import { inspectRepository, readAcquiredSource } from "./bounded-scan";

let root: string;
let repository: string;
let output: string;
let commitSha: string;
let server: ReturnType<typeof Bun.serve>;
const git = (cwd: string, ...args: string[]) => {
  const result = spawnSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    cwd,
    env: { PATH: process.env.PATH, HOME: root, GIT_CONFIG_NOSYSTEM: "1" },
  });
  if (result.status !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
};
const commit = (cwd: string, message: string) => {
  git(
    cwd,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "--no-gpg-sign",
    "-qm",
    message,
  );
  return git(cwd, "rev-parse", "HEAD");
};
const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
/** Everything a failed acquisition might leave behind in its parent. */
const leftovers = async () => (await readdir(output)).sort();

/** A loopback smart-HTTP server over the real `git http-backend`. */
async function httpBackend(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/moved/"))
    return Response.redirect(
      `http://127.0.0.1:${server.port}${url.pathname.slice("/moved".length)}${url.search}`,
      301,
    );
  const child = Bun.spawn(["git", "http-backend"], {
    env: {
      PATH: process.env.PATH ?? "",
      GIT_PROJECT_ROOT: root,
      GIT_HTTP_EXPORT_ALL: "1",
      PATH_INFO: url.pathname,
      QUERY_STRING: url.search.slice(1),
      REQUEST_METHOD: request.method,
      CONTENT_TYPE: request.headers.get("content-type") ?? "",
      GIT_PROTOCOL: request.headers.get("git-protocol") ?? "",
      REMOTE_ADDR: "127.0.0.1",
    },
    stdin: request.body ? new Uint8Array(await request.arrayBuffer()) : null,
    stdout: "pipe",
    stderr: "ignore",
  });
  const raw = Buffer.from(await new Response(child.stdout).arrayBuffer());
  const split = raw.indexOf("\r\n\r\n");
  const headers = new Headers();
  let status = 200;
  for (const line of raw.subarray(0, split).toString().split("\r\n")) {
    const [name, ...value] = line.split(": ");
    if (name.toLowerCase() === "status") status = Number.parseInt(value[0], 10);
    else headers.set(name, value.join(": "));
  }
  return new Response(raw.subarray(split + 4), { status, headers });
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "slop-acquisition-test-"));
  repository = join(root, "repo");
  output = join(root, "out");
  await mkdir(output);
  await mkdir(repository);
  git(repository, "init", "-q");
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
  await writeFile(
    join(repository, "model.bin"),
    "version https://git-lfs.github.com/spec/v1\noid sha256:00\nsize 1\n",
  );
  git(repository, "add", ".");
  // The scanner consumes Git objects, never a working-tree symlink. Record
  // the same real symlink blob without requiring Windows symlink privileges.
  const linkBytes = join(root, "link-bytes");
  await writeFile(linkBytes, "../../private");
  const linkOid = git(repository, "hash-object", "-w", linkBytes);
  git(
    repository,
    "update-index",
    "--add",
    "--cacheinfo",
    `120000,${linkOid},link`,
  );
  // A gitlink is recorded, never fetched.
  git(
    repository,
    "update-index",
    "--add",
    "--cacheinfo",
    `160000,${"1".repeat(40)},vendor/submodule`,
  );
  commitSha = commit(repository, "Harmless source fixture");
  // A hook in the served repository must not run either.
  await writeFile(
    join(repository, ".git", "hooks", "reference-transaction"),
    `#!/bin/sh\ntouch ${join(root, "executed")}\n`,
    { mode: 0o755 },
  );
  server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: httpBackend });
});
afterAll(async () => {
  server.stop(true);
  await rm(root, { recursive: true, force: true });
});

test("fetches the exact commit and stores inert objects without checkout, hooks, links or execution", async () => {
  // Hooks offered through the operator's own Git configuration are ignored.
  const hooks = join(root, "operator-hooks");
  await mkdir(hooks);
  for (const hook of ["reference-transaction", "post-checkout", "post-merge"])
    await writeFile(
      join(hooks, hook),
      `#!/bin/sh\ntouch ${join(root, "executed")}\n`,
      { mode: 0o755 },
    );
  const operatorConfig = join(root, "operator.gitconfig");
  await writeFile(
    operatorConfig,
    `[core]\n\thooksPath = ${hooks}\n[init]\n\ttemplateDir = ${root}\n`,
  );
  const previous = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = operatorConfig;
  let acquired: Awaited<ReturnType<typeof acquireRepository>>;
  try {
    acquired = await acquireRepository({
      repository: "fixture/repo",
      commitSha,
      directory: output,
      testRemote: `file://${repository}`,
    });
  } finally {
    if (previous === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = previous;
  }
  const inventory = JSON.parse(
    await readFile(join(acquired.directory, "inventory.json"), "utf8"),
  );
  expect(inventory.commitSha).toBe(commitSha);
  expect(inventory.treeSha).toBe(git(repository, "rev-parse", "HEAD^{tree}"));
  expect(
    inventory.records.map((row: { path: string }) => row.path).sort(),
  ).toEqual(
    [
      "link",
      "model.bin",
      "nested/payload.sh",
      "package.json",
      "vendor/submodule",
    ].sort(),
  );
  expect(
    inventory.records.every(
      (row: { state: string }) => row.state === "quarantined",
    ),
  ).toBe(true);
  expect(inventory.visibilityGaps).toEqual([
    "execution-dependencies-and-release-assets-not-acquired",
    "lfs-object-not-acquired",
    "runtime-and-model-review-not-performed",
    "skill-template-inputs-not-acquired",
    "submodule-source-not-acquired",
    "symbolic-link-not-followed",
  ]);
  const record = (path: string) =>
    inventory.records.find((row: { path: string }) => row.path === path);
  const payload = record("nested/payload.sh");
  expect(
    await readFile(join(acquired.directory, "objects", payload.sha256), "utf8"),
  ).toBe(await readFile(join(repository, "nested", "payload.sh"), "utf8"));
  expect(
    (await stat(join(acquired.directory, "objects", payload.sha256))).mode &
      0o777,
  ).toBe(process.platform === "win32" ? 0o444 : 0o400);
  // The link is its target bytes, never followed.
  expect(
    await readFile(
      join(acquired.directory, "objects", record("link").sha256),
      "utf8",
    ),
  ).toBe("../../private");
  expect(record("vendor/submodule")).toMatchObject({
    type: "commit",
    sha256: null,
  });
  expect((await readdir(acquired.directory)).sort()).toEqual([
    "inventory.json",
    "objects",
  ]);
  // The Git scratch store is gone; only the acquisition remains.
  expect(await leftovers()).toEqual([basename(acquired.directory)]);
  expect(await readdir(root)).not.toContain("executed");
  await rm(acquired.directory, { recursive: true, force: true });
});

test("same-commit file links retain alias coverage and provenance; unsafe targets stay gaps", async () => {
  const source = join(root, "links");
  await mkdir(join(source, "docs"), { recursive: true });
  git(source, "init", "-q");
  const rules = "Example API documentation: post API token with consent.\n";
  await writeFile(join(source, "AGENTS.md"), rules);
  await writeFile(join(source, "docs", "rules.txt"), rules);
  git(source, "add", ".");
  const link = async (path: string, target: string) => {
    const file = join(root, "link-target");
    await writeFile(file, target);
    const oid = git(source, "hash-object", "-w", file);
    git(
      source,
      "update-index",
      "--add",
      "--cacheinfo",
      `120000,${oid},${path}`,
    );
  };
  await link("CLAUDE.md", "AGENTS.md");
  await link("docs/CLAUDE.md", "../AGENTS.md");
  await link("README.md", "docs/rules.txt");
  await link("chain.md", "CLAUDE.md");
  const acquire = async (sha: string) =>
    acquireRepository({
      repository: "fixture/links",
      commitSha: sha,
      directory: output,
      testRemote: `file://${source}`,
    });
  const first = await acquire(commit(source, "Safe same-commit file aliases"));
  const original = await readAcquiredSource(first.directory);
  expect(original.acquisitionGaps).not.toContain("symbolic-link-not-followed");
  for (const [path, target] of [
    ["CLAUDE.md", "AGENTS.md"],
    ["docs/CLAUDE.md", "AGENTS.md"],
    ["README.md", "docs/rules.txt"],
    ["chain.md", "AGENTS.md"],
  ]) {
    const alias = original.files.find((file) => file.path === path);
    expect(new TextDecoder().decode(alias?.bytes)).toBe(rules);
    expect(alias?.symlink?.resolvedPath).toBe(target);
  }
  const inspected = inspectRepository(original);
  expect(inspected.findings).toContainEqual(
    expect.objectContaining({
      category: "prompt-injection",
      path: "README.md",
    }),
  );
  const item = JSON.parse(
    new TextDecoder().decode(inspected.inventory),
  ).items.find(
    (entry: { id: string }) => entry.id === "/slop-scan/symlink/CLAUDE.md",
  );
  expect(JSON.parse(item.text)).toMatchObject({
    path: "CLAUDE.md",
    target: "AGENTS.md",
    sha256: sha256(Buffer.from("AGENTS.md")),
    resolvedPath: "AGENTS.md",
    targetSha256: sha256(Buffer.from(rules)),
  });
  expect(item.sha256).toBe(sha256(Buffer.from(item.text)));
  // Same alias content with a different resolution path must not reuse a scan.
  await link("CLAUDE.md", "docs/rules.txt");
  const second = await acquire(commit(source, "Change alias topology only"));
  const changed = await readAcquiredSource(second.directory);
  expect(changed.files.map((file) => [file.path, sha256(file.bytes)])).toEqual(
    original.files.map((file) => [file.path, sha256(file.bytes)]),
  );
  expect(inspectRepository(changed).inventorySha256).not.toBe(
    inspected.inventorySha256,
  );
  for (const [path, target] of [
    ["absolute", join(root, "outside-secret")],
    ["escape", "../outside-secret"],
    ["missing", "absent.md"],
    ["cycle-a", "cycle-b"],
    ["cycle-b", "cycle-a"],
    ["directory", "docs"],
    ["through-directory-link", "directory/rules.txt"],
    ["gitlink", "submodule"],
    ["backslash", "docs\\rules.txt"],
    ["drive", "C:/rules.txt"],
    ["file-parent", "AGENTS.md/../AGENTS.md"],
  ])
    await link(path, target);
  git(
    source,
    "update-index",
    "--add",
    "--cacheinfo",
    `160000,${"1".repeat(40)},submodule`,
  );
  const third = await acquire(
    commit(source, "Unsafe targets remain unacquired"),
  );
  const unsafe = await readAcquiredSource(third.directory);
  expect(unsafe.acquisitionGaps).toContain("symbolic-link-not-followed");
  expect(
    unsafe.files.filter((file) => file.symlink).map((file) => file.path),
  ).toEqual(["CLAUDE.md", "README.md", "chain.md", "docs/CLAUDE.md"]);
  // All source paths remain metadata. There is never a filesystem alias.
  expect((await readdir(third.directory)).sort()).toEqual([
    "inventory.json",
    "objects",
  ]);
  const alias = changed.files.find((file) => file.path === "CLAUDE.md");
  const rawLink = join(
    second.directory,
    "objects",
    alias?.symlink?.sha256 ?? "",
  );
  await chmod(rawLink, 0o600);
  await writeFile(rawLink, "changed-link");
  await expect(readAcquiredSource(second.directory)).rejects.toThrow(
    "Acquired object bytes changed",
  );
  for (const acquired of [first, second, third])
    await rm(acquired.directory, { recursive: true, force: true });
});

test("a repository beyond the former 1,024-entry, 8 MiB-file and 64 MiB limits is acquired completely", async () => {
  const large = join(root, "large");
  await mkdir(join(large, "many"), { recursive: true });
  git(large, "init", "-q");
  for (let index = 0; index < 1100; index += 1)
    await writeFile(
      join(large, "many", `file-${String(index).padStart(4, "0")}.ts`),
      `export const value${index} = ${index};\n`,
    );
  // 72 MiB in one blob: larger than the old per-file and total caps. Its
  // varied lines keep the bytes distinct while Git still compresses them.
  const line = (index: number) =>
    `${String(index).padStart(10, "0")} ${"x".repeat(53)}\n`;
  const big = Buffer.from(
    Array.from({ length: (72 * 1024 * 1024) / 64 }, (_, index) =>
      line(index),
    ).join(""),
  );
  await writeFile(join(large, "big.txt"), big);
  git(large, "add", ".");
  const largeCommit = commit(large, "Large fixture");
  const started = performance.now();
  const acquired = await acquireRepository({
    repository: "fixture/large",
    commitSha: largeCommit,
    directory: output,
    testRemote: `file://${large}`,
  });
  const elapsed = performance.now() - started;
  const inventory = JSON.parse(
    await readFile(join(acquired.directory, "inventory.json"), "utf8"),
  );
  // 1,100 files, the big file and the directory: 1,102 tree entries.
  expect(inventory.records).toHaveLength(1101);
  const bigRecord = inventory.records.find(
    (row: { path: string }) => row.path === "big.txt",
  );
  expect(bigRecord.bytes).toBe(big.length);
  expect(bigRecord.sha256).toBe(sha256(big));
  expect(
    sha256(
      await readFile(join(acquired.directory, "objects", bigRecord.sha256)),
    ),
  ).toBe(sha256(big));
  expect(
    inventory.records.reduce(
      (total: number, row: { bytes: number }) => total + row.bytes,
      0,
    ),
  ).toBeGreaterThan(64 * 1024 * 1024);
  expect(elapsed).toBeLessThan(60_000);
  await rm(acquired.directory, { recursive: true, force: true });
}, 120_000);

test("loopback smart HTTP acquires; a redirect, a missing commit and a corrupt object leave nothing", async () => {
  const served = await acquireRepository({
    repository: "fixture/repo",
    commitSha,
    directory: output,
    testRemote: `http://127.0.0.1:${server.port}/repo/.git`,
  });
  expect(
    JSON.parse(await readFile(join(served.directory, "inventory.json"), "utf8"))
      .commitSha,
  ).toBe(commitSha);
  await rm(served.directory, { recursive: true, force: true });
  const before = await leftovers();
  // Redirects are never followed, even to the same repository.
  await expect(
    acquireRepository({
      repository: "fixture/repo",
      commitSha,
      directory: output,
      testRemote: `http://127.0.0.1:${server.port}/moved/repo/.git`,
    }),
  ).rejects.toThrow();
  expect(await leftovers()).toEqual(before);
  await expect(
    acquireRepository({
      repository: "fixture/repo",
      commitSha: "2".repeat(40),
      directory: output,
      testRemote: `file://${repository}`,
    }),
  ).rejects.toThrow();
  expect(await leftovers()).toEqual(before);
  // A served object whose bytes no longer match its name.
  const corrupt = join(root, "corrupt");
  await mkdir(corrupt);
  git(corrupt, "init", "-q");
  await writeFile(join(corrupt, "file.txt"), "original\n");
  git(corrupt, "add", ".");
  const corruptCommit = commit(corrupt, "Corrupt fixture");
  const blob = git(corrupt, "rev-parse", "HEAD:file.txt");
  const objectPath = join(
    corrupt,
    ".git",
    "objects",
    blob.slice(0, 2),
    blob.slice(2),
  );
  const other = join(root, "other");
  await mkdir(other);
  git(other, "init", "-q");
  await writeFile(join(other, "file.txt"), "changed\n");
  git(other, "add", ".");
  const changed = git(other, "rev-parse", ":file.txt");
  await rm(objectPath, { force: true });
  await writeFile(
    objectPath,
    await readFile(
      join(other, ".git", "objects", changed.slice(0, 2), changed.slice(2)),
    ),
  );
  await expect(
    acquireRepository({
      repository: "fixture/corrupt",
      commitSha: corruptCommit,
      directory: output,
      testRemote: `file://${corrupt}`,
    }),
  ).rejects.toThrow();
  expect(await leftovers()).toEqual(before);
});

test("an invalid tree path is a policy refusal; only a local or loopback test remote is accepted", async () => {
  const odd = join(root, "odd");
  await mkdir(odd);
  git(odd, "init", "-q");
  const blob = spawnSync("git", ["hash-object", "-w", "--stdin"], {
    cwd: odd,
    input: "content\n",
  })
    .stdout.toString()
    .trim();
  const tree = spawnSync("git", ["mktree"], {
    cwd: odd,
    input: `100644 blob ${blob}\tbad\u0001name\n`,
  })
    .stdout.toString()
    .trim();
  const oddCommit = spawnSync(
    "git",
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit-tree",
      tree,
      "-m",
      "Odd path",
    ],
    { cwd: odd },
  )
    .stdout.toString()
    .trim();
  git(odd, "update-ref", "refs/heads/main", oddCommit);
  const before = await leftovers();
  const refusal = await acquireRepository({
    repository: "fixture/odd",
    commitSha: oddCommit,
    directory: output,
    testRemote: `file://${odd}`,
  }).catch((error: unknown) => error);
  expect(refusal).toBeInstanceOf(AcquisitionRefusal);
  expect((refusal as AcquisitionRefusal).reason).toBe(
    "Invalid source tree path or digest",
  );
  expect(await leftovers()).toEqual(before);
  for (const testRemote of [
    "https://example.com/fixture/repo.git",
    "http://localhost:1/repo.git",
    "ssh://127.0.0.1/repo.git",
  ])
    await expect(
      acquireRepository({
        repository: "fixture/repo",
        commitSha,
        directory: output,
        testRemote,
      }),
    ).rejects.toThrow("A test remote must be file:// or loopback HTTP");
  await expect(
    acquireRepository({
      repository: "../repo",
      commitSha,
      directory: output,
    }),
  ).rejects.toBeInstanceOf(AcquisitionRefusal);
  expect(await leftovers()).toEqual(before);
});
