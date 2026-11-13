/**
 * Owner vault setup review controls with a synthetic setup API. No wallet
 * signs or sends anything; the existing-vault recovery path needs none.
 */
import { buildCreateVaultCalldata } from "../../contracts/evm/adapter";
import { ESCROW_NETWORKS } from "../../src/lib/escrow-policy.mjs";
import { PROJECTS } from "../../src/lib/projects.mjs";
import { registryProjectDigest } from "../../src/lib/vault-setup";
import {
  expect,
  expectAccessible,
  expectAccessibleReflow,
  test,
} from "./fixtures";
import { serveProjectMaintainer } from "./project-maintainer-fixture";

const OWNER = "0x1111111111111111111111111111111111111111";
const FACTORY = "0x2222222222222222222222222222222222222222";
const VAULT = "0x3333333333333333333333333333333333333333";
const HASH = `0x${"4".repeat(64)}`;

for (const token of [false, true])
  test(
    token
      ? "an owner reviews project-token cap labels and starts over after a failed creation"
      : "an owner changes a vault review and starts over after a failed creation",
    async ({ page, diagnostics }, info) => {
      diagnostics.allowPreviewApiMisses();
      diagnostics.allowCanceledBackgroundReads();
      // An active project whose Base vault is configured but not yet created,
      // so its owner sees vault setup. Fixed Base stablecoin/token metadata
      // keeps both cases independent of the registered reward asset.
      const registered = PROJECTS.find((entry) => entry.id === "eliza");
      if (!registered) throw new Error("Missing fixture project");
      let project = {
        ...registered,
        ...(token
          ? {
              reward: {
                ...registered.reward,
                chain: "base",
                currency: "TEST",
                monthlyCapMinor: "1000000000",
                monthlyCapDisplay: "1,000 TEST",
              },
            }
          : {}),
        rewardAsset: token
          ? {
              network: "base",
              kind: "token",
              address: "0x5555555555555555555555555555555555555555",
              symbol: "TEST",
              decimals: 6,
              chainId: "8453",
              cluster: null,
              verifiedAt: "2026-10-22T00:00:00.000Z",
            }
          : undefined,
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
      const asset = project.rewardAsset?.address ?? policy.asset;
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
        (route) =>
          route.fulfill({ json: { revision: 4, networks: [network] } }),
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
      await setup
        .getByText("Recover an existing vault", { exact: true })
        .click();
      await recover.focus();
      await page.keyboard.press("Enter");
      const hash = setup.getByLabel("Creation transaction hash");
      await expect(hash).toBeVisible();
      await expect(setup.getByText(OWNER, { exact: true })).toBeVisible();
      if (token) {
        await expect(
          setup.getByText("1,000 $TEST", { exact: true }),
        ).toBeVisible();
        expect(project.reward.monthlyCapDisplay).toBe("1,000 TEST");
        expect(project.rewardAsset?.symbol).toBe("TEST");
        expect(
          await page.evaluate(
            () => matchMedia("(prefers-reduced-motion: reduce)").matches,
          ),
        ).toBe(true);
      }
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
      if (token)
        await expectAccessibleReflow(page, "project-token-vault-review");

      // Change review discards the reviewed request and returns to the options.
      await setup
        .getByRole("button", { name: "Change review", exact: true })
        .click();
      await expect(hash).toHaveCount(0);
      await expect(setup.getByText(OWNER, { exact: true })).toHaveCount(0);
      await expect(
        setup.getByRole("button", {
          name: "Review vault creation",
          exact: true,
        }),
      ).toBeVisible();
      expect(posts).toHaveLength(1);

      // The options render afresh, so the recovery disclosure starts collapsed.
      await expect(recover).toBeHidden();

      // A failed creation keeps its saved request until the owner starts over.
      await setup
        .getByText("Recover an existing vault", { exact: true })
        .click();
      await recover.click();
      await hash.fill(HASH);
      await setup
        .getByRole("button", { name: "Check vault registration", exact: true })
        .click();
      await expect(setup.getByRole("alert")).toHaveText(
        "The creation transaction failed on chain.",
      );
      expect(diagnostics.count(failed)).toBe(1);
      expect(posts.at(-1)).toMatchObject({
        step: "register",
        transactionId: HASH,
      });
      const key = `slop:vault-setup:v1:${project.id}`;
      expect(
        await page.evaluate((name) => sessionStorage.getItem(name), key),
      ).toContain(HASH);
      if (token) {
        const retained = await page.evaluate(
          (name) => sessionStorage.getItem(name),
          key,
        );
        // An immutable creation review can outlive a later project asset edit.
        // Its old cap's unit must survive reload, without using the new ticker.
        if (!project.rewardAsset) throw new Error("Missing token fixture");
        project = {
          ...project,
          rewardAsset: {
            ...project.rewardAsset,
            address: "0x6666666666666666666666666666666666666666",
            symbol: "OTHER",
          },
          reward: {
            ...project.reward,
            currency: "OTHER",
            monthlyCapMinor: "2000000000",
            monthlyCapDisplay: "2,000 OTHER",
          },
        };
        await page.reload({ waitUntil: "networkidle" });
        await expect(
          setup.getByText("1,000 $TEST", { exact: true }),
        ).toBeVisible();
        await expect(setup.getByText("1,000 $OTHER")).toHaveCount(0);
        expect(
          await page.evaluate((name) => sessionStorage.getItem(name), key),
        ).toBe(retained);
        await setup
          .getByRole("button", {
            name: "Check vault registration",
            exact: true,
          })
          .click();
        await expect(setup.getByRole("alert")).toHaveText(
          "The creation transaction failed on chain.",
        );
      }
      await setup
        .getByRole("button", {
          name: "Review a new creation request",
          exact: true,
        })
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
        setup.getByRole("button", {
          name: "Review vault creation",
          exact: true,
        }),
      ).toBeVisible();
      expect(posts.filter((body) => body.step === "register")).toHaveLength(
        token ? 2 : 1,
      );
      await expectAccessible(page);
    },
  );
