import type { Locator, Page } from "@playwright/test";
import { expect, servePublicProjectReads, test } from "./fixtures";

// The fake clock passes the data loaders' request deadlines, so they cancel
// their reads. The hero does not depend on that data.
test.beforeEach(async ({ diagnostics, page }) => {
  diagnostics.allow(/^net::ERR_ABORTED GET http:\/\/[^ ]+\/data\//u);
  await servePublicProjectReads(page);
});

test("hero types, deletes and cycles without moving layout or changing its accessible name", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.clock.install({ time: new Date("2026-10-24T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-24T00:00:01Z"));
  await page.goto("/");
  const heading = page.getByRole("heading", { level: 1 });
  const text = heading.locator(".hero-typewriter");
  await expect(text).not.toBeEmpty();
  const initialText = (await text.textContent()) ?? "";
  await page.evaluate(() => document.fonts.ready);
  const before = await heading.boundingBox();
  // Each step is longer than the hero's longest pause, so it fires the one
  // pending timer; the next timer starts only after React renders the step.
  const advanceUntil = async (reached: (value: string) => boolean) => {
    for (let step = 0; step < 200; step += 1) {
      if (reached((await text.textContent()) ?? "")) return;
      await page.clock.runFor(2_500);
      expect((await heading.boundingBox())?.height).toBe(before?.height);
    }
    throw new Error("The hero typewriter stopped advancing");
  };
  const accessibleName = await heading.getAttribute("aria-label");
  if (!accessibleName)
    throw new Error("The animated heading needs an accessible name");
  await advanceUntil(
    (value) => value.length > 0 && value.length < initialText.length,
  );
  expect((await heading.boundingBox())?.height).toBe(before?.height);
  await advanceUntil((value) => value === "");
  expect((await heading.boundingBox())?.height).toBe(before?.height);
  await advanceUntil((value) => value.length === 1);
  await expect(heading).toHaveAccessibleName(accessibleName);
  await advanceUntil((value) => value === initialText);
  expect((await heading.boundingBox())?.height).toBe(before?.height);
  await expect(heading).toHaveAccessibleName(accessibleName);
});

test("reduced motion keeps the hero static", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install({ time: new Date("2026-10-24T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-24T00:00:01Z"));
  await page.goto("/");
  const text = page.locator(".hero-typewriter");
  await expect(text).not.toBeEmpty();
  const initialText = (await text.textContent()) ?? "";
  await page.clock.runFor(30_000);
  await expect(text).toHaveText(initialText);
  await expect(
    page.locator(".hero-typewriter > .hero-typewriter-caret"),
  ).toBeHidden();
});

const contributorAction = "SHIPPING OPEN SOURCE.";
const maintainerAction = "WITH CONTRIBUTORS.";

async function expectDeleting(page: Page, text: Locator, phrase: string) {
  await expect
    .poll(async () => {
      await page.clock.runFor(2_500);
      const value = (await text.textContent()) ?? "";
      return value.length > 0 && value !== phrase && phrase.startsWith(value);
    })
    .toBe(true);
}

test("changing to reduced motion replaces a partial phrase and turning it off restarts the campaign", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.clock.install({ time: new Date("2026-10-24T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-24T00:00:01Z"));
  await page.goto("/");
  const heading = page.getByRole("heading", { level: 1 });
  const text = heading.locator(".hero-typewriter");
  const caret = text.locator(".hero-typewriter-caret");
  await expect(text).toHaveText(contributorAction);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await expectDeleting(page, text, contributorAction);
    await expect(heading).toHaveAccessibleName(
      `MAKE MONEY ${contributorAction}`,
    );

    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(text).toHaveText(contributorAction);
    await expect(caret).toBeHidden();
    await page.clock.runFor(30_000);
    await expect(text).toHaveText(contributorAction);
    await expect(heading).toHaveAccessibleName(
      `MAKE MONEY ${contributorAction}`,
    );

    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(text).toHaveText(contributorAction);
    await expect(caret).toBeVisible();
  }
  await expectDeleting(page, text, contributorAction);
  await expect(heading).toHaveAccessibleName(`MAKE MONEY ${contributorAction}`);
});

test("starting reduced allows later animation and honors the current preference on return home", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install({ time: new Date("2026-10-24T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-24T00:00:01Z"));
  await page.goto("/?audience=maintainer");
  const heading = page.getByRole("heading", { level: 1 });
  const text = heading.locator(".hero-typewriter");
  await expect(text).toHaveText(maintainerAction);
  await page.clock.runFor(30_000);
  await expect(text).toHaveText(maintainerAction);

  await page.getByRole("button", { name: "Contributor", exact: true }).click();
  await expect(text).toHaveText(contributorAction);
  await page.getByRole("button", { name: "Maintainer", exact: true }).click();
  await expect(text).toHaveText(maintainerAction);
  await expect(heading).toHaveAccessibleName(
    `SHIP FASTER. ${maintainerAction}`,
  );

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expectDeleting(page, text, maintainerAction);
  await page.getByRole("button", { name: "Contributor", exact: true }).click();
  await expect(text).toHaveText(contributorAction);
  await expectDeleting(page, text, contributorAction);
  await expect(heading).toHaveAccessibleName(`MAKE MONEY ${contributorAction}`);

  await page.getByRole("link", { name: "How it works", exact: true }).click();
  await expect(text).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("link", { name: "Slop home", exact: true }).click();
  await expect(text).toHaveText(contributorAction);
  await page.clock.runFor(30_000);
  await expect(text).toHaveText(contributorAction);
  await expect(heading).toHaveAccessibleName(`MAKE MONEY ${contributorAction}`);
});
