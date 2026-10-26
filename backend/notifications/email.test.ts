/** NOT-01 complete preference -> source notification -> private Worker delivery path. */
import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { sqliteD1 } from "../../tests/sqlite-d1";
import {
  type ActivityMailDependencies,
  activityMailEligibility,
  dispatchActivityMail,
  parseActivityMailConfig,
} from "../../workers/notify/activity";
import { reconcileSecurityMail } from "../../workers/notify/security";
import type { SecurityD1Database } from "../security/handler";
import { handleEmailPreferences } from "./email";
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
