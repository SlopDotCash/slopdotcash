import { expect, test } from "bun:test";
import {
  isNotificationEventKey,
  parseNotificationsResponse,
} from "../../src/lib/notifications";
import { seedParticipationBan } from "../../tests/participation-ban.fixture";
import { sqliteD1 } from "../../tests/sqlite-d1";
import {
  notifyTraceLicensingAvailable,
  TRACE_LICENSING_BAN_QUERY,
  TRACE_LICENSING_EVENT_KEY,
  TRACE_LICENSING_NOTICE,
  TRACE_LICENSING_RECIPIENTS_SQL,
} from "../notifications/events";
import { handleNotificationsApi } from "../notifications/handler";
import { PARTICIPATION_BAN_QUERY } from "../projects/account-bans";

const NOW = "2026-11-23T12:00:00.000Z";

function harness() {
  const { db, sqlite } = sqliteD1();
  let seq = 0;
  const member = (github: string, closed = false) =>
    sqlite
      .query(
        "INSERT INTO points_members(actor_id,github_id,login,joined_at,public,closed_at) VALUES(?,?,?,?,1,?)",
      )
      .run(
        `actor-${github}`,
        github,
        `login${github}`,
        NOW,
        closed ? NOW : null,
      );
  const run = (github: string, state = "finalized") => {
    seq += 1;
    const id = `run-${github}-${seq}`;
    sqlite
      .query(
        `INSERT INTO trace_runs (id, client_run_id, github_user_id, github_login, project_id,
           repository, project_policy_revision, provider, model, client, client_version,
           state, trace_sha256, created_at, finalized_at, create_idempotency_key, terms_version)
         VALUES (?, ?, ?, 'login', 'slopdotcash', 'SlopDotCash/slopdotcash', 'rev-1',
           'anthropic', 'claude-opus-5-5', 'claude-code', '1.0.0', ?, ?, ?, ?, ?, 'private-trace-v2')`,
      )
      .run(
        id,
        `client-${id}`,
        github,
        state,
        seq.toString(16).padStart(8, "0").repeat(8),
        NOW,
        state === "finalized" ? NOW : null,
        `create-${id}`,
      );
  };
  const notices = () =>
    sqlite
      .query(
        "SELECT recipient_github_id AS id, kind, detail, action_path FROM notifications ORDER BY recipient_github_id",
      )
      .all() as {
      id: string;
      kind: string;
      detail: string;
      action_path: string;
    }[];
  const send = async () => {
    await notifyTraceLicensingAvailable(db, NOW).run();
  };
  const count = () =>
    (
      sqlite.query(TRACE_LICENSING_RECIPIENTS_SQL).get() as {
        recipients: number;
      }
    ).recipients;
  return { db, sqlite, member, run, notices, send, count };
}

test("notifies each eligible account once; skips banned and closed; second run adds nothing", async () => {
  const h = harness();
  for (const id of ["111", "112", "113", "114", "115", "116"])
    h.member(id, id === "113");
  h.run("111");
  h.run("111");
  h.run("112");
  h.run("113"); // closed
  h.run("114"); // banned
  h.run("115", "awaiting_trace"); // no finalized trace
  seedParticipationBan(
    h.sqlite,
    { githubId: "114", githubLogin: "login114" },
    { githubId: "900", githubLogin: "mod" },
    NOW,
  );
  expect(h.count()).toBe(2);
  await h.send();
  const first = h.notices();
  expect(first.map((n) => n.id)).toEqual(["111", "112"]);
  for (const n of first) {
    expect(n.kind).toBe("trace_licensing_available");
    expect(n.detail).toBe(TRACE_LICENSING_NOTICE);
    expect(n.action_path).toBe("/account#trace-licensing");
  }
  expect(TRACE_LICENSING_EVENT_KEY).toBe("trace-licensing:available-2026-11");
  expect(isNotificationEventKey(TRACE_LICENSING_EVENT_KEY)).toBe(true);
  expect(h.count()).toBe(0);
  h.run("116");
  expect(h.count()).toBe(1);
  await h.send();
  expect(h.notices().map((n) => n.id)).toEqual(["111", "112", "116"]);
  await h.send();
  expect(h.notices()).toHaveLength(3);
});

