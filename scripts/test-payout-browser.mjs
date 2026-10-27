import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";
import { privateKeyToAccount } from "viem/accounts";

await mkdir("evidence", { recursive: true });
const fixtureLog = openSync("evidence/payout-browser-fixture.log", "w");
const previewLog = openSync("evidence/payout-browser-preview.log", "w");
const fixture = spawn(
  "bun",
  ["backend/payments/evm.integration.ts", "--serve"],
  { stdio: ["ignore", fixtureLog, fixtureLog] },
);
const preview = spawn(
  "bunx",
  ["vite", "preview", "--host", "127.0.0.1", "--port", "18549", "--strictPort"],
  { stdio: ["ignore", previewLog, previewLog] },
);
async function ready(url) {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    if (fixture.exitCode !== null || preview.exitCode !== null)
      throw new Error("Local fixture failed; inspect evidence logs");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Fixture did not start: ${url}`);
}
let browser;
try {
  await Promise.all([
    ready("http://127.0.0.1:18548/fixture"),
    ready("http://127.0.0.1:18549/earnings"),
  ]);
  const signer = privateKeyToAccount(`0x${"1".padStart(64, "0")}`); // public local test key only
  browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    recordVideo: {
      dir: "evidence/payout-videos",
      size: { width: 1440, height: 1000 },
    },
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const failedRequests = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) =>
    failedRequests.push({ url: request.url(), error: request.failure() }),
  );
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const response = await fetch(
      `http://127.0.0.1:18548${url.pathname}${url.search}`,
      {
        method: req.method(),
        headers: { "content-type": "application/json" },
        ...(req.method() === "GET" ? {} : { body: req.postData() }),
      },
    );
    await route.fulfill({
      status: response.status,
      headers: { "content-type": "application/json" },
      body: await response.text(),
    });
  });
  // The site reads the project registry from D1 at startup. The payments
  // fixture serves no registry, so answer it with the empty registry the
  // payout flow needs; registered last, this route takes precedence.
  await page.route("**/api/v1/projects", (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ schemaVersion: "1", projects: [] }),
    }),
  );
  const signedMessages = [];
  await page.exposeFunction("localWalletSign", (message) => {
    signedMessages.push(message);
    return signer.signMessage({ message: { raw: message } });
  });
  await page.addInitScript((address) => {
    window.ethereum = {
      request: async ({ method, params }) => {
        if (method === "eth_requestAccounts") return [address];
        if (method === "personal_sign")
          return window.localWalletSign(params[0]);
        throw new Error(`Unsupported test wallet call ${method}`);
      },
    };
  }, signer.address);
  await page.goto("http://127.0.0.1:18549/earnings");
  await page.getByRole("heading", { name: "Your payouts" }).waitFor();
  await page.getByRole("link", { name: "Manage payout wallets" }).click();
  await page.getByRole("heading", { name: "Account", exact: true }).waitFor();
  // One EVM connection confirms a distinct claim for each supported chain.
  await page.getByRole("button", { name: "Connect EVM wallet" }).waitFor();
  await page.getByRole("button", { name: "Connect Solana wallet" }).waitFor();
  await page.screenshot({
    path: "evidence/payout-desktop-before.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Connect EVM wallet" }).focus();
  await page.keyboard.press("Enter");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Browser wallet Detected" })
    .click();
  await page
    .getByText("EVM wallet confirmed.", { exact: false })
    .waitFor({ timeout: 60000 });
  await page
    .getByRole("navigation", { name: "Account sections" })
    .getByRole("link", { name: "Payouts", exact: true })
    .click();
  for (let attempt = 0; attempt < 15; attempt++) {
    await page.getByRole("button", { name: "Refresh payments" }).click();
    await page
      .getByRole("button", { name: "Refresh payments" })
      .waitFor({ state: "visible" });
    await page.waitForLoadState("networkidle");
    if (await page.getByText("Paid", { exact: true }).count()) break;
    await page.waitForTimeout(1000);
  }
  await page.getByText("Paid", { exact: true }).waitFor({ timeout: 10000 });
  const paid = await (
    await fetch("http://127.0.0.1:18548/api/v1/payments/me")
  ).json();
  if (
    paid.payments[0].netBase !== "98000000" ||
    paid.payments[0].feeBase !== "2000000" ||
    paid.payments[0].state !== "paid"
  )
    throw new Error("Wrong payment result");
  const both = await (
    await fetch("http://127.0.0.1:18548/api/v1/payments/me")
  ).json();
  const walletOn = (chain) => both.wallets.filter((w) => w.chain === chain);
  const evmWallets = ["base", "robinhood", "ethereum"].map((chain) => {
    const wallets = walletOn(chain);
    if (
      wallets.length !== 1 ||
      !wallets[0].authorized ||
      wallets[0].address.toLowerCase() !== signer.address.toLowerCase()
    )
      throw new Error(`Missing independently confirmed ${chain} wallet`);
    return wallets[0];
  });
  if (
    signedMessages.length !== 3 ||
    new Set(signedMessages).size !== 3 ||
    new Set(evmWallets.map((wallet) => wallet.claimId)).size !== 3 ||
    both.payments[0].state !== "paid" ||
    both.payments[0].netBase !== "98000000" ||
    both.payments[0].feeBase !== "2000000" ||
    both.balances.some((b) => b.chain !== "base")
  )
    throw new Error(
      "EVM confirmation did not preserve chain claims and Base payment",
    );
  await page.screenshot({
    path: "evidence/payout-desktop-paid.png",
    fullPage: true,
  });
  const desktopAxe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  await page.setViewportSize({ width: 390, height: 844 });
  const history = page.getByRole("region", {
    name: "Payment history details; scroll horizontally for all columns",
  });
  // Narrow screens show labelled payment cards. Every value must fit on
  // screen without the horizontal scrolling required by the old table.
  const paidRow = history.getByRole("row").filter({
    has: page.getByText("Paid", { exact: true }),
  });
  for (const label of [
    "Project",
    "Network",
    "Gross award",
    "Fee",
    "You receive",
    "Status",
  ]) {
    const cell = paidRow.locator(`td[data-label="${label}"]`);
    await cell.waitFor({ state: "visible" });
    const bounds = await cell.boundingBox();
    if (!bounds || bounds.x < 0 || bounds.x + bounds.width > 390)
      throw new Error(`Mobile payment value is off screen: ${label}`);
  }
  await history.focus();
  await page.keyboard.press("Tab");
  const projectLink = paidRow.locator('td[data-label="Project"] a');
  if (
    !(await projectLink.evaluate(
      (element) => element === document.activeElement,
    ))
  )
    throw new Error("Payment card cannot be reached with the keyboard");
  await page.screenshot({
    path: "evidence/payout-mobile-paid.png",
    fullPage: true,
  });
  const mobileAxe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  await page.evaluate(() => (document.documentElement.style.zoom = "2"));
  await page.screenshot({
    path: "evidence/payout-mobile-200pct.png",
    fullPage: true,
  });
  const zoomAxe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  await writeFile(
    "evidence/payout-browser-result.json",
    JSON.stringify(
      {
        identity:
          "Seeded local GitHub session; injected local signer; real HTTP handlers, SQLite and Anvil",
        payment: paid.payments[0],
        desktopViolations: desktopAxe.violations,
        mobileViolations: mobileAxe.violations,
        zoomViolations: zoomAxe.violations,
        consoleErrors,
        failedRequests,
      },
      null,
      2,
    ),
  );
  await page.waitForLoadState("networkidle");
  await context.close();
  await browser.close();
  browser = undefined;
  if (
    desktopAxe.violations.length ||
    mobileAxe.violations.length ||
    zoomAxe.violations.length ||
    consoleErrors.length ||
    failedRequests.length
  )
    throw new Error("Browser evidence contains failures");
  console.log(
    "Browser payout workflow passed: desktop, mobile, keyboard, 200% zoom, WCAG AA, exact 98/2 paid receipt; seeded identity and test signer.",
  );
} finally {
  await browser?.close();
  fixture.kill("SIGTERM");
  preview.kill("SIGTERM");
  closeSync(fixtureLog);
  closeSync(previewLog);
}
