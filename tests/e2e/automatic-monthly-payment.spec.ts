/** Browser-only wallet fixture; the full on-chain flow runs in vault-actions.spec.ts against Anvil. */
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { EscrowDeployment } from "../../src/lib/escrow-policy.mjs";
import { PROJECTS } from "../../src/lib/projects.mjs";

const owner = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const other = "0x15d34aaf54267db7d7c367839aaf71a00a2c6a65";
const deployment: EscrowDeployment = {
  network: "base-sepolia",
  vault: "0x1000000000000000000000000000000000000001",
  asset: "0x2000000000000000000000000000000000000002",
  owner,
  identityAuthority: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
  feeRecipient: "0x90f79bf6eb2c4f870365e785982e1f101e93b906",
  factory: "0x3000000000000000000000000000000000000003",
  registrar: "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
  programId: null,
  upgradeAuthority: null,
  projectPda: null,
  networkDomain: null,
  rotationDelaySeconds: null,
  bindingDelaySeconds: "3600",
  deploymentTransaction: `0x${"4".repeat(64)}`,
  sourceCommit: "a".repeat(40),
  codeSha256: "b".repeat(64),
  factoryCodeSha256: "c".repeat(64),
};

test("automatic monthly payment starts checked and only the vault owner can sign", async ({
  page,
}, info) => {
  const original = PROJECTS.find((entry) => entry.id === "eliza");
  if (original?.reward.kind !== "monthly-pool")
    throw new Error("Missing monthly project fixture");
  const project = {
    ...original,
    reward: { ...original.reward, chain: "base", feeBasisPoints: 200 },
    escrow: {
      schemaVersion: "1",
      effectiveCycle: "2026-10",
      chain: "base",
      feeBasisPoints: 200,
      withdrawalFeeBasisPoints: 200,
      feeMode: "deduct-from-gross",
      deployments: [deployment],
    },
  };
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (event) => {
    if (event.type() === "error") errors.push(event.text());
  });
  const methods: string[] = [];
  await page.exposeFunction("monthlyFixtureRequest", (method: string) => {
    methods.push(method);
    if (method === "eth_accounts" || method === "eth_requestAccounts")
      return [other];
    if (method === "eth_chainId") return "0x14a34";
    throw new Error(`Unexpected wallet request ${method}`);
  });
  await page.addInitScript(() => {
    Object.assign(window, {
      ethereum: {
        isMetaMask: true,
        request: ({ method }: { method: string }) =>
          (
            window as unknown as {
              monthlyFixtureRequest: (method: string) => Promise<unknown>;
            }
          ).monthlyFixtureRequest(method),
      },
    });
  });
  await page.route(
    /\/(?:api\/v1\/projects|data\/fixture-project-registry\.json)$/,
    (route) =>
      route.fulfill({ json: { schemaVersion: "1", projects: [project] } }),
  );
  await page.route("**/api/v1/projects/eliza", (route) =>
    route.fulfill({ json: { project, revision: 1 } }),
  );
  await page.route("**/api/v1/payments/projects/eliza/vault", (route) =>
    route.fulfill({
      json: {
        projectId: "eliza",
        snapshots: [],
        staleAfterMs: 60000,
        servedAt: new Date().toISOString(),
      },
    }),
  );
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({ json: { session: null } }),
  );
  await page.goto("/projects/eliza/funding", { waitUntil: "networkidle" });
  const monthly = page.getByRole("region", {
    name: "Automatic monthly payment · base-sepolia",
  });
  const connect = monthly.getByRole("button", {
    name: "Connect MetaMask",
    exact: true,
  });
  await connect.focus();
  await page.keyboard.press("Enter");
  const automatic = monthly.getByRole("checkbox", {
    name: "Pay contributors automatically each month",
  });
  await expect(automatic).toBeChecked();
  // The owner can opt out with the keyboard before any signature.
  await automatic.focus();
  await page.keyboard.press("Space");
  await expect(automatic).not.toBeChecked();
  await page.keyboard.press("Space");
  await expect(automatic).toBeChecked();
  await monthly
    .getByRole("button", { name: "Review monthly payment setting" })
    .click();
  await expect(monthly.getByRole("alert")).toContainText(
    "Connect the vault owner's wallet to change automatic monthly payment.",
  );
  expect(methods).not.toContain("eth_sendTransaction");
  await expect(
    monthly.getByRole("button", {
      name: "Turn on automatic monthly payment in wallet",
    }),
  ).toHaveCount(0);
  await monthly.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath("automatic-monthly-payment.png"),
    fullPage: true,
  });
  const overflow = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
  expect(await overflow()).toBeLessThanOrEqual(1);
  // Controlled text enlargement, distinct from native browser zoom.
  await monthly.evaluate((section) => {
    for (const element of section.querySelectorAll<HTMLElement>("*")) {
      const style = getComputedStyle(element);
      element.style.fontSize = `${parseFloat(style.fontSize) * 2}px`;
      if (style.lineHeight !== "normal")
        element.style.lineHeight = `${parseFloat(style.lineHeight) * 2}px`;
    }
  });
  expect(await overflow()).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: info.outputPath("automatic-monthly-payment-200-percent-text.png"),
    fullPage: true,
  });
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  expect(errors).toEqual([]);
});
