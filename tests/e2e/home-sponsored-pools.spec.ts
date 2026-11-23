import { SPONSORED_POOLS_NOTICE_ENDS } from "../../src/lib/sponsored-pools-notice";
import { expect, expectAccessibleReflow, test } from "./fixtures";

test.describe("sponsored pools notice", () => {
  test.skip(
    Date.now() >= SPONSORED_POOLS_NOTICE_ENDS,
    "The notice ends on 8 December 2026",
  );

  test("home page shows the notice and a dismissal is remembered", async ({
    page,
    diagnostics,
  }) => {
    diagnostics.allowPreviewApiMisses();
    await page.goto("/", { waitUntil: "networkidle" });
    const notice = page.getByRole("complementary", { name: "Sponsored pools" });
    await expect(notice).toContainText("Holders vote in early December");
    await expect(
      notice.getByRole("link", { name: "How to enter" }),
    ).toHaveAttribute("href", "https://record.slop.cash/sponsored-pools");
    await expectAccessibleReflow(page, "home-sponsored-pools-notice");
    await notice
      .getByRole("button", { name: "Dismiss sponsored pools notice" })
      .click();
    await expect(notice).toHaveCount(0);
    await page.reload({ waitUntil: "networkidle" });
    await expect(
      page.getByRole("complementary", { name: "Sponsored pools" }),
    ).toHaveCount(0);
  });

  test("the notice is gone once the round closes", async ({
    page,
    diagnostics,
  }) => {
    diagnostics.allowPreviewApiMisses();
    await page.clock.setFixedTime(new Date(SPONSORED_POOLS_NOTICE_ENDS));
    await page.goto("/", { waitUntil: "networkidle" });
    await expect(
      page.getByRole("button", { name: "Maintainer", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("complementary", { name: "Sponsored pools" }),
    ).toHaveCount(0);
  });
});
