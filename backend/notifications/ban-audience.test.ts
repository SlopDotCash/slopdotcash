import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import {
  githubNodeIdSpellings,
  githubUserIdFromNodeId,
} from "../../src/lib/github-actor";
import { applicationManifest } from "../../tests/project-application-manifest";
import { sqliteD1 } from "../../tests/sqlite-d1";
import {
  affectedContributorGithubIds,
  notifyVettingBanAudience,
} from "./events";

const AT = "2026-11-05T12:00:00.000Z";
const legacy = (numeric: string) => githubNodeIdSpellings(numeric)[0];
const current = (numeric: string) =>
  githubNodeIdSpellings(numeric)[githubNodeIdSpellings(numeric).length - 1];

test("a vetting ban reaches affected contributors under either node ID spelling", async () => {
  // Both canonical spellings name the same numeric account.
  expect(legacy("70000")).toBe("MDQ6VXNlcjcwMDAw");
  expect(current("70000")).toBe("U_kgDOAAERcA");
  expect(githubUserIdFromNodeId(legacy("70000"))).toBe("70000");
  expect(githubUserIdFromNodeId(current("70000"))).toBe("70000");

  const { db, sqlite } = sqliteD1(
    readdirSync(new URL("../../migrations", import.meta.url))
      .filter((name) => name.endsWith(".sql"))
      .sort(),
  );
  try {
    const manifest = JSON.stringify(
      applicationManifest("proj-x", "example/proj-x"),
    );
    sqlite
      .query(
        "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,actor_github_id,actor_github_login,created_at) VALUES ('proj-x',1,?,?,'Fixture','303','lister',?)",
      )
      .run(manifest, "a".repeat(64), AT);
    sqlite
      .query(
        "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES ('proj-x','paused',1,?,?,?,?)",
      )
      .run(manifest, "a".repeat(64), AT, AT);

    const member = (actor: string, github: string) =>
      sqlite
        .query(
          "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES(?,?,?, ?,1)",
        )
        .run(actor, github, `user${github}`, AT);
    const award = (
      id: string,
      sourceKey: string,
      previous: string | null,
      actor: string,
      amount: number,
    ) =>
      sqlite
        .query(
          "INSERT INTO points_revisions(id,source_key,previous,recorded_at,payload) VALUES(?,?,?,?,?)",
        )
        .run(
          id,
          sourceKey,
          previous,
          AT,
          JSON.stringify({
            award: { actor: { id: actor }, projectId: "proj-x", amount },
          }),
        );

    // Membership saved under one spelling, award retained under the other.
    member(legacy("70000"), "70000");
    award("rev-a", "rev-a", null, current("70000"), 10);
    member(current("70002"), "70002");
    award("rev-c", "rev-c", null, legacy("70002"), 10);
    // Same-spelling control.
    member(current("70001"), "70001");
    award("rev-b", "rev-b", null, current("70001"), 10);
    // Cross-spelling, but a payment obligation also identifies them.
    member(legacy("70003"), "70003");
    award("rev-d", "rev-d", null, current("70003"), 10);
    sqlite
      .query(
        "INSERT INTO payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at) VALUES('obl-d','proj-x','70003','base','base','vault',?,6,'100','2',?,'reserved',?)",
      )
      .run("a".repeat(32), "d".repeat(64), AT);
    // A superseded award corrected to zero selects nobody.
    member(current("70004"), "70004");
    award("rev-e1", "rev-e", null, current("70004"), 10);
    award("rev-e2", "rev-e", "rev-e1", current("70004"), 0);
    // A retained zero-credit award selects nobody.
    member(current("70005"), "70005");
    award("rev-f", "rev-f", null, current("70005"), 0);
    // A retained award for a non-member selects nobody.
    award("rev-g", "rev-g", null, current("70006"), 10);

    expect(await affectedContributorGithubIds(db, "proj-x")).toEqual(
      expect.arrayContaining(["70000", "70001", "70002", "70003"]),
    );
    expect(await affectedContributorGithubIds(db, "proj-x")).toHaveLength(4);

    sqlite
      .query(
        "INSERT INTO project_enforcements(id,project_id,sequence,action,state_after,appeal_after,reason,evidence_reference,repository_github_id,repository_keys,system_issuer,actor_role,decision_source,before_revision,before_manifest_sha256,result,created_at) VALUES ('enf_ban_audience','proj-x',1,'ban','banned','none','Confirmed malicious','fixture','1','[\"example/proj-x\"]',?,'vetting-service','standing-rule',1,?,'revision_pending',?)",
      )
      .run(
        JSON.stringify({
          kind: "vetting-service",
          keySha256: "b".repeat(64),
          assessmentId: "fixture",
          policyVersion: "fixture",
          rule: "confirmed-malicious",
        }),
        "a".repeat(64),
        AT,
      );

    await db.batch([
      await notifyVettingBanAudience(db, "enf_ban_audience", "proj-x", ["900"]),
    ]);
    const recipients = sqlite
      .query(
        "SELECT recipient_github_id, kind, action_path FROM notifications ORDER BY recipient_github_id",
      )
      .all() as {
      recipient_github_id: string;
      kind: string;
      action_path: string;
    }[];
    expect(recipients).toEqual([
      {
        recipient_github_id: "70000",
        kind: "project_banned",
        action_path: "/projects/proj-x",
      },
      {
        recipient_github_id: "70001",
        kind: "project_banned",
        action_path: "/projects/proj-x",
      },
      {
        recipient_github_id: "70002",
        kind: "project_banned",
        action_path: "/projects/proj-x",
      },
      {
        recipient_github_id: "70003",
        kind: "project_banned",
        action_path: "/projects/proj-x",
      },
      {
        recipient_github_id: "900",
        kind: "project_banned",
        action_path: "/admin",
      },
    ]);
  } finally {
    sqlite.close();
  }
});
