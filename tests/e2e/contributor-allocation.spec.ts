/** Payouts shows only the signed-in account's row of the published contributor allocation. */
import type { Page } from "@playwright/test";
import { expect, expectAccessible, test } from "./fixtures";

const tx = `0x${"b".repeat(64)}`;
const robinhood = {
  chain: "robinhood",
  claimId: "claim-1",
  address: "0x1111111111111111111111111111111111111111",
  authorized: true,
  firstAuthorizedAt: "2025-12-01T00:00:00Z",
};
function allocation(
  recipient: { amountBase: string; transactionId: string | null },
  closesAt = "2099-01-01T17:00:00Z",
) {
  return {
    distribution: {
      network: "robinhood-mainnet",
      token: {
        symbol: "SLOP",
        decimals: 18,
        address: "0x2222222222222222222222222222222222222222",
      },
      registrationClosesAt: closesAt,
      closed: false,
      recipients: [
        { githubId: "900000200", ...recipient },
        {
          githubId: "900000201",
          amountBase: "9000000000000000000000",
          transactionId: null,
        },
      ],
    },
  };
}
async function setup(
  page: Page,
  published: unknown,
  wallets: (typeof robinhood)[] = [],
) {
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({
      json: {
        session: { githubId: "900000200", githubLogin: "alloc", admin: false },
      },
    }),
  );
  await page.route("**/api/v1/project-appeals", (route) =>
    route.fulfill({ json: { appeals: [] } }),
  );
  await page.route("**/api/v1/referrals/me", (route) =>
    route.fulfill({ json: { enabled: false } }),
  );
  await page.route("**/api/v1/payments/me", (route) =>
    route.fulfill({
      json: {
        githubUserId: "900000200",
        wallets,
        payments: [],
        balances: [],
        monthlyAwards: [],
        directTransfers: [],
        walletObservations: [],
      },
    }),
  );
  await page.route("**/contributor-allocation.json", (route) =>
    route.fulfill({ json: published }),
  );
}
const section = (page: Page) =>
  page.getByRole("region", { name: "Contributor allocation" });

for (const event of ["focus", "visibilitychange"] as const) {
  test(`an allocation rechecks its deadline on ${event} after a wall-clock jump`, async ({
    page,
  }, info) => {
    await page.clock.install({ time: new Date("2026-11-05T00:00:00Z") });
    await setup(
      page,
      allocation(
        { amountBase: "1537000000000000000000", transactionId: null },
        "2026-11-05T00:10:00Z",
      ),
    );
    await page.goto("/earnings", { waitUntil: "networkidle" });
    await expect(section(page)).toContainText("Awaiting wallet");
    await section(page).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath("before-return.png") });
    // Unlike fastForward, changing the wall clock does not run the timeout.
    await page.clock.setSystemTime(new Date("2026-11-05T01:00:00Z"));
    await page.evaluate((type) => {
      const target = type === "focus" ? window : document;
      target.dispatchEvent(new Event(type));
    }, event);
    await expect(section(page)).toContainText("Unclaimed");
    await expect(
      section(page).getByRole("link", {
        name: "Add or confirm your Robinhood Chain wallet",
      }),
    ).toHaveCount(0);
    await expectAccessible(page);
    await page.screenshot({ path: info.outputPath("after-return.png") });
  });
}

test("an open allocation stops offering wallet registration when its deadline passes", async ({
  page,
}, info) => {
  await page.clock.install({ time: new Date("2026-11-05T00:00:00Z") });
  await setup(
    page,
    allocation(
      { amountBase: "1537000000000000000000", transactionId: null },
      "2026-11-05T00:01:00Z",
    ),
  );
  await page.goto("/earnings", { waitUntil: "networkidle" });
  await expect(section(page)).toContainText("Awaiting wallet");
  const register = section(page).getByRole("link", {
    name: "Add or confirm your Robinhood Chain wallet",
  });
  for (let steps = 0; steps < 40; steps++) {
    await page.keyboard.press("Tab");
    if (await register.evaluate((link) => link === document.activeElement))
      break;
  }
  await expect(register).toBeFocused();
  await section(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("before-deadline.png") });
  await page.clock.fastForward("01:01");
  await expect(section(page)).toContainText("Unclaimed");
  await expect(
    section(page).getByRole("link", {
      name: "Add or confirm your Robinhood Chain wallet",
    }),
  ).toHaveCount(0);
  await expectAccessible(page);
  await page.screenshot({ path: info.outputPath("after-deadline.png") });
  await page.evaluate(() => {
    if (window.innerWidth >= 640) document.documentElement.style.zoom = "2";
    else document.documentElement.style.fontSize = "200%";
  });
  await section(page).scrollIntoViewIfNeeded();
  await expect(section(page)).toContainText("Unclaimed");
  await expectAccessible(page);
  await page.screenshot({
    path: info.outputPath("after-deadline-200-percent.png"),
  });
});

