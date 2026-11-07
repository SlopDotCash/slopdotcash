import { expect, test } from "./fixtures";

/** The sponsor rules name the guide section they send the reader to. */
test("Payment stages on the sponsors page opens the payment stages section", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  diagnostics.allowCanceledBackgroundReads();
  await page.goto("/sponsors", { waitUntil: "networkidle" });
  await page.getByText("Funding rules and fees", { exact: true }).click();
  await page.getByRole("link", { name: "Payment stages", exact: true }).click();
  await expect(page).toHaveURL(/\/how-it-works#payments$/u);
  await expect(
    page.getByRole("heading", { name: "Payment stages", exact: true }),
  ).toBeInViewport();
});