test("the script's literal statement works without bindings and is idempotent", async () => {
  const { withNoticeTime } = await import(
    "../../scripts/announce-trace-licensing"
  );
  const { TRACE_LICENSING_AVAILABLE_SQL } = await import(
    "../notifications/events"
  );
  const h = harness();
  h.member("111");
  h.run("111");
  const sql = withNoticeTime(TRACE_LICENSING_AVAILABLE_SQL, new Date(NOW));
  expect(sql).not.toContain("?");
  h.sqlite.exec(sql);
  h.sqlite.exec(sql);
  expect(h.notices().map((n) => n.id)).toEqual(["111"]);
});

test("an uploader with no points_members row is notified once", async () => {
  const h = harness();
  h.run("121");
  h.run("121");
  expect(h.count()).toBe(1);
  await h.send();
  await h.send();
  expect(h.notices().map((n) => n.id)).toEqual(["121"]);
  expect(h.count()).toBe(0);
});

test("the notice reaches the recipient's Inbox, parses on the page and can be marked read", async () => {
  const h = harness();
  h.run("131");
  await h.send();
  const origin = "https://slop.cash";
  const call = (request: Request) =>
    handleNotificationsApi(request, {
      db: h.db as never,
      sessionActor: async () => ({ githubId: "131" }),
      now: () => new Date("2026-11-23T13:00:00.000Z"),
    });
  const listed = (await call(
    new Request(`${origin}/api/v1/notifications`),
  )) as Response;
  expect(listed.status).toBe(200);
  const inbox = parseNotificationsResponse(await listed.json());
  expect(inbox.unread).toBe(1);
  expect(inbox.notifications).toHaveLength(1);
  const [notice] = inbox.notifications;
  expect(notice.eventKey).toBe(TRACE_LICENSING_EVENT_KEY);
  expect(notice.kind).toBe("trace_licensing_available");
  expect(notice.detail).toBe(TRACE_LICENSING_NOTICE);
  expect(notice.actionPath).toBe("/account#trace-licensing");
  const marked = (await call(
    new Request(`${origin}/api/v1/notifications/read`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ eventKeys: [notice.eventKey] }),
    }),
  )) as Response;
  expect(marked.status).toBe(200);
  expect(await marked.json()).toEqual({ marked: 1 });
  const after = parseNotificationsResponse(
    await (
      (await call(new Request(`${origin}/api/v1/notifications`))) as Response
    ).json(),
  );
  expect(after.unread).toBe(0);
  expect(after.notifications[0].readAt).toBe("2026-11-23T13:00:00.000Z");
});

test("the notice text and event key contain no single quote", () => {
  // The script interpolates both between single quotes in literal SQL.
  expect(TRACE_LICENSING_NOTICE).not.toContain("'");
  expect(TRACE_LICENSING_EVENT_KEY).not.toContain("'");
});

test("the audience's ban check is rewritten to the uploader, with nothing left to bind", () => {
  // If the shared ban query's text changes, the rewrite must not silently
  // keep a bound "?" that would read NULL and let banned accounts through.
  expect(TRACE_LICENSING_BAN_QUERY).not.toBe(PARTICIPATION_BAN_QUERY);
  expect(TRACE_LICENSING_BAN_QUERY).toContain(
    "b.github_id = run.github_user_id",
  );
  expect(TRACE_LICENSING_BAN_QUERY).not.toContain("?");
});

test("the script reads wrangler's count and rows written, and refuses anything else", async () => {
  const { recipientCount, rowsWritten } = await import(
    "../../scripts/announce-trace-licensing"
  );
  expect(
    recipientCount(JSON.stringify([{ results: [{ recipients: 54 }] }])),
  ).toBe(54);
  expect(
    rowsWritten(JSON.stringify([{ results: [], meta: { changes: 54 } }])),
  ).toBe(54);
  for (const bad of [
    "[]",
    JSON.stringify([{ results: [] }]),
    JSON.stringify([{ results: [{ recipients: "54" }] }]),
    JSON.stringify([{ results: [{ recipients: -1 }] }]),
  ])
    expect(() => recipientCount(bad)).toThrow();
  expect(() => rowsWritten(JSON.stringify([{ results: [] }]))).toThrow();
});
