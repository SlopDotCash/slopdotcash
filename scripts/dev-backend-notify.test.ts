// The local notify stand-in answers the real eligibility lookup.
import { expect, test } from "bun:test";
import {
  handleEmailPreferences,
  verifiedEmailEligibility,
} from "../backend/notifications/email";
import { sqliteD1 } from "../tests/sqlite-d1";
import { type LocalCapturedEmail, localNotify } from "./dev-backend-notify";

test("a known account can preview consent with a non-deliverable address", async () => {
  const service = localNotify((id) => (id === "42" ? "octo-cat" : undefined));
  const result = await verifiedEmailEligibility(service, "42");
  expect(result).toMatchObject({
    available: true,
    email: "octo-cat@example.invalid",
  });
  expect((result as { destinationVersion: string }).destinationVersion).toMatch(
    /^[a-f0-9]{64}$/u,
  );
});

test("the destination version changes when the address changes", async () => {
  const before = await verifiedEmailEligibility(
    localNotify(() => "old-name"),
    "42",
  );
  const after = await verifiedEmailEligibility(
    localNotify(() => "new-name"),
    "42",
  );
  expect(before).not.toEqual(after);
});

test("other requests and bad input are refused", async () => {
  const service = localNotify(() => undefined);
  expect(
    (
      await service.fetch(
        new Request("https://notify.internal/v1/other", { method: "POST" }),
      )
    ).status,
  ).toBe(404);
  const bad = await service.fetch(
    new Request(
      "https://notify.internal/v1/activity-notifications/eligibility",
      {
        method: "POST",
        body: JSON.stringify({ githubId: "not-a-number" }),
      },
    ),
  );
  expect(bad.status).toBe(400);
  expect(await verifiedEmailEligibility(service, "abc")).toBeNull();
  expect(await verifiedEmailEligibility(service, "7")).toEqual({
    available: false,
  });
});

test("local enrollment uses the shared private handler and captures verification without external delivery", async () => {
  const { db, sqlite } = sqliteD1();
  const captured: LocalCapturedEmail[] = [];
  const service = localNotify(() => "local-user", {
    db,
    now: () => new Date("2026-10-30T12:00:00.000Z"),
    inboxUrl: "http://localhost:4466/inbox",
    unsubscribeKey: "ab".repeat(32),
    capture: (message) => {
      captured.push(message);
    },
  });
  const call = async (path: string, body?: object) => {
    const response = await handleEmailPreferences(
      new Request(`http://localhost:4466/api/v1/notifications/email${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          origin: "http://localhost:4466",
          "content-type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      {
        db,
        now: () => new Date("2026-10-30T12:00:00.000Z"),
        sessionActor: async () => ({ githubId: "42" }),
        eligibility: (id) => verifiedEmailEligibility(service, id),
        mailService: service,
      },
    );
    if (!response) throw new Error("Missing local email route");
    return {
      status: response.status,
      body: (await response.json()) as Record<string, unknown>,
    };
  };
  expect((await call("")).body).toMatchObject({
    enrollmentAvailable: true,
    availability: "unverified",
  });
  const requested = await call("/verification", {
    email: "synthetic@example.com",
    idempotencyKey: "local-verification-request",
    enabled: true,
    securityEnabled: true,
  });
  expect(requested.status).toBe(202);
  expect(captured).toHaveLength(1);
  expect(captured[0].to).toBe("synthetic@example.com");
  const token = captured[0].mime
    .replace(/=\r\n/gu, "")
    .replace(/=3D/gu, "=")
    .match(/#verify-email=([a-f0-9]{64})/u)?.[1];
  expect(token).toBeDefined();
  expect((await call("/verify", { token })).body).toMatchObject({
    availability: "verified",
    email: "synthetic@example.com",
    enabled: true,
    securityEnabled: true,
  });
  expect((await verifiedEmailEligibility(service, "42"))?.available).toBe(true);
  expect(captured).toHaveLength(1);
  expect(captured[0].githubId).toBe("42");
  await db
    .prepare(
      "INSERT INTO notifications(event_key,recipient_github_id,kind,subject,action_path,source_at,created_at) VALUES('local-notice','42','application_approved','synthetic','/inbox','2026-10-30T12:00:00.000Z','2026-10-30T12:00:00.000Z')",
    )
    .run();
  await Promise.all([service.dispatch(), service.dispatch()]);
  expect(captured).toHaveLength(2);
  expect(captured[1].githubId).toBe("42");
  await service.dispatch();
  expect(captured).toHaveLength(2);
  sqlite.close();
});
