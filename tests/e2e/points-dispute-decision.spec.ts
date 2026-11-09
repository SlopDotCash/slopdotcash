import type { Page, Route } from "@playwright/test";
import { expect, expectAccessible, test } from "./fixtures";

const actor = { githubId: "42", githubLogin: "moderator" };

const award = (key: string, amount: number, occurredAt: string) => ({
  key,
  actor: { id: "U_contributor", login: "contributor" },
  projectId: "dispute-fixture",
  category: "accepted-work",
  amount,
  occurredAt,
  sourceId: `PR_${key}`,
  sourceUrl: `https://github.com/example/dispute-fixture/pull/${amount}`,
  workUnitId: `work-${key}`,
  provisional: false,
});

/** Inbox reads that every Points review page makes besides the review API. */
async function serveInbox(
  page: Page,
  disputes: (route: Route, path: string, search: string) => unknown,
) {
  const counts = { notifications: 0 };
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/api/v1/projects")
      return route.fulfill({ json: { schemaVersion: "1", projects: [] } });
    if (path === "/api/v1/project-session")
      return route.fulfill({ json: { session: actor } });
    if (path === "/api/v1/notifications") {
      counts.notifications++;
      return route.fulfill({
        json: {
          recipientGithubId: actor.githubId,
          notifications: [],
          unread: 0,
          nextCursor: null,
        },
      });
    }
    if (path === "/api/v1/security-cases")
      return route.fulfill({
        json: { viewer: actor, programs: [], cases: [] },
      });
    if (path === "/api/v1/security-submissions")
      return route.fulfill({
        json: {
          recipientGithubId: actor.githubId,
          automatic: false,
          submissions: [],
        },
      });
    if (path.startsWith("/api/v1/points/disputes")) {
      expect(route.request().headers()["x-slop-expected-github-id"]).toBe("42");
      return disputes(route, path, url.search);
    }
    throw new Error(`Unexpected request: ${route.request().method()} ${path}`);
  });
  return counts;
}

test("a moderator denies an escalated Points dispute with a recorded reason", async ({
  page,
}) => {
  const id = "pd_0000000000000001";
  const revision = { award: award("disputed", 30, "2026-10-20T10:00:00.000Z") };
  let dispute: Record<string, unknown> = {
    id,
    state: "review",
    openedAt: "2026-10-21T10:00:00.000Z",
    draft: "deny",
    resolution: null,
    revision,
    reason: "The merged change was reverted the next day.",
    resolutionReason: null,
    mayDecide: true,
  };
  const decisions: unknown[] = [];
  const counts = await serveInbox(page, async (route, path) => {
    expect(path).toBe(`/api/v1/points/disputes/${id}`);
    if (route.request().method() === "POST") {
      decisions.push(route.request().postDataJSON());
      dispute = {
        ...dispute,
        state: "resolved",
        resolution: "denied",
        resolutionReason: "The revert landed after the award window closed.",
        mayDecide: false,
      };
    }
    return route.fulfill({ json: dispute });
  });
  await page.goto(`/inbox?pointsDispute=${id}`, { waitUntil: "networkidle" });
  const review = page.getByRole("region", { name: "Points review" });
  await expect(review.getByText("30 points", { exact: true })).toBeVisible();
  await expect(
    review.getByRole("status").filter({ hasText: /^Moderator review$/u }),
  ).toBeVisible();
  await expect(review.getByText("Slopbot: Keep the award")).toBeVisible();
  const deny = review.getByRole("button", {
    name: "Deny dispute",
    exact: true,
  });
  const uphold = review.getByRole("button", {
    name: "Uphold dispute",
    exact: true,
  });
  await expect(deny).toBeDisabled();
  await expect(uphold).toBeDisabled();
  await review
    .getByLabel("Decision reason")
    .fill("The revert landed after the award window closed.");
  const reloads = counts.notifications;
  await deny.click();
  await expect(
    review.getByRole("status").filter({ hasText: /^Dispute denied$/u }),
  ).toBeVisible();
  expect(decisions).toEqual([
    {
      action: "deny",
      reason: "The revert landed after the award window closed.",
    },
  ]);
  await expect(
    review.getByText("The revert landed after the award window closed.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(deny).toHaveCount(0);
  await expect(review.getByLabel("Decision reason")).toHaveCount(0);
  // The decision keeps the dispute in the URL and refreshes the Inbox.
  await expect(page).toHaveURL(new RegExp(`[?&]pointsDispute=${id}$`, "u"));
  await expect.poll(() => counts.notifications).toBeGreaterThan(reloads);
  await expectAccessible(page);
});

test("Points history pages back with Older records using the server cursor", async ({
  page,
}) => {
  const reads: string[] = [];
  await serveInbox(page, (route, path, search) => {
    expect(path).toBe("/api/v1/points/disputes");
    reads.push(search);
    return route.fulfill({
      json:
        search === ""
          ? {
              awards: [
                {
                  revisionId: "rev_newer",
                  award: award("newer", 20, "2026-10-25T10:00:00.000Z"),
                  disputeId: null,
                },
              ],
              next: "cursor_after_newer",
            }
          : {
              awards: [
                {
                  revisionId: "rev_older",
                  award: award("older", 10, "2026-09-25T10:00:00.000Z"),
                  disputeId: "pd_0000000000000002",
                },
              ],
              next: null,
            },
    });
  });
  await page.goto("/inbox?points", { waitUntil: "networkidle" });
  const review = page.getByRole("region", { name: "Points review" });
  await expect(review.getByText("20 points", { exact: true })).toBeVisible();
  await review
    .getByRole("button", { name: "Older records", exact: true })
    .click();
  await expect(review.getByText("10 points", { exact: true })).toBeVisible();
  await expect(review.getByText("20 points", { exact: true })).toHaveCount(0);
  expect(reads).toEqual(["", "?before=cursor_after_newer"]);
  // The last page offers no further cursor; its disputed record links out.
  await expect(
    review.getByRole("button", { name: "Older records", exact: true }),
  ).toHaveCount(0);
  await expect(
    review.getByRole("link", { name: "Open review", exact: true }),
  ).toHaveAttribute("href", "/inbox?pointsDispute=pd_0000000000000002");
});
