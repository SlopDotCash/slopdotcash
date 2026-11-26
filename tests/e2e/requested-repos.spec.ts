/** Browser contract for the Requested repos page; the API suite uses real SQLite. */
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { deploymentOrigins, deploymentTier } from "../../src/lib/deployment";
import { expect, expectAccessibleReflow, test } from "./fixtures";

const { site } = deploymentOrigins(
  deploymentTier(process.env.VITE_SLOP_ENVIRONMENT),
);

type Flag = { repo: string; expiresAt: string; listedAs: string | null };

/** Serves the build under the site origin and answers the page's reads. */
async function serve(
  page: Page,
  member: { referralCode: string | null } | null,
  board: () => {
    repos: { repo: string; count: number; newestAt: string }[];
    mine: Flag[] | null;
  },
) {
  await page.route(`${site}/**`, (route) =>
    route.fulfill({
      path: join(
        process.cwd(),
        "dist",
        route.request().resourceType() === "document"
          ? "index.html"
          : new URL(route.request().url()).pathname,
      ),
    }),
  );
  await page.route(`${site}/api/v1/points/me`, (route) =>
    member === null
      ? route.fulfill({ status: 401, json: { error: "not_signed_in" } })
      : route.fulfill({
          json: {
            actor: { id: "U_kgDOAAAAAQ", login: "link-test" },
            joinedAt: "2026-10-01T00:00:00Z",
            public: true,
            welcome: 5,
            referralCode: member.referralCode,
          },
        }),
  );
  await page.route(`${site}/api/v1/repo-requests`, (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: board() })
      : route.fallback(),
  );
}

