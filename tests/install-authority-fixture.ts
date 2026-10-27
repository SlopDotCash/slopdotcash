/**
 * Builds deterministic file-backed GitHub API and raw-content authorities for
 * installer tests. The fixture mirrors only endpoints the production command
 * is permitted to query, so tests cannot silently fall back to the network.
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const REPOSITORY = "SlopDotCash/slopdotcash";
const SKILL_PATH = "skills/contribute-to-eliza";

export interface AuthorityRevision {
  files: Record<string, Buffer | string>;
  pulls?: unknown[];
  released?: boolean;
}

export interface AuthorityFixtureOptions {
  /** Canonical source tree; generated skills name their template. */
  skillPath?: string;
  comparisons?: Record<string, unknown>;
  developHead: string;
  /**
   * A verified production release; individual history/job responses can be
   * overridden for the installed-workflow counterexamples.
   */
  latestRelease?: { revision: string; run: number };
  revisions: Record<string, AuthorityRevision>;
  responseOverrides?: Record<string, unknown>;
  timelines?: Record<number, unknown[]>;
}

export function releaseEvidence(
  revision: string,
  id: number,
  options: {
    event?: "push" | "workflow_dispatch";
    attempt?: number;
    createdAt?: string;
    completedAt?: string;
    updatedAt?: string;
  } = {},
) {
  const attempt = options.attempt ?? 1;
  const created = options.createdAt ?? "2026-10-27T01:00:00Z";
  const completed = options.completedAt ?? "2026-10-27T01:01:00Z";
  return {
    run: {
      id,
      head_sha: revision,
      head_branch: "main",
      path: ".github/workflows/deploy.yml",
      event: options.event ?? "push",
      status: "completed",
      conclusion: "success",
      run_attempt: attempt,
      created_at: created,
      updated_at: options.updatedAt ?? completed,
      head_repository: { full_name: REPOSITORY },
    },
    jobs: {
      total_count: 1,
      jobs: [
        {
          id: id + 1,
          run_id: id,
          run_attempt: attempt,
          head_sha: revision,
          name: "Deploy trusted production bundle",
          status: "completed",
          conclusion: "success",
          started_at: created,
          completed_at: completed,
          steps: [
            "Verify deployment checkout",
            "Verify downloaded Pages bundle",
            "Require live release-input equivalence",
            "Deploy private identity and Cloudflare Pages",
            "Verify Cloudflare deployment commit metadata",
            "Verify published skill and leaderboard",
          ].map((name, index) => ({
            name,
            number: index + 1,
            status: "completed",
            conclusion: "success",
            started_at: created,
            completed_at: created,
          })),
        },
      ],
    },
  };
}

interface ContentsEntry {
  name: string;
  path: string;
  sha?: string;
  size: number;
  submodule_git_url?: null;
  type: "dir" | "file";
}

function gitBlobSha(contents: Buffer): string {
  return createHash("sha1")
    .update(`blob ${contents.length}\0`)
    .update(contents)
    .digest("hex");
}

function normalizedFiles(
  files: Record<string, Buffer | string>,
): Record<string, Buffer> {
  return Object.fromEntries(
    Object.entries(files).map(([path, contents]) => [
      path,
      Buffer.isBuffer(contents) ? contents : Buffer.from(contents),
    ]),
  );
}

function contentsResponses(
  revision: string,
  files: Record<string, Buffer>,
  SKILL_PATH: string,
): Record<string, unknown> {
  const directories = new Map<string, Map<string, ContentsEntry>>();
  directories.set("", new Map());
  for (const [relativePath, contents] of Object.entries(files)) {
    const parts = relativePath.split("/");
    for (let index = 0; index < parts.length - 1; index += 1) {
      const parent = parts.slice(0, index).join("/");
      const child = parts.slice(0, index + 1).join("/");
      const childName = parts[index];
      const entries = directories.get(parent);
      if (!entries) throw new TypeError(`fixture omitted directory ${parent}`);
      entries.set(childName, {
        name: childName,
        path: `${SKILL_PATH}/${child}`,
        size: 0,
        type: "dir",
      });
      if (!directories.has(child)) directories.set(child, new Map());
    }
    const parent = parts.slice(0, -1).join("/");
    const name = parts.at(-1);
    if (!name) throw new TypeError("fixture file path is empty");
    const entries = directories.get(parent);
    if (!entries) throw new TypeError(`fixture omitted directory ${parent}`);
    entries.set(name, {
      name,
      path: `${SKILL_PATH}/${relativePath}`,
      sha: gitBlobSha(contents),
      size: contents.length,
      submodule_git_url: null,
      type: "file",
    });
  }

  return Object.fromEntries(
    [...directories.entries()].map(([relativeDirectory, entries]) => {
      const directory = relativeDirectory
        ? `${SKILL_PATH}/${relativeDirectory}`
        : SKILL_PATH;
      return [
        `/repos/${REPOSITORY}/contents/${directory}?ref=${revision}`,
        [...entries.values()].sort((left, right) =>
          left.name.localeCompare(right.name),
        ),
      ];
    }),
  );
}

