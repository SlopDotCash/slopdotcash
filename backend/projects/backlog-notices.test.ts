// Owner notices of the backlog rule (operator decision, 23 November 2026;
// PRD section 5). Each test runs the real migrations, stores merge activity
// rows, then runs the notice step twice to prove each notice is written once
// and only to the project's owner audience.
import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import {
  notificationAction,
  notificationTitle,
} from "../../src/lib/notifications";
import type { ProjectDefinition } from "../../src/lib/projects.mjs";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { sendBacklogNotices } from "./backlog-notices";

const migrations = readdirSync("migrations")
  .filter((f) => f.endsWith(".sql"))
  .sort();
const T = "2026-10-23T10:00:00.000Z";
const LISTER = "910000001";
const STEWARD = "910000002";
const ORG = "910000009";
const DAY = 86_400_000;

function open() {
  const { db, sqlite } = sqliteD1(migrations);
  const listProject = (id: string, steward: Record<string, string>) => {
    const manifest = JSON.stringify({
      id,
      status: "active",
      repositories: [{ id: `example/${id}` }],
      steward: { github: steward },
    });
    sqlite.exec(
      `INSERT INTO project_revisions (project_id,revision,manifest,manifest_sha256,reason,created_at,actor_github_id,actor_github_login)
         VALUES ('${id}',1,'${manifest}','${"a".repeat(64)}','Listed','${T}','${LISTER}','lister');
       INSERT INTO projects (id,status,revision,manifest,manifest_sha256,created_at,updated_at)
         VALUES ('${id}','active',1,'${manifest}','${"a".repeat(64)}','${T}','${T}');`,
    );
  };
  const store = (
    id: string,
    waiting: number,
    lastMergedAt: string | null,
    observedAt: string,
  ) =>
    sqlite
      .query(
        `INSERT INTO repository_merge_activity
           (project_id, repository, observed_at, attempted_at, last_merged_at,
            waiting_outside, waiting_capped, merged_outside_30d)
         VALUES (?, ?, ?, ?, ?, ?, 0, 0)
         ON CONFLICT (project_id, repository) DO UPDATE SET
           observed_at = excluded.observed_at,
           last_merged_at = excluded.last_merged_at,
           waiting_outside = excluded.waiting_outside`,
      )
      .run(id, `example/${id}`, observedAt, observedAt, lastMergedAt, waiting);
  const rows = () =>
    sqlite
      .query(
        "SELECT event_key, recipient_github_id, kind, subject, detail, action_path FROM notifications ORDER BY event_key, recipient_github_id",
      )
      .all() as {
      event_key: string;
      recipient_github_id: string;
      kind: string;
      subject: string;
      detail: string;
      action_path: string;
    }[];
  return { db, listProject, store, rows };
}

function manifest(
  id: string,
  extra: Record<string, unknown> = {},
): ProjectDefinition {
  return {
    id,
    status: "active",
    listingTier: "community",
    reward: { kind: "monthly-pool", monthlyCapMinor: "1000000" },
    ...extra,
  } as unknown as ProjectDefinition;
}

const ago = (now: Date, days: number) =>
  new Date(now.getTime() - days * DAY).toISOString();

test("before 1 December a project that would leave gets one preview", async () => {
  const { db, listProject, store, rows } = open();
  const now = new Date("2026-11-24T12:00:00.000Z");
  listProject("busy", { actorId: STEWARD });
  listProject("fine", { actorId: STEWARD });
  store("busy", 60, ago(now, 1), ago(now, 0.1));
  store("fine", 3, ago(now, 1), ago(now, 0.1));
  const projects = [manifest("busy"), manifest("fine")];
  for (let run = 0; run < 2; run += 1)
    await sendBacklogNotices(db as never, projects, now);
  const written = rows();
  expect(written).toEqual([
    {
      event_key: "backlog-rule:busy:preview",
      recipient_github_id: STEWARD,
      kind: "project_revision",
      subject: "busy",
      detail:
        "From 1 December 2026, a project with 50 or more outside pull requests waiting a week for a maintainer, or no merge in 14 days while outside pull requests wait, leaves the home page, /sponsors and agent discovery until that is fixed. Your project would leave today: 60 outside pull requests have waited a week or more for a maintainer. You can mark it as catching up on reviews for up to 14 days from its settings.",
      action_path: "/projects/busy/manage",
    },
  ]);
  const notice = {
    eventKey: written[0].event_key,
    kind: "project_revision",
    subject: "busy",
    actionPath: written[0].action_path,
  } as never;
  expect(notificationTitle(notice)).toBe("busy review backlog");
  expect(notificationAction(notice)).toBe("Open settings");
  // Still over the limit on 1 December: the out notice follows, once.
  const december = new Date("2026-12-01T06:00:00.000Z");
  store("busy", 60, ago(december, 1), ago(december, 0.1));
  for (let run = 0; run < 2; run += 1)
    await sendBacklogNotices(db as never, projects, december);
  expect(rows().map((row) => row.event_key)).toEqual([
    `backlog-rule:busy:out:backlog:${ago(december, 1)}`,
    "backlog-rule:busy:preview",
  ]);
});

