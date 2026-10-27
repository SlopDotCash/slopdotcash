// The local notify stand-in answers the real eligibility lookup.
import { expect, test } from "bun:test";
import { verifiedEmailEligibility } from "../backend/notifications/email";
import { localNotify } from "./dev-backend-notify";

test("a known account gets its no-reply address as a verified destination", async () => {
  const service = localNotify((id) => (id === "42" ? "octo-cat" : undefined));
  const result = await verifiedEmailEligibility(service, "42");
  expect(result).toMatchObject({
    available: true,
    email: "octo-cat@users.noreply.github.com",
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
  // An unknown account still gets a stable placeholder address.
  expect(await verifiedEmailEligibility(service, "7")).toMatchObject({
    email: "user-7@users.noreply.github.com",
  });
});
