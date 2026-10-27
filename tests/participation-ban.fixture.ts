import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";

// Synthetic moderator decision through the real schema and ban trigger.
export function seedParticipationBan(
  sqlite: Database,
  account: { githubId: string; githubLogin: string },
  moderator: { githubId: string; githubLogin: string },
  at: string,
) {
  const projectId = `malicious-${account.githubId}`;
  const manifest = JSON.stringify({ id: projectId, status: "paused" });
  const digest = createHash("sha256").update(manifest).digest("hex");
  sqlite
    .query(
      "INSERT INTO project_revisions (project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES (?,1,?,?,'fixture',?)",
    )
    .run(projectId, manifest, digest, at);
  sqlite
    .query(
      "INSERT INTO projects (id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES (?,'paused',1,?,?,?,?)",
    )
    .run(projectId, manifest, digest, at, at);
  for (const sequence of [1, 2]) {
    sqlite
      .query(
        `INSERT INTO project_enforcements (id,project_id,sequence,action,state_after,appeal_after,reason,evidence_reference,repository_github_id,repository_keys,actor_github_id,actor_github_login,system_issuer,actor_role,decision_source,before_revision,before_manifest_sha256,after_revision,after_manifest_sha256,result,created_at)
        VALUES (?,?,?,'ban','banned','none','Synthetic malicious finding','private-fixture','123','["example/malicious"]',?,?,?,?,?,1,?,NULL,NULL,'revision_pending',?)`,
      )
      .run(
        `enf_${projectId}_${sequence}`,
        projectId,
        sequence,
        sequence === 1 ? null : moderator.githubId,
        sequence === 1 ? null : moderator.githubLogin,
        sequence === 1
          ? JSON.stringify({
              kind: "vetting-service",
              keySha256: "a".repeat(64),
              assessmentId: "vet_fixture",
              policyVersion: "fixture",
              rule: "confirmed-malicious",
            })
          : null,
        sequence === 1 ? "vetting-service" : "project-moderator",
        sequence === 1 ? "standing-rule" : "admin-panel",
        digest,
        at,
      );
  }
  sqlite
    .query(
      "INSERT INTO project_maintainer_bans (enforcement_id,github_id,github_login) VALUES (?,?,?)",
    )
    .run(`enf_${projectId}_2`, account.githubId, account.githubLogin);
}
