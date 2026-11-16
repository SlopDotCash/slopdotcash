/** PRD 5/7: real publication, source collection and migrated SQLite. A valid
 * retained unresolved declaration exercises the write boundary, not model
 * correctness. No provider output, inference or financial authority is used. */
import { expect, test } from "bun:test";
import { createHash, generateKeyPairSync } from "node:crypto";
import { assertProjectDefinition } from "../../src/lib/project-schema.mjs";
import { collectTargetRepositories } from "../../src/lib/repositories.mjs";
import { REWARD_ASSET_NETWORKS } from "../../src/lib/reward-asset.mjs";
import {
  VALUE_DIMENSIONS,
  VALUE_RUBRIC_VERSION,
  type ValueAssessment,
} from "../../src/lib/value-assessment";
import { applicationManifest } from "../../tests/project-application-manifest";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { fixture, policy, repository } from "../../tests/value-binary-fixture";
import type { ReviewEnv } from "./review";
import { collectValueEvidence } from "./value-evidence";
import { publishValueAssessment } from "./value-publication";
import { type ValueAssessmentResult, valueSourceDigest } from "./value-review";
import { prepareWorkUnitEvidence } from "./value-work-unit";
import { publishWorkUnitAssessment } from "./value-work-unit-publication";
import type { WorkUnitAssessmentResult } from "./value-work-unit-review";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const at = "2026-10-25T00:00:00.000Z";
const privateKey = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
}).privateKey;
const declaration = {
  channel: "chatgpt-subscription",
  provider: "openai",
  model: "GPT-6.1 Sol",
  client: "Codex",
  exactVariant: null,
  identityEvidence: "self-reported",
  apiReceipt: null,
} as const;

