/** A reward token's link must open the explorer for its recorded network. */
import { PROJECTS } from "../../src/lib/projects.mjs";
import { expect, test } from "./fixtures";

test("a Robinhood reward token opens its own chain explorer", async ({
  page,
  context,
}) => {
  const original = PROJECTS.find((project) => project.id === "eliza");
  if (original?.reward.kind !== "monthly-pool")
    throw new Error("The monthly project fixture is missing");
  const address = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
  const project = {
    ...original,
    reward: {
      ...original.reward,
      chain: "robinhood",
      currency: "WETH",
      monthlyCapMinor: "1000000000000000000",
      monthlyCapDisplay: "1 WETH",
    },
    ...(original.escrow
      ? { escrow: { ...original.escrow, chain: "robinhood", deployments: [] } }
      : {}),
    rewardAsset: {
      network: "robinhood",
      kind: "token",
      address,
      symbol: "WETH",
      decimals: 18,
      chainId: "4663",
      cluster: null,
      verifiedAt: "2026-10-25T00:00:00.000Z",
    },
  };
  await page.route("**/.well-known/slop/projects.json", (route) =>
    route.fulfill({ json: { schemaVersion: "1", projects: [] } }),
  );
  await page.route("**/data/fixture-project-registry.json", (route) =>
    route.fulfill({
      json: {
        schemaVersion: "1",
        projects: PROJECTS.map((entry) =>
          entry.id === project.id ? project : entry,
        ),
      },
    }),
  );
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({ json: { session: null } }),
  );
  await page.route("**/api/v1/projects/eliza", (route) =>
    route.fulfill({ json: { revision: 1, project } }),
  );
  // Keep the external explorer inert. This proves the actual clicked URL,
  // not the explorer's content or a live token balance.
  await context.route(
    /^https:\/\/(?:etherscan\.io|robinhoodchain\.blockscout\.com)\/token\//u,
    (route) => {
      const target = new URL(route.request().url());
      return route.fulfill({
        contentType: "text/html",
        body: `<title>Explorer destination</title><h1>${target.hostname}</h1><p>${target.pathname}</p>`,
      });
    },
  );
  await page.goto("/projects/eliza", { waitUntil: "networkidle" });
  const token = page.getByRole("link", { name: "$WETH", exact: true });
  await token.scrollIntoViewIfNeeded();
  const popupPromise = page.waitForEvent("popup");
  await token.click();
  const popup = await popupPromise;
  await popup.waitForLoadState("domcontentloaded");
  await expect(popup).toHaveURL(
    `https://robinhoodchain.blockscout.com/token/${address}`,
  );
});
