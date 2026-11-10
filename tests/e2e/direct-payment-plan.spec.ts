/**
 * Browser coverage for the direct-payment plan check (F1) and the
 * unreadable saved-request recovery (F7). The fixture bundle renders the
 * real payment components against a fake EVM provider and a fake Wallet
 * Standard Solana wallet; a tampered plan must be refused before any
 * wallet prompt, a valid plan must still pay, and a corrupt saved journal
 * must offer an in-page clear path instead of a dead component.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { encodeBase58Bytes } from "../../src/lib/base58";
import { expect, test } from "./fixtures";

let directory: string;
let bundle: string;
test.beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "slop-direct-payment-plan-"));
  bundle = join(directory, "fixture.js");
  execFileSync("bun", [
    "build",
    fileURLToPath(
      new URL("../direct-payment-plan-fixture.tsx", import.meta.url),
    ),
    "--target=browser",
    "--format=esm",
    // The fixture bundle runs outside Vite, so the environment reads the
    // app performs through `import.meta.env` need build-time values.
    "--define",
    'import.meta.env.VITE_SLOP_ENVIRONMENT="staging"',
    "--define",
    'import.meta.env.VITE_SLOP_LOCAL_BACKEND="0"',
    "--define",
    "import.meta.env.DEV=false",
    "--outfile",
    bundle,
  ]);
});
test.afterAll(() => rmSync(directory, { recursive: true, force: true }));

type Scenario = {
  rail: "evm" | "solana";
  plan: "valid" | "tampered";
  journal: "clean" | "corrupt";
};
type FixtureState = {
  sends: { method?: string }[];
  verified: unknown[];
  ready: boolean;
};

async function openFixture(page: Page, scenario: Scenario) {
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        session: { githubId: "12345", githubLogin: "e2e-owner" },
      }),
    }),
  );
  await page.route("**/__direct-payment-plan-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><body><main id="root"></main></body></html>',
    }),
  );
  await page.addInitScript((value: Scenario) => {
    (
      window as unknown as { directPaymentScenario: Scenario }
    ).directPaymentScenario = value;
  }, scenario);
  await page.goto("/__direct-payment-plan-fixture");
  await page.addScriptTag({ path: bundle, type: "module" });
  await expect(
    page.getByText("Payment fixture ready", { exact: true }),
  ).toBeVisible();
}

async function fixtureState(page: Page): Promise<FixtureState> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          directPaymentPlan: FixtureState;
        }
      ).directPaymentPlan,
  );
}

const fakeHash = `0x${"ab".repeat(32)}`;
const fakeSignature = encodeBase58Bytes(new Uint8Array(64).fill(0x2a));

test("a tampered EVM plan is refused before the wallet prompt", async ({
  page,
}) => {
  await openFixture(page, { rail: "evm", plan: "tampered", journal: "clean" });
  await expect(
    page.getByRole("alert").filter({
      hasText: "The prepared payment does not match the approved transfers",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Pay remaining transfers" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Connect MetaMask" }).click();
  await expect(
    page.getByText("Connected: 0x1111111111111111111111111111111111111111", {
      exact: true,
    }),
  ).toBeVisible();
  expect(
    (await fixtureState(page)).sends.filter(
      (send) => send.method === "eth_sendTransaction",
    ),
  ).toHaveLength(0);
});

test("a valid EVM plan still pays and verifies", async ({ page }) => {
  await openFixture(page, { rail: "evm", plan: "valid", journal: "clean" });
  await page.getByRole("button", { name: "Connect MetaMask" }).click();
  await expect(
    page.getByText("Connected: 0x1111111111111111111111111111111111111111", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pay remaining transfers" }).click();
  await expect(
    page.getByText("Transfers submitted. Verify them after finality.", {
      exact: true,
    }),
  ).toBeVisible();
  const sends = (await fixtureState(page)).sends.filter(
    (send) => send.method === "eth_sendTransaction",
  );
  expect(sends).toHaveLength(2);
  await page.getByRole("button", { name: "Verify submitted payments" }).click();
  await expect(
    page.getByText("Finalized evidence verified.", { exact: true }),
  ).toBeVisible();
  expect((await fixtureState(page)).verified).toEqual([fakeHash, fakeHash]);
});

test("a corrupt EVM journal can be cleared in place", async ({ page }) => {
  await openFixture(page, { rail: "evm", plan: "valid", journal: "corrupt" });
  await expect(
    page.getByRole("alert").filter({
      hasText: "The saved wallet request cannot be read",
    }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "I checked wallet activity. Clear saved request",
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: "I checked wallet activity. Clear saved request",
    }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Connect MetaMask" }).click();
  await expect(
    page.getByText("Connected: 0x1111111111111111111111111111111111111111", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pay remaining transfers" }).click();
  await expect(
    page.getByText("Transfers submitted. Verify them after finality.", {
      exact: true,
    }),
  ).toBeVisible();
});

test("a tampered Solana plan is refused before the wallet prompt", async ({
  page,
}) => {
  await openFixture(page, {
    rail: "solana",
    plan: "tampered",
    journal: "clean",
  });
  await expect(
    page.getByRole("alert").filter({
      hasText: "The prepared payment does not match the approved transfers",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Pay approved award" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Connect Fixture Solana" }).click();
  await expect(
    page.getByText(
      `Connected: ${encodeBase58Bytes(new Uint8Array(32).fill(1))}`,
      { exact: true },
    ),
  ).toBeVisible();
  expect((await fixtureState(page)).sends).toHaveLength(0);
});

test("a valid Solana plan still pays and verifies", async ({ page }) => {
  await openFixture(page, {
    rail: "solana",
    plan: "valid",
    journal: "clean",
  });
  await page.getByRole("button", { name: "Connect Fixture Solana" }).click();
  await page.getByRole("button", { name: "Pay approved award" }).click();
  await expect(page.locator("input").first()).toHaveValue(fakeSignature);
  await page.getByRole("button", { name: "Verify submitted payment" }).click();
  expect((await fixtureState(page)).verified).toEqual([fakeSignature]);
});

test("a corrupt Solana pending record can be cleared in place", async ({
  page,
}) => {
  await openFixture(page, {
    rail: "solana",
    plan: "valid",
    journal: "corrupt",
  });
  await expect(
    page.getByRole("alert").filter({
      hasText: "The saved wallet request cannot be read",
    }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "I checked wallet activity. Clear saved request",
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: "I checked wallet activity. Clear saved request",
    }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Connect Fixture Solana" }).click();
  await page.getByRole("button", { name: "Pay approved award" }).click();
  await expect(page.locator("input").first()).toHaveValue(fakeSignature);
});
