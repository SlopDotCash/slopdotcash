import { expect, expectAccessible, test } from "./fixtures";

test("legacy people navigation preserves the pending ranking read and URL query", async ({
  page,
}) => {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let observed: () => void = () => {};
  const requested = new Promise<void>((resolve) => {
    observed = resolve;
  });
  let rankingReads = 0;
  await page.route("**/data/leaderboard.json?**", async (route) => {
    rankingReads++;
    observed();
    await held;
    await route.continue();
  });
  try {
    await page.goto("/points?q=profile", { waitUntil: "domcontentloaded" });
    await requested;
    await page.evaluate(() => {
      history.pushState({}, "", "/points?view=people&q=profile");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect(
      page.getByRole("region", { name: "People", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Find a contributor")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "People", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Rankings", exact: true }),
    ).toHaveCount(0);
    await expect(page).toHaveURL(/view=people.*q=profile/u);
    await page.evaluate(() => {
      history.pushState({}, "", "/points?q=profile");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    release();
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page).toHaveURL(/q=profile/u);
    expect(rankingReads).toBe(1);
  } finally {
    release();
  }
});

test(
  "points history is usable, accessible and independent of payments",
  { tag: ["@pages"] },
  async ({ page }, info) => {
    const response = await page.goto("/points");
    expect(response?.status()).toBe(200);
    const reloaded = await page.reload();
    expect(reloaded?.status()).toBe(200);
    await expect(
      page.getByRole("columnheader", { name: "Points", exact: true }),
    ).toHaveAttribute("aria-sort", "descending");
    const header = page.locator(".route-page-header");
    const actions = header.locator(".route-page-actions");
    const month = actions.getByRole("button", {
      name: "This month",
      exact: true,
    });
    const allTime = actions.getByRole("button", {
      name: "All time",
      exact: true,
    });
    await expect(month).toHaveAttribute("aria-pressed", "true");
    await expect(allTime).toHaveAttribute("aria-pressed", "false");
    const buttonStyle = await allTime.evaluate((button) => {
      const style = getComputedStyle(button);
      return {
        paddingLeft: style.paddingLeft,
        paddingRight: style.paddingRight,
        borderWidth: style.borderLeftWidth,
        borderStyle: style.borderLeftStyle,
        cursor: style.cursor,
        background: style.backgroundColor,
      };
    });
    expect(Number.parseFloat(buttonStyle.paddingLeft)).toBeGreaterThanOrEqual(
      16,
    );
    expect(Number.parseFloat(buttonStyle.paddingRight)).toBeGreaterThanOrEqual(
      16,
    );
    expect(buttonStyle.borderWidth).toBe("1px");
    expect(buttonStyle.borderStyle).toBe("solid");
    expect(buttonStyle.cursor).toBe("pointer");
    if ((page.viewportSize()?.width ?? 0) >= 768) {
      await allTime.hover();
      await expect
        .poll(() =>
          allTime.evaluate(
            (button) => getComputedStyle(button).backgroundColor,
          ),
        )
        .not.toBe(buttonStyle.background);
      await page.mouse.move(0, 0);
    }

    await expect(page.getByText("Period", { exact: true })).toHaveCount(0);
    await expect(page.locator(".points-panel .points-period")).toHaveCount(0);
    const titleBox = await header
      .getByRole("heading", { level: 1 })
      .boundingBox();
    const actionsBox = await actions.boundingBox();
    const headerBox = await header.boundingBox();
    if (!titleBox || !actionsBox || !headerBox)
      throw new Error("Missing leaderboard header");
    if ((page.viewportSize()?.width ?? 0) >= 768) {
      expect(actionsBox.x).toBeGreaterThanOrEqual(titleBox.x + titleBox.width);
      expect(
        Math.abs(
          actionsBox.x + actionsBox.width - headerBox.x - headerBox.width,
        ),
      ).toBeLessThanOrEqual(2);
      expect(actionsBox.y).toBeLessThan(titleBox.y + titleBox.height);
      expect(actionsBox.y + actionsBox.height).toBeGreaterThan(titleBox.y);
    } else {
      expect(actionsBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height);
    }

    await expect(page.locator(".points-coverage-details")).toHaveCount(0);
    await expect(page.getByLabel("Project", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Find a contributor")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "People", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Rankings", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "All time", exact: true }).click();
    await expect(page.getByRole("table")).toBeVisible({ timeout: 30000 });
    await expect(
      page.getByRole("columnheader", { name: "Points", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("columnheader")).toHaveText([
      "Rank",
      "Contributor",
      "Points",
    ]);
    await expect(
      page.getByRole("columnheader", { name: "Money received", exact: true }),
    ).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "All time", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("Cohort", { exact: true })).toHaveCount(0);
    // Earlier period links still open All time.
    await page.goto("/points?period=new");
    await expect(
      page.getByRole("button", { name: "All time", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.goto("/points?sort=points&period=lifetime");
    await expect(
      page.getByRole("region", { name: "People", exact: true }),
    ).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready);
    if ((page.viewportSize()?.width ?? 0) <= 390) {
      const scroller = page.getByRole("region", {
        name: "Contributor standings table",
        exact: true,
      });
      await scroller.focus();
      await expect(scroller).toBeFocused();
      // A narrower three-column table needs scrolling only if content overflows.
      if (await scroller.evaluate((el) => el.scrollWidth > el.clientWidth)) {
        await page.keyboard.press("ArrowRight");
        await expect
          .poll(() => scroller.evaluate((el) => el.scrollLeft))
          .toBeGreaterThan(0);
        await scroller.evaluate((el) => {
          el.scrollLeft = 0;
        });
      }
    }

    await page.getByRole("button", { name: "All time", exact: true }).click();
    const first = page.getByRole("table").getByRole("row").nth(1);
    const login = await first.getByRole("link").innerText();
    // Earlier contributor links still filter directly, without a search control.
    await page.goto(`/points?period=lifetime&q=${encodeURIComponent(login)}`);
    await expect(
      page.getByRole("table").getByRole("link", { name: login, exact: true }),
    ).toBeVisible();
    await page.goto("/points?period=lifetime&q=no-such-contributor-987654321");
    await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(0);
    await page.goto("/points?period=lifetime");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByText(/Page 2 of/)).toBeVisible();
    await month.click();
    await expect(month).toHaveAttribute("aria-pressed", "true");
    await expect(allTime).toHaveAttribute("aria-pressed", "false");
    await expect(page).not.toHaveURL(/page=2|period=lifetime/u);
    await expect(page.getByText(/Page 2 of/)).toHaveCount(0);
    await allTime.click();
    await expect(allTime).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(/period=lifetime/u);
    await expect(page).not.toHaveURL(/page=2/u);

    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() => document.activeElement !== document.body),
    ).toBe(true);
    await expectAccessible(page);
    await page.screenshot({
      path: info.outputPath("points.png"),
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
      await page.evaluate(() => {
        const overflow =
          document.documentElement.scrollWidth > window.innerWidth + 1;
        return {
          overflow,
          elements: !overflow
            ? []
            : [...document.querySelectorAll("main *")]
                .filter(
                  (el) =>
                    el.getBoundingClientRect().right > window.innerWidth + 1,
                )
                .map((el) => ({
                  tag: el.tagName,
                  class: el.className,
                  text: el.textContent?.slice(0, 80),
                  right: el.getBoundingClientRect().right,
                })),
        };
      }),
    ).toEqual({ overflow: false, elements: [] });
    await page.screenshot({
      path: info.outputPath("points-zoom.png"),
      fullPage: true,
    });
  },
);
