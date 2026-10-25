/** PRD sections 4, 5 and 7: registration must not wait for a site release.
 * Exercise durable intake and the real consumer with local D1 and GitHub HTTP
 * responses. These cases stop before inference; no model verdict is simulated.
 */
import { expect, test } from "bun:test";
import { createHash, generateKeyPairSync } from "node:crypto";
import { readdirSync } from "node:fs";
import { assertProjectDefinition } from "../../src/lib/project-schema.mjs";
import { findRegisteredRepositoryById } from "../../src/lib/repositories.mjs";
import { REWARD_ASSET_NETWORKS } from "../../src/lib/reward-asset.mjs";
import { applicationManifest } from "../../tests/project-application-manifest";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { recordDelivery } from "./persistence";
import { consumeValueRequest, type ValueConsumerEnv } from "./value-consumer";
import { recordValueRequest } from "./value-requests";

const repository = "fresh-registration/toolkit";
const job = {
  deliveryId: "new-registration-delivery",
  installationId: 1,
  repositoryId: 123456789,
  owner: "fresh-registration",
  repo: "toolkit",
  number: 1,
};
const at = "2026-10-24T00:00:00.000Z";
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

for (const change of [
  "none",
  "removed",
  "paused",
  "restricted",
  "identity",
  "deselected",
] as const) {
  test(`live registration reaches the consumer; ${change} authority`, async () => {
    const { db, sqlite } = sqliteD1(
      readdirSync(new URL("../../migrations/", import.meta.url))
        .filter((path) => path.endsWith(".sql"))
        .sort(),
    );
    const project = assertProjectDefinition(
      applicationManifest("fresh-registration", repository, {
        status: "active",
        rewardAsset: {
          network: "ethereum",
          kind: "stablecoin",
          ...REWARD_ASSET_NETWORKS.ethereum.stablecoin,
          chainId: REWARD_ASSET_NETWORKS.ethereum.chainId,
          cluster: null,
          verifiedAt: at,
        },
      }),
    );
    const manifest = JSON.stringify(project);
    const digest = createHash("sha256").update(manifest).digest("hex");
    sqlite.run(
      "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES (?,1,?,?,?,?)",
      [project.id, manifest, digest, "registration workflow", at],
    );
    sqlite.run(
      "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES (?,'active',1,?,?,?,?)",
      [project.id, manifest, digest, at, at],
    );
    sqlite.run(
      "INSERT INTO project_repositories(repository_key,project_id) VALUES (?,?)",
      [repository, project.id],
    );
    sqlite.run(
      "INSERT INTO slopbot_installations(installation_id,account_id,account_login,account_type,created_at) VALUES (1,77,'fresh-registration','Organization',?)",
      [at],
    );
    expect(findRegisteredRepositoryById(repository)).toBeNull();
    await recordDelivery(db, job.deliveryId, "pull_request");
    await recordValueRequest(db, job);
    if (change === "removed")
      sqlite.run("DELETE FROM project_repositories WHERE project_id=?", [
        project.id,
      ]);
    if (change === "paused") {
      const paused = JSON.stringify({ ...project, status: "paused" });
      const pausedDigest = createHash("sha256").update(paused).digest("hex");
      sqlite.run(
        "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES (?,2,?,?,?,?)",
        [project.id, paused, pausedDigest, "pause after intake", at],
      );
      sqlite.run(
        "UPDATE projects SET status='paused',revision=2,manifest=?,manifest_sha256=?,updated_at=? WHERE id=?",
        [paused, pausedDigest, at, project.id],
      );
    }
    if (change === "restricted")
      sqlite.run(
        `INSERT INTO project_enforcements
      (id,project_id,sequence,action,state_after,appeal_after,reason,evidence_reference,repository_github_id,repository_keys,actor_github_id,actor_github_login,actor_role,decision_source,before_revision,before_manifest_sha256,result,created_at)
      VALUES ('enf_registry_test',?,1,'quarantine','quarantined','none','Review pending','local-workflow',?,?,'77','moderator','project-moderator','admin-panel',1,?,'revision_pending',?)`,
        [
          project.id,
          project.authority.repositoryId,
          JSON.stringify([repository]),
          digest,
          at,
        ],
      );
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      calls.push(url.pathname);
      if (url.origin !== "https://api.github.com")
        throw new Error("No provider call is authorized in this test");
      if (url.pathname === "/app/installations/1/access_tokens")
        return Response.json({ token: "local-installation" });
      const identity = {
        id: change === "identity" ? 987 : job.repositoryId,
        node_id: "R_example",
        private: false,
      };
      if (url.pathname === `/repos/${repository}`)
        return Response.json(identity);
      if (url.pathname === "/installation/repositories")
        return Response.json({
          repositories: change === "deselected" ? [] : [identity],
        });
      if (url.pathname === `/repos/${repository}/pulls/1`)
        return Response.json({
          state: "open",
          merged_at: null,
          closed_at: null,
        });
      throw new Error("Unexpected GitHub request");
    }) as typeof fetch;
    try {
      const env: ValueConsumerEnv = {
        SLOPBOT_DB: db,
        SLOPBOT_APP_ID: "1",
        SLOPBOT_APP_PRIVATE_KEY: privateKey,
        SLOPBOT_APP_USER_ID: "2",
        SURPLUS_API_KEY: "not-used-before-inference",
        SLOPBOT_PRODUCER_REVISION: "a".repeat(40),
        SLOPBOT_VALUE_START_AT: at,
        SLOPBOT_VALUE_MONTHLY_BUDGET_MICRO_USD: "alerts-only",
        SLOPBOT_VALUE_ATTEMPT_RESERVE_MICRO_USD: "1000000",
      };
      const outcome = await consumeValueRequest(env, job);
      expect(outcome).toBe(
        change === "none"
          ? "open"
          : change === "deselected"
            ? "retry"
            : "authority",
      );
      expect(
        sqlite
          .query("SELECT state,outcome FROM slopbot_value_processing")
          .get(),
      ).toEqual({
        state: change === "none" ? "completed" : "waiting",
        outcome,
      });
      if (
        change === "removed" ||
        change === "paused" ||
        change === "restricted"
      )
        expect(calls).toEqual([]);
      if (change === "none")
        expect(calls).toContain(`/repos/${repository}/pulls/1`);
      expect(
        sqlite
          .query("SELECT count(*) AS count FROM slopbot_value_journal")
          .get(),
      ).toEqual({ count: 0 });
    } finally {
      globalThis.fetch = original;
      sqlite.close();
    }
  });
}
