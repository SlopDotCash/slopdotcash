import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.setTimeout(120000);

test("quality review groups duplicate accepted work and carries an exact source-bound proposal into the payout draft", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/projects/eliza/funding");
  const panel = page.locator(".funding-quality-review");
  await panel.locator("summary").focus();
  await page.keyboard.press("Enter");
  await panel
    .getByRole("button", { name: "Load cycle evidence", exact: true })
    .click();
  await expect(panel).toContainText("0 of 7061 source events reviewed");
  await panel.getByLabel("Find contributor or PR").fill("19630");
  await panel.getByRole("checkbox", { name: /^Select / }).check();
  await panel
    .getByRole("button", { name: "Select matching patch candidates" })
    .click();
  await panel
    .getByLabel("Public reason", { exact: true })
    .fill(
      "Same accepted Terraform checksum fix promoted from develop to main; count one outcome.",
    );
  await panel
    .getByRole("button", { name: "Save outcome proposal", exact: true })
    .click();
  await expect(panel).toContainText("2 of 7061 source events reviewed");
  const pending = page.waitForEvent("download");
  await panel
    .getByRole("button", { name: "Download decisions and comparison" })
    .click();
  const file = await (await pending).path();
  if (!file) throw new Error("Missing quality proposal");
  const proposal = JSON.parse(await readFile(file, "utf8"));
  expect(proposal.adjustments).toHaveLength(108);
  expect(proposal.paymentAuthorized).toBe(false);
  expect(proposal.unresolvedEvents).toBe(7059);
  expect(proposal.decisions[0].eventIds).toHaveLength(2);
  expect(
    proposal.adjustments.reduce(
      (sum: bigint, row: { amountMinor: string }) =>
        sum + BigInt(row.amountMinor),
      0n,
    ),
  ).toBe(10000000000n);
  await panel
    .getByRole("button", { name: "Use proposed amounts in recipient draft" })
    .click();
  await expect(panel.getByRole("status")).toContainText(
    "copied into the recipient draft",
  );
  await panel.getByLabel("Contribution type").selectOption("closures");
  await panel.getByLabel("Find contributor or PR").fill("18853");
  await panel.getByRole("checkbox", { name: /^Select / }).check();
  await panel.getByLabel("Find contributor or PR").fill("18855");
  await panel.getByRole("checkbox", { name: /^Select / }).check();
  await panel
    .getByLabel("Proposed deduction in basis points (100 = 1%)")
    .fill("100");
  await panel
    .getByLabel("Public evidence and reason")
    .fill(
      "Scenario only: repeated policy-contradicting CLI normalization after explicit maintainer feedback.",
    );
  await panel
    .getByRole("button", { name: "Propose review-burden deduction" })
    .click();
  await expect(panel.getByRole("status")).toContainText(
    "Burden deduction proposed locally",
  );
  expect(
    (
      await new AxeBuilder({ page })
        .include(".funding-quality-review")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.evaluate(() => {
    // Resize text independently; root CSS zoom at a 320px viewport creates
    // a 160 CSS-pixel layout, below the site's 320px reflow contract.
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
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);
  // Historical recovery can change the reviewed payload without changing the
  // predecessor snapshot/census labels. Never replay decisions across that change.
  await page.route(
    "**/data/contribution-quality/eliza-2026-08.json",
    async (route) => {
      const response = await route.fetch();
      const updated = await response.json();
      updated.events[0].flags.push("recovered review context");
      await route.fulfill({ response, json: updated });
    },
  );
  await page.reload();
  await panel.locator("summary").click();
  await panel
    .getByRole("button", { name: "Load cycle evidence", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText(
    "Invalid saved quality decisions",
  );
  await panel
    .getByRole("button", { name: "Clear saved quality draft", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "Load cycle evidence", exact: true })
    .click();
  await expect(panel).toContainText("0 of 7061 source events reviewed");
  await panel.getByLabel("Import saved quality decisions").setInputFiles({
    name: "previous-evidence-decisions.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(proposal)),
  });
  await expect(panel.getByRole("status")).toContainText(
    "Decision file does not match this exact cycle, source and budget",
  );
  await expect(panel).toContainText("0 of 7061 source events reviewed");
  expect(errors).toEqual([]);
});
