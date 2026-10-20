/** Immutable public-source acquisition for VET-01; never checkout or execute input. */
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const MAX_BYTES = 64 * 1024 * 1024;
const MAX_FILES = 1024;
const SHA = /^[0-9a-f]{40}$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const hash = (bytes: Uint8Array, algorithm = "sha256") =>
  createHash(algorithm).update(bytes).digest("hex");
const object = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid GitHub object");
  return value as Record<string, unknown>;
};

export async function acquireRepository(input: {
  repository: string;
  commitSha: string;
  directory: string;
  fetch?: typeof fetch;
}): Promise<{ directory: string; inventorySha256: string }> {
  if (
    !REPOSITORY.test(input.repository) ||
    input.repository.split("/").some((part) => part === "." || part === "..") ||
    !SHA.test(input.commitSha)
  )
    throw new Error("An exact repository and commit SHA are required");
  const fetcher = input.fetch ?? fetch;
  let transferred = 0;
  const deadline = AbortSignal.timeout(120_000);
  const get = async (path: string, limit: number) => {
    const response = await fetcher(
      `https://api.github.com/repos/${input.repository}/git/${path}`,
      {
        method: "GET",
        redirect: "error",
        headers: {
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "user-agent": "slop-vetting-acquisition",
        },
        signal: AbortSignal.any([deadline, AbortSignal.timeout(15_000)]),
      },
    );
    if (!response.ok || response.body === null)
      throw new Error("Immutable source is unavailable");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        transferred += value.byteLength;
        if (size > limit || transferred > MAX_BYTES * 2)
          throw new Error("Source transfer limit exceeded");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    return object(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  };
  const commit = await get(`commits/${input.commitSha}`, 1024 * 1024);
  if (
    commit.sha !== input.commitSha ||
    !SHA.test(String(object(commit.tree).sha))
  )
    throw new Error("Commit pin mismatch");
  const treeSha = String(object(commit.tree).sha);
  const tree = await get(`trees/${treeSha}?recursive=1`, 4 * 1024 * 1024);
  if (
    tree.sha !== treeSha ||
    tree.truncated !== false ||
    !Array.isArray(tree.tree)
  )
    throw new Error("Incomplete commit tree");
  if (tree.tree.length > MAX_FILES)
    throw new Error("Source entry limit exceeded");
  const names = new Set<string>();
  const entries = tree.tree.map((value) => {
    const row = object(value);
    if (
      typeof row.path !== "string" ||
      row.path.length > 1024 ||
      row.path.startsWith("/") ||
      row.path.includes("\\") ||
      row.path
        .split("/")
        .some((part) => !part || part === "." || part === "..") ||
      [...row.path].some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ) ||
      names.has(row.path) ||
      !SHA.test(String(row.sha))
    )
      throw new Error("Invalid source tree path or digest");
    names.add(row.path);
    if (
      !(
        (row.type === "tree" && row.mode === "040000") ||
        (row.type === "commit" && row.mode === "160000") ||
        (row.type === "blob" &&
          ["100644", "100755", "120000"].includes(String(row.mode)))
      )
    )
      throw new Error("Unsupported source tree entry");
    return {
      path: row.path,
      gitSha: String(row.sha),
      type: String(row.type),
      mode: String(row.mode),
    };
  });
  const directories = new Set(
    entries.filter((entry) => entry.type === "tree").map((entry) => entry.path),
  );
  for (const entry of entries) {
    const separator = entry.path.lastIndexOf("/");
    if (separator !== -1 && !directories.has(entry.path.slice(0, separator)))
      throw new Error("Source entry is disconnected from its Git tree");
  }
  // Rebuild Git tree objects so omitted or altered members cannot keep the assigned tree SHA.
  for (const directory of [
    { path: "", gitSha: treeSha },
    ...entries.filter((entry) => entry.type === "tree"),
  ]) {
    const prefix = directory.path ? `${directory.path}/` : "";
    const children = entries.filter(
      (entry) =>
        entry.path.startsWith(prefix) &&
        !entry.path.slice(prefix.length).includes("/"),
    );
    children.sort((a, b) =>
      Buffer.compare(
        Buffer.from(
          a.path.slice(prefix.length) + (a.type === "tree" ? "/" : ""),
        ),
        Buffer.from(
          b.path.slice(prefix.length) + (b.type === "tree" ? "/" : ""),
        ),
      ),
    );
    const body = Buffer.concat(
      children.map((entry) =>
        Buffer.concat([
          Buffer.from(
            `${entry.mode.replace(/^0+/u, "")} ${entry.path.slice(prefix.length)}\0`,
          ),
          Buffer.from(entry.gitSha, "hex"),
        ]),
      ),
    );
    if (
      hash(
        Buffer.concat([Buffer.from(`tree ${body.length}\0`), body]),
        "sha1",
      ) !== directory.gitSha
    )
      throw new Error("Tree bytes do not match the Git object");
  }
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  // A unique private directory prevents a repository path from choosing a host path.
  const directory = await mkdtemp(
    join(resolve(input.directory), "slop-source-"),
  );
  try {
    await mkdir(join(directory, "objects"), { mode: 0o700 });
    let bytes = 0;
    const stored = new Set<string>();
    const records = [];
    const gaps = new Set([
      "execution-dependencies-and-release-assets-not-acquired",
      "skill-template-inputs-not-acquired",
      "runtime-and-model-review-not-performed",
    ]);
    for (const entry of entries) {
      if (entry.type === "tree") continue;
      if (entry.type === "commit") {
        gaps.add("submodule-source-not-acquired");
        records.push({
          ...entry,
          sha256: null,
          bytes: null,
          state: "quarantined",
        });
        continue;
      }
      const blob = await get(`blobs/${entry.gitSha}`, 12 * 1024 * 1024);
      if (
        blob.sha !== entry.gitSha ||
        blob.encoding !== "base64" ||
        typeof blob.content !== "string" ||
        !Number.isSafeInteger(blob.size) ||
        (blob.size as number) < 0 ||
        (blob.size as number) > 8 * 1024 * 1024
      )
        throw new Error("Invalid immutable blob");
      const encoded = blob.content.replaceAll("\n", "");
      const content = Buffer.from(encoded, "base64");
      if (
        content.toString("base64") !== encoded ||
        content.length !== blob.size ||
        hash(
          Buffer.concat([Buffer.from(`blob ${content.length}\0`), content]),
          "sha1",
        ) !== entry.gitSha
      )
        throw new Error("Blob bytes do not match the Git object");
      bytes += content.length;
      if (bytes > MAX_BYTES) throw new Error("Source byte limit exceeded");
      const sha256 = hash(content);
      if (!stored.has(sha256)) {
        await writeFile(join(directory, "objects", sha256), content, {
          mode: 0o400,
          flag: "wx",
        });
        stored.add(sha256);
      }
      if (entry.mode === "120000") gaps.add("symbolic-link-not-followed");
      if (
        content
          .subarray(0, 80)
          .toString()
          .startsWith("version https://git-lfs.github.com/spec/v1")
      )
        gaps.add("lfs-object-not-acquired");
      records.push({
        ...entry,
        sha256,
        bytes: content.length,
        state: "quarantined",
      });
    }
    const inventory = Buffer.from(
      JSON.stringify({
        schema: "slop-source-inventory-v1",
        repository: input.repository,
        commitSha: input.commitSha,
        treeSha,
        state: "quarantined",
        records,
        visibilityGaps: [...gaps].sort(),
      }),
    );
    await writeFile(join(directory, "inventory.json"), inventory, {
      mode: 0o400,
      flag: "wx",
    });
    return { directory, inventorySha256: hash(inventory) };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

if (import.meta.main) {
  const [repository, commitSha, directory] = process.argv.slice(2);
  if (!repository || !commitSha || !directory || process.argv.length !== 5)
    throw new Error(
      "Usage: bun workers/vetting/acquire.ts OWNER/REPO COMMIT PRIVATE_DIRECTORY",
    );
  try {
    console.log(
      JSON.stringify(
        await acquireRepository({ repository, commitSha, directory }),
      ),
    );
  } catch {
    console.error(
      "Source acquisition failed; no completed inventory was saved.",
    );
    process.exitCode = 1;
  }
}
