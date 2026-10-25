/** Reconstruct a journal's server-verified merge recipe from public Git objects.
 * No checkout, model call, source execution or publication occurs here.
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { validRepositoryPath } from "../src/lib/project-contracts";
import {
  MERGE_GIT_VERSION,
  mergeInput,
  mergeRecipe,
  type ValueMergeRecipe,
  validMergeRecipe,
} from "../workers/slopbot/value-merge-profile";
import type { WorkUnitSource } from "../workers/slopbot/value-work-unit";
import { collectVerifiedMergeResolutions } from "./value-merge-resolution";

export interface PublicMergeRepository {
  id: number;
  node_id: string;
  private: boolean;
  full_name?: string;
}

const run = promisify(execFile);

export async function hydrateValueMergeSource(
  source: WorkUnitSource,
  recipe: ValueMergeRecipe,
  repository: PublicMergeRepository,
): Promise<WorkUnitSource> {
  if (
    !validMergeRecipe(recipe) ||
    (await mergeRecipe(source.evidence)).inputSha256 !== recipe.inputSha256
  )
    throw new Error("Merge reconstruction inputs differ from the journal");
  const name = repository.full_name;
  if (
    repository.private !== false ||
    repository.node_id !== source.evidence.repositoryNodeId ||
    repository.id !== source.evidence.repositoryDatabaseId ||
    typeof name !== "string" ||
    !validRepositoryPath(name) ||
    name.split("/").some((part) => part === "." || part === "..")
  )
    throw new Error(
      "Merge reconstruction requires the verified public repository",
    );

  const input = mergeInput(source.evidence);
  const objects = [
    ...new Set([
      input.pull.head.sha,
      ...input.commits.flatMap(({ sha, parents }) => [
        sha,
        ...parents.map((parent) => parent.sha),
      ]),
    ]),
  ];
  if (!objects.every((sha) => /^[a-f0-9]{40}$/u.test(sha)))
    throw new Error("Invalid immutable merge object identity");

  const env = {
    PATH: process.env.PATH,
    LC_ALL: "C",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_NO_REPLACE_OBJECTS: "1",
  };
  if (
    (await run("git", ["--version"], { env })).stdout.trim() !==
    MERGE_GIT_VERSION
  )
    throw new Error("Required merge reconstruction Git version unavailable");
  const directory = await mkdtemp(
    join(tmpdir(), "slop-value-merge-ingestion-"),
  );
  try {
    const git = (...args: string[]) =>
      run(
        "git",
        [
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
        {
          env: { ...env, HOME: directory, XDG_CONFIG_HOME: directory },
          maxBuffer: 1024 * 1024,
          timeout: 120_000,
        },
      );
    await git("init", "--bare", "--template=");
    // Full ancestry and blobs are required for canonical merge-tree results.
    // Never use a shallow or lazy-fetch repository, credentials or redirects.
    await git(
      "fetch",
      "--no-tags",
      "--no-recurse-submodules",
      "--no-write-fetch-head",
      `https://github.com/${name}.git`,
      ...objects,
    );
    await git("fsck", "--full", "--strict", "--no-reflogs");
    const mergeResolutions = await collectVerifiedMergeResolutions(
      input,
      directory,
    );
    return {
      ...source,
      evidence: { ...source.evidence, mergeResolutions },
      mergeRecipe: recipe,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
