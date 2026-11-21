/** Exact deltas of complete single-commit PRs, read from public Git objects. */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { validRepositoryPath } from "../src/lib/project-contracts";
import { sha256Hex } from "../src/lib/sha256";
import { changeDigest } from "./pull-request-git-files";
import {
  type PublicMergeRepository,
  publicGitProcess,
} from "./value-merge-ingestion";

export type AcceptedImplementationSource = {
  id: string;
  headSha: string;
  mergeSha: string;
  mergeParentShas: string[];
  mergeTreeSha: string;
  firstParentTreeSha: string;
};

export interface AcceptedImplementationProofs {
  digests: ReadonlyMap<string, string>;
  unavailable: ReadonlySet<string>;
}

const OID = /^[a-f0-9]{40}$/u;
const EMPTY_CHANGE = sha256Hex("");
// At most 64 immutable tips per fetch. Depth two includes the accepted
// first parent and the submitted commit's parent; no ancestry walk is needed.
const FETCH_BATCH_SIZE = 32;
const run = promisify(execFile);

function git(directory: string, args: string[]) {
  const command = publicGitProcess(directory, args);
  return run(command.file, command.args, {
    ...command.options,
    encoding: "buffer",
    maxBuffer: 1024 * 1024,
  });
}

function eligibleSources(sources: readonly AcceptedImplementationSource[]) {
  const ids = new Map<string, number>();
  for (const { id } of sources) ids.set(id, (ids.get(id) ?? 0) + 1);
  return sources.filter((source) => {
    const { id, headSha, mergeSha, mergeParentShas, mergeTreeSha } = source;
    const [first, second] = mergeParentShas;
    return (
      id.length > 0 &&
      ids.get(id) === 1 &&
      (mergeParentShas.length === 1 ||
        (mergeParentShas.length === 2 && second === headSha)) &&
      first !== headSha &&
      first !== mergeSha &&
      [
        headSha,
        mergeSha,
        mergeTreeSha,
        source.firstParentTreeSha,
        ...mergeParentShas,
      ].every((oid) => OID.test(oid))
    );
  });
}

interface CommitHeader {
  tree: string;
  parents: string[];
}

async function readCommit(
  directory: string,
  oid: string,
): Promise<CommitHeader> {
  const { stdout } = await git(directory, ["cat-file", "commit", oid]);
  const actual = createHash("sha1")
    .update(`commit ${stdout.length}\0`)
    .update(stdout)
    .digest("hex");
  const boundary = stdout.indexOf("\n\n");
  if (actual !== oid || boundary < 0)
    throw new Error("Native commit identity is unavailable");
  // Raw headers retain actual parent edges even at a shallow boundary.
  const [treeLine, ...rest] = stdout
    .subarray(0, boundary)
    .toString("latin1")
    .split("\n");
  const tree = treeLine.startsWith("tree ") ? treeLine.slice(5) : "";
  const parents = rest
    .filter((line) => line.startsWith("parent "))
    .map((line) => line.slice(7));
  if (!OID.test(tree) || parents.some((parent) => !OID.test(parent)))
    throw new Error("Native commit header is invalid");
  return { tree, parents };
}

