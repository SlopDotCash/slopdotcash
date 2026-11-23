import { expect, test } from "bun:test";
import { seedParticipationBan } from "../../tests/participation-ban.fixture";
import { sqliteD1 } from "../../tests/sqlite-d1";
import {
  notifyTraceLicensingAvailable,
  TRACE_LICENSING_EVENT_KEY,
  TRACE_LICENSING_NOTICE,
  TRACE_LICENSING_RECIPIENTS_SQL,
} from "../notifications/events";

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
  return { sqlite, member, run, notices, send, count };
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
  expect(TRACE_LICENSING_EVENT_KEY).toBe("trace-licensing-available-2026-11");
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
