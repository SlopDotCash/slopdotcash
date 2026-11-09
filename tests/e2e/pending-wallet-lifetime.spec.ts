import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "./fixtures";

let directory: string;
let bundle: string;
test.beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "slop-wallet-lifetime-"));
  bundle = join(directory, "fixture.js");
  execFileSync("bun", [
    "build",
    fileURLToPath(
      new URL("../pending-wallet-lifetime-fixture.tsx", import.meta.url),
    ),
    "--target=browser",
    "--format=iife",
    "--outfile",
    bundle,
  ]);
});
test.afterAll(() => rmSync(directory, { recursive: true, force: true }));

test("committed wallet removal retires the final pre-send callback", async ({
  page,
}) => {
  await page.route("**/__wallet-lifetime-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><body><main id="root"></main></body></html>',
    }),
  );
  await page.goto("/__wallet-lifetime-fixture");
  await page.addScriptTag({ path: bundle });
  await expect(
    page.getByText("Wallet request open", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Leave wallet" }).click();
  await expect(page.getByText("Wallet closed", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => ({
      ...(
        window as unknown as {
          walletLifetime: { committedRemoval: boolean; sends: number };
        }
      ).walletLifetime,
      saved: sessionStorage.getItem("slop:test:pending-wallet-lifetime"),
    })),
  ).toEqual({ committedRemoval: true, sends: 0, saved: null });
});
