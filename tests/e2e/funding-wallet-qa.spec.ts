/** Browser-only synthetic identity responses never register a real wallet. */
import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import { expect, test } from "./fixtures";

test("legacy wallet links open Account Wallets on direct navigation and reload", {
  tag: ["@pages"],
}, async ({ diagnostics, page }) => {
  diagnostics.allow(
    /^console Failed to load resource: the server responded with a status of 401 .* at http:\/\/[^ ]+\/api\/v1\/payments\/me$/u,
    /^401 GET http:\/\/[^ ]+\/api\/v1\/payments\/me$/u,
  );
  await page.route("**/api/v1/payments/me", (route) =>
    route.fulfill({ status: 401, json: { error: "not_signed_in" } }),
  );
  for (const path of ["/wallet", "/wallet/"]) {
    const response = await page.goto(path, { waitUntil: "networkidle" });
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/account#wallets$/u);
    await expect(
      page.getByRole("heading", { name: "Wallets", exact: true }),
    ).toBeInViewport();
    const reloaded = await page.reload({ waitUntil: "networkidle" });
    expect(reloaded?.status()).toBe(200);
    await expect(
      page
        .locator("#wallets")
        .getByRole("link", { name: "Sign in with GitHub" }),
    ).toHaveAttribute("href", "/login?next=%2Faccount%23wallets");
  }
});

/** Records every same-origin response for the attached network evidence. */
function observe(page: Page) {
  const network: { path: string; status: number }[] = [];
  page.on("response", (response) => {
    if (new URL(response.url()).origin === new URL(page.url()).origin)
      network.push({
        path: new URL(response.url()).pathname,
        status: response.status(),
      });
  });
  return { network };
}

async function audit(page: Page, info: TestInfo, label: string) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  await info.attach(`${label}-axe.json`, {
    body: JSON.stringify(
      { violations: result.violations, passes: result.passes.map((p) => p.id) },
      null,
      2,
    ),
    contentType: "application/json",
  });
  const screenshotPath = info.outputPath(`${label}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await info.attach(`${label}.png`, {
    path: screenshotPath,
    contentType: "image/png",
  });
  expect(result.violations, label).toEqual([]);
  const splitWords = await page.evaluate(() => {
    const failures: string[] = [];
    for (const element of document.querySelectorAll(
      ".site-header a, .wordmark, .payout-steps button",
    )) {
      if (!(element as HTMLElement).offsetWidth) continue;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (const match of (node.textContent ?? "").matchAll(/\S+/g)) {
          const range = document.createRange();
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match[0].length);
          const lines = new Set(
            [...range.getClientRects()].map((rect) => Math.round(rect.top)),
          );
          if (lines.size > 1) failures.push(match[0]);
        }
      }
    }
    return failures;
  });
  expect(splitWords, `${label} keeps navigation words intact`).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
    `${label} page overflow`,
  ).toBeLessThanOrEqual(1);
}

async function keyboardTo(
  page: Page,
  target: ReturnType<Page["getByRole"]>,
  reverse = false,
) {
  for (let count = 0; count < 80; count++) {
    if (await target.evaluate((element) => element === document.activeElement))
      return;
    await page.keyboard.press(reverse ? "Shift+Tab" : "Tab");
  }
  await expect(target).toBeFocused();
}

test("funding and wallet keyboard flows remain accessible at 200 percent text size", async ({
  page,
}, info) => {
  await page.route("**/api/v1/payments/me", (route) =>
    route.fulfill({
      json: {
        githubUserId: "123",
        wallets: [],
        payments: [],
        monthlyAwards: [],
        balances: [],
        directTransfers: [],
        walletObservations: [],
      },
    }),
  );
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({ json: { session: null } }),
  );
  const evidence = observe(page);
  for (const path of ["/wallet", "/projects/eliza/funding"]) {
    await page.goto(path, { waitUntil: "networkidle" });
    await page.evaluate(() => {
      const sizes = [...document.querySelectorAll<HTMLElement>("body *")].map(
        (element) => ({
          element,
          font: getComputedStyle(element).fontSize,
          line: getComputedStyle(element).lineHeight,
        }),
      );
      for (const { element, font, line } of sizes) {
        element.style.fontSize = `${Number.parseFloat(font) * 2}px`;
        if (line !== "normal")
          element.style.lineHeight = `${Number.parseFloat(line) * 2}px`;
      }
    });
    if (path === "/wallet") {
      const connect = page.getByRole("button", {
        name: "Connect Solana wallet",
        exact: true,
      });
      await keyboardTo(page, connect);
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("dialog", { name: "Connect a Solana wallet" }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(connect).toBeFocused();
      await audit(page, info, "wallet-200-percent-text");
    } else {
      await expect(
        page.getByRole("heading", { exact: true, name: "Eliza funding" }),
      ).toBeVisible();
      await keyboardTo(
        page,
        page.getByRole("link", { name: "cycle archive", exact: true }),
      );
      await audit(page, info, "funding-200-percent-text");
    }
  }
  await info.attach("network.json", {
    body: JSON.stringify(evidence, null, 2),
    contentType: "application/json",
  });
});
