/** Reconstruct a journal's server-verified merge recipe from public Git objects.
 * No checkout, model call, source execution or publication occurs here.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { canonicalJson } from "../src/lib/canonical-json";
import { validRepositoryPath } from "../src/lib/project-contracts";
import {
  findRegisteredRepositoryById,
  type TargetRepository,
} from "../src/lib/repositories.mjs";
import { collectValueEvidence } from "../workers/slopbot/value-evidence";
import type { EvidenceClient } from "../workers/slopbot/value-evidence-types";
import {
  VALUE_FILE_EXPANSION_LIMIT,
  validValueFileRequest,
} from "../workers/slopbot/value-file-recovery";
import {
  MERGE_GIT_VERSION,
  mergeInput,
  mergeRecipe,
  type ValueMergeRecipe,
  validMergeRecipe,
} from "../workers/slopbot/value-merge-profile";
import type { WorkUnitSource } from "../workers/slopbot/value-work-unit-types";
import { collectVerifiedMergeResolutions } from "./value-merge-resolution";

export interface PublicMergeRepository {
  id: number;
  node_id: string;
  private: boolean;
  full_name?: string;
}

const run = promisify(execFile);

/** The same isolated Git boundary is used for acquisition and object reads. */
export function publicGitProcess(directory: string, args: string[]) {
  return {
    file: "git",
    args: [
      "-c",
      "credential.helper=",
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "http.followRedirects=false",
      "-c",
      "fetch.fsckObjects=true",
      "-c",
      "protocol.allow=never",
      "-c",
      "protocol.https.allow=always",
      "-C",
      directory,
      ...args,
    ],
    options: {
      env: {
        PATH: process.env.PATH,
        LC_ALL: "C",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_ATTR_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
        GIT_NO_REPLACE_OBJECTS: "1",
        GIT_NO_LAZY_FETCH: "1",
        HOME: directory,
        XDG_CONFIG_HOME: directory,
      },
      timeout: 120_000,
    },
  };
}

