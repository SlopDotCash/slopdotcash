/** Browser-only synthetic identity responses never register a real wallet. */
import { createHash } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo, test } from "@playwright/test";

test.setTimeout(120_000);

const address = "11111111111111111111111111111111";
const sha = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

test("serves wallet registration on direct navigation and reload", async ({
  page,
}) => {
  for (const path of ["/wallet", "/wallet/"]) {
    const response = await page.goto(path, { waitUntil: "networkidle" });
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { name: "Register your wallet" }),
    ).toBeVisible();
    const reloaded = await page.reload({ waitUntil: "networkidle" });
    expect(reloaded?.status()).toBe(200);
    await expect(
      page.getByRole("button", { name: "Continue with GitHub" }),
    ).toBeVisible();
  }
});

function observe(page: Page) {
  const errors: string[] = [];
  const network: { path: string; status: number }[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    errors.push(
      `${new URL(request.url()).pathname}: ${request.failure()?.errorText}`,
    );
  });
  page.on("response", (response) => {
    if (new URL(response.url()).origin === new URL(page.url()).origin)
      network.push({
        path: new URL(response.url()).pathname,
        status: response.status(),
      });
  });
  return { errors, network };
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
      const input = page.getByLabel("Solana public address");
      await keyboardTo(page, input);
      await page.keyboard.type("invalid");
      await page.keyboard.press("Enter");
      await expect(page.getByRole("alert")).toContainText(
        "valid Solana public address",
      );
      await audit(page, info, "wallet-200-percent-text");
    } else {
      const panel = page.locator(".funding-workbench");
      await keyboardTo(page, panel.getByLabel("Find contributor"));
      await page.keyboard.type("lalalune");
      await expect(panel.locator("tbody tr")).toHaveCount(1);
      await audit(page, info, "funding-review-200-percent-text");
      for (const label of [
        "Prepare funding",
        "Approve cycle",
        "Track payments",
      ]) {
        const button = panel.getByRole("button", { name: label });
        await keyboardTo(page, button, label === "Prepare funding");
        await page.keyboard.press("Enter");
        await audit(
          page,
          info,
          `funding-${label.toLowerCase().replaceAll(" ", "-")}`,
        );
      }
      await expect(panel).toContainText("Payments have not been authorized");
    }
  }
  await info.attach("console-network.json", {
    body: JSON.stringify(evidence, null, 2),
    contentType: "application/json",
  });
  expect(evidence.errors).toEqual([]);
  expect(evidence.network.filter((r) => r.status >= 400)).toEqual([]);
});

test("wallet popup preview requires confirmation and verifies the returned public proof", async ({
  page,
  context,
}, info) => {
  const evidence = observe(page);
  let writes = 0;
  const owner = { githubActorId: "123", githubLogin: "qa-fixture" };
  const expiresAt = new Date(
    Math.floor(Date.now() / 1000) * 1000 + 240_000,
  ).toISOString();
  const flowId = `flow_${"f".repeat(24)}`;
  const canonical = {
    schemaVersion: 1,
    ...owner,
    address,
    source: "d1_registry",
    issueRepository: null,
    issueNumber: null,
    sourceBodySha256: sha({
      schemaVersion: 1,
      githubActorId: owner.githubActorId,
      address,
      supersedesClaimId: null,
    }),
    observedAt: new Date().toISOString(),
    supersedesClaimId: null,
  };
  const token = `fixture.${Buffer.from(
    JSON.stringify({
      githubId: owner.githubActorId,
      githubLogin: owner.githubLogin,
      iss: "slop.cash",
      aud: "private-trace-api",
      sub: "github:123",
      exp: Date.parse(expiresAt) / 1000,
    }),
  ).toString("base64url")}.fixture`;
  await context.route("https://identity.slop.cash/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/v1/oauth/authorize") {
      await route.fulfill({
        contentType: "text/html",
        body: "<title>Synthetic OAuth fixture</title>Test sign-in complete",
      });
    } else if (path === "/v1/oauth/start") {
      await route.fulfill({
        json: {
          flowId,
          pollCapability: "p".repeat(48),
          expiresAt,
          pollAfterSeconds: 1,
          authorizationUrl: `https://identity.slop.cash/v1/oauth/authorize?flow_id=${flowId}&state=${"s".repeat(48)}`,
        },
      });
    } else if (path === "/v1/oauth/poll") {
      await route.fulfill({
        json: {
          status: "complete",
          assertionType: "SlopIdentity",
          assertion: `slop_assert_v1_${"a".repeat(48)}`,
          expiresAt,
        },
      });
    } else throw new Error(`Unexpected identity request ${path}`);
  });
  await context.route("https://api.slop.cash/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/auth/session") {
      await route.fulfill({ json: { tokenType: "Bearer", token, expiresAt } });
    } else if (path === "/api/v1/wallet-claims/current") {
      // A real existing claim avoids treating an expected 404 as a console failure.
      const oldAddress = "Vote111111111111111111111111111111111111111";
      const old = { ...canonical, address: oldAddress };
      await route.fulfill({
        json: { ...old, claimId: "qa_old_claim", recordDigest: sha(old) },
      });
    } else if (path === "/api/v1/wallet-claims") {
      writes++;
      expect(route.request().postDataJSON()).toEqual({
        address,
        supersedesClaimId: "qa_old_claim",
      });
      const next = {
        ...canonical,
        supersedesClaimId: "qa_old_claim",
        sourceBodySha256: sha({
          schemaVersion: 1,
          githubActorId: owner.githubActorId,
          address,
          supersedesClaimId: "qa_old_claim",
        }),
      };
      await route.fulfill({
        json: { ...next, claimId: "qa_new_claim", recordDigest: sha(next) },
      });
    } else throw new Error(`Unexpected API request ${path}`);
  });
  await page.goto("/wallet", { waitUntil: "networkidle" });
  await keyboardTo(page, page.getByLabel("Solana public address"));
  await page.keyboard.type(address);
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Confirm your public registration" }),
  ).toBeVisible();
  expect(writes).toBe(0);
  await expect(page.locator(".funding-workbench")).toContainText(
    owner.githubLogin,
  );
  await audit(page, info, "wallet-preview");
  await keyboardTo(
    page,
    page.getByRole("button", { name: "Cancel", exact: true }),
  );
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toContainText(
    "No wallet claim was submitted",
  );
  expect(writes).toBe(0);
  await keyboardTo(
    page,
    page.getByRole("button", { name: "Continue with GitHub" }),
  );
  await page.keyboard.press("Enter");
  const confirm = page.getByRole("button", {
    name: "Confirm register",
    exact: true,
  });
  await expect(confirm).toBeVisible();
  await keyboardTo(page, confirm);
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Wallet registered", exact: true }),
  ).toBeVisible();
  expect(writes).toBe(1);
  await expect(
    page.getByRole("link", { name: "View public claim" }),
  ).toHaveAttribute(
    "href",
    "https://api.slop.cash/api/v1/wallet-claims/qa_new_claim",
  );
  await audit(page, info, "wallet-confirmed-synthetic");
  await info.attach("console-network.json", {
    body: JSON.stringify(evidence, null, 2),
    contentType: "application/json",
  });
  expect(evidence.errors).toEqual([]);
  expect(evidence.network.filter((r) => r.status >= 400)).toEqual([]);
});
