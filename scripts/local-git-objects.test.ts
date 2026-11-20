import { afterAll, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitHubClient } from "../workers/slopbot/github";
import { githubIngestionReadTransport } from "./github-ingestion-read";
import {
  type LocalGitObjects,
  localGitObjectsFromDirectory,
} from "./local-git-objects";

const fixtures = join(import.meta.dir, "../tests/fixtures/local-git-objects");
const temporary = mkdtempSync(join(tmpdir(), "slop-local-git-"));
const readers: LocalGitObjects[] = [];
afterAll(() => {
  for (const reader of readers) reader.close();
  rmSync(temporary, { recursive: true, force: true });
});

function bare(root: string, owner: string, name: string) {
  const gitDir = join(root, owner, `${name}.git`);
  mkdirSync(gitDir, { recursive: true });
  execFileSync("git", ["init", "--bare", "--quiet", gitDir]);
  return gitDir;
}

function git(gitDir: string, args: string[], input?: string | Buffer) {
  return execFileSync("git", ["--git-dir", gitDir, ...args], {
    input,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Ada Example",
      GIT_AUTHOR_EMAIL: "ada@example.com",
      GIT_AUTHOR_DATE: "1794088867 +0900",
      GIT_COMMITTER_NAME: "GitHub",
      GIT_COMMITTER_EMAIL: "noreply@github.com",
      GIT_COMMITTER_DATE: "1794088900 -0500",
    },
  })
    .toString("utf8")
    .trim();
}

function reader(root: string) {
  const objects = localGitObjectsFromDirectory(root);
  readers.push(objects);
  return objects;
}

async function body(objects: LocalGitObjects, path: string) {
  const bytes = await objects.read(new URL(`https://api.github.com${path}`));
  return bytes ? JSON.parse(new TextDecoder().decode(bytes)) : null;
}

// Real objects from SlopDotCash/slopdotcash and GitHub's recorded answers for
// them (20 November 2026): two signed GitHub web merges, a fork pull request
// head, a +0900 commit, a nested tree, its recursive listing and a subtree.
const recorded = JSON.parse(
  readFileSync(join(fixtures, "github-responses.json"), "utf8"),
) as { responses: Record<string, Record<string, unknown>> };
const realRoot = join(temporary, "real");
const realGit = bare(realRoot, "SlopDotCash", "slopdotcash");
git(
  realGit,
  ["unpack-objects", "-q"],
  readFileSync(join(fixtures, "objects.pack")),
);
const real = reader(realRoot);

test("local trees and commits equal GitHub's recorded answers", async () => {
  const paths = Object.keys(recorded.responses);
  expect(paths.filter((path) => path.includes("/git/trees/"))).toHaveLength(3);
  expect(paths.filter((path) => path.includes("/git/commits/"))).toHaveLength(
    4,
  );
  for (const path of paths) {
    const expected = { ...recorded.responses[path] };
    // GitHub's own records, not derived from the object; the local reader
    // omits them and no collector caller reads them.
    if (path.includes("/git/commits/")) {
      delete expected.node_id;
      delete expected.verification;
    }
    const local = await body(real, path);
    // Same keys in the same order, so retained proofs serialize identically.
    expect(JSON.stringify(local)).toBe(JSON.stringify(expected));
  }
  expect(real.stats.declined).toBe(0);
});

test("a request in other casing gets GitHub's canonical urls", async () => {
  const [path] = Object.keys(recorded.responses);
  const lower = path.replace(
    "SlopDotCash/slopdotcash",
    "slopdotcash/SLOPDOTCASH",
  );
  expect(JSON.stringify(await body(real, lower))).toBe(
    JSON.stringify(recorded.responses[path]),
  );
});

const synthetic = join(temporary, "synthetic");
const syntheticGit = bare(synthetic, "owner", "repo");
const blob = git(syntheticGit, ["hash-object", "-w", "--stdin"], "hello\n");
const link = git(syntheticGit, ["hash-object", "-w", "--stdin"], "target");
const inner = git(syntheticGit, ["mktree"], `100755 blob ${blob}\trun.sh\n`);
const root = git(
  syntheticGit,
  ["mktree"],
  `100644 blob ${blob}\ta.txt\n040000 tree ${inner}\tbin\n120000 blob ${link}\tlink\n`,
);
const commit = git(syntheticGit, [
  "commit-tree",
  root,
  "-m",
  "Subject\n\nBody",
]);
const objects = reader(synthetic);
const api = "https://api.github.com/repos/owner/repo";

