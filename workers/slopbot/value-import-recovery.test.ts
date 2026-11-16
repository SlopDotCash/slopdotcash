import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { assertProjectDefinition } from "../../src/lib/project-schema.mjs";
import { collectTargetRepositories } from "../../src/lib/repositories.mjs";
import { REWARD_ASSET_NETWORKS } from "../../src/lib/reward-asset.mjs";
import {
  VALUE_DIMENSIONS,
  VALUE_RUBRIC_VERSION,
} from "../../src/lib/value-assessment";
import { applicationManifest } from "../../tests/project-application-manifest";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { fixture, policy, repository } from "../../tests/value-binary-fixture";
import { GitHubClient } from "./github";
import type { ReviewEnv } from "./review";
import { collectValueEvidence } from "./value-evidence";
import type { ValueFileRequest } from "./value-file-recovery";
import {
  type ValueFileRecovery,
  verifiedValueFileClient,
} from "./value-file-recovery";
import { importSubscriptionAssessment } from "./value-import";
import type { ValueMergeInput } from "./value-merge-profile";
import { mergeRecipe } from "./value-merge-profile";
import { prepareWorkUnitEvidence } from "./value-work-unit";

/** Synthetic transport exercises canonical import and final recollection, with
 * an unresolved fixture verdict. It makes no model-backed value assertion. */
