import { expect, type Page } from "@playwright/test";

/** Select retained fixture data through the same calendar controls as an owner. */
export async function selectAwardMonth(page: Page, period: string) {
  const [year, month] = period.split("-").map(Number);
  const target = year * 12 + month - 1;
  const months = Array.from({ length: 12 }, (_, index) =>
    new Intl.DateTimeFormat("en-US", {
      month: "long",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(2000, index, 1))),
  );
  const expected = `${months[month - 1]} ${year}`;
  const navigation = page.getByRole("navigation", {
    name: "Contribution month",
    exact: true,
  });
  const label = navigation.locator('[aria-live="polite"]');
  // Ten years is ample for these retained fixtures; an unreachable month
  // must fail instead of looping or changing the browser/chain clocks.
  for (let attempt = 0; attempt < 120; attempt++) {
    const shown = await label.innerText();
    if (shown === expected) return;
    const [name, displayedYear] = shown.split(" ");
    const index = months.indexOf(name);
    if (index < 0 || !/^\d{4}$/.test(displayedYear))
      throw new Error(`Cannot read the award month: ${shown}`);
    const current = Number(displayedYear) * 12 + index;
    await navigation
      .getByRole("button", {
        name: current > target ? "Previous award month" : "Next award month",
        exact: true,
      })
      .click();
    await expect(label).not.toHaveText(shown);
  }
  throw new Error(`Could not select retained award month ${period}`);
}
