import type { EvidenceClient } from "./value-evidence";

interface Entry {
  path: string;
  mode: string;
  type: string;
  sha: string;
}

async function treeDigest(entries: Entry[]): Promise<string> {
  const encoder = new TextEncoder();
  const group = entries.map((e) => ({
    entry: e,
    name: e.path.slice(e.path.lastIndexOf("/") + 1),
  }));
  const compare = (a: Uint8Array, b: Uint8Array) => {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (a[i] !== b[i]) return a[i] - b[i];
    }
    return a.length - b.length;
  };
  group.sort((a, b) =>
    compare(
      encoder.encode(a.name + (a.entry.type === "tree" ? "/" : "\0")),
      encoder.encode(b.name + (b.entry.type === "tree" ? "/" : "\0")),
    ),
  );
  const chunks = group.map(({ entry, name }) => {
    const prefix = encoder.encode(`${entry.mode.replace(/^0/u, "")} ${name}\0`);
    const bytes = new Uint8Array(prefix.length + 20);
    bytes.set(prefix);
    bytes.set(
      Uint8Array.from(
        Array.from({ length: 20 }, (_, i) => entry.sha.slice(i * 2, i * 2 + 2)),
        (x) => Number.parseInt(x, 16),
      ),
      prefix.length,
    );
    return bytes;
  });
  const size = chunks.reduce((n, chunk) => n + chunk.length, 0);
  const header = encoder.encode(`tree ${size}\0`);
  const bytes = new Uint8Array(header.length + size);
  bytes.set(header);
  let offset = header.length;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const actual = [...new Uint8Array(await crypto.subtle.digest("SHA-1", bytes))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  return actual;
}

/** A complete, hash-verified Git tree proves absence as well as presence.
 * A missing HTTP response or a truncated tree can never prove a deletion. */
export async function readValueTree(
  client: EvidenceClient,
  repository: string,
  ref: string,
): Promise<Map<string, Entry> | null> {
  return (await readValueTreeProof(client, repository, ref))?.entries ?? null;
}

/** Retain the verified root identity without changing existing text evidence. */
export async function readValueTreeProof(
  client: EvidenceClient,
  repository: string,
  ref: string,
): Promise<{ treeSha: string; entries: Map<string, Entry> } | null> {
  const oid = /^[a-f0-9]{40}$/u;
  if (!oid.test(ref)) return null;
  const commit = await client.get<{ sha: string; tree: { sha: string } }>(
    `/repos/${repository}/git/commits/${ref}`,
  );
  if (commit?.sha !== ref || !oid.test(commit.tree?.sha ?? "")) return null;
  const result = await client.get<{
    sha: string;
    truncated: boolean;
    tree: Entry[];
  }>(`/repos/${repository}/git/trees/${commit.tree.sha}?recursive=1`);
  if (
    result?.sha !== commit.tree.sha ||
    result.truncated !== false ||
    !Array.isArray(result.tree) ||
    result.tree.length > 20_000
  )
    return null;
  const entries = new Map<string, Entry>();
  const children = new Map<string, Entry[]>();
  const modes: Record<string, string> = {
    "040000": "tree",
    "100644": "blob",
    "100755": "blob",
    "120000": "blob",
    "160000": "commit",
  };
  for (const entry of result.tree) {
    if (
      typeof entry.path !== "string" ||
      !entry.path ||
      entry.path.length > 1024 ||
      entry.path.includes("\\") ||
      [...entry.path].some(
        (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
      ) ||
      entry.path.split("/").some((p) => !p || p === "." || p === "..") ||
      entries.has(entry.path) ||
      !oid.test(entry.sha) ||
      modes[entry.mode] !== entry.type
    )
      return null;
    entries.set(entry.path, entry);
    const parent = entry.path
      .slice(0, entry.path.lastIndexOf("/") + 1)
      .replace(/\/$/u, "");
    const group = children.get(parent) ?? [];
    group.push(entry);
    children.set(parent, group);
  }
  for (const parent of children.keys()) {
    if (parent && entries.get(parent)?.type !== "tree") return null;
  }
  for (const [path, expected] of [
    ["", commit.tree.sha],
    ...result.tree.filter((e) => e.type === "tree").map((e) => [e.path, e.sha]),
  ]) {
    const actual = await treeDigest(children.get(path) ?? []);
    if (actual !== expected) return null;
  }
  return { treeSha: commit.tree.sha, entries };
}

/** Verify the complete tree at every ancestor of the requested paths. A
 * missing child in a verified parent proves absence without enumerating
 * unrelated subtrees. Budgets are per invocation, never per path. */
export async function readValuePaths(
  client: EvidenceClient,
  repository: string,
  ref: string,
  paths: string[],
): Promise<Map<string, Entry> | null> {
  const oid = /^[a-f0-9]{40}$/u;
  if (
    !oid.test(ref) ||
    !paths.length ||
    paths.length > 16 ||
    paths.some(
      (path) =>
        !path ||
        path.length > 1024 ||
        path.includes("\\") ||
        [...path].some(
          (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
        ) ||
        path.split("/").some((part) => !part || part === "." || part === ".."),
    )
  )
    return null;
  const commit = await client.get<{ sha: string; tree: { sha: string } }>(
    `/repos/${repository}/git/commits/${ref}`,
  );
  if (commit?.sha !== ref || !oid.test(commit.tree?.sha ?? "")) return null;
  const trees = new Map<string, Map<string, Entry>>();
  let total = 0;
  const result = new Map<string, Entry>();
  for (const path of paths) {
    let sha = commit.tree.sha;
    const parts = path.split("/");
    for (let depth = 0; depth < parts.length; depth++) {
      let children = trees.get(sha);
      if (!children) {
        const tree = await client.get<{
          sha: string;
          truncated: boolean;
          tree: Entry[];
        }>(`/repos/${repository}/git/trees/${sha}`);
        if (
          tree?.sha !== sha ||
          tree.truncated !== false ||
          !Array.isArray(tree.tree)
        )
          return null;
        total += tree.tree.length;
        if (total > 20_000) return null;
        children = new Map();
        for (const child of tree.tree) {
          if (
            !child.path ||
            child.path.length > 1024 ||
            child.path.includes("/") ||
            child.path.includes("\\") ||
            [...child.path].some(
              (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
            ) ||
            child.path === "." ||
            child.path === ".." ||
            children.has(child.path) ||
            !oid.test(child.sha) ||
            {
              "040000": "tree",
              "100644": "blob",
              "100755": "blob",
              "120000": "blob",
              "160000": "commit",
            }[child.mode] !== child.type
          )
            return null;
          children.set(child.path, child);
        }
        if ((await treeDigest(tree.tree)) !== sha) return null;
        trees.set(sha, children);
      }
      const child = children.get(parts[depth]);
      if (!child) break;
      if (depth === parts.length - 1) result.set(path, { ...child, path });
      else {
        if (child.type !== "tree") return null;
        sha = child.sha;
      }
    }
  }
  return result;
}
