// Exception-only inbox events (PRD section 9, NOT-01; migration 0063). Each
// test runs the real migrations, writes the source row, then replays the
// event statement to prove one source transition yields one notice per
// recipient, and that only the intended people receive it.
import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import type { ProjectDefinition } from "../../src/lib/projects.mjs";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { CloudflareProjectPersistence } from "../projects/cloudflare-persistence";
import {
  notifyProjectRevision,
  notifyProjectScanFailed,
  notifySecurityReportReceived,
  notifySlopbotInstallationLost,
} from "./events";
import { handleNotificationsApi } from "./handler";

const migrations = readdirSync("migrations")
  .filter((f) => f.endsWith(".sql"))
  .sort();
const T = "2026-10-23T10:00:00.000Z";
const R = "2026-10-23T11:00:00.000Z";
const APPLICANT = "910000001";
const STEWARD = "910000002";
const REPORTER = "910000004";
const ADMIN = { githubId: "1", githubLogin: "admin" };

function open() {
  const { db, sqlite } = sqliteD1(migrations);
  const rows = (recipient: string) =>
    sqlite
      .query(
        "SELECT event_key, kind, subject, detail, action_path FROM notifications WHERE recipient_github_id=? ORDER BY source_at, event_key",
      )
      .all(recipient) as {
      event_key: string;
      kind: string;
      subject: string;
      detail: string | null;
      action_path: string;
    }[];
  /** A listed project: legacy applicant plus GitHub steward. */
  const project = (id: string, status: "active" | "paused", repo: string) => {
    const manifestWith = (state: string) =>
      JSON.stringify({
        id,
        status: state,
        repositories: [{ id: repo }],
        steward: { github: { actorId: STEWARD } },
      });
    const manifest = manifestWith(status);
    // An application always carries the paused manifest it asked to list.
    sqlite.exec(
      `INSERT INTO project_applications (id,project_id,repository_key,manifest,manifest_sha256,acceptance_criteria,applicant_github_id,applicant_github_login,submitted_at,status,admin_notification,admin_notification_at,decided_at,decided_by_github_id,decided_by_github_login)
         VALUES ('application-${id}','${id}','${repo}','${manifestWith("paused")}','${"a".repeat(64)}','Merged pull requests','${APPLICANT}','applicant','${T}','approved','sent','${T}','${T}','1','admin');
       INSERT INTO project_revisions (project_id,revision,manifest,manifest_sha256,reason,created_at)
         VALUES ('${id}',1,'${manifest}','${"a".repeat(64)}','Listed','${T}');
       INSERT INTO projects (id,status,revision,manifest,manifest_sha256,created_at,updated_at,source_application_id)
         VALUES ('${id}','${status}',1,'${manifest}','${"a".repeat(64)}','${T}','${T}','application-${id}');
       INSERT INTO project_repositories (repository_key,project_id) VALUES ('${repo.toLowerCase()}','${id}');`,
    );
  };
  return { db, sqlite, rows, project };
}