export async function withPublicGitObjects<T>(
  repository: PublicMergeRepository,
  objects: string[],
  read: (directory: string) => Promise<T>,
): Promise<T> {
  const name = repository.full_name;
  if (
    repository.private !== false ||
    !Number.isSafeInteger(repository.id) ||
    repository.id <= 0 ||
    typeof repository.node_id !== "string" ||
    !repository.node_id ||
    typeof name !== "string" ||
    !validRepositoryPath(name) ||
    name.split("/").some((part) => part === "." || part === "..")
  )
    throw new Error(
      "Merge reconstruction requires the verified public repository",
    );

  if (!objects.length || !objects.every((sha) => /^[a-f0-9]{40}$/u.test(sha)))
    throw new Error("Invalid immutable merge object identity");

  const directory = await mkdtemp(
    join(tmpdir(), "slop-value-merge-ingestion-"),
  );
  try {
    const git = (...args: string[]) => {
      const command = publicGitProcess(directory, args);
      return run(command.file, command.args, {
        ...command.options,
        // The complete PR 1069 graph has 162,288 objects and 4 GB of required
        // changed blobs; PR 33708 has 514,352 objects and exceeded a two-minute
        // strict fsck deadline. Acquisition and verification both traverse
        // the complete object graph. Allow thirty minutes for either within
        // the release job's three-hour budget; other commands retain two minutes.
        timeout: ["fetch", "fsck"].includes(args[0])
          ? 1_800_000
          : command.options.timeout,
        maxBuffer: 1024 * 1024,
      });
    };
    if ((await git("--version")).stdout.trim() !== MERGE_GIT_VERSION)
      throw new Error("Required merge reconstruction Git version unavailable");
    await git("init", "--bare", "--template=");
    // Full ancestry and blobs are required for canonical merge-tree results.
    // Never use a shallow or lazy-fetch repository, credentials or redirects.
    await git(
      "fetch",
      "--no-tags",
      "--no-recurse-submodules",
      "--no-write-fetch-head",
      `https://github.com/${name}.git`,
      ...new Set(objects),
    );
    await git("fsck", "--full", "--strict", "--no-reflogs");
    return await read(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function hydrateValueMergeSource(
  source: WorkUnitSource,
  recipe: ValueMergeRecipe | undefined,
  repository: PublicMergeRepository,
  client?: EvidenceClient,
  repositoryPolicy?: TargetRepository,
): Promise<WorkUnitSource> {
  if (recipe !== undefined && !validMergeRecipe(recipe))
    throw new Error("Merge reconstruction inputs differ from the journal");
  if (
    repository.node_id !== source.evidence.repositoryNodeId ||
    repository.id !== source.evidence.repositoryDatabaseId
  )
    throw new Error(
      "Merge reconstruction requires the verified public repository",
    );
  const needsFiles = Boolean(
    client &&
      source.evidence.limitations.some(
        (problem) =>
          problem.startsWith("Full diff required:") ||
          problem.startsWith(
            "Added binary implementation identity is unavailable:",
          ) ||
          problem.startsWith("Added binary accepted identity is unavailable:"),
      ),
  );
  if (!recipe && !needsFiles) return source;
  if (
    recipe &&
    !needsFiles &&
    (await mergeRecipe(source.evidence)).inputSha256 !== recipe.inputSha256
  )
    throw new Error("Merge reconstruction inputs differ from the journal");
  const input = mergeInput(source.evidence);
  const objects = [
    input.pull.head.sha,
    source.evidence.pull.base.sha,
    ...(source.evidence.mergeCommitEvidence
      ? [
          source.evidence.mergeCommitEvidence.sha,
          ...source.evidence.mergeCommitEvidence.parents.map(
            (parent) => parent.sha,
          ),
        ]
      : []),
    ...input.commits.flatMap(({ sha, parents }) => [
      sha,
      ...parents.map((parent) => parent.sha),
    ]),
  ];
  return withPublicGitObjects(repository, objects, async (directory) => {
    let complete = source;
    if (client && needsFiles) {
      complete = await recoverValueSourceFiles(
        source,
        client,
        repository,
        directory,
        repositoryPolicy,
      );
    }
    if (!recipe) return complete;
    if (
      (await mergeRecipe(complete.evidence)).inputSha256 !== recipe.inputSha256
    )
      throw new Error("Merge reconstruction inputs differ from the journal");
    const mergeResolutions = await collectVerifiedMergeResolutions(
      mergeInput(complete.evidence),
      directory,
      recipe.profile,
    );
    return {
      ...complete,
      evidence: { ...complete.evidence, mergeResolutions },
      mergeRecipe: recipe,
    };
  });
}

/** Recollect through a verified public object store while retaining live source identity. */
export async function recoverValueSourceFiles(
  source: WorkUnitSource,
  client: EvidenceClient,
  repository: PublicMergeRepository,
  directory: string,
  repositoryPolicy: TargetRepository | null = findRegisteredRepositoryById(
    source.evidence.repository,
  ),
): Promise<WorkUnitSource> {
  if (
    repository.private !== false ||
    repository.id !== source.evidence.repositoryDatabaseId ||
    repository.node_id !== source.evidence.repositoryNodeId ||
    repository.full_name?.toLowerCase() !==
      source.evidence.repository.toLowerCase()
  )
    throw new Error("Immutable file recovery repository differs");
  const verified = Object.create(client) as EvidenceClient;
  let expanded = 0;
  const blobs = new Map<string, { sha: string; bytes: Uint8Array }>();
  verified.verifiedFile = async (name, ref, path) => {
    if (
      name.toLowerCase() !== source.evidence.repository.toLowerCase() ||
      !validValueFileRequest({
        repository: name,
        repositoryNodeId: repository.node_id,
        ref,
        path,
      })
    )
      throw new Error("Invalid immutable file recovery selection");
    const command = publicGitProcess(directory, [
      "ls-tree",
      "-z",
      ref,
      "--",
      `:(literal)${path}`,
    ]);
    const entry = (
      await run(command.file, command.args, {
        ...command.options,
        maxBuffer: 8192,
      })
    ).stdout;
    if (!entry) return null;
    const match = /^([0-7]{6}) blob ([a-f0-9]{40})\t([^\0]+)\0$/u.exec(entry);
    if (!match || match[3] !== path || !["100644", "100755"].includes(match[1]))
      return null;
    const prior = blobs.get(match[2]);
    if (prior) return prior;
    const blobCommand = publicGitProcess(directory, [
      "cat-file",
      "blob",
      match[2],
    ]);
    const result = await run(blobCommand.file, blobCommand.args, {
      ...blobCommand.options,
      encoding: "buffer",
      maxBuffer: VALUE_FILE_EXPANSION_LIMIT,
    });
    const bytes = result.stdout;
    expanded += bytes.length;
    if (
      expanded > VALUE_FILE_EXPANSION_LIMIT ||
      createHash("sha1")
        .update(`blob ${bytes.length}\0`)
        .update(bytes)
        .digest("hex") !== match[2]
    )
      throw new Error("Immutable file recovery exceeds its bound or differs");
    const value = { sha: match[2], bytes };
    blobs.set(match[2], value);
    return value;
  };
  const evidence = await collectValueEvidence(
    verified,
    source.evidence.repository,
    source.evidence.pull.number,
    repositoryPolicy,
  );
  for (const field of [
    "pull",
    "commits",
    "reviews",
    "comments",
    "reviewComments",
  ] as const)
    if (
      canonicalJson(evidence[field]) !== canonicalJson(source.evidence[field])
    )
      throw new Error("Source changed during immutable file recovery");
  // Context bytes were independently collected for the caller's requested scope.
  return {
    ...source,
    evidence: {
      ...evidence,
      ...(source.evidence.contextFiles
        ? { contextFiles: source.evidence.contextFiles }
        : {}),
      evidenceUrls: source.evidence.contextFiles
        ? [
            ...new Set([
              ...evidence.evidenceUrls,
              ...source.evidence.contextFiles.map((file) => file.url),
            ]),
          ]
        : evidence.evidenceUrls,
    },
  };
}
