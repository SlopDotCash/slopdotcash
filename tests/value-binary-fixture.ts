import { createHash } from "node:crypto";
import type { TargetRepository } from "../src/lib/repositories.mjs";
import {
  collectValueEvidence,
  type FileChange,
} from "../workers/slopbot/value-evidence";

const base = "a".repeat(40);
const head = "b".repeat(40);
const merge = "c".repeat(40);
const bytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0xff, 9]);
const binaryPath = "capture.webm";
const repository: TargetRepository = {
  id: "example/binary-proof",
  owner: "example",
  name: "binary-proof",
  aliases: [],
  expectedNodeId: "R_binary",
  displayName: "Binary proof",
  githubUrl: "https://github.com/example/binary-proof",
  description: "Collector boundary fixture",
  integrationBranch: "main",
  projectId: "fixture",
  role: "primary",
};
const author = { node_id: "U_author", login: "author", type: "User" };
const submitter = { node_id: "U_submitter", login: "submitter", type: "User" };
const policy = {
  sha: base,
  text: "CONTRIBUTING.md\nRetain accepted source evidence.",
};
const hash = (type: string, content: Uint8Array) =>
  createHash("sha1")
    .update(`${type} ${content.length}\0`)
    .update(content)
    .digest("hex");
const clone = <T>(value: T): T => structuredClone(value);
function added(filename = binaryPath): FileChange {
  return {
    filename,
    status: "added",
    additions: 0,
    deletions: 0,
    blob_url: `https://github.com/${repository.id}/blob/${head}/${filename}`,
  };
}

/** These are synthetic Git/API bytes, not recorded provider/model output. */
function fixture(
  options: {
    direct?: boolean;
    differentAccepted?: boolean;
    textOnly?: boolean;
    binaryOnly?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const trees = new Map<string, unknown>();
  const commits = new Map<
    string,
    { sha: string; tree: { sha: string }; parents: { sha: string }[] }
  >();
  const contents = new Map<
    string,
    {
      type: string;
      encoding: string;
      content: string;
      size: number;
      sha: string;
    }
  >();
  const source = new Map<string, Uint8Array>();
  if (!options.binaryOnly)
    source.set(
      "fix.ts",
      new TextEncoder().encode("export const fixed = true;\n"),
    );
  if (!options.textOnly) source.set(binaryPath, bytes);
  const accepted = new Map(source);
  if (options.differentAccepted)
    accepted.set(binaryPath, new Uint8Array([0, 0xff, 8]));
  function tree(files: Map<string, Uint8Array>, mode = "100644") {
    const entries = [...files]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, data]) => ({
        path,
        mode,
        type: "blob",
        sha: hash("blob", data),
      }));
    const data = Buffer.concat(
      entries.flatMap((entry) => [
        Buffer.from(`${entry.mode} ${entry.path}\0`),
        Buffer.from(entry.sha, "hex"),
      ]),
    );
    const sha = hash("tree", data);
    trees.set(sha, { sha, truncated: false, tree: entries });
    return sha;
  }
  function bind(
    ref: string,
    files: Map<string, Uint8Array>,
    parents: string[],
    mode = "100644",
  ) {
    commits.set(ref, {
      sha: ref,
      tree: { sha: tree(files, mode) },
      parents: parents.map((sha) => ({ sha })),
    });
    for (const [path, data] of files)
      contents.set(`${path}?ref=${ref}`, {
        type: "file",
        encoding: "base64",
        content: Buffer.from(data).toString("base64"),
        size: data.length,
        sha: hash("blob", data),
      });
  }
  bind(base, new Map(), []);
  bind(head, source, [base]);
  bind(merge, accepted, options.direct ? [base, head] : [base]);
  const text: FileChange = {
    filename: "fix.ts",
    status: "added",
    additions: 1,
    deletions: 0,
    patch: "@@ -0,0 +1 @@\n+export const fixed = true;",
    blob_url: `https://github.com/${repository.id}/blob/${head}/fix.ts`,
  };
  const files = [
    ...(!options.binaryOnly ? [text] : []),
    ...(!options.textOnly ? [added()] : []),
  ];
  const pull = {
    node_id: "PR_binary",
    number: 1,
    html_url: `https://github.com/${repository.id}/pull/1`,
    title: "Retain regression recording",
    body: null as string | null,
    user: submitter,
    merged_by: author,
    state: "closed",
    merged_at: "2026-10-15T18:00:00Z",
    closed_at: "2026-10-15T18:00:00Z",
    merge_commit_sha: merge,
    updated_at: "2026-10-15T18:00:00Z",
    head: { sha: head },
    base: { sha: base, ref: "main" },
    changed_files: files.length,
    comments: 0,
    review_comments: 0,
    commits: 1,
  };
  const changes = (sha: string) => ({
    sha,
    html_url: `https://github.com/${repository.id}/commit/${sha}`,
    parents:
      sha === merge && options.direct
        ? [{ sha: base }, { sha: head }]
        : [{ sha: base }],
    stats: {
      additions: options.binaryOnly ? 0 : 1,
      deletions: 0,
      total: options.binaryOnly ? 0 : 1,
    },
    files: clone(files),
  });
  const client = {
    async get<T>(path: string): Promise<T | null> {
      calls.push(path);
      const root = `/repos/${repository.id}`;
      let result: unknown;
      if (path === root)
        result = { id: 42, node_id: repository.expectedNodeId, private: false };
      else if (path === `${root}/pulls/1`) result = pull;
      else if (path === `${root}/pulls/1/files?per_page=100&page=1`)
        result = files;
      else if (path === `${root}/pulls/1/commits?per_page=100&page=1`)
        result = [
          {
            ...changes(head),
            author,
            committer: author,
            commit: {
              message: "Fix behavior and retain recording",
              author: { date: "2026-10-15T17:00:00Z" },
              committer: { date: "2026-10-15T17:00:00Z" },
            },
          },
        ];
      else if (
        [
          `${root}/pulls/1/reviews?per_page=100&page=1`,
          `${root}/pulls/1/comments?per_page=100&page=1`,
          `${root}/issues/1/comments?per_page=100&page=1`,
        ].includes(path)
      )
        result = [];
      else if (path === `${root}/compare/${base}...${head}`)
        result = { merge_base_commit: { sha: base } };
      else if (path.startsWith(`${root}/commits/`))
        result = changes(path.slice(`${root}/commits/`.length).split("?")[0]);
      else if (path.startsWith(`${root}/git/commits/`))
        result = commits.get(path.slice(`${root}/git/commits/`.length)) ?? null;
      else if (path.startsWith(`${root}/git/trees/`))
        result =
          trees.get(path.slice(`${root}/git/trees/`.length).split("?")[0]) ??
          null;
      else if (path.startsWith(`${root}/contents/`))
        result =
          contents.get(
            decodeURIComponent(path.slice(`${root}/contents/`.length)),
          ) ?? null;
      else throw new Error(`Unexpected evidence read: ${path}`);
      return clone(result) as T | null;
    },
    async graphql<T>(): Promise<T> {
      return {
        repository: {
          pullRequest: {
            id: pull.node_id,
            timelineItems: {
              nodes: [],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      } as T;
    },
    async fileText(_owner: string, _repo: string, path: string) {
      return path === "CONTRIBUTING.md"
        ? { path, text: "Retain accepted source evidence.", truncated: false }
        : null;
    },
  };
  return { client, calls, commits, trees, contents, pull, files, bind };
}

async function collect(f = fixture()) {
  return collectValueEvidence(f.client, repository.id, 1, repository);
}

export { collect, fixture, policy, repository };