describe("exception-only notification events", () => {
  test("setup completion is one project_ready notice, never sent to its publisher", async () => {
    const { db, rows, project } = open();
    project("alpha", "paused", "example/alpha");
    const persistence = new CloudflareProjectPersistence(db);
    const revise = (
      revision: number,
      status: "active" | "paused",
      actor: { githubId: string; githubLogin: string },
      at: string,
    ) => {
      const manifest = {
        id: "alpha",
        status,
        repositories: [{ id: "example/alpha" }],
        steward: { github: { actorId: STEWARD } },
      } as unknown as ProjectDefinition;
      return persistence.appendProjectRevision(
        {
          projectId: "alpha",
          expectedRevision: revision - 1,
          manifest,
          manifestText: JSON.stringify(manifest),
          manifestSha256: String(revision).repeat(64),
          reason: `Revision ${revision}`,
          actor,
          at,
        },
        0,
      );
    };
    // The automatic activation after installation and scan is setup completion.
    expect(await revise(2, "active", ADMIN, T)).toBe("updated");
    expect(await revise(2, "active", ADMIN, T)).toBe("conflict");
    const ready = {
      event_key: "project-revision:alpha:2",
      kind: "project_ready",
      subject: "alpha",
      detail: null,
      action_path: "/projects/alpha",
    };
    expect(rows(APPLICANT)).toEqual([ready]);
    expect(rows(STEWARD)).toEqual([ready]);
    // An active project's later edit is an ordinary revision, and the steward
    // who published it is not told about their own change.
    expect(
      await revise(3, "active", { githubId: STEWARD, githubLogin: "s" }, R),
    ).toBe("updated");
    expect(rows(STEWARD)).toEqual([ready]);
    expect(rows(APPLICANT)).toEqual([
      ready,
      {
        event_key: "project-revision:alpha:3",
        kind: "project_revision",
        subject: "alpha",
        detail: "Revision 3",
        action_path: "/projects/alpha",
      },
    ]);
  });

  test("a self-service first revision reports ready only when it is active", async () => {
    const { db, sqlite, rows } = open();
    for (const [id, status] of [
      ["gamma", "active"],
      ["delta", "paused"],
    ]) {
      const manifest = JSON.stringify({
        id,
        status,
        steward: { github: { actorId: STEWARD } },
      });
      sqlite.exec(
        `INSERT INTO project_revisions (project_id,revision,manifest,manifest_sha256,reason,actor_github_id,actor_github_login,created_at)
           VALUES ('${id}',1,'${manifest}','${"b".repeat(64)}','Owner setup','${APPLICANT}','owner','${T}');`,
      );
      for (let replay = 0; replay < 2; replay++)
        await db.batch([
          notifyProjectRevision(db, id, 1, "b".repeat(64), T),
        ] as never);
    }
    expect(rows(STEWARD).map((row) => [row.event_key, row.kind])).toEqual([
      ["project-revision:gamma:1", "project_ready"],
    ]);
    // The owner who completed setup is the publisher and gets no notice.
    expect(rows(APPLICANT)).toEqual([]);
  });

  test("a scan that cannot finish reaches the owners once; other results write nothing", async () => {
    const { db, sqlite, rows, project } = open();
    project("alpha", "paused", "example/alpha");
    for (const [id, state] of [
      ["vet_incomplete1", "incomplete"],
      ["vet_cleanresult", "clean"],
    ]) {
      const result = JSON.stringify({
        assessmentId: id,
        disposition: state,
        assessed: { commitSha: "c".repeat(40), templateSha256: "d".repeat(64) },
      });
      sqlite.exec(
        `INSERT INTO vetting_assessments (id,project_id,revision,manifest_sha256,content_sha256,commit_sha,template_sha256,requested_by_github_id,requested_by_github_login,requested_at,request_reason,state,policy_version,result,result_sha256,signing_key_sha256,completed_at)
           VALUES ('${id}','alpha',1,'${"a".repeat(64)}','${"e".repeat(64)}','${"c".repeat(40)}','${"d".repeat(64)}','${APPLICANT}','applicant','${T}','Setup scan','${state}','policy-1','${result}','${"f".repeat(64)}','${"0".repeat(64)}','${R}');`,
      );
      for (let replay = 0; replay < 2; replay++)
        await db.batch([notifyProjectScanFailed(db, id)] as never);
    }
    const failed = [
      {
        event_key: "project-scan:vet_incomplete1",
        kind: "project_scan_failed",
        subject: "alpha",
        detail: null,
        action_path: "/projects/alpha",
      },
    ];
    expect(rows(APPLICANT)).toEqual(failed);
    expect(rows(STEWARD)).toEqual(failed);
  });

  test("losing the Slopbot installation reaches each affected project's owners once", async () => {
    const { db, sqlite, rows, project } = open();
    project("alpha", "active", "example/alpha");
    project("beta", "active", "elsewhere/beta");
    // Self-service organization setup has no application row. Its human
    // creator must still receive the installation failure, once on replay.
    const manifest = JSON.stringify({
      id: "gamma",
      status: "active",
      repositories: [{ id: "example/gamma" }],
      steward: { github: { actorId: STEWARD } },
    });
    sqlite.exec(
      `INSERT INTO project_revisions (project_id,revision,manifest,manifest_sha256,reason,actor_github_id,actor_github_login,created_at)
         VALUES ('gamma',1,'${manifest}','${"b".repeat(64)}','Owner setup','${APPLICANT}','creator','${T}');
       INSERT INTO projects (id,status,revision,manifest,manifest_sha256,created_at,updated_at,source_application_id)
         VALUES ('gamma','active',1,'${manifest}','${"b".repeat(64)}','${T}','${T}',NULL);
       INSERT INTO project_repositories (repository_key,project_id) VALUES ('example/gamma','gamma');`,
    );
    sqlite.exec(
      `INSERT INTO slopbot_installations (installation_id,account_id,account_login,account_type,created_at,removed_at)
         VALUES (55,77,'Example','Organization','${T}','${R}'),
                (56,78,'elsewhere','Organization','${T}',NULL);`,
    );
    for (let replay = 0; replay < 2; replay++)
      await db.batch([
        notifySlopbotInstallationLost(db, 55, R),
        // A time that is not the recorded change writes nothing.
        notifySlopbotInstallationLost(db, 56, R),
        notifySlopbotInstallationLost(db, 55, T),
      ] as never);
    const lost = [
      {
        event_key: `slopbot-installation:55:${R}:alpha`,
        kind: "project_installation_lost",
        subject: "alpha",
        detail: null,
        action_path: "/projects/alpha",
      },
    ];
    lost.push({
      event_key: `slopbot-installation:55:${R}:gamma`,
      kind: "project_installation_lost",
      subject: "gamma",
      detail: null,
      action_path: "/projects/gamma",
    });
    expect(rows(APPLICANT)).toEqual(lost);
    expect(rows(STEWARD)).toEqual(lost);
  });

  test("a verified report receipt reaches only its reporter, once, with no acknowledgment", async () => {
    const { db, sqlite, rows, project } = open();
    project("alpha", "active", "example/alpha");
    const insertCase = (id: string, ghsa: string, verified: boolean) =>
      sqlite.exec(
        `INSERT INTO security_cases (id,project_id,advisory_repository,advisory_ghsa,reporter_github_id,reporter_github_login,submission_state,received_at,verified_at,verified_by_github_id,receipt_state,remediation_state,award_state,payment_state,disclosure_state,recognition,appeal_state,revision,created_at,updated_at)
           VALUES ('${id}','alpha','example/alpha','${ghsa}','${REPORTER}','reporter','${verified ? "verified" : "claimed"}',${verified ? `'${T}'` : "NULL"},${verified ? `'${R}'` : "NULL"},${verified ? `'${STEWARD}'` : "NULL"},'received','not-started','not-applicable','not-applicable','embargoed','private','none',1,'${T}','${T}');`,
      );
    insertCase("sc_receipt0001", "GHSA-aaaa-bbbb-cccc", true);
    insertCase("sc_claimonly01", "GHSA-dddd-eeee-ffff", false);
    for (let replay = 0; replay < 2; replay++)
      await db.batch([
        notifySecurityReportReceived(db, "sc_receipt0001"),
        notifySecurityReportReceived(db, "sc_claimonly01"),
      ] as never);
    expect(rows(REPORTER)).toEqual([
      {
        event_key: "security-receipt:sc_receipt0001",
        kind: "security_report_received",
        subject: "sc_receipt0001",
        detail: null,
        action_path: "/security?case=sc_receipt0001",
      },
    ]);
    expect(rows(STEWARD)).toEqual([]);
    // The private queue carries it under the receipt template; activity mail
    // never does.
    expect(
      sqlite
        .query(
          "SELECT recipient_github_id, template_version FROM security_notification_outbox",
        )
        .all(),
    ).toEqual([
      {
        recipient_github_id: REPORTER,
        template_version: "security-receipt-v1",
      },
    ]);
    expect(
      sqlite.query("SELECT count(*) n FROM activity_notification_outbox").get(),
    ).toEqual({ n: 0 });
    const response = await handleNotificationsApi(
      new Request("https://slop.cash/api/v1/notifications"),
      {
        db: db as never,
        sessionActor: async () => ({ githubId: REPORTER }),
        now: () => new Date(R),
      },
    );
    const body = (await response?.json()) as {
      notifications: Record<string, unknown>[];
    };
    expect(body.notifications).toHaveLength(1);
    expect(Object.hasOwn(body.notifications[0], "acknowledgedAt")).toBe(false);
  });
});