for (const mode of ["single", "joint"] as const) {
  for (const change of ["none", "pause", "restriction", "mapping"] as const) {
    test(`${mode} publication ${change === "none" ? "succeeds with current authority" : `refuses a ${change} immediately before INSERT`}`, async () => {
      const { db, sqlite } = sqliteD1();
      const source = fixture({ direct: true, textOnly: true });
      const project = assertProjectDefinition(
        applicationManifest("fixture", repository.id, {
          rewardAsset: {
            network: "ethereum",
            kind: "stablecoin",
            ...REWARD_ASSET_NETWORKS.ethereum.stablecoin,
            chainId: REWARD_ASSET_NETWORKS.ethereum.chainId,
            cluster: null,
            verifiedAt: at,
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
      const manifest = JSON.stringify(project);
      sqlite.run(
        "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES (?,1,?,?,?,?)",
        [
          project.id,
          manifest,
          digest(manifest),
          "Initial publication fixture",
          at,
        ],
      );
      sqlite.run(
        "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES (?,'active',1,?,?,?,?)",
        [project.id, manifest, digest(manifest), at, at],
      );
      sqlite.run(
        "INSERT INTO project_repositories(repository_key,project_id) VALUES (?,?)",
        [repository.id, project.id],
      );
      sqlite.run(
        "INSERT INTO slopbot_installations(installation_id,account_id,account_login,account_type,created_at) VALUES (1,1,'example','Organization',?)",
        [at],
      );
      const evidence = await collectValueEvidence(
        source.client,
        repository.id,
        1,
        collectTargetRepositories([project])[0],
      );
      const assessment: ValueAssessment = {
        status: "unresolved",
        tier: null,
        rationale:
          "No model assessment is made by this storage conformance fixture.",
        dimensions: Object.fromEntries(
          VALUE_DIMENSIONS.map((dimension) => [
            dimension,
            "Not assessed by this fixture.",
          ]),
        ) as ValueAssessment["dimensions"],
        evidenceUrls: [evidence.pull.html_url],
        relatedPullRequests: [],
        limitations: ["No inference was requested."],
        reviews: [],
      };
      const previousFetch = globalThis.fetch;
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
        );
        if (url.origin !== "https://api.github.com")
          throw new Error("Unexpected external transport");
        if (url.pathname === "/app/installations/1/access_tokens")
          return Response.json({ token: "local-installation" });
        if (url.pathname === "/installation/repositories")
          return Response.json({
            repositories: [{ id: 42, node_id: "R_binary", private: false }],
          });
        if (url.pathname === "/graphql")
          return Response.json({ data: await source.client.graphql() });
        if (url.pathname.endsWith("/contents/CONTRIBUTING.md"))
          return Response.json({
            type: "file",
            encoding: "base64",
            size: "Retain accepted source evidence.".length,
            content: Buffer.from("Retain accepted source evidence.").toString(
              "base64",
            ),
          });
        const data = await source.client.get(url.pathname + url.search);
        return Response.json(data, { status: data === null ? 404 : 200 });
      }) as typeof fetch;
      let changed = false;
      const table =
        mode === "single"
          ? "slopbot_value_journal"
          : "slopbot_work_unit_journal";
      const wrapped = {
        ...db,
        prepare(sql: string) {
          if (
            change !== "none" &&
            !changed &&
            sql.includes(`INSERT INTO ${table}`)
          ) {
            changed = true;
            if (change === "pause") {
              const paused = JSON.stringify({ ...project, status: "paused" });
              sqlite.run(
                "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES (?,2,?,?,?,?)",
                [
                  project.id,
                  paused,
                  digest(paused),
                  "Paused during publication",
                  at,
                ],
              );
              sqlite.run(
                "UPDATE projects SET status='paused',revision=2,manifest=?,manifest_sha256=? WHERE id=?",
                [paused, digest(paused), project.id],
              );
            } else if (change === "mapping") {
              sqlite.run(
                "DELETE FROM project_repositories WHERE project_id=?",
                [project.id],
              );
            } else
              sqlite.run(
                `INSERT INTO project_enforcements
              (id,project_id,sequence,action,state_after,appeal_after,reason,evidence_reference,repository_github_id,repository_keys,actor_github_id,actor_github_login,actor_role,decision_source,before_revision,before_manifest_sha256,result,created_at)
              VALUES ('enf_publication_race',?,1,'quarantine','quarantined','none','Review pending','local-fixture','42',?,'77','moderator','project-moderator','admin-panel',1,?,'revision_pending',?)`,
                [
                  project.id,
                  JSON.stringify([repository.id]),
                  digest(manifest),
                  at,
                ],
              );
          }
          return db.prepare(sql);
        },
      };
      const env = {
        SLOPBOT_DB: wrapped,
        SLOPBOT_APP_ID: "1",
        SLOPBOT_APP_PRIVATE_KEY: privateKey,
      } as unknown as ReviewEnv;
      const job = {
        itemKind: "pull_request",
        installationId: 1,
        repositoryId: 42,
        owner: "example",
        repo: "binary-proof",
        number: 1,
      } as const;
      try {
        let publication: Promise<unknown>;
        if (mode === "single")
          publication = publishValueAssessment(
            env,
            job,
            {
              blocked: false,
              blockReason: null,
              provenance: declaration,
              assessedAt: at,
              verdict: assessment,
              rubricVersion: VALUE_RUBRIC_VERSION,
              sourceDigest: await valueSourceDigest(evidence, policy),
              pullRequestNodeId: evidence.pull.node_id,
              headSha: evidence.pull.head.sha,
              policySha: policy.sha,
            } as ValueAssessmentResult,
            evidence,
            "a".repeat(40),
            null,
          );
        else {
          const joint = await prepareWorkUnitEvidence(
            [{ evidence, policy }],
            collectTargetRepositories([project]),
          );
          publication = publishWorkUnitAssessment(
            env,
            job,
            {
              blocked: false,
              blockReason: null,
              provenance: declaration,
              assessedAt: at,
              verdict: {
                units: [
                  {
                    claimIds: joint.claims.map((claim) => claim.id),
                    assessment,
                  },
                ],
              },
              rubricVersion: VALUE_RUBRIC_VERSION,
              sourceDigest: joint.sourceDigest,
            } as WorkUnitAssessmentResult,
            joint,
            "a".repeat(40),
            [],
            [],
            null,
          );
        }
        if (change === "none") {
          await publication;
          expect(
            sqlite.query(`SELECT count(*) AS n FROM ${table}`).get(),
          ).toEqual({ n: 1 });
        } else {
          await expect(publication).rejects.toThrow();
          expect(changed).toBe(true);
          expect(
            sqlite.query(`SELECT count(*) AS n FROM ${table}`).get(),
          ).toEqual({ n: 0 });
        }
      } finally {
        globalThis.fetch = previousFetch;
        sqlite.close();
      }
    });
  }
}
