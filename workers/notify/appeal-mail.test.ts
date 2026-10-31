import { afterEach, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { handleEmailPreferences } from "../../backend/notifications/email";
import { notifyPointsDispute } from "../../backend/notifications/events";
import type { NotificationsDependencies } from "../../backend/notifications/handler";
import type { SecurityD1Database } from "../../backend/security/handler";
import { type PointRevision, pointRevisionId } from "../../src/lib/points";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { escalateAppeal } from "../slopbot/appeals";
import {
  type ActivityMailDependencies,
  activityMailEligibility,
  dispatchActivityMail,
  parseActivityMailConfig,
} from "./activity";

const NOW = "2026-10-30T14:00:00.000Z";
const DUE = "2099-11-06T14:00:00.000Z";

const databases: { close(): void }[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

async function setup() {
  const { db: source, sqlite } = sqliteD1(
    readdirSync("migrations")
      .filter((p) => p.endsWith(".sql"))
      .sort(),
  );
  databases.push(sqlite);
  const db = source as unknown as SecurityD1Database;
  const now = new Date(NOW);
  const config = parseActivityMailConfig(
    JSON.stringify({
      inboxUrl: "https://staging.slop.cash/inbox",
      recipients: {
        "101": {
          email: "active-mod@example.com",
          verifiedAt: NOW,
          evidenceReference: "pilot-active-mod",
        },
        "102": {
          email: "revoked-mod@example.com",
          verifiedAt: NOW,
          evidenceReference: "pilot-revoked-mod",
        },
        "103": {
          email: "appellant@example.com",
          verifiedAt: NOW,
          evidenceReference: "pilot-appellant",
        },
      },
    }),
  );
  if (!config) throw new Error("Pilot fixture invalid");

  for (const githubId of ["101", "102", "103"]) {
    const eligibility = await activityMailEligibility(config, githubId, now);
    if (!eligibility.available) throw new Error("Recipient unavailable");
    const response = await handleEmailPreferences(
      new Request("https://slop.test/api/v1/notifications/email", {
        method: "POST",
        headers: {
          origin: "https://slop.test",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          enabled: true,
          destinationVersion: eligibility.destinationVersion,
        }),
      }),
      {
        db: db as unknown as NotificationsDependencies["db"],
        sessionActor: async () => ({ githubId }),
        now: () => now,
        eligibility: async (id) => activityMailEligibility(config, id, now),
      },
    );
    expect(response?.status).toBe(200);
  }

  const sent: { to: string; mime: string }[] = [];
  const mail: ActivityMailDependencies = {
    db,
    moderatorGithubIds: new Set(["101"]),
    config,
    fromAddress: "notifications@slop.cash",
    now: () => new Date(Date.now() + 60_000),
    sendEmail: async (_from, to, mime) => {
      sent.push({ to, mime });
    },
  };

  const outbox = () =>
    sqlite
      .query(
        "SELECT event_key, recipient_github_id, state FROM activity_notification_outbox ORDER BY event_key, recipient_github_id",
      )
      .all() as {
      event_key: string;
      recipient_github_id: string;
      state: string;
    }[];

  return { db, source, sqlite, mail, sent, outbox };
}

test("value dispute escalation mail suppresses revoked moderators and resolved disputes", async () => {
  const h = await setup();
  const openKey = `value-appeal:single:${"a".repeat(64)}:103:1:10`;
  const resolvedKey = `value-appeal:single:${"b".repeat(64)}:103:1:11`;

  for (const [key, item] of [
    [openKey, "PR_open_10"],
    [resolvedKey, "PR_resolved_11"],
  ] as const) {
    h.sqlite
      .query(
        `INSERT INTO slopbot_appeals(
          appeal_key, repository_id, item_node_id, appellant_github_id,
          job_json, opened_at, due_at
        ) VALUES (?, 1, ?, '103', '{}', ?, ?)`,
      )
      .run(key, item, NOW, DUE);
  }

  await escalateAppeal(
    h.source,
    openKey,
    "Independent moderator review required",
    new Set(["101", "102"]),
  );
  await escalateAppeal(
    h.source,
    resolvedKey,
    "Independent moderator review required",
    new Set(["101"]),
  );
  const resolvedAt = new Date().toISOString();
  h.sqlite
    .query(
      "UPDATE slopbot_appeals SET resolved_at=?, resolution='denied', resolved_by='moderator' WHERE appeal_key=?",
    )
    .run(resolvedAt, resolvedKey);

  await dispatchActivityMail(h.mail);

  expect(h.outbox()).toEqual([
    {
      event_key: `slopbot-${openKey}`,
      recipient_github_id: "101",
      state: "provider-accepted",
    },
    {
      event_key: `slopbot-${openKey}`,
      recipient_github_id: "102",
      state: "suppressed",
    },
    {
      event_key: `slopbot-${resolvedKey}`,
      recipient_github_id: "101",
      state: "suppressed",
    },
  ]);
  expect(h.sent.map((item) => item.to)).toEqual(["active-mod@example.com"]);
});

test("Points dispute escalation mail suppresses revoked moderators and resolved disputes while delivering appellant notices", async () => {
  const h = await setup();
  const base: Omit<PointRevision, "id"> = {
    previous: null,
    recordedAt: NOW,
    sourceDigest: "c".repeat(64),
    sourceRule: "legacy-reviewed-award",
    award: {
      key: "alpha:manual:103",
      actor: { id: btoa("04:User103"), login: "appellant" },
      projectId: "alpha",
      category: "evaluated-contribution",
      amount: 90,
      occurredAt: NOW,
      sourceId: "manual-award-103",
      sourceUrl: "https://example.com/accepted-work",
      workUnitId: "manual-award-103",
      provisional: false,
    },
  };
  const revisionA: PointRevision = { ...base, id: pointRevisionId(base) };
  const baseB: Omit<PointRevision, "id"> = {
    ...base,
    sourceDigest: "d".repeat(64),
    award: { ...base.award, key: "alpha:manual:104", sourceId: "manual-104" },
  };
  const revisionB: PointRevision = { ...baseB, id: pointRevisionId(baseB) };

  for (const r of [revisionA, revisionB]) {
    h.sqlite
      .query(
        "INSERT INTO points_revisions(id,source_key,previous,recorded_at,payload) VALUES(?,?,?,?,?)",
      )
      .run(r.id, r.award.key, r.previous, r.recordedAt, JSON.stringify(r));
  }

  const openKey = `points-dispute:${"c".repeat(64)}`;
  const resolvedKey = `points-dispute:${"d".repeat(64)}`;

  for (const [key, revId] of [
    [openKey, revisionA.id],
    [resolvedKey, revisionB.id],
  ] as const) {
    h.sqlite
      .query(
        `INSERT INTO points_disputes(
          appeal_key, revision_id, item_node_id, appellant_github_id,
          statement, opened_at, due_at
        ) VALUES (?, ?, ?, '103', 'Review manual award.', ?, ?)`,
      )
      .run(key, revId, revId, NOW, DUE);
  }

  await notifyPointsDispute(h.source, openKey, "opened", NOW).run();
  await escalateAppeal(
    h.source,
    openKey,
    "Original work evidence needs independent moderator review",
    new Set(["101", "102"]),
    "points_disputes",
  );
  await escalateAppeal(
    h.source,
    resolvedKey,
    "Original work evidence needs independent moderator review",
    new Set(["101"]),
    "points_disputes",
  );
  const resolvedAt = new Date().toISOString();
  h.sqlite
    .query(
      `UPDATE points_disputes
          SET resolved_at=?, resolution='upheld', resolved_by='moderator',
              resolution_reason='Date corrected.', resolver_github_id='101'
        WHERE appeal_key=?`,
    )
    .run(resolvedAt, resolvedKey);
  await notifyPointsDispute(
    h.source,
    resolvedKey,
    "resolved",
    resolvedAt,
  ).run();

  await dispatchActivityMail(h.mail);

  expect(h.outbox()).toEqual([
    {
      event_key: `slopbot-${openKey}`,
      recipient_github_id: "101",
      state: "provider-accepted",
    },
    {
      event_key: `slopbot-${openKey}`,
      recipient_github_id: "102",
      state: "suppressed",
    },
    {
      event_key: `slopbot-${openKey}`,
      recipient_github_id: "103",
      state: "provider-accepted",
    },
    {
      event_key: `slopbot-${resolvedKey}`,
      recipient_github_id: "101",
      state: "suppressed",
    },
    {
      event_key: `slopbot-${resolvedKey}:resolved`,
      recipient_github_id: "103",
      state: "provider-accepted",
    },
  ]);
  expect(h.sent.map((item) => item.to).sort()).toEqual([
    "active-mod@example.com",
    "appellant@example.com",
    "appellant@example.com",
  ]);
});