export function createInstallAuthorityFixture(
  root: string,
  options: AuthorityFixtureOptions,
): { apiOrigin: string; rawOrigin: string } {
  const skillPath = options.skillPath ?? SKILL_PATH;
  const apiRoot = join(root, "api");
  const rawRoot = join(root, "raw");
  mkdirSync(apiRoot, { recursive: true });
  mkdirSync(rawRoot, { recursive: true });

  const release = options.latestRelease
    ? releaseEvidence(options.latestRelease.revision, options.latestRelease.run)
    : null;

  const responses: Record<string, unknown> = {
    [`/repos/${REPOSITORY}/git/ref/heads/main`]: {
      object: { sha: options.developHead, type: "commit" },
      ref: "refs/heads/main",
    },
    [`/repos/${REPOSITORY}/actions/workflows/deploy.yml/runs?branch=main&per_page=100&page=1`]:
      {
        total_count: release ? 1 : 0,
        workflow_runs: release ? [release.run] : [],
      },
  };
  if (release)
    responses[
      `/repos/${REPOSITORY}/actions/runs/${release.run.id}/attempts/1/jobs?per_page=100&page=1`
    ] = release.jobs;
  for (const [revision, configuration] of Object.entries(options.revisions)) {
    responses[
      `/repos/${REPOSITORY}/actions/workflows/deploy.yml/runs?head_sha=${revision}&status=success&per_page=100`
    ] = {
      workflow_runs: configuration.released
        ? [
            {
              head_sha: revision,
              head_branch: "main",
              event: "push",
              conclusion: "success",
              head_repository: { full_name: REPOSITORY },
            },
          ]
        : [],
    };
    responses[
      `/repos/${REPOSITORY}/contents/protocol/skill-revocations.json?ref=${revision}`
    ] = { encoding: "base64", content: Buffer.from("[]").toString("base64") };
    const files = normalizedFiles(configuration.files);
    Object.assign(responses, contentsResponses(revision, files, skillPath));
    responses[
      `/repos/${REPOSITORY}/commits/${revision}/pulls?page=1&per_page=100`
    ] = configuration.pulls ?? [];
    for (const [relativePath, contents] of Object.entries(files)) {
      const destination = join(
        rawRoot,
        ...REPOSITORY.split("/"),
        revision,
        ...skillPath.split("/"),
        ...relativePath.split("/"),
      );
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, contents);
    }
  }
  for (const [comparison, response] of Object.entries(
    options.comparisons ?? {},
  )) {
    responses[`/repos/${REPOSITORY}/compare/${comparison}?per_page=1&page=2`] =
      response;
  }
  for (const [number, timeline] of Object.entries(options.timelines ?? {})) {
    responses[
      `/repos/${REPOSITORY}/issues/${number}/timeline?page=1&per_page=100`
    ] = timeline;
  }
  Object.assign(responses, options.responseOverrides);
  writeFileSync(
    join(apiRoot, "responses.json"),
    `${JSON.stringify(responses, null, 2)}\n`,
  );
  return {
    apiOrigin: pathToFileURL(apiRoot).href.replace(/\/$/u, ""),
    rawOrigin: pathToFileURL(rawRoot).href.replace(/\/$/u, ""),
  };
}

export function aheadComparison(oldRevision: string, newRevision: string) {
  return {
    ahead_by: 1,
    base_commit: { sha: oldRevision },
    behind_by: 0,
    merge_base_commit: { sha: oldRevision },
    status: "ahead",
    total_commits: 1,
    commits: [{ sha: newRevision }],
  };
}
