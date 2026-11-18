/**
 * A project's maintainer share (operator decision, 18 November 2026; PRD
 * section 6). The owner sets a percent of the monthly amount on the manage
 * page; it starts with the next UTC month. The project page, the home card
 * and /sponsors show it.
 */

import type { Page } from "@playwright/test";
import { PROJECT_SKILL_TEMPLATES } from "../../src/lib/project-schema.mjs";
import { PROJECTS } from "../../src/lib/projects.mjs";
import { CONTRIBUTION } from "../project-application-manifest";
import { projectImageApiFixture } from "../project-image-api-fixture.mjs";
import { stagingPaymentProject } from "../staging-payment-fixture.mjs";
import { expect, expectAccessibleReflow, test } from "./fixtures";

const OBSERVED_AT = "2026-11-18T11:17:00.000Z";
const NOW = "2026-11-18T12:00:00.000Z";

test.use({ video: "on" });

/** The frozen registry with a funded Eliza whose owner set a maintainer share. */
async function serveSharedEliza(
  page: Page,
  share: {
    maintainerShare?: number;
    maintainerShareHistory?: { throughCycle: string; basisPoints: number }[];
  },
) {
  const funded = stagingPaymentProject("base-mainnet");
  const eliza = { ...funded, reward: { ...funded.reward, ...share } };
  const vault = eliza.escrow?.deployments[0];
  if (!vault) throw new Error("The Eliza vault fixture is missing");
  await page.route(
    /\/(?:api\/v1\/projects|data\/fixture-project-registry\.json)$/,
    (route) =>
      route.fulfill({
        json: {
          schemaVersion: "1",
          projects: PROJECTS.map((entry) =>
            entry.id === eliza.id ? eliza : entry,
          ),
        },
      }),
  );
  await page.route("**/.well-known/slop/projects.json", (route) =>
    route.fulfill({ json: { schemaVersion: "1", projects: [] } }),
  );
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({ json: { session: null } }),
  );
  await page.route("**/api/v1/pool-funding", (route) =>
    route.fulfill({
      json: {
        schema: "slop-pool-funding-v1",
        projects: [
          {
            projectId: eliza.id,
            vaults: [
              {
                network: vault.network,
                vault: vault.vault,
                freeBalance: eliza.reward.monthlyCapMinor,
                blockTime: OBSERVED_AT,
                observedAt: OBSERVED_AT,
              },
            ],
          },
        ],
      },
    }),
  );
}

const NOTICE =
  "Maintainer share: 20% of the monthly amount, split among the maintainers who merge or close outside pull requests.";

test("a published maintainer share shows on the project page, the home card and sponsors", async ({
  page,
}, info) => {
  await page.clock.setFixedTime(new Date(NOW));
  await serveSharedEliza(page, { maintainerShare: 2000 });
  await page.goto("/", { waitUntil: "networkidle" });
  const card = page.locator('#projects a[href="/projects/eliza"]');
  await expect(card).toContainText("Maintainer share 20%");
  // A project without the setting shows nothing more than before.
  await expect(
    page.locator('#projects a[href="/projects/slopdotcash"]'),
  ).not.toContainText("Maintainer share");
  await page.screenshot({
    path: info.outputPath("home-maintainer-share.png"),
    fullPage: true,
  });

  await page.goto("/sponsors", { waitUntil: "networkidle" });
  const pools = page.getByRole("list", { name: "Project funding pools" });
  await expect(
    pools.locator("li").filter({
      has: page.getByRole("link", { name: "Eliza", exact: true }),
    }),
  ).toContainText("Maintainer share 20%");
  await page.screenshot({
    path: info.outputPath("sponsors-maintainer-share.png"),
    fullPage: true,
  });

  await page.goto("/projects/eliza", { waitUntil: "networkidle" });
  await expect(page.getByText(NOTICE, { exact: true })).toBeVisible();
  await page.screenshot({
    path: info.outputPath("project-maintainer-share.png"),
    fullPage: true,
  });
  await expectAccessibleReflow(page, "project-maintainer-share");
});