for (const variant of [
  "unchanged",
  "changed",
  "repository activity",
  "later unclaimed context",
] as const)
  test(`subscription import ${variant === "changed" ? "refuses changed metadata" : variant === "repository activity" ? "ignores repository and milestone counters that move between reads" : "rechecks recovered files through normal journal publication"}`, async () => {
    const changed = variant === "changed";
    const source = fixture({ direct: true, textOnly: true });
    const bytes = new TextEncoder().encode(
      "retained large text evidence\n".repeat(100000),
    );
    const head = source.pull.head.sha;
    const merged = source.pull.merge_commit_sha;
    if (!merged) throw new Error("Missing fixture merge");
    source.bind(head, new Map([["fix.ts", bytes]]), [source.pull.base.sha]);
    source.bind(merged, new Map([["fix.ts", bytes]]), [
      source.pull.base.sha,
      head,
    ]);
    source.files[0].additions = 100000;
    delete source.files[0].patch;
    const laterContext = variant === "later unclaimed context";
    let collections = 0;
    let recoveryCompleted = false;
    const client = {
      ...source.client,
      async get<T>(path: string): Promise<T | null> {
        if (path === "/installation/repositories?per_page=100&page=1")
          return {
            repositories: [
              { id: 42, node_id: repository.expectedNodeId, private: false },
            ],
          } as T;
        if (path.endsWith("/pulls/1")) collections++;
        if (laterContext && /\/(?:pulls|issues)\/2(?:\/|$)/u.test(path)) {
          const mapped = path.replace(/\/(pulls|issues)\/2/u, "/$1/1");
          const value = await source.client.get<T>(mapped);
          if (mapped.endsWith("/pulls/1") && value) {
            Object.assign(value, {
              node_id: "PR_later_context",
              number: 2,
              html_url: `https://github.com/${repository.id}/pull/2`,
              merged_at: null,
              closed_at: "2026-11-01T07:20:21Z",
              updated_at: "2026-11-01T07:20:21Z",
              merge_commit_sha: null,
            });
          }
          return value;
        }
        const value = await source.client.get<T>(path);
        if (value && path.includes("/commits/") && !path.includes("/git/"))
          (value as unknown as { stats: unknown }).stats = {
            additions: 100000,
            deletions: 0,
            total: 100000,
          };
        if (changed && recoveryCompleted && path.endsWith("/pulls/1") && value)
          (value as unknown as { title: string }).title =
            "Changed after recovery";
        // GitHub's pull body embeds the base and head repositories and the
        // milestone. A push to any branch, a new issue or a star moves their
        // timestamps and counters between reads; the PR itself is unchanged.
        if (
          variant === "repository activity" &&
          path.endsWith("/pulls/1") &&
          value
        ) {
          const activity = {
            id: 42,
            node_id: repository.expectedNodeId,
            full_name: repository.id,
            pushed_at: `2026-10-20T10:00:${String(collections).padStart(2, "0")}Z`,
            updated_at: `2026-10-20T10:00:${String(collections).padStart(2, "0")}Z`,
            open_issues_count: 100 + collections,
            stargazers_count: 200 + collections,
          };
          const pull = value as unknown as {
            base: Record<string, unknown>;
            head: Record<string, unknown>;
            milestone: unknown;
          };
          pull.base.repo = { ...activity };
          pull.head.repo = { ...activity };
          pull.milestone = {
            number: 1,
            open_issues: collections,
            closed_issues: 10,
            updated_at: activity.updated_at,
          };
        }
        return value;
      },
    };
    const githubClient = {
      ...client,
      async graphql<T>(_query: string, variables: { number?: number }) {
        const result = await source.client.graphql<{
          repository: { pullRequest: { id: string } };
        }>();
        if (laterContext && variables?.number === 2)
          result.repository.pullRequest.id = "PR_later_context";
        return result as T;
      },
    };
    const blobSha = createHash("sha1")
      .update(`blob ${bytes.length}\0`)
      .update(bytes)
      .digest("hex");
    const makeRecovery = (
      requests: Parameters<
        NonNullable<NonNullable<ReviewEnv["VALUE_MERGE_VERIFIER"]>["recover"]>
      >[1],
    ): ValueFileRecovery => ({
      inputSha256: createHash("sha256")
        .update(JSON.stringify(requests))
        .digest("hex"),
      entries: requests.map((request) => ({
        ...request,
        treeSha: "d".repeat(40),
        mode: "100644",
        blobSha,
      })),
      blobs: [
        {
          sha: blobSha,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          size: bytes.length,
          gzipBase64: gzipSync(bytes).toString("base64"),
        },
      ],
    });
    const requests = [head, merged].map((ref) => ({
      repository: repository.id,
      repositoryNodeId: repository.expectedNodeId ?? "",
      ref,
      path: "fix.ts",
    }));
    const verified = await verifiedValueFileClient(
      githubClient,
      requests,
      makeRecovery(requests),
    );
    const project = assertProjectDefinition(
      applicationManifest("fixture", repository.id, {
        rewardAsset: {
          network: "ethereum",
          kind: "stablecoin",
          ...REWARD_ASSET_NETWORKS.ethereum.stablecoin,
          chainId: REWARD_ASSET_NETWORKS.ethereum.chainId,
          cluster: null,
          verifiedAt: new Date().toISOString(),
        },
        status: "active",
        authority: {
          state: "unverified",
          reason: "missing-repository-proof",
          role: "project-steward",
          repositoryId: "42",
          repositoryNodeId: "R_binary",
          proof: null,
        },
      }),
    );
    const repositories = collectTargetRepositories([project]);
    const evidence = await collectValueEvidence(
      verified,
      repository.id,
      1,
      repositories[0],
    );
    evidence.mergeResolutions = [];
    const preparedSources = [
      { evidence, policy, mergeRecipe: await mergeRecipe(evidence) },
    ];
    if (laterContext) {
      const context = await collectValueEvidence(
        verified,
        repository.id,
        2,
        repositories[0],
      );
      context.mergeResolutions = [];
      preparedSources.push({
        evidence: context,
        policy,
        mergeRecipe: await mergeRecipe(context),
      });
    }
    const joint = await prepareWorkUnitEvidence(preparedSources, repositories);
    expect(joint.limitations).toEqual([]);
    const result = {
      sourceDigest: joint.sourceDigest,
      rubricVersion: VALUE_RUBRIC_VERSION,
      assessedAt: new Date().toISOString(),
      provenance: {
        channel: "chatgpt-subscription",
        provider: "openai",
        model: "Fixture model",
        client: "Fixture client",
        exactVariant: null,
        identityEvidence: "self-reported",
        apiReceipt: null,
      },
      verdict: {
        units: [
          {
            claimIds: joint.claims.map((c) => c.id),
            assessment: {
              status: "unresolved",
              tier: null,
              rationale:
                "Transport fixture retains an unresolved verdict without value assignment.",
              dimensions: Object.fromEntries(
                VALUE_DIMENSIONS.map((d) => [
                  d,
                  "No model quality assertion is made by this transport fixture.",
                ]),
              ),
              evidenceUrls: [source.pull.html_url],
              relatedPullRequests: [],
              limitations: ["Fixture verdict remains unresolved."],
              reviews: [],
            },
          },
        ],
      },
    };
    const { db, sqlite } = sqliteD1();
    const now = new Date().toISOString(),
      manifest = JSON.stringify(project),
      digest = createHash("sha256").update(manifest).digest("hex");
    sqlite.run(
      "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES (?,1,?,?,?,?)",
      [project.id, manifest, digest, "Fixture import", now],
    );
    sqlite.run(
      "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES (?,'active',1,?,?,?,?)",
      [project.id, manifest, digest, now, now],
    );
    sqlite.run(
      "INSERT INTO project_repositories(repository_key,project_id) VALUES (?,?)",
      [repository.id, project.id],
    );
    sqlite.run(
      "INSERT INTO slopbot_installations(installation_id,account_id,account_login,account_type,created_at) VALUES (1,1,'example','Organization',?)",
      [now],
    );
    const original = GitHubClient.forInstallation;
    GitHubClient.forInstallation = async () =>
      githubClient as unknown as GitHubClient;
    let recoveryCalls = 0,
      mergeCalls = 0;
    try {
      const pending = importSubscriptionAssessment(
        {
          SLOPBOT_DB: db,
          SLOPBOT_PRODUCER_REVISION: "1".repeat(40),
          VALUE_MERGE_VERIFIER: {
            async recover(
              _inputs: ValueMergeInput[],
              requests: ValueFileRequest[],
              bundle: ReadableStream<Uint8Array>,
            ) {
              await new Response(bundle).arrayBuffer();
              recoveryCalls++;
              recoveryCompleted = true;
              return makeRecovery(requests);
            },
            async reconstruct(
              inputs: ValueMergeInput[],
              bundle: ReadableStream<Uint8Array>,
            ) {
              await new Response(bundle).arrayBuffer();
              mergeCalls++;
              return inputs.map((input) => ({
                inputSha256: createHash("sha256")
                  .update(JSON.stringify(input))
                  .digest("hex"),
                mergeResolutions: [],
              }));
            },
          },
        } as unknown as Parameters<typeof importSubscriptionAssessment>[0],
        {
          mode: "work-unit",
          installationId: 1,
          sources: [1, ...(laterContext ? [2] : [])].map((number) => ({
            repository: repository.id,
            pullRequestNumber: number,
            contextPaths: [],
          })),
          result,
          supersedes: [],
          legacyPredecessors: [],
          revisionReason: null,
        },
        new Blob(["fixture bundle"]).stream(),
      );
      if (changed) {
        await expect(pending).rejects.toThrow(
          "Recovery source metadata changed",
        );
        expect(
          sqlite
            .query("SELECT COUNT(*) AS n FROM slopbot_work_unit_journal")
            .get(),
        ).toEqual({ n: 0 });
        return;
      }
      const stored = await pending;
      expect(stored.sequence).toBe(1);
      expect(recoveryCalls).toBe(1);
      expect(mergeCalls).toBe(1);
      expect(collections).toBeGreaterThanOrEqual(4);
      expect(
        sqlite
          .query("SELECT COUNT(*) AS n FROM slopbot_work_unit_journal")
          .get(),
      ).toEqual({ n: 1 });
    } finally {
      GitHubClient.forInstallation = original;
      sqlite.close();
    }
  }, 30000);
