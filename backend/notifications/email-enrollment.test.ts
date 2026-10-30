/** Real API/D1/outbox flow with an injected provider; no external email. */
import { expect, test } from "bun:test";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { dispatchActivityMail } from "../../workers/notify/activity";
import {
  handleEnrollmentMailRequest,
  sendEmailVerification,
} from "../../workers/notify/enrollment";
import { dispatchSecurityMail } from "../../workers/notify/security";
import { handleSecurityApi } from "../security/handler";
import { handleEmailPreferences } from "./email";
import {
  emailUnsubscribeToken,
  verificationTokenHash,
} from "./email-destinations";

const ORIGIN = "https://staging.slop.cash";
const MEMBER = "810000001";
const OTHER = "810000002";
const KEY = "ab".repeat(32);

async function setup() {
  const { db, sqlite } = sqliteD1();
  let now = new Date("2026-10-30T12:00:00.000Z");
  let ready = true;
  let failure: boolean | string = false;
  const mail: { to: string; mime: string }[] = [];
  const config = { inboxUrl: `${ORIGIN}/inbox`, recipients: {} };
  const worker = {
    db,
    config,
    fromAddress: "notifications@slop.cash",
    inboxUrl: config.inboxUrl,
    unsubscribeKey: KEY,
    generalEmail: true,
    now: () => now,
    async sendEmail(_from: string, to: string, mime: string) {
      if (failure)
        throw Object.assign(
          new Error("Provider result unavailable"),
          typeof failure === "string" ? { code: failure } : {},
        );
      mail.push({ to, mime });
    },
  };
  const service = {
    async fetch(request: Request) {
      return (
        (await handleEnrollmentMailRequest(request, ready ? worker : null, {
          db,
          now: () => now,
        })) ?? new Response(null, { status: 404 })
      );
    },
  };
  const call = async (
    path = "",
    body?: object,
    actor: string | null = MEMBER,
    method = body ? "POST" : "GET",
    origin = ORIGIN,
  ) => {
    const response = await handleEmailPreferences(
      new Request(`${ORIGIN}/api/v1/notifications/email${path}`, {
        method,
        headers: { origin, "content-type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      {
        db,
        now: () => now,
        mailService: service,
        sessionActor: async () => (actor ? { githubId: actor } : null),
        eligibility: async () => ({ available: false }),
      },
    );
    if (!response) throw new Error("Missing email route");
    return {
      status: response.status,
      body: (await response.json()) as Record<string, unknown>,
    };
  };
  let sequence = 0;
  const enroll = async (
    email = "member@example.com",
    actor = MEMBER,
    options = { enabled: true, securityEnabled: true },
  ) => {
    const response = await call(
      "/verification",
      { email, idempotencyKey: `enrollment-request-${++sequence}`, ...options },
      actor,
    );
    return response;
  };
  const token = () => {
    const match = mail
      .at(-1)
      ?.mime.replace(/=\r\n/gu, "")
      .replace(/=3D/gu, "=")
      .match(/#verify-email=([a-f0-9]{64})/u);
    if (!match) throw new Error("Missing verification link");
    return match[1];
  };
  const verify = () => call("/verify", { token: token() });
  const activity = (key: string) =>
    sqlite
      .query(
        "INSERT INTO notifications(event_key,recipient_github_id,kind,subject,action_path,source_at,created_at) VALUES(?,?,'application_approved','synthetic','/inbox',?,?)",
      )
      .run(key, MEMBER, now.toISOString(), now.toISOString());
  const manifest = JSON.stringify({
    id: "email-case",
    status: "active",
    securityBounty: {
      status: "pending-approval",
      intake: { repository: "example/email-case" },
      approvers: {
        technical: [{ githubId: MEMBER, githubLogin: "member" }],
        financial: [],
        dispute: [],
      },
      capacity: { awards: 1, closesAt: null },
      responseTargets: { acknowledgeHours: 1 },
    },
  });
  sqlite
    .query(
      "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES('email-case',1,?,?,'test',?)",
    )
    .run(manifest, "a".repeat(64), now.toISOString());
  sqlite
    .query(
      "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES('email-case','active',1,?,?,?,?)",
    )
    .run(manifest, "a".repeat(64), now.toISOString(), now.toISOString());
  const claimed = await handleSecurityApi(
    new Request(`${ORIGIN}/api/v1/security-cases`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({
        mode: "claim",
        projectId: "email-case",
        advisory: "GHSA-7c8f-9g2h-3j4m",
        idempotencyKey: "synthetic-email-case",
      }),
    }),
    {
      db,
      now: () => now,
      randomId: () => "syntheticemailcase",
      sessionActor: async () => ({ githubId: OTHER, githubLogin: "other" }),
      reportingRead: async () => ({ kind: "unavailable" }),
    },
  );
  if (claimed?.status !== 201) throw new Error("Failed synthetic case");
  const caseId = ((await claimed.json()) as { case: { id: string } }).case.id;
  const security = (key: string) =>
    sqlite
      .query(
        "INSERT INTO notifications(event_key,recipient_github_id,kind,subject,action_path,source_at,created_at) VALUES(?,?,'security_case',?,?,?,?)",
      )
      .run(
        key,
        MEMBER,
        caseId,
        `/security?case=${caseId}`,
        now.toISOString(),
        now.toISOString(),
      );
  return {
    db,
    sqlite,
    worker,
    service,
    mail,
    call,
    enroll,
    verify,
    token,
    activity,
    security,
    caseId,
    advance: (ms = 61_000) => {
      now = new Date(now.getTime() + ms);
    },
    ready: (value: boolean) => {
      ready = value;
    },
    failure: (value: boolean | string) => {
      failure = value;
    },
    async oneClick(token: string, method = "POST") {
      const response = await handleEmailPreferences(
        new Request(
          `${ORIGIN}/api/v1/notifications/email/unsubscribe?token=${token}`,
          {
            method,
            headers: { "content-type": "application/x-www-form-urlencoded" },
            ...(method === "POST"
              ? { body: "List-Unsubscribe=One-Click" }
              : {}),
          },
        ),
        {
          db,
          now: () => now,
          mailService: service,
          sessionActor: async () => null,
          eligibility: async () => ({ available: false }),
        },
      );
      return response?.status;
    },
  };
}

test("self-verification enables future private notices without pilot records; unsubscribe stops both queues", async () => {
  const h = await setup();
  h.activity("before-enrollment");
  h.security("security-before-enrollment");
  const requested = await h.enroll();
  expect(requested.status).toBe(202);
  expect(requested.body).toMatchObject({
    enabled: false,
    securityEnabled: false,
    enrollmentAvailable: true,
    availability: "unverified",
    pending: { state: "sent", email: "member@example.com" },
  });
  const token = h.token();
  expect(
    JSON.stringify(
      h.sqlite.query("SELECT * FROM notification_email_verifications").all(),
    ),
  ).not.toContain(token);
  expect(h.mail[0].mime).not.toContain(h.caseId);
  expect(h.mail[0].mime).not.toContain(MEMBER);
  expect((await h.call("/verify", { token }, OTHER)).status).toBe(409);
  expect((await h.call("/verify", { token }, null)).status).toBe(401);
  const verified = await h.verify();
  expect(verified.body).toMatchObject({
    enabled: true,
    securityEnabled: true,
    availability: "verified",
    email: "member@example.com",
    pending: null,
  });
  expect((await h.verify()).status).toBe(409);
  h.activity("after-enrollment");
  h.security("security-after-enrollment");
  await Promise.all([
    dispatchActivityMail(h.worker),
    dispatchActivityMail(h.worker),
    dispatchSecurityMail(h.worker),
    dispatchSecurityMail(h.worker),
  ]);
  expect(h.mail).toHaveLength(3);
  for (const message of h.mail.slice(1)) {
    expect(message.to).toBe("member@example.com");
    expect(message.mime).toContain(
      "List-Unsubscribe-Post: List-Unsubscribe=One-Click",
    );
    expect(message.mime).not.toContain(h.caseId);
    expect(message.mime).not.toContain("synthetic-email-case");
  }
  const version = verified.body.destinationVersion as string;
  const unsubscribe = await emailUnsubscribeToken(KEY, version);
  h.activity("queued-before-unsubscribe");
  h.security("security-queued-before-unsubscribe");
  expect(
    (await h.call("/unsubscribe", { token: unsubscribe }, null)).body,
  ).toEqual({ enabled: false, securityEnabled: false });
  await dispatchActivityMail(h.worker);
  await dispatchSecurityMail(h.worker);
  expect(h.mail).toHaveLength(3);
  expect((await h.call()).body).toMatchObject({
    enabled: false,
    securityEnabled: false,
    availability: "verified",
  });
  h.sqlite.close();
});

test("verification resends are bounded and invalidate old links without changing the active destination", async () => {
  const h = await setup();
  const body = {
    email: "member@example.com",
    enabled: true,
    securityEnabled: false,
    idempotencyKey: "stable-email-request",
  };
  const [first, replayed] = await Promise.all([
    h.call("/verification", body),
    h.call("/verification", body),
  ]);
  expect([first.status, replayed.status]).toEqual([202, 202]);
  expect(h.mail).toHaveLength(1);
  const old = h.token();
  expect((await h.enroll()).status).toBe(429);
  h.advance();
  expect((await h.enroll("successor@example.com")).status).toBe(202);
  expect((await h.call("/verify", { token: old })).status).toBe(409);
  const current = h.token();
  h.advance(31 * 60_000);
  expect((await h.call()).body).toMatchObject({
    pending: { state: "expired" },
  });
  expect((await h.call("/verify", { token: current })).status).toBe(409);
  expect((await h.enroll("successor@example.com")).status).toBe(202);
  expect((await h.verify()).body).toMatchObject({
    email: "successor@example.com",
    enabled: true,
    securityEnabled: true,
  });
  h.advance();
  expect((await h.enroll("third@example.com")).status).toBe(429);
  expect(
    (await h.call("/verification", { ...body, email: "changed@example.com" }))
      .status,
  ).toBe(409);
  h.sqlite.close();
});

test("general-mode readiness and verification transport failures remain recoverable and never imply delivery", async () => {
  const h = await setup();
  h.ready(false);
  expect((await h.enroll()).status).toBe(503);
  expect(h.mail).toHaveLength(0);
  expect(
    h.sqlite
      .query("SELECT count(*) AS n FROM notification_email_verifications")
      .get(),
  ).toEqual({ n: 0 });
  h.ready(true);
  h.failure(true);
  const requested = await h.enroll();
  expect(requested.body).toMatchObject({
    pending: { state: "unknown" },
    enabled: false,
    securityEnabled: false,
  });
  h.failure(false);
  h.advance();
  expect((await h.enroll()).status).toBe(202);
  expect(h.mail).toHaveLength(1);
  expect((await h.verify()).status).toBe(200);
  h.sqlite.close();
});

test("address changes bind new consent, cancel stale deliveries and reject old unsubscribe capabilities", async () => {
  const h = await setup();
  await h.enroll();
  const initial = await h.verify();
  const oldUnsubscribe = await emailUnsubscribeToken(
    KEY,
    initial.body.destinationVersion as string,
  );
  h.activity("old-address-queue");
  h.security("old-address-security");
  h.advance();
  await h.enroll("new@example.com", MEMBER, {
    enabled: false,
    securityEnabled: true,
  });
  expect((await h.call()).body.email).toBe("member@example.com");
  const changed = await h.verify();
  expect(changed.body).toMatchObject({
    email: "new@example.com",
    enabled: false,
    securityEnabled: true,
  });
  expect(
    (await h.call("/unsubscribe", { token: oldUnsubscribe }, null)).status,
  ).toBe(409);
  await dispatchActivityMail(h.worker);
  await dispatchSecurityMail(h.worker);
  expect(h.mail).toHaveLength(2);
  h.activity("activity-disabled");
  h.security("security-enabled");
  await dispatchActivityMail(h.worker);
  await dispatchSecurityMail(h.worker);
  expect(h.mail).toHaveLength(3);
  expect(h.mail.at(-1)?.to).toBe("new@example.com");
  const forged = await emailUnsubscribeToken(
    "cd".repeat(32),
    changed.body.destinationVersion as string,
  );
  expect((await h.call("/unsubscribe", { token: forged }, null)).status).toBe(
    409,
  );
  expect(
    (
      await h.call("", {
        enabled: false,
        securityEnabled: true,
        destinationVersion: initial.body.destinationVersion,
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await h.call("/verification", {
        email: "malicious\r\nBcc: x@example.com",
        enabled: true,
        securityEnabled: true,
        idempotencyKey: "header-injection-attempt",
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await h.call(
        "/verification",
        {
          email: "other@example.com",
          enabled: true,
          securityEnabled: true,
          idempotencyKey: "cross-origin-email-request",
        },
        MEMBER,
        "POST",
        "https://other.example",
      )
    ).status,
  ).toBe(403);
  h.sqlite.close();
});

test("the private sending route rejects fabricated challenge tokens and public GET never consumes a link", async () => {
  const h = await setup();
  await h.enroll();
  const token = h.token();
  const record = h.sqlite
    .query("SELECT id,token_hash FROM notification_email_verifications")
    .get() as { id: string; token_hash: string };
  expect(record.token_hash).toBe(await verificationTokenHash(token));
  expect(
    await sendEmailVerification(h.worker, {
      githubId: MEMBER,
      id: record.id,
      token: "00".repeat(32),
    }),
  ).toBe(false);
  expect(
    await sendEmailVerification(h.worker, {
      githubId: OTHER,
      id: record.id,
      token,
    }),
  ).toBe(false);
  expect((await h.call("/verify", undefined, MEMBER, "GET")).status).toBe(405);
  expect((await h.verify()).status).toBe(200);
  expect(h.mail).toHaveLength(1);
  h.sqlite.close();
});

test("one-click unsubscribe is token-bound and explicit POST; provider quota rejections retry without duplicate sends", async () => {
  const h = await setup();
  await h.enroll();
  const verified = await h.verify();
  h.activity("quota-activity");
  h.security("quota-security");
  h.failure("E_RATE_LIMIT_EXCEEDED");
  await dispatchActivityMail(h.worker);
  await dispatchSecurityMail(h.worker);
  expect(h.mail).toHaveLength(1);
  expect(
    h.sqlite
      .query("SELECT state,attempts FROM activity_notification_outbox")
      .all(),
  ).toEqual([{ state: "retrying", attempts: 1 }]);
  expect(
    h.sqlite
      .query(
        "SELECT state,attempts FROM security_notification_outbox WHERE event_key='quota-security'",
      )
      .get(),
  ).toEqual({ state: "retrying", attempts: 1 });
  h.failure(false);
  h.advance(61_000);
  await Promise.all([
    dispatchActivityMail(h.worker),
    dispatchSecurityMail(h.worker),
  ]);
  expect(h.mail).toHaveLength(3);
  await Promise.all([
    dispatchActivityMail(h.worker),
    dispatchSecurityMail(h.worker),
  ]);
  expect(h.mail).toHaveLength(3);
  const token = await emailUnsubscribeToken(
    KEY,
    verified.body.destinationVersion as string,
  );
  expect(await h.oneClick(token, "GET")).toBe(405);
  expect((await h.call()).body.enabled).toBe(true);
  expect(await h.oneClick(token)).toBe(200);
  expect((await h.call()).body).toMatchObject({
    enabled: false,
    securityEnabled: false,
  });
  h.sqlite.close();
});

test("issued unsubscribe links survive signing-key rotation and sender pause but never an address change", async () => {
  const h = await setup();
  await h.enroll();
  const verified = await h.verify();
  h.activity("before-key-rotation");
  await dispatchActivityMail(h.worker);
  const oldToken = await emailUnsubscribeToken(
    KEY,
    verified.body.destinationVersion as string,
  );
  h.worker.unsubscribeKey = "cd".repeat(32);
  h.activity("after-key-rotation");
  await dispatchActivityMail(h.worker);
  const issued = h.sqlite
    .query(
      "SELECT token_hash,destination_version FROM notification_email_unsubscribe_tokens",
    )
    .all();
  expect(issued).toHaveLength(2);
  expect(JSON.stringify(issued)).not.toContain(oldToken);
  h.ready(false);
  expect((await h.enroll("new@example.com")).status).toBe(503);
  expect((await h.call("/unsubscribe", { token: oldToken }, null)).status).toBe(
    200,
  );
  expect((await h.call()).body).toMatchObject({
    enabled: false,
    securityEnabled: false,
    enrollmentAvailable: false,
  });
  h.ready(true);
  h.advance();
  await h.enroll("new@example.com");
  await h.verify();
  expect((await h.call("/unsubscribe", { token: oldToken }, null)).status).toBe(
    409,
  );
  h.sqlite.close();
});
