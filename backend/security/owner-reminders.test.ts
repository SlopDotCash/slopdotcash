/**
 * The weekly reminder to a project's report reviewers (operator decision,
 * 25 November 2026; PRD section 8), against real migrated SQLite.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { applicationManifest } from "../../tests/project-application-manifest";
import { sqliteD1 } from "../../tests/sqlite-d1";
import type { D1Database, D1QueryStatement } from "../d1";
import {
  ownerReminderKey,
  REMINDER_AFTER_DAYS,
  sendOwnerReminders,
} from "./owner-reminders";

const NOW = "2026-11-25T12:00:00.000Z";
const DAY = 24 * 60 * 60 * 1000;
const before = (ms: number, from = NOW) =>
  new Date(Date.parse(from) - ms).toISOString();

function fixture() {
  const { db, sqlite } = sqliteD1();
  const database = db as unknown as D1Database<D1QueryStatement>;
  let ghsa = 0;
  const project = (id: string, reviewers?: string[]) => {
    const base = applicationManifest(id, `example/${id}`, {
      status: "active",
    }) as Record<string, unknown>;
    const manifest = reviewers
      ? {
          ...base,
          securityBounty: {
            approvers: {
              technical: reviewers.map((githubId) => ({
                githubId,
                githubLogin: `reviewer-${githubId}`,
              })),
            },
          },
        }
      : base;
    const text = JSON.stringify(manifest);
    const digest = createHash("sha256").update(text).digest("hex");
    sqlite
      .query(
        "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,actor_github_id,actor_github_login,created_at) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(id, 1, text, digest, "Fixture terms", "900000001", "lister", NOW);
    sqlite
      .query(
        "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'active',1,?,?,?,?)",
      )
      .run(id, text, digest, NOW, NOW);
    return manifest;
  };
  const addCase = (
    id: string,
    projectId: string,
    createdAt: string,
    receiptState = "received",
  ) => {
    ghsa += 1;
    sqlite
      .query(
        `INSERT INTO security_cases (id,project_id,advisory_repository,advisory_ghsa,reporter_github_id,reporter_github_login,submission_state,received_at,verified_at,verified_by_github_id,receipt_state,remediation_state,award_state,payment_state,disclosure_state,recognition,appeal_state,revision,created_at,updated_at)
         VALUES (?,?,?,?,'730000002','reporter','verified',?,?,'1',?,'not-started','not-applicable','not-applicable','embargoed','private','none',1,?,?)`,
      )
      .run(
        id,
        projectId,
        `example/${projectId}`,
        `GHSA-${String(ghsa).padStart(4, "a")}-bbbb-cccc`,
        createdAt,
        createdAt,
        receiptState,
        createdAt,
        createdAt,
      );
  };
  const notices = () =>
    sqlite
      .query(
        "SELECT event_key, recipient_github_id, kind, subject, detail, action_path FROM notifications ORDER BY subject, recipient_github_id, event_key",
      )
      .all() as {
      event_key: string;
      recipient_github_id: string;
      kind: string;
      subject: string;
      detail: string;
      action_path: string;
    }[];
  return { database, sqlite, project, addCase, notices };
}

describe("owner reminders", () => {
  test("each reviewer of a program with reports waiting over a week gets one notice a week", async () => {
    const t = fixture();
    t.project("alpha", ["810000001", "810000002"]);
    t.project("beta", ["810000003"]);
    t.project("gamma", ["810000004"]);
    // alpha: two old reports, one recent, one decided.
    t.addCase("sc_alpha00001", "alpha", before(30 * DAY));
    t.addCase("sc_alpha00002", "alpha", before(9 * DAY), "triaging");
    t.addCase("sc_alpha00003", "alpha", before(2 * DAY));
    t.addCase("sc_alpha00004", "alpha", before(40 * DAY), "rejected");
    // beta: only a recent report. gamma: nothing open.
    t.addCase("sc_beta000001", "beta", before(REMINDER_AFTER_DAYS * DAY - 1));
    t.addCase("sc_gamma00001", "gamma", before(50 * DAY), "duplicate");

    const first = await sendOwnerReminders(t.database, new Date(NOW));
    expect(first).toEqual({ projects: 1, failed: 0 });
    const week = ownerReminderKey("alpha", new Date(NOW));
    expect(week).toBe("security-queue:alpha:2026-W48");
    expect(t.notices()).toEqual(
      ["810000001", "810000002"].map((recipient) => ({
        event_key: week,
        recipient_github_id: recipient,
        kind: "project_revision",
        subject: "alpha",
        detail:
          "2 private reports have waited more than 7 days for a decision. The oldest was received on 26 October 2026.",
        action_path: "/inbox",
      })),
    );
    // The notice names no case, reporter or advisory.
    expect(JSON.stringify(t.notices())).not.toMatch(/sc_|GHSA|730000002/u);

    // The same week again writes nothing new.
    await sendOwnerReminders(t.database, new Date(Date.parse(NOW) + 2 * DAY));
    const alpha = () => t.notices().filter((n) => n.subject === "alpha");
    expect(alpha()).toHaveLength(2);
    // beta's report has now waited past seven days, so its reviewer is told.
    expect(t.notices().filter((n) => n.subject === "beta")).toMatchObject([
      { recipient_github_id: "810000003" },
    ]);
    // The next week writes one more each, with the count as it then stands.
    await sendOwnerReminders(t.database, new Date(Date.parse(NOW) + 7 * DAY));
    const later = alpha().filter((n) => n.event_key.endsWith("W49"));
    expect(later).toHaveLength(2);
    expect(later[0].detail).toStartWith("3 private reports have waited");
  });

  test("a project with no program reminds its steward, and one report reads in the singular", async () => {
    const t = fixture();
    const manifest = t.project("plain") as {
      steward: { githubId?: string };
    };
    t.addCase("sc_plain00001", "plain", before(8 * DAY));
    expect(await sendOwnerReminders(t.database, new Date(NOW))).toEqual({
      projects: 1,
      failed: 0,
    });
    const notices = t.notices();
    expect(notices.length).toBeGreaterThan(0);
    expect(notices[0].detail).toBe(
      "1 private report has waited more than 7 days for a decision. It was received on 17 November 2026.",
    );
    for (const notice of notices)
      expect(notice.recipient_github_id).toMatch(/^[1-9][0-9]*$/u);
    expect(manifest.steward).toBeDefined();
  });

  test("a report that waits for its deposit is not counted", async () => {
    const t = fixture();
    t.project("alpha", ["810000001"]);
    t.addCase("sc_alpha00001", "alpha", before(20 * DAY));
    t.sqlite
      .query(
        `INSERT INTO security_report_deposits (case_id,project_id,item,mode,slop_amount,slop_per_usd,asked_at)
         VALUES ('sc_alpha00001','alpha','item-1','asked','1','1',?)`,
      )
      .run(NOW);
    expect(await sendOwnerReminders(t.database, new Date(NOW))).toEqual({
      projects: 0,
      failed: 0,
    });
    expect(t.notices()).toEqual([]);
  });
});
