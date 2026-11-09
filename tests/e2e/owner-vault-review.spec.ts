/**
 * Owner vault setup review controls with a synthetic setup API. No wallet
 * signs or sends anything; the existing-vault recovery path needs none.
 */
import { buildCreateVaultCalldata } from "../../contracts/evm/adapter";
import { ESCROW_NETWORKS } from "../../src/lib/escrow-policy.mjs";
import { PROJECTS } from "../../src/lib/projects.mjs";
import { registryProjectDigest } from "../../src/lib/vault-setup";
import { expect, expectAccessible, test } from "./fixtures";
import { serveProjectMaintainer } from "./project-maintainer-fixture";

const OWNER = "0x1111111111111111111111111111111111111111";
const FACTORY = "0x2222222222222222222222222222222222222222";
const VAULT = "0x3333333333333333333333333333333333333333";
const HASH = `0x${"4".repeat(64)}`;

test("an owner changes a vault review and starts over after a failed creation", async ({
  page,
  diagnostics,
}, info) => {
  diagnostics.allowPreviewApiMisses();
  diagnostics.allowCanceledBackgroundReads();
  // An active project whose Base vault is configured but not yet created,
  // so its owner sees vault setup. The Base network stablecoin replaces any
  // registered reward asset, so the case does not depend on which registry
  // snapshot the run uses.
  const registered = PROJECTS.find((entry) => entry.id === "eliza");
  if (!registered) throw new Error("Missing fixture project");
  const project = {
    ...registered,
    rewardAsset: undefined,
    escrow: {
      effectiveCycle: "2026-10",
      ...registered.escrow,
      schemaVersion: "1" as const,
      chain: "base" as const,
      feeBasisPoints: registered.reward.feeBasisPoints,
      withdrawalFeeBasisPoints: 200,
      feeMode: "deduct-from-gross" as const,
      deployments: [],
    },
  } as typeof registered;
  const network = "base-sepolia" as const;
  const policy = ESCROW_NETWORKS[network];
  const asset = policy.asset;
  const failed = diagnostics.allowResponse(
    409,
    "POST",
    `/api/v1/project-vaults/${project.id}`,
  );
  await serveProjectMaintainer(page, () => project);
  await page.route("**/api/v1/projects", (route) =>
    route.fulfill({ json: { schemaVersion: "1", projects: [project] } }),
  );
  await page.route("**/api/v1/payments/me", (route) =>
    route.fulfill({
      json: {
        githubUserId: "1",
        wallets: [
          {
            chain: policy.chain,
            claimId: "claim-owner-wallet",
            address: OWNER,
            authorized: true,
          },
        ],
        payments: [],
        monthlyAwards: [],
        balances: [],
        directTransfers: [],
        walletObservations: [],
      },
    }),
  );
  const posts: Record<string, unknown>[] = [];
  await page.route(
    `**/api/v1/project-vaults/${project.id}?purpose=ordinary`,
    (route) => route.fulfill({ json: { revision: 4, networks: [network] } }),
  );
  await page.route(`**/api/v1/project-vaults/${project.id}`, (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    posts.push(body);
    if (body.step === "register")
      return route.fulfill({
        status: 409,
        json: {
          error: "vault_creation_failed",
          message: "The creation transaction failed on chain.",
        },
      });
    const automatic = body.automatic === true;
    return route.fulfill({
      json: {
        review: {
          family: "evm",
          payoutPolicy: "ordinary",
          network,
          chainId: policy.chainId,
          owner: OWNER,
          asset,
          cap: project.reward.monthlyCapMinor,
          capDisplay: project.reward.monthlyCapDisplay,
          automatic,
          existingVault: VAULT,
          transaction: {
            from: OWNER,
            to: FACTORY,
            value: "0x0",
            data: buildCreateVaultCalldata({
              projectId: `0x${registryProjectDigest(project.id)}`,
              asset: String(asset),
              monthlyCap: project.reward.monthlyCapMinor,
              automaticMonthly: automatic,
            }),
          },
        },
      },
    });
  });
  await page.goto(`/projects/${project.slug}/manage`, {
    waitUntil: "networkidle",
  });
  const setup = page.getByRole("region", {
    name: "Set up project vault",
    exact: true,
  });
  const recover = setup.getByRole("button", {
    name: "Recover existing vault",
    exact: true,
  });
  await setup.getByText("Recover an existing vault", { exact: true }).click();
  await recover.click();
  const hash = setup.getByLabel("Creation transaction hash");
  await expect(hash).toBeVisible();
  await expect(setup.getByText(OWNER, { exact: true })).toBeVisible();
  expect(posts).toEqual([
    {
      network,
      claimId: "claim-owner-wallet",
      automatic: true,
      payoutPolicy: "ordinary",
      expectedRevision: 4,
      step: "review",
    },
  ]);
  await expectAccessible(page);
  await page.screenshot({
    path: info.outputPath("existing-vault-review.png"),
    fullPage: true,
  });

  // Change review discards the reviewed request and returns to the options.
  await setup
    .getByRole("button", { name: "Change review", exact: true })
    .click();
  await expect(hash).toHaveCount(0);
  await expect(setup.getByText(OWNER, { exact: true })).toHaveCount(0);
  await expect(
    setup.getByRole("button", { name: "Review vault creation", exact: true }),
  ).toBeVisible();
  expect(posts).toHaveLength(1);

  // The options render afresh, so the recovery disclosure starts collapsed.
  await expect(recover).toBeHidden();

  // A failed creation keeps its saved request until the owner starts over.
  await setup.getByText("Recover an existing vault", { exact: true }).click();
  await recover.click();
  await hash.fill(HASH);
  await setup
    .getByRole("button", { name: "Check vault registration", exact: true })
    .click();
  await expect(setup.getByRole("alert")).toHaveText(
    "The creation transaction failed on chain.",
  );
  expect(diagnostics.count(failed)).toBe(1);
  expect(posts.at(-1)).toMatchObject({ step: "register", transactionId: HASH });
  const key = `slop:vault-setup:v1:${project.id}`;
  expect(
    await page.evaluate((name) => sessionStorage.getItem(name), key),
  ).toContain(HASH);
  await setup
    .getByRole("button", { name: "Review a new creation request", exact: true })
    .click();
  await expect(
    setup.getByRole("button", {
      name: "Review a new creation request",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(hash).toHaveCount(0);
  await expect(setup.getByRole("alert")).toHaveCount(0);
  expect(
    await page.evaluate((name) => sessionStorage.getItem(name), key),
  ).toBeNull();
  await expect(
    setup.getByRole("button", { name: "Review vault creation", exact: true }),
  ).toBeVisible();
  expect(posts.filter((body) => body.step === "register")).toHaveLength(1);
  await expectAccessible(page);
});