test("a synthetic tree and commit have GitHub's shape", async () => {
  expect(
    await body(objects, `/repos/owner/repo/git/trees/${root}?recursive=1`),
  ).toEqual({
    sha: root,
    url: `${api}/git/trees/${root}`,
    tree: [
      {
        path: "a.txt",
        mode: "100644",
        type: "blob",
        sha: blob,
        size: 6,
        url: `${api}/git/blobs/${blob}`,
      },
      {
        path: "bin",
        mode: "040000",
        type: "tree",
        sha: inner,
        url: `${api}/git/trees/${inner}`,
      },
      {
        path: "bin/run.sh",
        mode: "100755",
        type: "blob",
        sha: blob,
        size: 6,
        url: `${api}/git/blobs/${blob}`,
      },
      {
        path: "link",
        mode: "120000",
        type: "blob",
        sha: link,
        size: 6,
        url: `${api}/git/blobs/${link}`,
      },
    ],
    truncated: false,
  });
  expect(
    await body(objects, `/repos/owner/repo/git/commits/${commit}`),
  ).toEqual({
    sha: commit,
    url: `${api}/git/commits/${commit}`,
    html_url: `https://github.com/owner/repo/commit/${commit}`,
    author: {
      name: "Ada Example",
      email: "ada@example.com",
      date: "2026-11-07T22:01:07Z",
    },
    committer: {
      name: "GitHub",
      email: "noreply@github.com",
      date: "2026-11-07T22:01:40Z",
    },
    tree: { sha: root, url: `${api}/git/trees/${root}` },
    message: "Subject\n\nBody",
    parents: [],
  });
});

test("anything not certain to match GitHub is left to the API", async () => {
  const submodule = git(
    syntheticGit,
    ["mktree"],
    `160000 commit ${commit}\tvendor\n100644 blob ${blob}\ta.txt\n`,
  );
  const raw = (header: string, message: string) =>
    git(
      syntheticGit,
      ["hash-object", "-t", "commit", "-w", "--stdin", "--literally"],
      `tree ${root}\nauthor A <a@b> 1 +0000\ncommitter A <a@b> 1 +0000\n${header}\n${message}`,
    );
  const encoded = raw("encoding ISO-8859-1\n", "x\n");
  const blankEnding = raw("", "x\n\n");
  const nonUtf8Name = git(
    syntheticGit,
    ["mktree", "-z"],
    Buffer.concat([
      Buffer.from(`100644 blob ${blob}\t`),
      Buffer.from([0xff, 0x41]),
      Buffer.from([0]),
    ]),
  );
  const before = objects.stats.declined;
  for (const path of [
    `/repos/owner/repo/git/trees/${submodule}`,
    `/repos/owner/repo/git/trees/${nonUtf8Name}`,
    `/repos/owner/repo/git/trees/${commit}`, // a commit, not a tree
    `/repos/owner/repo/git/commits/${root}`, // a tree, not a commit
    `/repos/owner/repo/git/commits/${encoded}`,
    `/repos/owner/repo/git/commits/${blankEnding}`,
    `/repos/owner/repo/git/trees/${"0".repeat(40)}`,
  ])
    expect(await body(objects, path)).toBeNull();
  expect(objects.stats.declined - before).toBe(7);
  for (const path of [
    `/repos/other/repo/git/trees/${root}`,
    `/repos/owner/repo/git/trees/${root}?recursive=0`,
    `/repos/owner/repo/git/commits/${commit}?recursive=1`,
    `/repos/owner/repo/git/blobs/${blob}`,
    `/repos/owner/repo/commits/${commit}`,
  ])
    expect(await body(objects, path)).toBeNull();
  expect(
    await objects.read(
      new URL(`https://example.com/repos/owner/repo/git/trees/${root}`),
    ),
  ).toBeNull();
});

test("the ingestion reader answers locally and reads GitHub on a miss", async () => {
  const urls: string[] = [];
  const transport = Object.assign(
    async (input: Parameters<typeof fetch>[0]) => {
      urls.push(String(input));
      return Response.json({ sha: blob, size: 6 });
    },
    { preconnect: fetch.preconnect },
  );
  const read = githubIngestionReadTransport(
    transport,
    undefined,
    undefined,
    undefined,
    {
      localGitObjects: objects,
    },
  );
  const client = GitHubClient.forToken("test-token", read);
  const tree = await client.get<{ sha: string }>(
    `/repos/owner/repo/git/trees/${root}`,
  );
  expect(tree?.sha).toBe(root);
  expect(urls).toEqual([]);
  await client.get(`/repos/owner/repo/git/blobs/${blob}`);
  await client.get(`/repos/owner/repo/git/trees/${"0".repeat(40)}`);
  expect(urls).toEqual([
    `${api}/git/blobs/${blob}`,
    `${api}/git/trees/${"0".repeat(40)}`,
  ]);
});
