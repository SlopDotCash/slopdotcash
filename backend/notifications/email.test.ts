/** NOT-01 complete preference -> source notification -> private Worker delivery path. */
import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import type { ProjectEnforcement } from "../../src/lib/project-contracts";
import { applicationManifest } from "../../tests/project-application-manifest";
import { sqliteD1 } from "../../tests/sqlite-d1";
import {
  type ActivityMailDependencies,
  activityMailEligibility,
  dispatchActivityMail,
  parseActivityMailConfig,
} from "../../workers/notify/activity";
import { reconcileSecurityMail } from "../../workers/notify/security";
import { CloudflareProjectPersistence } from "../projects/cloudflare-persistence";
import type { SecurityD1Database } from "../security/handler";
import { ProjectFlagStore } from "../vetting/flags";
import { handleEmailPreferences } from "./email";
import { notifyProjectEnforcement, notifyVettingBanAudience } from "./events";
import type { NotificationsDependencies } from "./handler";

function setup() {
  const { db: source, sqlite } = sqliteD1(
    readdirSync("migrations")
      .filter((p) => p.endsWith(".sql"))
      .sort(),
  );
  const db = source as unknown as SecurityD1Database;
  let now = new Date("2026-10-20T00:00:00.000Z");
  const config = parseActivityMailConfig(
    JSON.stringify({
      inboxUrl: "https://staging.slop.cash/inbox",
      recipients: {
        "101": {
          email: "member@example.com",
          verifiedAt: now.toISOString(),
          evidenceReference: "private-operator-receipt",
        },
      },
    }),
  );
  if (!config) throw new Error("Pilot fixture invalid");
  const sent: string[] = [];
  const mail: ActivityMailDependencies = {
    db,
    config,
    fromAddress: "notifications@slop.cash",
    now: () => now,
    sendEmail: async (_from, _to, mime) => {
      sent.push(mime);
    },
  };
  let available = true;
  const call = async (method: string, body?: unknown, githubId = "101") => {
    const response = await handleEmailPreferences(
      new Request("https://slop.test/api/v1/notifications/email", {
        method,
        headers: {
          origin: "https://slop.test",
          "content-type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      {
        db: db as unknown as NotificationsDependencies["db"],
        sessionActor: async () => ({ githubId }),
        now: () => now,
        eligibility: async (id) =>
          available ? activityMailEligibility(config, id, now) : null,
      },
    );
    if (!response) throw new Error("Preference route missing");
    return {
      status: response.status,
      body: (await response.json()) as Record<string, unknown>,
    };
  };
  const event = (id: string, kind = "application_approved") =>
    sqlite
      .query(
        "INSERT INTO notifications(event_key,recipient_github_id,kind,subject,action_path,source_at,created_at) VALUES (?,'101',?,'example','/inbox',?,?) ON CONFLICT(event_key,recipient_github_id) DO NOTHING",
      )
      .run(
        `application-event:${id}`,
        kind,
        now.toISOString(),
        now.toISOString(),
      );
  const rows = () =>
    sqlite
      .query(
        "SELECT * FROM activity_notification_outbox ORDER BY created_at,id",
      )
      .all() as {
      id: string;
      state: string;
      attempts: number;
      destination_digest: string;
    }[];
  return {
    sqlite,
    db,
    mail,
    call,
    event,
    rows,
    sent,
    advance: (ms = 60_000) => {
      now = new Date(now.getTime() + ms);
    },
    now: () => now,
    unavailable: () => {
      available = false;
    },
  };
}

test("verified opt-in sends future activity once; opt-out cancels queued mail and is independent of essential notices", async () => {
  const h = setup();
  h.event("before-consent");
  expect(h.rows()).toEqual([]);
  const current = await h.call("GET");
  expect(current.body.enabled).toBe(false);
  expect(current.body.availability).toBe("verified");
  expect(
    (
      await h.call("POST", {
        enabled: true,
        destinationVersion: current.body.destinationVersion,
      })
    ).status,
  ).toBe(200);
  h.event("after-consent");
  h.event("after-consent");
  await Promise.all([
    dispatchActivityMail(h.mail),
    dispatchActivityMail(h.mail),
  ]);
  expect(h.sent).toHaveLength(1);
  expect(h.sent[0]).toContain("activity update");
  expect(h.sent[0]).not.toContain("application-event");
  h.event("queued-before-opt-out");
  h.unavailable();
  expect((await h.call("POST", { enabled: false })).status).toBe(200);
  await dispatchActivityMail(h.mail);
  expect(h.sent).toHaveLength(1);
  expect(h.rows().some((r) => r.state === "suppressed")).toBe(true);
  h.event("after-opt-out");
  h.event("wallet-change", "wallet_changed");
  await dispatchActivityMail(h.mail);
  expect(h.sent).toHaveLength(2);
  expect(h.sent[1]).toContain("security notice");
  h.sqlite.close();
});

test("an email preference write bound to another account is refused without changing the stored preference", async () => {
  const h = setup();
  const current = await h.call("GET");
  expect(
    (
      await h.call("POST", {
        enabled: true,
        destinationVersion: current.body.destinationVersion,
      })
    ).status,
  ).toBe(200);
  expect((await h.call("GET")).body.enabled).toBe(true);
  const refused = await handleEmailPreferences(
    new Request("https://slop.test/api/v1/notifications/email", {
      method: "POST",
      headers: {
        origin: "https://slop.test",
        "content-type": "application/json",
        "x-slop-expected-github-id": "202",
      },
      body: JSON.stringify({ enabled: false }),
    }),
    {
      db: h.db as unknown as NotificationsDependencies["db"],
      sessionActor: async () => ({ githubId: "101" }),
      now: h.now,
      eligibility: async () => null,
    },
  );
  expect(refused?.status).toBe(403);
  expect(await refused?.json()).toEqual({ error: "actor_changed" });
  expect((await h.call("GET")).body.enabled).toBe(true);
  const matched = await handleEmailPreferences(
    new Request("https://slop.test/api/v1/notifications/email", {
      method: "POST",
      headers: {
        origin: "https://slop.test",
        "content-type": "application/json",
        "x-slop-expected-github-id": "101",
      },
      body: JSON.stringify({ enabled: false }),
    }),
    {
      db: h.db as unknown as NotificationsDependencies["db"],
      sessionActor: async () => ({ githubId: "101" }),
      now: h.now,
      eligibility: async () => null,
    },
  );
  expect(matched?.status).toBe(200);
  expect((await h.call("GET")).body.enabled).toBe(false);
  h.sqlite.close();
});

test("unverified and changed destinations cannot inherit activity consent", async () => {
  const h = setup();
  expect((await h.call("GET", undefined, "202")).body.availability).toBe(
    "unverified",
  );
  expect(
    (
      await h.call(
        "POST",
        { enabled: true, destinationVersion: "a".repeat(64) },
        "202",
      )
    ).status,
  ).toBe(409);
  const initial = await h.call("GET");
  await h.call("POST", {
    enabled: true,
    destinationVersion: initial.body.destinationVersion,
  });
  h.event("old-address-event");
  h.mail.config.recipients["101"].email = "successor@example.com";
  expect((await h.call("GET")).body.enabled).toBe(false);
  expect(
    (
      await h.call("POST", {
        enabled: true,
        destinationVersion: initial.body.destinationVersion,
      })
    ).status,
  ).toBe(409);
  await dispatchActivityMail(h.mail);
  expect(h.sent).toHaveLength(0);
  expect(h.rows()[0].state).toBe("suppressed");
  const next = await h.call("GET");
  await h.call("POST", {
    enabled: true,
    destinationVersion: next.body.destinationVersion,
  });
  h.event("successor-event");
  await dispatchActivityMail(h.mail);
  expect(h.sent).toHaveLength(1);
  h.sqlite.close();
});

test("optional-mail ambiguity retries only with attempt-bound independent evidence and remains bounded", async () => {
  const h = setup();
  const initial = await h.call("GET");
  await h.call("POST", {
    enabled: true,
    destinationVersion: initial.body.destinationVersion,
  });
  h.event("ambiguous");
  h.mail.sendEmail = async () => {
    throw new Error("unknown transport outcome");
  };
  for (let attempt = 1; attempt <= 5; attempt++) {
    await dispatchActivityMail(h.mail);
    const row = h.rows()[0];
    expect(row.state).toBe("ambiguous");
    const evidence = {
      deliveryId: row.id,
      attempt,
      destinationDigest: row.destination_digest,
      outcome: "not-accepted",
      evidenceReference: `provider-negative-receipt-${attempt}`,
    };
    expect(await reconcileSecurityMail(h.mail, evidence, "activity")).toBe(
      true,
    );
    expect(await reconcileSecurityMail(h.mail, evidence, "activity")).toBe(
      false,
    );
    h.advance();
  }
  await dispatchActivityMail(h.mail);
  expect(h.rows()[0].state).toBe("exhausted");
  expect(h.rows()[0].attempts).toBe(5);
  h.sqlite.close();
});

test("an essential notice retries a not-yet-effective destination on a bounded schedule; optional mail does not", async () => {
  const h = setup();
  const initial = await h.call("GET");
  await h.call("POST", {
    enabled: true,
    destinationVersion: initial.body.destinationVersion,
  });
  // The operator record exists but takes effect in ten minutes.
  h.mail.config.recipients["101"].verifiedAt = new Date(
    h.now().getTime() + 600_000,
  ).toISOString();
  h.event("optional-before-effective");
  h.event("wallet-before-effective", "wallet_changed");
  await dispatchActivityMail(h.mail);
  expect(h.sent).toHaveLength(0);
  const states = () =>
    h.sqlite
      .query(
        "SELECT essential,state,attempts FROM activity_notification_outbox ORDER BY essential",
      )
      .all();
  expect(states()).toEqual([
    { essential: 0, state: "suppressed", attempts: 1 },
    { essential: 1, state: "retrying", attempts: 1 },
  ]);
  // Not due yet: the one-minute backoff holds the next attempt.
  await dispatchActivityMail(h.mail);
  expect(states()[1]).toEqual({ essential: 1, state: "retrying", attempts: 1 });
  for (const wait of [60_000, 120_000, 240_000]) {
    h.advance(wait);
    await dispatchActivityMail(h.mail);
  }
  expect(h.sent).toHaveLength(0);
  expect(states()[1]).toEqual({ essential: 1, state: "retrying", attempts: 4 });
  h.advance(480_000);
  await dispatchActivityMail(h.mail);
  expect(h.sent).toHaveLength(1);
  expect(h.sent[0]).toContain("security notice");
  expect(states()[1]).toEqual({
    essential: 1,
    state: "provider-accepted",
    attempts: 5,
  });
  h.sqlite.close();
});

test("an essential notice exhausts after five non-send attempts and an absent record is suppressed", async () => {
  const h = setup();
  h.mail.config.recipients["101"].verifiedAt = new Date(
    h.now().getTime() + 86_400_000,
  ).toISOString();
  h.event("wallet-never-effective", "wallet_changed");
  for (let attempt = 0; attempt < 5; attempt++) {
    await dispatchActivityMail(h.mail);
    h.advance(3_600_000);
  }
  await dispatchActivityMail(h.mail);
  expect(h.rows()[0]).toMatchObject({ state: "exhausted", attempts: 5 });
  const events = h.sqlite
    .query(
      "SELECT state FROM activity_notification_delivery_events ORDER BY id",
    )
    .all();
  expect(events).toEqual([
    { state: "retrying" },
    { state: "retrying" },
    { state: "retrying" },
    { state: "retrying" },
    { state: "exhausted" },
  ]);
  h.sqlite
    .query(
      "INSERT INTO notifications(event_key,recipient_github_id,kind,subject,action_path,source_at,created_at) VALUES ('wallet-claim:absent','303','wallet_changed','base','/account#wallets',?,?)",
    )
    .run(h.now().toISOString(), h.now().toISOString());
  await dispatchActivityMail(h.mail);
  expect(
    h.sqlite
      .query(
        "SELECT state,attempts FROM activity_notification_outbox WHERE recipient_github_id='303'",
      )
      .get(),
  ).toEqual({ state: "suppressed", attempts: 1 });
  expect(h.sent).toHaveLength(0);
  h.sqlite.close();
});

test("opt-out cancels optional mail that is waiting for a reconciled retry", async () => {
  const h = setup();
  const initial = await h.call("GET");
  await h.call("POST", {
    enabled: true,
    destinationVersion: initial.body.destinationVersion,
  });
  h.event("retry-then-opt-out");
  h.mail.sendEmail = async () => {
    throw new Error("unknown transport outcome");
  };
  await dispatchActivityMail(h.mail);
  const row = h.rows()[0];
  expect(row.state).toBe("ambiguous");
  expect(
    await reconcileSecurityMail(
      h.mail,
      {
        deliveryId: row.id,
        attempt: 1,
        destinationDigest: row.destination_digest,
        outcome: "not-accepted",
        evidenceReference: "provider-negative-receipt",
      },
      "activity",
    ),
  ).toBe(true);
  expect(h.rows()[0].state).toBe("retrying");
  expect((await h.call("POST", { enabled: false })).status).toBe(200);
  expect(h.rows()[0].state).toBe("suppressed");
  h.mail.sendEmail = async (_from, _to, mime) => {
    h.sent.push(mime);
  };
  h.advance(3_600_000);
  await dispatchActivityMail(h.mail);
  expect(h.sent).toHaveLength(0);
  h.sqlite.close();
});

test("scheduled drains finish activity delivery and report a failed security queue", async () => {
  // Cloudflare owns this binding in production; the local test sends no email.
  const { plugin } = await import("bun");
  await plugin({
    name: "notification-test-email-binding",
    setup(build) {
      build.module("cloudflare:email", () => ({
        exports: { EmailMessage: class {} },
        loader: "object",
      }));
    },
  });
  const { default: worker } = await import("../../workers/notify/index");
  const h = setup();
  try {
    h.event("scheduled-wallet-change", "wallet_changed");
    let accepted = 0;
    const recipient = h.mail.config.recipients["101"];
    const env = {
      SLOP_DB: {
        ...h.db,
        prepare(query: string) {
          if (query.startsWith("UPDATE security_notification_outbox"))
            throw new Error("Security outbox unavailable");
          return h.db.prepare(query);
        },
      },
      NOTIFY_FROM_ADDRESS: h.mail.fromAddress,
      NOTIFY_INBOX_URL: h.mail.config.inboxUrl,
      SECURITY_MAIL_PILOT: JSON.stringify({
        inboxUrl: h.mail.config.inboxUrl,
        recipients: { "101": { ...recipient, backupGithubId: "102" } },
      }),
      ACTIVITY_MAIL_PILOT: JSON.stringify(h.mail.config),
      ADMIN_EMAIL: {
        async send() {
          accepted++;
        },
      },
    };
    await expect(worker.scheduled({}, env)).rejects.toThrow();
    expect(accepted).toBe(1);
    expect(
      h.rows().map(({ state, attempts }) => ({ state, attempts })),
    ).toEqual([{ state: "provider-accepted", attempts: 1 }]);
    await expect(worker.scheduled({}, env)).rejects.toThrow();
    expect(accepted).toBe(1);
    // A set but malformed pilot secret fails the run; it never sends nothing
    // while reporting success.
    await expect(
      worker.scheduled(
        {},
        { ...env, SECURITY_MAIL_PILOT: undefined, ACTIVITY_MAIL_PILOT: "{" },
      ),
    ).rejects.toThrow("Mail pilot misconfigured");
  } finally {
    h.sqlite.close();
  }
});

test("project notices recheck the current steward before activity mail", async () => {
  const h = setup();
  // Staff membership does not substitute for the owner of an owner-only notice.
  h.mail.adminGithubIds = new Set(["101"]);
  const current = await h.call("GET");
  expect(
    (
      await h.call("POST", {
        enabled: true,
        destinationVersion: current.body.destinationVersion,
      })
    ).status,
  ).toBe(200);
  // A self-service project listed by account 303, with account 101 as its
  // GitHub steward.
  const at = h.now().toISOString();
  const manifest = (steward: string) => {
    const value = applicationManifest(
      "steward-change",
      "example/steward-change",
    );
    value.steward = {
      ...(value.steward as Record<string, unknown>),
      kind: "user",
      github: {
        actorId: steward,
        nodeId: `U_${steward}`,
        login: `user${steward}`,
        type: "User",
        profileUrl: `https://github.com/user${steward}`,
      },
    };
    return JSON.stringify(value);
  };
  h.sqlite
    .query(
      "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,actor_github_id,actor_github_login,created_at) VALUES ('steward-change',1,?,?,'Fixture','303','lister',?)",
    )
    .run(manifest("101"), "a".repeat(64), at);
  h.sqlite
    .query(
      "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES ('steward-change','paused',1,?,?,?,?)",
    )
    .run(manifest("101"), "a".repeat(64), at, at);
  const notice = (key: string, kind: string, path: string) =>
    h.sqlite
      .query(
        "INSERT INTO notifications(event_key,recipient_github_id,kind,subject,action_path,source_at,created_at) VALUES (?,'101',?,'steward-change',?,?,?)",
      )
      .run(key, kind, path, at, at);
  // While account 101 is the steward, its payout exception is mailed.
  notice(
    "payout-exception:steward-change:1",
    "payout_exception",
    "/projects/steward-change",
  );
  await dispatchActivityMail(h.mail);
  expect(h.sent).toHaveLength(1);
  // An underfunded payout exception (as notifyMonthlyUnderfunded writes it)
  // and a project revision notice are queued for steward 101.
  notice(
    "monthly-underfunded:steward-change:2026-11",
    "payout_exception",
    "/projects/steward-change/funding",
  );
  notice(
    "project-revision:steward-change:2",
    "project_revision",
    "/projects/steward-change",
  );
  // Before the send, revision 2 makes account 202 the steward.
  h.sqlite
    .query(
      "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,actor_github_id,actor_github_login,created_at) VALUES ('steward-change',2,?,?,'Steward change','303','lister',?)",
    )
    .run(manifest("202"), "b".repeat(64), at);
  h.sqlite
    .query(
      "UPDATE projects SET revision=2, manifest=?, manifest_sha256=? WHERE id='steward-change'",
    )
    .run(manifest("202"), "b".repeat(64));
  await dispatchActivityMail(h.mail);
  expect(h.sent).toHaveLength(1);
  const states = Object.fromEntries(
    (h.rows() as unknown as { event_key: string; state: string }[]).map(
      (row) => [row.event_key, row.state],
    ),
  );
  expect(states).toEqual({
    "payout-exception:steward-change:1": "provider-accepted",
    "monthly-underfunded:steward-change:2026-11": "suppressed",
    "project-revision:steward-change:2": "suppressed",
  });
  h.sqlite.close();
});

test("vetting ban mail rechecks affected contributors and current staff after an ownership change", async () => {
  for (const staffRemoved of [false, true]) {
    const h = setup();
    try {
      for (const id of ["101", "102", "103", "104"]) {
        h.mail.config.recipients[id] = {
          ...h.mail.config.recipients["101"],
          email: `member${id}@example.com`,
        };
        const current = await h.call("GET", undefined, id);
        expect(
          (
            await h.call(
              "POST",
              {
                enabled: true,
                destinationVersion: current.body.destinationVersion,
              },
              id,
            )
          ).status,
        ).toBe(200);
      }
      const at = h.now().toISOString();
      const manifest = applicationManifest(
        "affected-project",
        "example/affected-project",
      );
      manifest.steward = {
        ...(manifest.steward as Record<string, unknown>),
        kind: "user",
        github: {
          actorId: "103",
          nodeId: "U_103",
          login: "steward",
          type: "User",
          profileUrl: "https://github.com/steward",
        },
      };
      const body = JSON.stringify(manifest);
      h.sqlite
        .query(
          "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,actor_github_id,actor_github_login,created_at) VALUES ('affected-project',1,?,?,'Fixture','303','lister',?)",
        )
        .run(body, "a".repeat(64), at);
      h.sqlite
        .query(
          "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES ('affected-project','paused',1,?,?,?,?)",
        )
        .run(body, "a".repeat(64), at, at);
      h.sqlite
        .query(
          "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES('affected','101','affected',?,0)",
        )
        .run(at);
      h.sqlite
        .query(
          "INSERT INTO points_revisions(id,source_key,previous,recorded_at,payload) VALUES('credit','credit',NULL,?,?)",
        )
        .run(
          at,
          JSON.stringify({
            award: {
              actor: { id: "affected" },
              projectId: "affected-project",
              amount: 10,
            },
          }),
        );
      h.sqlite
        .query(
          "INSERT INTO payment_direct_transfers(network,transaction_id,project_id,contribution_month,github_user_id,github_node_id,github_login,chain,recipient,amount_micro,block_time,block_id,source_path,imported_at) VALUES('base-mainnet','fixture-transfer','affected-project','2026-10','102','U_102','financial','base','fixture-wallet','1',?,'fixture-block','fixture',?)",
        )
        .run(at, at);
      h.sqlite
        .query(
          "INSERT INTO project_enforcements(id,project_id,sequence,action,state_after,appeal_after,reason,evidence_reference,repository_github_id,repository_keys,system_issuer,actor_role,decision_source,before_revision,before_manifest_sha256,result,created_at) VALUES ('enf_mail_fixture','affected-project',1,'ban','banned','none','Confirmed malicious','fixture','1','[\"example/affected-project\"]',?,'vetting-service','standing-rule',1,?,'revision_pending',?)",
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
          at,
        );
      await h.db.batch([
        notifyProjectEnforcement(h.db, "enf_mail_fixture"),
        notifyVettingBanAudience(h.db, "enf_mail_fixture", ["103", "104"]),
      ]);
      expect(h.rows()).toHaveLength(4);
      // The owner writer wins the shared event key, so this staff member's
      // notice has a project link even after they stop being the steward.
      expect(
        h.sqlite
          .query(
            "SELECT recipient_github_id,action_path FROM notifications WHERE recipient_github_id IN ('103','104') ORDER BY recipient_github_id",
          )
          .all(),
      ).toEqual([
        {
          recipient_github_id: "103",
          action_path: "/projects/affected-project",
        },
        { recipient_github_id: "104", action_path: "/admin" },
      ]);
      h.mail.adminGithubIds = new Set(staffRemoved ? [] : ["103"]);
      h.mail.moderatorGithubIds = new Set(staffRemoved ? [] : ["104"]);
      h.sqlite
        .query(
          "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,actor_github_id,actor_github_login,created_at) SELECT id,2,json_set(manifest, '$.steward.github.actorId', '202'),?,'Steward change','303','lister',? FROM projects WHERE id='affected-project'",
        )
        .run("b".repeat(64), at);
      h.sqlite
        .query(
          "UPDATE projects SET revision=2,manifest=(SELECT manifest FROM project_revisions WHERE project_id='affected-project' AND revision=2),manifest_sha256=? WHERE id='affected-project'",
        )
        .run("b".repeat(64));
      await dispatchActivityMail(h.mail);
      expect(h.sent).toHaveLength(staffRemoved ? 2 : 4);
      for (const id of ["101", "102", "103", "104"])
        expect(
          h.sent.filter((mime) => mime.includes(`To: member${id}@example.com`)),
        ).toHaveLength(staffRemoved && (id === "103" || id === "104") ? 0 : 1);
      expect(
        h.rows().filter((row) => row.state === "provider-accepted"),
      ).toHaveLength(staffRemoved ? 2 : 4);
      expect(h.rows().filter((row) => row.state === "suppressed")).toHaveLength(
        staffRemoved ? 2 : 0,
      );
    } finally {
      h.sqlite.close();
    }
  }
});

test("a reinstatement review mails only a current moderator", async () => {
  const h = setup();
  try {
    // Accounts 101 and 102 are moderators with verified, consented mail.
    for (const id of ["101", "102"]) {
      h.mail.config.recipients[id] = {
        ...h.mail.config.recipients["101"],
        email: `moderator${id}@example.com`,
      };
      const current = await h.call("GET", undefined, id);
      expect(
        (
          await h.call(
            "POST",
            {
              enabled: true,
              destinationVersion: current.body.destinationVersion,
            },
            id,
          )
        ).status,
      ).toBe(200);
    }
    const at = h.now().toISOString();
    const manifest = JSON.stringify({
      id: "review-project",
      status: "paused",
      repositories: [{ id: "example/review-project" }],
      steward: { github: { actorId: "303" } },
    });
    h.sqlite
      .query(
        "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,actor_github_id,actor_github_login,created_at) VALUES ('review-project',1,?,?,'Fixture','303','owner',?)",
      )
      .run(manifest, "a".repeat(64), at);
    h.sqlite
      .query(
        "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES ('review-project','paused',1,?,?,?,?)",
      )
      .run(manifest, "a".repeat(64), at, at);
    const record = (
      sequence: number,
      action: ProjectEnforcement["action"],
      appealAfter: ProjectEnforcement["appealAfter"],
      actor: { githubId: string; githubLogin: string },
      actorRole: ProjectEnforcement["actorRole"],
      decisionSource: ProjectEnforcement["decisionSource"],
    ): ProjectEnforcement => ({
      id: `enf_reviewrecord${sequence}`,
      projectId: "review-project",
      sequence,
      action,
      stateAfter: "quarantined",
      appealAfter,
      reason: "Private moderation reason",
      evidenceReference: "private-evidence-1",
      repositoryGithubId: "123",
      repositoryKeys: ["example/review-project"],
      actor,
      actorRole,
      decisionSource,
      beforeRevision: 1,
      beforeManifestSha256: "a".repeat(64),
      afterRevision: null,
      afterManifestSha256: null,
      result: "no_revision_needed",
      createdAt: at,
    });
    const persistence = new CloudflareProjectPersistence(h.db as never);
    expect(
      await persistence.appendEnforcement(
        record(
          1,
          "quarantine",
          "none",
          { githubId: "104", githubLogin: "moderator104" },
          "project-moderator",
          "admin-panel",
        ),
        null,
        [],
      ),
    ).toBe("recorded");
    // The owner's request reaches both independent moderators (ELG-02).
    expect(
      await persistence.appendEnforcement(
        record(
          2,
          "request_reinstatement",
          "requested",
          { githubId: "303", githubLogin: "owner" },
          "project-steward",
          "owner-request",
        ),
        null,
        ["101", "102"],
      ),
    ).toBe("recorded");
    expect(h.rows()).toHaveLength(2);
    // Before the send, account 102 stops being a moderator.
    h.mail.moderatorGithubIds = new Set(["101", "104"]);
    await dispatchActivityMail(h.mail);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toContain("To: moderator101@example.com");
    expect(
      Object.fromEntries(
        (
          h.rows() as unknown as {
            recipient_github_id: string;
            state: string;
          }[]
        ).map((row) => [row.recipient_github_id, row.state]),
      ),
    ).toEqual({ "101": "provider-accepted", "102": "suppressed" });
    // The inbox notice itself stays.
    expect(
      h.sqlite
        .query(
          "SELECT kind FROM notifications WHERE event_key='reinstatement-review:enf_reviewrecord2' AND recipient_github_id='102'",
        )
        .get(),
    ).toEqual({ kind: "reinstatement_review" });
  } finally {
    h.sqlite.close();
  }
});

test("a contributor-flag pause mails only current staff or a current owner", async () => {
  const h = setup();
  try {
    // 101 is a moderator, 102 an administrator, and 103 the project steward
    // who is also a moderator. All three consented to verified mail.
    for (const id of ["101", "102", "103"]) {
      h.mail.config.recipients[id] = {
        ...h.mail.config.recipients["101"],
        email: `member${id}@example.com`,
      };
      const current = await h.call("GET", undefined, id);
      expect(
        (
          await h.call(
            "POST",
            {
              enabled: true,
              destinationVersion: current.body.destinationVersion,
            },
            id,
          )
        ).status,
      ).toBe(200);
    }
    const at = h.now().toISOString();
    const manifest = applicationManifest(
      "flagged-project",
      "example/flagged-project",
      { status: "active" },
    );
    manifest.steward = {
      ...(manifest.steward as Record<string, unknown>),
      kind: "user",
      github: {
        actorId: "103",
        nodeId: "U_103",
        login: "steward",
        type: "User",
        profileUrl: "https://github.com/steward",
      },
    };
    const body = JSON.stringify(manifest);
    h.sqlite
      .query(
        "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,actor_github_id,actor_github_login,created_at) VALUES ('flagged-project',1,?,?,'Fixture','303','lister',?)",
      )
      .run(body, "a".repeat(64), at);
    h.sqlite
      .query(
        "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES ('flagged-project','active',1,?,?,?,?)",
      )
      .run(body, "a".repeat(64), at, at);
    const project = await new CloudflareProjectPersistence(
      h.db as never,
    ).getProject("flagged-project");
    if (!project) throw new Error("Missing fixture project");
    // The second distinct flag pauses the project and notifies the
    // configured administrators and moderators (the Pages writer's staff).
    const flags = new ProjectFlagStore(h.db as never);
    for (const index of [1, 2])
      expect(
        await flags.file({
          flagId: `flg_mail_fixture_${index}`,
          pauseRecordId: `enf_flags_mail_fixture_${index}`,
          project,
          repositoryGithubId: "123456789",
          repositoryKeys: ["example/flagged-project"],
          reporter: {
            githubId: String(8000000 + index),
            githubLogin: `flagger-${index}`,
          },
          category: "other",
          evidence: "Synthetic evidence of risky install behavior.",
          evidenceUrl: null,
          moderatorGithubIds: ["101", "102", "103"],
          at,
        }),
      ).not.toBe("conflict");
    // The staff writer wins the shared event key, so the steward's notice
    // has the admin link.
    expect(
      h.sqlite
        .query(
          "SELECT recipient_github_id,kind,action_path FROM notifications WHERE event_key='project-enforcement:enf_flags_mail_fixture_2' ORDER BY recipient_github_id",
        )
        .all(),
    ).toEqual([
      {
        recipient_github_id: "101",
        kind: "project_quarantined",
        action_path: "/admin",
      },
      {
        recipient_github_id: "102",
        kind: "project_quarantined",
        action_path: "/admin",
      },
      {
        recipient_github_id: "103",
        kind: "project_quarantined",
        action_path: "/admin",
      },
      {
        recipient_github_id: "303",
        kind: "project_quarantined",
        action_path: "/projects/flagged-project",
      },
    ]);
    expect(h.rows()).toHaveLength(3);
    // Before the send, 101 and 103 stop being moderators. 103 still
    // stewards the project.
    h.mail.adminGithubIds = new Set(["102"]);
    h.mail.moderatorGithubIds = new Set();
    await dispatchActivityMail(h.mail);
    expect(h.sent).toHaveLength(2);
    expect(
      Object.fromEntries(
        (
          h.rows() as unknown as {
            recipient_github_id: string;
            state: string;
          }[]
        ).map((row) => [row.recipient_github_id, row.state]),
      ),
    ).toEqual({
      "101": "suppressed",
      "102": "provider-accepted",
      "103": "provider-accepted",
    });
  } finally {
    h.sqlite.close();
  }
});