test("an on-time wallet stays scheduled as the allocation deadline passes", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-11-05T00:00:00Z") });
  await setup(
    page,
    allocation(
      { amountBase: "1537000000000000000000", transactionId: null },
      "2026-11-05T00:01:00Z",
    ),
    [robinhood],
  );
  await page.goto("/earnings", { waitUntil: "networkidle" });
  await expect(section(page)).toContainText("Scheduled");
  await page.clock.fastForward("01:01");
  await expect(section(page)).toContainText("Scheduled");
});

test("a recipient without a wallet is linked to register it before the deadline", async ({
  page,
}, info) => {
  await setup(
    page,
    allocation({ amountBase: "1537000000000000000000", transactionId: null }),
  );
  await page.goto("/earnings", { waitUntil: "networkidle" });
  await expect(section(page)).toContainText("1,537");
  await expect(section(page)).toContainText("SLOP");
  await expect(section(page)).toContainText("Awaiting wallet");
  // Only this account's row is shown.
  await expect(section(page)).not.toContainText("9,000");
  const link = section(page).getByRole("link", {
    name: "Add or confirm your Robinhood Chain wallet",
  });
  await expect(link).toHaveAttribute("href", "/account#wallets");
  await expect(section(page)).toContainText("Jan 1, 2099");
  await expectAccessible(page);
  await page.screenshot({
    path: info.outputPath("allocation-awaiting-wallet.png"),
    fullPage: true,
  });
});

test("a confirmed wallet is scheduled, then a recorded transfer is sent", async ({
  page,
}, info) => {
  await setup(
    page,
    allocation({ amountBase: "1537000000000000000000", transactionId: null }),
    [robinhood],
  );
  await page.goto("/earnings", { waitUntil: "networkidle" });
  await expect(section(page)).toContainText("Scheduled");
  await expect(
    section(page).getByRole("link", { name: "View transfer" }),
  ).toHaveCount(0);
  await page.unroute("**/contributor-allocation.json");
  await page.route("**/contributor-allocation.json", (route) =>
    route.fulfill({
      json: allocation({
        amountBase: "1537000000000000000000",
        transactionId: tx,
      }),
    }),
  );
  await page.reload({ waitUntil: "networkidle" });
  await expect(section(page)).toContainText("Sent");
  await expect(
    section(page).getByRole("link", { name: "View transfer" }),
  ).toHaveAttribute("href", `https://robinhoodchain.blockscout.com/tx/${tx}`);
  await expectAccessible(page);
  await page.screenshot({
    path: info.outputPath("allocation-sent.png"),
    fullPage: true,
  });
});

test("no published allocation, or no row for this account, shows nothing", async ({
  page,
}) => {
  await setup(page, { distribution: null });
  await page.goto("/earnings", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", { name: "Awards and payments" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Contributor allocation" }),
  ).toHaveCount(0);
  const other = allocation({ amountBase: "1", transactionId: null });
  other.distribution.recipients.shift();
  await page.unroute("**/contributor-allocation.json");
  await page.route("**/contributor-allocation.json", (route) =>
    route.fulfill({ json: other }),
  );
  await page.reload({ waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", { name: "Awards and payments" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Contributor allocation" }),
  ).toHaveCount(0);
});

test("a missed deadline stays unclaimed after late wallet confirmation", async ({
  page,
}) => {
  const published = allocation(
    { amountBase: "1537000000000000000000", transactionId: null },
    "2026-01-01T00:00:00Z",
  );
  await setup(page, published);
  await page.goto("/earnings", { waitUntil: "networkidle" });
  await expect(section(page)).toContainText("Unclaimed");
  await setup(page, published, [
    { ...robinhood, firstAuthorizedAt: "2026-01-02T00:00:00Z" },
  ]);
  await page.reload({ waitUntil: "networkidle" });
  await expect(section(page)).toContainText("Unclaimed");
  await expect(section(page)).not.toContainText("Scheduled");
  // An on-time registration remains scheduled after the same cutoff.
  await setup(page, published, [robinhood]);
  await page.reload({ waitUntil: "networkidle" });
  await expect(section(page)).toContainText("Scheduled");
  await expectAccessible(page);
});

test("an invalid file is an error with retry, never an empty allocation", async ({
  page,
}) => {
  await setup(page, { distribution: { network: "solana-mainnet" } });
  await page.goto("/earnings", { waitUntil: "networkidle" });
  const alert = page
    .getByRole("alert")
    .filter({ hasText: "The contributor allocation could not load." });
  await expect(alert).toBeVisible();
  await page.unroute("**/contributor-allocation.json");
  await page.route("**/contributor-allocation.json", (route) =>
    route.fulfill({
      json: allocation(
        { amountBase: "1537000000000000000000", transactionId: null },
        "2026-01-01T00:00:00Z",
      ),
    }),
  );
  await alert.getByRole("button", { name: "Retry" }).click();
  await expect(alert).toHaveCount(0);
  await expect(section(page)).toContainText("Unclaimed");
});
