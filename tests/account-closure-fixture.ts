/** Synthetic account records shared by API and browser acceptance checks. */
import { readdirSync, readFileSync } from "node:fs";
import { assertProjectDefinition } from "../src/lib/project-schema.mjs";
import { sha256Hex } from "../workers/identity/crypto";
import { applicationManifest } from "./project-application-manifest";
import { sqliteD1 } from "./sqlite-d1";
export const ME = {
  actor: "U_closing",
  github: "4100",
  login: "Closing-Member",
};
export const OTHER = {
  actor: "U_staying",
  github: "4200",
  login: "staying-member",
};
export async function seedAccountClosure(
  now = "2026-10-23T12:00:00.000Z",
  withObligations = true,
) {
  const NOW = now;
  const migrations = readdirSync(new URL("../migrations", import.meta.url))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  // Both members joined before participation points were discontinued, so
  // they carry a historical welcome award and this member a historical X
  // connection award; the later migrations must keep both untouched.
  const discontinued = migrations.indexOf(
    "0080_points_participation_discontinued.sql",
  );
  const { db, sqlite } = sqliteD1(migrations.slice(0, discontinued));
  const tokens = {
    me: "m".repeat(48),
    meOther: "n".repeat(48),
    other: "o".repeat(48),
  };
  for (const member of [ME, OTHER])
    sqlite
      .prepare(
        "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES(?,?,?,?,1)",
      )
      .run(member.actor, member.github, member.login, NOW);
  sqlite.exec(`
    INSERT INTO points_x_claims VALUES ('77','${ME.actor}','${NOW}');
    INSERT INTO points_x_awards VALUES ('${ME.actor}','77','${NOW}',10);
  `);
  for (const migration of migrations.slice(discontinued))
    sqlite.exec(
      readFileSync(
        new URL(`../migrations/${migration}`, import.meta.url),
        "utf8",
      ),
    );
  for (const [token, actor] of [
    [tokens.me, ME.actor],
    [tokens.meOther, ME.actor],
    [tokens.other, OTHER.actor],
  ])
    sqlite
      .prepare(
        "INSERT INTO points_sessions(token_hash,actor_id,expires_at) VALUES(?,?,?)",
      )
      .run(
        await sha256Hex(token),
        actor,
        new Date(Date.parse(NOW) + 7_200_000).toISOString(),
      );
  const manifest = JSON.stringify(
    assertProjectDefinition(
      applicationManifest("alpha", "example/alpha", {
        rewardAsset: {
          network: "ethereum",
          kind: "stablecoin",
          address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
          symbol: "USDC",
          decimals: 6,
          chainId: "1",
          cluster: null,
          verifiedAt: NOW,
        },
      }),
    ),
  ).replaceAll("'", "''");
  sqlite.exec(`
    INSERT INTO points_x_links VALUES ('${ME.actor}','77','closing_x','${NOW}',1);
    INSERT INTO points_x_flows VALUES ('state','browser','session','${ME.actor}','v','iv','2026-10-23T12:10:00.000Z',1,'pending');
    INSERT INTO points_telegram_claims VALUES ('88','${ME.actor}','${NOW}');
    INSERT INTO points_telegram_links VALUES ('${ME.actor}','88','closing_tg','${NOW}',1);
    INSERT INTO points_telegram_flows VALUES ('code','session','${ME.actor}','2026-10-23T12:10:00.000Z',1,'pending');
    INSERT INTO notification_email_preferences VALUES ('${ME.github}',1,'${"d".repeat(64)}','${NOW}');
    INSERT INTO wallet_claims (id,github_user_id,github_login,wallet_address,source,issue_repository,issue_number,source_body_sha256,observed_at,record_sha256,supersedes_claim_id,created_at,chain)
      VALUES ('claim-1','${ME.github}','${ME.login}','0x8f77c37d8650776bfe73c9b12b15209ee15d9b86','d1_registry',NULL,NULL,'${"a".repeat(64)}','${NOW}','${"b".repeat(64)}',NULL,'${NOW}','base');
  `);
  if (withObligations)
    sqlite.exec(`
    INSERT INTO notifications (event_key,recipient_github_id,kind,subject,action_path,source_at,created_at)
      VALUES ('payment-reserved:obligation-1','${ME.github}','award_reserved','alpha','/earnings','${NOW}','${NOW}');
    INSERT INTO payment_obligations VALUES ('obligation-1','alpha','${ME.github}','base-sepolia','base','0x2222222222222222222222222222222222222222','0x3333333333333333333333333333333333333333',6,'100000000','2000000','${"9".repeat(64)}','reserved','${NOW}',NULL);
    INSERT INTO project_revisions (project_id,revision,manifest,manifest_sha256,reason,created_at)
      VALUES ('alpha',1,'${manifest}','${"a".repeat(64)}','Listed','${NOW}');
    INSERT INTO projects (id,status,revision,manifest,manifest_sha256,created_at,updated_at)
      VALUES ('alpha','paused',1,'${manifest}','${"a".repeat(64)}','${NOW}','${NOW}');
    INSERT INTO security_cases (id,project_id,advisory_repository,advisory_ghsa,reporter_github_id,reporter_github_login,submission_state,received_at,verified_at,verified_by_github_id,receipt_state,remediation_state,award_state,payment_state,disclosure_state,recognition,appeal_state,revision,created_at,updated_at)
      VALUES ('sc_closing0001','alpha','example/alpha','GHSA-aaaa-bbbb-cccc','${ME.github}','${ME.login}','verified','${NOW}','${NOW}','4200','received','not-started','not-applicable','not-applicable','embargoed','private','none',1,'${NOW}','${NOW}');
  `);
  return { db, sqlite, tokens };
}
