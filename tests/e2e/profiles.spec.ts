import { githubUserIdFromNodeId } from "../../src/lib/github-actor";
import { assertProfiles } from "../../src/lib/profiles";
import { TARGET_REPOSITORIES } from "../../src/lib/repositories.mjs";
import { expect, expectAccessible, test } from "./fixtures";

test("profiles preserve legacy coverage and expose recorded issue history", async ({
  page,
}, info) => {
  const failures: string[] = [];
  page.on("response", (r) => {
    if (
      new URL(r.url()).origin === new URL(page.url()).origin &&
      r.status() >= 400
    )
      failures.push(r.url());
  });
  const walletRequests: string[] = [];
  const expectedWalletRequests = [
    "/api/v1/wallet-claims/actors/1234567/current",
  ];
  // This census/issue-history check must not depend on a remote payout service.
  await page.route("**/api/v1/wallet-claims/actors/*/current", (route) => {
    walletRequests.push(new URL(route.request().url()).pathname);
    return route.fulfill({ json: null });
  });
  const now = new Date().toISOString();
  await page.route("**/data/profiles.json", (r) =>
    r.fulfill({
      json: {
        schemaVersion: "1",
        startedAt: now,
        generatedAt: now,
        repositories: TARGET_REPOSITORIES.map((v, i) => ({
          repository: v.id,
          count: i === 0 ? 5 : 0,
          excluded: 0,
        })),
        people: [
          {
            id: "MDQ6VXNlcjEyMzQ1Njc=",
            login: "profile-only-contributor",
            avatarUrl: "https://avatars.githubusercontent.com/u/1234567",
            repositories: [
              {
                repository: TARGET_REPOSITORIES[0].id,
                merged: 0,
                open: 3,
                closed: 2,
              },
            ],
          },
        ],
      },
    }),
  );
  await page.goto("/points");
  const directory = page.getByRole("region", { name: "People", exact: true });
  await directory.getByLabel("GitHub username").fill("profile-only");
  await directory
    .getByRole("link", { name: "profile-only-contributor", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "profile-only-contributor",
      exact: true,
    }),
  ).toBeVisible();
  const profile = page.getByRole("region", { name: "Contributor profile" });
  await expect(profile.locator(".pr-legend")).toContainText("3 PRs open");
  await expect(profile.locator(".pr-legend")).toContainText(
    "2 PRs closed without merging",
  );
  await expect(
    page
      .getByText("total points", { exact: true })
      .locator("..")
      .locator("strong"),
  ).toHaveText("0");
  await expect(
    profile.getByRole("link", { name: "GitHub · @profile-only-contributor" }),
  ).toHaveAttribute("href", "https://github.com/profile-only-contributor");
  await profile.getByText("Issue outcomes", { exact: true }).click();
  await expect(profile.getByLabel("Period (UTC)")).toHaveCount(0);
  await expect(
    profile.locator("summary", { hasText: /^Penalty history$/ }),
  ).toHaveCount(0);
  await profile.locator("summary", { hasText: /^Issue outcomes$/ }).focus();
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => document.activeElement !== document.body),
  ).toBe(true);
  await expectAccessible(page);
  await page.screenshot({
    path: info.outputPath("individual-profile.png"),
    fullPage: true,
  });
  // Match the repository's 200% text-enlargement fixture without reducing
  // a 320px viewport below the supported reflow width through CSS zoom.
  await page.evaluate(() => {
    const typography = [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((el) => el instanceof HTMLElement)
      .map((el) => ({
        el,
        font: getComputedStyle(el).fontSize,
        line: getComputedStyle(el).lineHeight,
      }));
    for (const { el, font, line } of typography) {
      el.style.fontSize = `${Number.parseFloat(font) * 2}px`;
      if (line !== "normal")
        el.style.lineHeight = `${Number.parseFloat(line) * 2}px`;
    }
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("individual-profile-zoom.png"),
    fullPage: true,
  });
  await page.unroute("**/data/profiles.json");
  const response = await page.request.get("/data/profiles.json");
  expect(response.ok()).toBe(true);
  const census = await response.json();
  assertProfiles(census);
  const reopened = census.issues?.items.find(
    (issue) =>
      issue.authorId !== null &&
      issue.events.some((event) => event.kind === "reopened"),
  );
  if (!reopened)
    throw Error("The reviewed census must include a reopened issue");
  const actor = census.people.find((person) => person.id === reopened.authorId);
  if (!actor) throw Error("The issue author must have a profile");
  const walletActorId = githubUserIdFromNodeId(actor.id);
  if (!walletActorId)
    throw Error("The issue author must have a GitHub actor ID");
  expectedWalletRequests.push(
    `/api/v1/wallet-claims/actors/${walletActorId}/current`,
  );
  const lastReopen = [...reopened.events]
    .reverse()
    .find((event) => event.kind === "reopened");
  if (!lastReopen) throw Error("The issue must retain its reopen event");
  const repository = TARGET_REPOSITORIES.find(
    (item) => item.id === reopened.repository,
  );
  if (!repository) throw Error("The issue repository must be registered");
  await page.goto(`/contributors/${actor.login}`);
  await page.getByText("Issue outcomes", { exact: true }).click();
  await page
    .getByRole("combobox", { name: "Repository", exact: true })
    .selectOption(reopened.repository);
  await page
    .getByRole("combobox", { name: "Period (UTC)", exact: true })
    .selectOption(new Date(lastReopen.occurredAt).toISOString().slice(0, 7));
  const issueDetails = page.locator("details").filter({
    has: page.locator(":scope > summary", { hasText: /^Issue outcomes$/ }),
  });
  await issueDetails.locator("summary", { hasText: /^Issue history/ }).click();
  const reopenedRecord = issueDetails
    .locator("li")
    .filter({
      has: page.locator(
        `a[href="https://github.com/${repository.owner}/${repository.name}/issues/${reopened.number}"]`,
      ),
    })
    .filter({ hasText: "Reopened" });
  await expect(reopenedRecord.first()).toBeVisible();
  await expectAccessible(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("issue-outcomes.png"),
    fullPage: true,
  });
  expect(walletRequests).toEqual(expectedWalletRequests);
  expect(failures).toEqual([]);
});