test("a share set this month is shown as starting next month", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date(NOW));
  await serveSharedEliza(page, {
    maintainerShare: 2000,
    maintainerShareHistory: [{ throughCycle: "2026-11", basisPoints: 0 }],
  });
  await page.goto("/projects/eliza", { waitUntil: "networkidle" });
  await expect(
    page.getByText(
      "Maintainer share: none of the monthly amount this month, 20% from December, split among the maintainers who merge or close outside pull requests.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(
    page.locator('#projects a[href="/projects/eliza"]'),
  ).toContainText("Maintainer share 20% from December");
});

test("a project without the setting shows no maintainer share", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date(NOW));
  await serveSharedEliza(page, {});
  await page.goto("/projects/eliza", { waitUntil: "networkidle" });
  await expect(page.locator(".project-reward-status").first()).toBeVisible();
  await expect(
    page.getByText("Maintainer share", { exact: false }),
  ).toHaveCount(0);
});

test("the owner sets, changes and clears the maintainer share on the manage page", async ({
  page,
}, info) => {
  const registered = PROJECTS.find((project) => project.id === "eliza");
  if (!registered) throw new Error("Missing project fixture");
  const api = await projectImageApiFixture({
    ...registered,
    contribution: { ...CONTRIBUTION },
    skill: {
      ...registered.skill,
      sourcePath: PROJECT_SKILL_TEMPLATES.contributor,
      publishAtRoot: false,
    },
    reviewSkill: {
      ...registered.reviewSkill,
      sourcePath: PROJECT_SKILL_TEMPLATES.reviewer,
    },
  });
  await page.route(
    /\/api\/v1\/(?:projects\/eliza(?:\?.*)?|project-setup\/eliza(?:\/check)?|project-session)$/u,
    async (route) => {
      const request = route.request();
      const response = await api.fetch(
        new Request(request.url(), {
          method: request.method(),
          headers: request.headers(),
          ...(request.method() === "GET" ? {} : { body: request.postData() }),
        }),
      );
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: await response.text(),
      });
    },
  );
  const publish = page.getByRole("button", {
    name: "Publish changes",
    exact: true,
  });
  const published = (revision: number) =>
    expect(
      page.getByRole("status").getByText(`Rev ${revision}`, { exact: true }),
    ).toBeVisible();
  try {
    await page.goto("/projects/eliza/manage", { waitUntil: "networkidle" });
    await page
      .getByText("Monthly rewards", { exact: true })
      .locator("xpath=self::summary")
      .click();
    const field = page.getByLabel("Maintainer share (%, 0 to 30, optional)", {
      exact: true,
    });
    // None until the owner enters a percent.
    await expect(field).toHaveValue("");
    const before = (await api.stored()).project.reward;
    expect(before.maintainerShare).toBeUndefined();

    // Above the limit is refused and nothing is published.
    await field.fill("31");
    await publish.click();
    await expect(
      page.getByText("Enter a whole number from 0 to 30, or leave it empty.", {
        exact: true,
      }),
    ).toBeVisible();
    expect((await api.stored()).revision).toBe(1);

    await field.fill("20");
    const proposed = page
      .getByRole("region", { name: "Changes", exact: true })
      .locator("dd")
      .filter({ hasText: "20%" });
    await expect(proposed).toBeVisible();
    // The change is marked as starting next month, not now.
    await expect(proposed).toContainText("From ");
    await page.screenshot({
      path: info.outputPath("manage-maintainer-share.png"),
      fullPage: true,
    });
    await field.focus();
    await expect(field).toBeFocused();
    await expectAccessibleReflow(page, "manage-maintainer-share");
    await publish.click();
    await published(2);
    const set = await api.stored();
    expect(set.revision).toBe(2);
    // The fixture server's clock is fixed in October 2026.
    const openCycle = "2026-10";
    // The open month and every earlier month keep no share.
    expect(set.project.reward).toEqual({
      ...before,
      maintainerShare: 2000,
      maintainerShareHistory: [{ throughCycle: openCycle, basisPoints: 0 }],
    });

    await field.fill("");
    await publish.click();
    await published(3);
    const cleared = (await api.stored()).project.reward;
    expect(cleared.maintainerShare).toBeUndefined();
    // The history written by the server stays.
    expect(cleared.maintainerShareHistory).toEqual([
      { throughCycle: openCycle, basisPoints: 0 },
    ]);
  } finally {
    await api.dispose();
  }
});
