import { expect, expectAccessibleReflow, test } from "./fixtures";

test("switching journey resets an active campaign animation @desktop-only", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/", { waitUntil: "networkidle" });
  const animated = page.locator(".hero-typewriter");
  await expect(animated).toContainText("HACKING", { timeout: 25_000 });
  await page.getByRole("button", { name: "Maintainer", exact: true }).click();
  await expect(animated).toHaveText("WITH CONTRIBUTORS.");
  await page.getByRole("button", { name: "Contributor", exact: true }).click();
  await expect(animated).toHaveText("SHIPPING OPEN SOURCE.");
});

test("homepage switches the visible journey and every agent destination @breakpoint", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  await page.goto("/", { waitUntil: "networkidle" });
  const origin = new URL(page.url()).origin;
  const prompt = page.getByRole("status", { name: "Agent prompt" });
  const journeys = page.getByRole("group", {
    name: "Choose your Slop journey",
  });
  for (const audience of ["contributor", "maintainer"] as const) {
    const label = audience === "contributor" ? "Contributor" : "Maintainer";
    const skillPath =
      audience === "contributor"
        ? "/contribute/SKILL.md"
        : "/maintain/SKILL.md";
    const skillUrl = `${origin}${skillPath}`;
    const expectedPrompt = `Read ${skillUrl} and follow it.`;
    await journeys.getByRole("button", { name: label, exact: true }).click();
    await expect(
      journeys.getByRole("button", { name: label, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(prompt).toHaveText(expectedPrompt);
    await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName(
      audience === "contributor"
        ? "MAKE MONEY SHIPPING OPEN SOURCE."
        : "SHIP FASTER. WITH CONTRIBUTORS.",
    );
    for (const [name, parameter] of [
      ["Cursor", "text"],
      ["Claude", "q"],
      ["ChatGPT", "q"],
      ["Grok", "q"],
      ["Meta AI (Muse Spark)", "prompt"],
      ["OpenClaw", "message"],
      ["Hermes Agent", "identifier"],
    ]) {
      const href = await page
        .getByRole("link", { name, exact: true })
        .getAttribute("href");
      expect(new URL(href as string).searchParams.get(parameter)).toBe(
        parameter === "identifier" ? skillUrl : expectedPrompt,
      );
    }
    await expect(
      page.getByRole("link", { name: "Add a project" }),
    ).toHaveAttribute("href", "/projects/new");
    await expect(page.locator(".hero-typewriter-caret").last()).toBeHidden();
    await expectAccessibleReflow(page, `${audience}-home`);
  }
});

test("the homepage journey survives reload and browser history without dropping other URL state", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  diagnostics.allowCanceledBackgroundReads();
  await page.goto("/?audience=maintainer&period=lifetime#projects", {
    waitUntil: "networkidle",
  });
  const maintainer = page.getByRole("button", {
    name: "Maintainer",
    exact: true,
  });
  await expect(maintainer).toHaveAttribute("aria-pressed", "true");
  await page.reload({ waitUntil: "networkidle" });
  await expect(maintainer).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveTitle("Slop: ship and maintain open source");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://slop.cash/",
  );
  await page.mouse.wheel(0, -10_000);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.getByRole("button", { name: "Contributor", exact: true }).click();
  await expect(page).toHaveURL(/\/\?period=lifetime#projects$/u);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.goBack();
  await page.waitForLoadState("networkidle");
  await expect(maintainer).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(
    /audience=maintainer&period=lifetime#projects$/u,
  );
  await page.goForward();
  await page.waitForLoadState("networkidle");
  await expect(
    page.getByRole("button", { name: "Contributor", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.mouse.wheel(0, 400);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(400);
  await page.getByRole("link", { name: "How it works", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "How Slop works" }),
  ).toBeVisible();
  await page.goBack();
  await page.waitForLoadState("networkidle");
  await expect(
    page.getByRole("button", { name: "Contributor", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(400);
});

test("unknown journeys fall back to Contributor and the guide links to the maintainer journey", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  diagnostics.allowCanceledBackgroundReads();
  await page.goto("/?audience=administrator", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("button", { name: "Contributor", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const maintainer = page.getByRole("button", {
    name: "Maintainer",
    exact: true,
  });
  await maintainer.focus();
  await page.keyboard.press("Space");
  await expect(maintainer).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("link", { name: "How it works", exact: true }).click();
  await page.getByRole("link", { name: "Use the maintainer skill" }).click();
  await expect(page).toHaveURL(/\/\?audience=maintainer$/u);
  await expect(maintainer).toHaveAttribute("aria-pressed", "true");
});