test("a member flags a repo from a link, sees the count, copies a pitch with their link, renews and withdraws", async ({
  page,
  diagnostics,
}, info) => {
  const mine: Flag[] = [];
  const counts = new Map([["acme/widgets", 2]]);
  const posted: { repo: unknown; action: unknown }[] = [];
  await serve(page, { referralCode: "DrewBuilds" }, () => ({
    repos: [...counts]
      .filter(([, count]) => count > 0)
      .map(([repo, count]) => ({
        repo,
        count,
        newestAt: "2026-11-22T12:00:00.000Z",
      })),
    mine: [...mine],
  }));
  await page.route(`${site}/api/v1/repo-requests`, async (route) => {
    const request = route.request();
    if (request.method() !== "POST") return route.fallback();
    const body = request.postDataJSON() as { repo: string; action: string };
    posted.push({ repo: body.repo, action: body.action });
    if (body.repo === "acme/self")
      return route.fulfill({
        status: 409,
        json: {
          error: "own_repo",
          message: "You cannot flag your own repository.",
        },
      });
    const before = counts.get(body.repo) ?? 0;
    const already = mine.some((flag) => flag.repo === body.repo);
    if (body.action === "withdraw") {
      mine.splice(
        mine.findIndex((flag) => flag.repo === body.repo),
        1,
      );
      counts.set(body.repo, before - 1);
      return route.fulfill({
        json: {
          repo: body.repo,
          count: before - 1,
          flagged: false,
          expiresAt: null,
        },
      });
    }
    const expiresAt = "2027-02-20T12:00:00.000Z";
    if (!already) {
      mine.push({ repo: body.repo, expiresAt, listedAs: null });
      counts.set(body.repo, before + 1);
    }
    return route.fulfill({
      json: {
        repo: body.repo,
        count: counts.get(body.repo),
        flagged: true,
        expiresAt,
      },
    });
  });
  diagnostics.allow(
    /^console Failed to load resource: the server responded with a status of 409 \(.+\) at .+\/api\/v1\/repo-requests$/u,
  );

  await page.goto(`${site}/requested?flag=acme/widgets`, {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("heading", { name: "Requested repos", level: 1 }),
  ).toBeVisible();
  const panel = page.getByRole("region", { name: "Flag a repo" });
  await expect(panel).toContainText(
    "Flag acme/widgets as a repo you'd work on?",
  );
  const table = page.getByRole("table", { name: "Requested repos" });
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(table.getByRole("row").nth(1)).toContainText("acme/widgets2");
  await page.screenshot({
    path: info.outputPath("requested-before-flag.png"),
    fullPage: true,
  });

  await panel.getByRole("button", { name: "Flag", exact: true }).click();
  await expect(page.getByRole("status").first()).toHaveText(
    "Flagged acme/widgets until Feb 20, 2027.",
  );
  await expect(table.getByRole("row").nth(1)).toContainText("acme/widgets3");
  const flags = page.getByRole("region", { name: "Your flags" });
  await expect(flags).toContainText("acme/widgets · Counts until Feb 20, 2027");

  await page
    .context()
    .grantPermissions(["clipboard-read", "clipboard-write"], { origin: site });
  await table
    .getByRole("button", { name: "Copy pitch for acme/widgets" })
    .click();
  await expect(table.getByText("Copied.")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    `3 Slop contributors with merged work want to work on acme/widgets. List it free at ${site}/referral/DrewBuilds`,
  );

  // Renew with the keyboard: one request, the same flag.
  await flags.getByRole("button", { name: "Renew acme/widgets" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").first()).toHaveText(
    "Flagged acme/widgets until Feb 20, 2027.",
  );
  await flags.getByRole("button", { name: "Withdraw acme/widgets" }).click();
  await expect(page.getByRole("status").first()).toHaveText(
    "Withdrawn your flag on acme/widgets.",
  );
  await expect(flags).toContainText("You have not flagged a repo.");
  await expect(table.getByRole("row").nth(1)).toContainText("acme/widgets2");

  // A pasted GitHub link in the field flags its repository.
  await page.goto(`${site}/requested`, { waitUntil: "domcontentloaded" });
  const field = page.getByRole("region", { name: "Flag a repo" });
  await field
    .getByRole("textbox", { name: "Repository" })
    .fill("https://github.com/acme/tools/pull/3");
  await field.getByRole("button", { name: "Flag", exact: true }).click();
  await expect(page.getByRole("status").first()).toContainText(
    "Flagged acme/tools until",
  );
  await field.getByRole("textbox", { name: "Repository" }).fill("tools");
  await field.getByRole("button", { name: "Flag", exact: true }).click();
  await expect(field.getByRole("alert")).toHaveText(
    "Enter the repository as owner/name or paste its GitHub link.",
  );

  // A refusal is shown and nothing changes.
  await page.goto(`${site}/requested?flag=acme/self`, {
    waitUntil: "domcontentloaded",
  });
  await page
    .getByRole("region", { name: "Flag a repo" })
    .getByRole("button", { name: "Flag", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveText(
    "You cannot flag your own repository.",
  );
  expect(posted).toEqual([
    { repo: "acme/widgets", action: "flag" },
    { repo: "acme/widgets", action: "flag" },
    { repo: "acme/widgets", action: "withdraw" },
    { repo: "acme/tools", action: "flag" },
    { repo: "acme/self", action: "flag" },
  ]);
  await expectAccessibleReflow(page, "requested-repos");
});

test("a signed-out visitor sees the board, a sign-in prompt and a pitch that links the project form", async ({
  page,
  diagnostics,
}) => {
  // A signed-out session answers 401, which the browser reports.
  diagnostics.allow(
    /^console Failed to load resource: the server responded with a status of 401 \(Unauthorized\) at .+\/api\/v1\/points\/me$/u,
  );
  await serve(page, null, () => ({
    repos: [
      { repo: "acme/widgets", count: 1, newestAt: "2026-11-21T09:00:00.000Z" },
    ],
    mine: null,
  }));
  await page.goto(`${site}/requested?flag=acme/widgets`, {
    waitUntil: "domcontentloaded",
  });
  const panel = page.getByRole("region", { name: "Flag a repo" });
  await expect(panel).toContainText(
    "Sign in to flag acme/widgets as a repo you'd work on.",
  );
  await expect(
    panel.getByRole("link", { name: "Sign in with GitHub" }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Your flags" })).toHaveCount(0);
  await page
    .context()
    .grantPermissions(["clipboard-read", "clipboard-write"], { origin: site });
  await page
    .getByRole("button", { name: "Copy pitch for acme/widgets" })
    .click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    `1 Slop contributor with merged work wants to work on acme/widgets. List it free at ${site}/projects/new`,
  );
  // A link that names no repository says so.
  await page.goto(`${site}/requested?flag=not-a-repo`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("alert")).toHaveText(
    "Enter the repository as owner/name.",
  );
  // The footer links the page.
  await expect(
    page
      .getByRole("contentinfo")
      .getByRole("link", { name: "Requested repos" }),
  ).toHaveAttribute("href", "/requested");
});