test("from 1 December a warning at 10 days, then one notice per episode", async () => {
  const { db, listProject, store, rows } = open();
  listProject("quiet", { actorId: STEWARD });
  const projects = [manifest("quiet")];
  const merged = "2026-12-01T12:00:00.000Z";
  const at = (day: number) =>
    new Date(Date.parse(merged) + day * DAY + 3_600_000);
  for (const day of [9, 10, 11, 14, 15, 16]) {
    store("quiet", 2, merged, at(day).toISOString());
    await sendBacklogNotices(db as never, projects, at(day));
  }
  expect(rows().map((row) => row.event_key)).toEqual([
    `backlog-rule:quiet:out:dormant:${merged}`,
    `backlog-rule:quiet:warn:${merged}`,
  ]);
  expect(rows()[0].detail).toBe(
    "Your project left the home page, /sponsors and agent discovery: no pull request has been merged in 14 days while outside pull requests wait. It returns by itself once a maintainer merges. You can mark it as catching up on reviews for up to 14 days from its settings. Accepted work still records points.",
  );
  expect(rows()[1].detail).toBe(
    "No pull request has been merged in 10 days while outside pull requests wait. After 14 days the project leaves the home page, /sponsors and agent discovery until a maintainer merges. You can mark it as catching up on reviews for up to 14 days from its settings.",
  );
});

test("an Organization steward's notice goes to the lister; exempt and catching-up projects get none", async () => {
  const { db, listProject, store, rows } = open();
  const now = new Date("2026-12-10T12:00:00.000Z");
  listProject("org", { actorId: ORG, type: "Organization" });
  listProject("prize", { actorId: STEWARD });
  listProject("pause", { actorId: STEWARD });
  for (const id of ["org", "prize", "pause"])
    store(id, 70, ago(now, 1), ago(now, 0.1));
  await sendBacklogNotices(
    db as never,
    [
      manifest("org"),
      manifest("prize", {
        reward: { kind: "external-prize-share", monthlyCapMinor: "0" },
      }),
      manifest("pause", {
        slopbot: {
          automaticClosure: false,
          catchUpUntil: "2026-12-20T00:00:00.000Z",
          catchUpHistory: [{ startedAt: "2026-12-06T00:00:00.000Z" }],
        },
      }),
    ],
    now,
  );
  expect(rows().map((row) => [row.event_key, row.recipient_github_id])).toEqual(
    [[`backlog-rule:org:out:backlog:${ago(now, 1)}`, LISTER]],
  );
});

test("a stale or missing read sends nothing, and a database failure never throws", async () => {
  const { db, listProject, store, rows } = open();
  const now = new Date("2026-12-10T12:00:00.000Z");
  listProject("stale", { actorId: STEWARD });
  store("stale", 80, null, ago(now, 4));
  await sendBacklogNotices(
    db as never,
    [manifest("stale"), manifest("unread")],
    now,
  );
  expect(rows()).toEqual([]);
  const broken = {
    prepare() {
      throw new Error("D1 unavailable");
    },
  };
  expect(
    await sendBacklogNotices(broken as never, [manifest("stale")], now),
  ).toEqual({ attempted: 0, failed: 0 });
});