/** Read a caller's verified complete one-commit census from native objects. */
export async function readAcceptedImplementationProofs(
  directory: string,
  sources: readonly AcceptedImplementationSource[],
): Promise<AcceptedImplementationProofs> {
  const digests = new Map<string, string>();
  const unavailable = new Set(sources.map(({ id }) => id));
  const headers = new Map<string, Promise<CommitHeader>>();
  function header(oid: string) {
    const retained = headers.get(oid);
    if (retained) return retained;
    const read = readCommit(directory, oid);
    headers.set(oid, read);
    return read;
  }
  for (const source of eligibleSources(sources)) {
    try {
      const accepted = await header(source.mergeSha);
      if (
        accepted.tree !== source.mergeTreeSha ||
        accepted.parents.length !== source.mergeParentShas.length ||
        !accepted.parents.every(
          (parent, index) => parent === source.mergeParentShas[index],
        )
      )
        continue;
      const submitted = await header(source.headSha);
      if (
        submitted.parents.length !== 1 ||
        (source.mergeSha === source.headSha &&
          accepted.parents[0] !== submitted.parents[0])
      )
        continue;
      const first = await header(accepted.parents[0]);
      if (first.tree !== source.firstParentTreeSha) continue;
      const submittedParent = await header(submitted.parents[0]);
      const digest = await changeDigest(directory, first.tree, accepted.tree);
      const sameChange =
        (first.tree === submittedParent.tree &&
          accepted.tree === submitted.tree) ||
        digest ===
          (await changeDigest(directory, submittedParent.tree, submitted.tree));
      // Two complete changes establish either equality or ineligibility.
      unavailable.delete(source.id);
      if (sameChange && digest !== EMPTY_CHANGE) digests.set(source.id, digest);
    } catch {
      // error-policy:J2 A missing native object is no proof for this source.
      // Raw Git diagnostics can contain repository content.
    }
  }
  return { digests, unavailable };
}

export async function readAcceptedImplementationDigests(
  directory: string,
  sources: readonly AcceptedImplementationSource[],
): Promise<ReadonlyMap<string, string>> {
  return (await readAcceptedImplementationProofs(directory, sources)).digests;
}

async function fetchBatch(
  directory: string,
  url: string,
  sources: readonly AcceptedImplementationSource[],
): Promise<void> {
  const tips = [
    ...new Set(sources.flatMap(({ headSha, mergeSha }) => [headSha, mergeSha])),
  ];
  try {
    await git(directory, [
      "fetch",
      "--no-tags",
      "--no-recurse-submodules",
      "--no-write-fetch-head",
      "--depth=2",
      "--filter=blob:none",
      url,
      ...tips,
    ]);
  } catch (error) {
    // A rejected object can spoil the whole batch. Isolate that failure;
    // connectivity and other failures would only repeat for every smaller batch.
    if (
      sources.length > 1 &&
      error instanceof Error &&
      "stderr" in error &&
      Buffer.isBuffer(error.stderr) &&
      /not our ref|unadvertised object/u.test(error.stderr.toString("utf8"))
    ) {
      const middle = Math.floor(sources.length / 2);
      await fetchBatch(directory, url, sources.slice(0, middle));
      await fetchBatch(directory, url, sources.slice(middle));
    }
  }
}

export async function loadAcceptedImplementationProofs(
  repository: Pick<PublicMergeRepository, "node_id" | "private" | "full_name">,
  sources: readonly AcceptedImplementationSource[],
): Promise<AcceptedImplementationProofs> {
  const name = repository.full_name;
  if (
    repository.private !== false ||
    typeof repository.node_id !== "string" ||
    !repository.node_id ||
    typeof name !== "string" ||
    !validRepositoryPath(name) ||
    name.split("/").some((part) => part === "." || part === "..")
  )
    throw new Error(
      "Accepted implementation proof requires a public repository",
    );
  const eligible = eligibleSources(sources);
  if (!eligible.length)
    return {
      digests: new Map(),
      unavailable: new Set(sources.map(({ id }) => id)),
    };
  const directory = await mkdtemp(join(tmpdir(), "slop-accepted-digests-"));
  try {
    await git(directory, ["init", "--bare", "--template=", "--quiet"]);
    const url = `https://github.com/${name}.git`;
    for (let start = 0; start < eligible.length; start += FETCH_BATCH_SIZE) {
      await fetchBatch(
        directory,
        url,
        eligible.slice(start, start + FETCH_BATCH_SIZE),
      );
    }
    return await readAcceptedImplementationProofs(directory, sources);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function loadAcceptedImplementationDigests(
  repository: Parameters<typeof loadAcceptedImplementationProofs>[0],
  sources: readonly AcceptedImplementationSource[],
): Promise<ReadonlyMap<string, string>> {
  return (await loadAcceptedImplementationProofs(repository, sources)).digests;
}
