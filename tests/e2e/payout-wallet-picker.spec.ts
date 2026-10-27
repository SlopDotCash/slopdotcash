/** Provider/API fixtures exercise the real page; they never register a real wallet. */
import type { Page } from "@playwright/test";
import { expect, expectAccessible, test } from "./fixtures";

test.beforeEach(({ diagnostics }) => diagnostics.allowPreviewApiMisses());

const evmAddress = "0x1111111111111111111111111111111111111111";
const solanaAddress = "11111111111111111111111111111111";

type SavedWallet = {
  chain: "base" | "solana" | "robinhood" | "ethereum";
  claimId: string;
  address: string;
  authorized: boolean;
};

async function payments(page: Page, wallets: SavedWallet[] = []) {
  const writes: { path: string; body: Record<string, string> }[] = [];
  let claim = { chain: "base", address: evmAddress };
  await page.route("**/api/v1/payments/**", async (route) => {
    const path = new URL(route.request().url()).pathname.split("/payments/")[1];
    if (path === "me") {
      await route.fulfill({
        json: {
          githubUserId: "123",
          wallets,
          payments: [],
          monthlyAwards: [],
          balances: [],
          directTransfers: [],
          walletObservations: [],
        },
      });
      return;
    }
    const body = route.request().postDataJSON();
    writes.push({ path, body });
    if (path === "wallets/register") claim = body;
    await route.fulfill({
      json:
        path === "wallets/register"
          ? { claimId: "fixture" }
          : path === "wallets/challenge"
            ? {
                ...claim,
                challengeId: "fixture-challenge",
                message: "Fixture payout routing confirmation",
              }
            : {},
    });
  });
  return writes;
}

/**
 * `connected` is the account a wallet returns before its account picker runs;
 * `permissions` models wallet_requestPermissions: the picker selects
 * evmAddress, the wallet lacks the method, or the user rejects it.
 */
async function providers(
  page: Page,
  reject = false,
  {
    connected = evmAddress,
    permissions = "picker",
    rejectSignature = 0,
  }: {
    connected?: string;
    permissions?: "picker" | "unsupported" | "rejected";
    rejectSignature?: number;
  } = {},
) {
  await page.addInitScript(
    ({
      reject,
      evmAddress,
      solanaAddress,
      connected,
      permissions,
      rejectSignature,
    }) => {
      const calls: string[] = [];
      const evm = (name: string) => {
        let account = connected;
        let signatures = 0;
        return {
          request: async ({ method }: { method: string }) => {
            calls.push(`${name}:${method}`);
            if (reject) throw new Error("Wallet request rejected by user.");
            if (method === "personal_sign" && ++signatures === rejectSignature)
              throw new Error("Wallet signature rejected by user.");
            if (method === "wallet_requestPermissions") {
              if (permissions === "unsupported")
                throw Object.assign(new Error("Method not supported."), {
                  code: -32601,
                });
              if (permissions === "rejected")
                throw Object.assign(new Error("User rejected the request."), {
                  code: 4001,
                });
              account = evmAddress;
              return [{ parentCapability: "eth_accounts" }];
            }
            return method === "eth_requestAccounts"
              ? [account]
              : "0xfixture-signature";
          },
        };
      };
      const metamask = evm("MetaMask");
      const phantom = evm("Phantom");
      const announce = () => {
        for (const [provider, name, uuid] of [
          [phantom, "Phantom", "0b7c3a8e-5f1d-4c2a-9e6b-3d4f5a6b7c80"],
          [metamask, "MetaMask", "6f9e2d1c-8b7a-4e3d-a2c1-0f9e8d7c6b5a"],
        ] as const)
          window.dispatchEvent(
            new CustomEvent("eip6963:announceProvider", {
              detail: {
                provider,
                info: {
                  uuid,
                  name,
                  rdns: `${name}.app`,
                  icon: "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2224%22 height=%2224%22/%3E",
                },
              },
            }),
          );
      };
      Object.assign(window, { ethereum: phantom, walletCalls: calls });
      window.addEventListener("eip6963:requestProvider", announce);
      const account = {
        address: solanaAddress,
        publicKey: new Uint8Array(32),
        chains: ["solana:mainnet"],
        features: ["solana:signMessage"],
      };
      const solana = (name: string) => ({
        name,
        version: "1.0.0",
        icon: "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2224%22 height=%2224%22/%3E",
        chains: ["solana:mainnet"],
        accounts: [],
        features: {
          "standard:connect": {
            version: "1.0.0",
            connect: async () => {
              calls.push(`${name}:connect`);
              return { accounts: [account] };
            },
          },
          "solana:signMessage": {
            version: "1.0.0",
            signMessage: async ({ message }: { message: Uint8Array }) => {
              calls.push(`${name}:signMessage`);
              return [
                { signedMessage: message, signature: new Uint8Array(64) },
              ];
            },
          },
        },
      });
      window.addEventListener("wallet-standard:app-ready", (event) => {
        const api = (event as CustomEvent).detail;
        api.register(solana("Phantom"));
        const remove = api.register(solana("Backpack"));
        Object.assign(window, { removeBackpack: remove });
      });
      Object.assign(window, {
        announceWallets: announce,
        // Reuses MetaMask's UUID for a different provider object.
        announceImpostor: () =>
          window.dispatchEvent(
            new CustomEvent("eip6963:announceProvider", {
              detail: {
                provider: evm("Impostor"),
                info: {
                  uuid: "6f9e2d1c-8b7a-4e3d-a2c1-0f9e8d7c6b5a",
                  name: "MetaMask",
                  rdns: "MetaMask.app",
                  icon: "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2224%22 height=%2224%22/%3E",
                },
              },
            }),
          ),
      });
    },
    {
      reject,
      evmAddress,
      solanaAddress,
      connected,
      permissions,
      rejectSignature,
    },
  );
}

async function openPicker(page: Page, family: "EVM" | "Solana") {
  await page
    .getByRole("button", { name: `Connect ${family} wallet`, exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: `Connect ${family === "EVM" ? "an" : "a"} ${family} wallet`,
  });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("modal routes EVM to MetaMask and Solana to Backpack despite Phantom globals", async ({
  page,
}, info) => {
  const writes = await payments(page);
  await providers(page);
  await page.goto("/account#wallets");
  expect(
    await page.evaluate(
      () => (window as unknown as { walletCalls: string[] }).walletCalls,
    ),
  ).toEqual([]);
  const evm = await openPicker(page, "EVM");
  await expect(evm.getByRole("button", { name: "Backpack" })).toHaveCount(0);
  await expectAccessible(page);
  await page.screenshot({
    path: info.outputPath("wallet-modal.png"),
    fullPage: true,
  });
  await evm.getByRole("button", { name: "MetaMask", exact: true }).click();
  await expect(evm).not.toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "EVM wallet confirmed" }),
  ).toBeVisible();
  const solana = await openPicker(page, "Solana");
  await solana.getByRole("button", { name: "Backpack", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Solana wallet confirmed" }),
  ).toBeVisible();
  // One EVM connection confirms Base, Robinhood Chain and Ethereum. Each
  // chain keeps its own claim and signature.
  expect(
    await page.evaluate(
      () => (window as unknown as { walletCalls: string[] }).walletCalls,
    ),
  ).toEqual([
    "MetaMask:eth_requestAccounts",
    "MetaMask:personal_sign",
    "MetaMask:personal_sign",
    "MetaMask:personal_sign",
    "Backpack:connect",
    "Backpack:signMessage",
  ]);
  expect(
    writes.filter((w) => w.path === "wallets/register").map((w) => w.body),
  ).toEqual([
    { chain: "base", address: evmAddress },
    { chain: "robinhood", address: evmAddress },
    { chain: "ethereum", address: evmAddress },
    { chain: "solana", address: solanaAddress },
  ]);
  expect(writes.filter((w) => w.path === "wallets/authorize")).toHaveLength(4);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(1);
});

test("Escape and close cancel without wallet requests and return focus", async ({
  page,
}) => {
  const writes = await payments(page);
  await providers(page);
  await page.goto("/account#wallets");
  await openPicker(page, "EVM");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect EVM wallet", exact: true }),
  ).toBeFocused();
  const solana = await openPicker(page, "Solana");
  await solana.getByRole("button", { name: "Close wallet picker" }).click();
  await expect(solana).not.toBeVisible();
  expect(writes).toEqual([]);
  expect(
    await page.evaluate(
      () => (window as unknown as { walletCalls: string[] }).walletCalls,
    ),
  ).toEqual([]);
});

test("wallet rejection stops registration and permits reopening the modal", async ({
  page,
}) => {
  const writes = await payments(page);
  await providers(page, true);
  await page.goto("/account#wallets");
  const dialog = await openPicker(page, "EVM");
  await dialog.getByRole("button", { name: "MetaMask", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect(writes).toEqual([]);
  await openPicker(page, "EVM");
});

test("repeated announcements do not duplicate options and removed Solana wallet disappears", async ({
  page,
}) => {
  await payments(page);
  await providers(page);
  await page.goto("/account#wallets");
  const dialog = await openPicker(page, "Solana");
  await expect(
    dialog.getByRole("button", { name: "Backpack", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    const testWindow = window as unknown as {
      announceWallets(): void;
      removeBackpack(): void;
    };
    testWindow.announceWallets();
    testWindow.removeBackpack();
  });
  await expect(
    dialog.getByRole("button", { name: "Backpack", exact: true }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close wallet picker" }).click();
  const base = await openPicker(page, "EVM");
  await expect(
    base.getByRole("button", { name: "MetaMask", exact: true }),
  ).toHaveCount(1);
  await expect(
    base.getByRole("button", { name: "Phantom", exact: true }),
  ).toHaveCount(1);
});

test("no wallets offers official install links in either network modal", async ({
  page,
}) => {
  const writes = await payments(page);
  await page.goto("/account#wallets");
  await expect(page.getByRole("article", { name: "EVM wallet" })).toBeVisible();
  await expect(
    page.getByRole("article", { name: "Solana wallet" }),
  ).toBeVisible();
  await expect(page.getByText("No unpaid awards", { exact: true })).toHaveCount(
    0,
  );
  for (const chain of ["EVM", "Solana"] as const) {
    const dialog = await openPicker(page, chain);
    await expect(
      dialog.getByRole("link", { name: "MetaMask Install", exact: false }),
    ).toHaveAttribute("href", "https://metamask.io/download");
    await expect(
      dialog.getByRole("link", { name: "Phantom Install", exact: false }),
    ).toHaveAttribute("href", "https://phantom.com/download");
    await expect(
      dialog.locator(".wallet-picker-list").getByRole("button"),
    ).toHaveCount(0);
    await dialog.getByRole("button", { name: "Close wallet picker" }).click();
  }
  expect(writes).toEqual([]);
});

test("legacy wallet browser remains connectable through the modal", async ({
  page,
}) => {
  await payments(page);
  await page.addInitScript(
    ({ evmAddress }) => {
      Object.assign(window, {
        ethereum: {
          isMetaMask: true,
          request: async ({ method }: { method: string }) =>
            method === "eth_requestAccounts" ? [evmAddress] : "0xfixture",
        },
      });
    },
    { evmAddress },
  );
  await page.goto("/account#wallets");
  const dialog = await openPicker(page, "EVM");
  await dialog.getByRole("button", { name: "MetaMask", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "EVM wallet confirmed" }),
  ).toBeVisible();
});

test("conflicting EIP-6963 UUID removes both providers without wallet requests", async ({
  page,
}) => {
  const writes = await payments(page);
  await providers(page);
  await page.goto("/account#wallets");
  const dialog = await openPicker(page, "EVM");
  await expect(
    dialog.getByRole("button", { name: "MetaMask", exact: true }),
  ).toHaveCount(1);
  await page.evaluate(() =>
    (window as unknown as { announceImpostor(): void }).announceImpostor(),
  );
  await expect(
    dialog.getByRole("button", { name: "MetaMask", exact: true }),
  ).toHaveCount(0);
  // Phantom keeps its own valid UUID and stays available.
  await expect(
    dialog.getByRole("button", { name: "Phantom", exact: true }),
  ).toHaveCount(1);
  // A later genuine reannouncement cannot restore the blocked UUID.
  await page.evaluate(() =>
    (window as unknown as { announceWallets(): void }).announceWallets(),
  );
  await expect(
    dialog.getByRole("button", { name: "MetaMask", exact: true }),
  ).toHaveCount(0);
  expect(writes).toEqual([]);
  expect(
    await page.evaluate(
      () => (window as unknown as { walletCalls: string[] }).walletCalls,
    ),
  ).toEqual([]);
});

test("mixed standard and legacy discovery keeps every distinct wallet", async ({
  page,
}) => {
  const writes = await payments(page);
  await page.addInitScript(
    ({ evmAddress, solanaAddress }) => {
      const calls: string[] = [];
      const evm = (name: string, flags: Record<string, boolean>) => ({
        ...flags,
        request: async ({ method }: { method: string }) => {
          calls.push(`${name}:${method}`);
          return method === "eth_requestAccounts"
            ? [evmAddress]
            : "0xfixture-signature";
        },
      });
      const metamask = evm("MetaMask", { isMetaMask: true });
      const coinbase = evm("Coinbase", { isCoinbaseWallet: true });
      // MetaMask is in both EIP-6963 and the legacy list; Coinbase is legacy only.
      Object.assign(window, {
        ethereum: { ...metamask, providers: [metamask, coinbase] },
        walletCalls: calls,
      });
      window.addEventListener("eip6963:requestProvider", () =>
        window.dispatchEvent(
          new CustomEvent("eip6963:announceProvider", {
            detail: {
              provider: metamask,
              info: {
                uuid: "6f9e2d1c-8b7a-4e3d-a2c1-0f9e8d7c6b5a",
                name: "MetaMask",
                rdns: "io.metamask",
                icon: "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2224%22 height=%2224%22/%3E",
              },
            },
          }),
        ),
      );
      const legacySolana = (name: string, flags: Record<string, boolean>) => ({
        ...flags,
        connect: async () => {
          calls.push(`${name}:connect`);
          return { publicKey: { toString: () => solanaAddress } };
        },
        signMessage: async () => {
          calls.push(`${name}:signMessage`);
          return { signature: new Uint8Array(64) };
        },
      });
      // Phantom is in both Wallet Standard and the legacy globals; Solflare is legacy only.
      Object.assign(window, {
        phantom: { solana: legacySolana("LegacyPhantom", { isPhantom: true }) },
        solana: legacySolana("Solflare", { isSolflare: true }),
      });
      window.addEventListener("wallet-standard:app-ready", (event) => {
        const account = {
          address: solanaAddress,
          publicKey: new Uint8Array(32),
          chains: ["solana:mainnet"],
          features: ["solana:signMessage"],
        };
        (event as CustomEvent).detail.register({
          name: "Phantom",
          version: "1.0.0",
          icon: "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2224%22 height=%2224%22/%3E",
          chains: ["solana:mainnet"],
          accounts: [],
          features: {
            "standard:connect": {
              version: "1.0.0",
              connect: async () => {
                calls.push("Phantom:connect");
                return { accounts: [account] };
              },
            },
            "solana:signMessage": {
              version: "1.0.0",
              signMessage: async ({ message }: { message: Uint8Array }) => {
                calls.push("Phantom:signMessage");
                return [
                  { signedMessage: message, signature: new Uint8Array(64) },
                ];
              },
            },
          },
        });
      });
    },
    { evmAddress, solanaAddress },
  );
  await page.goto("/account#wallets");
  const base = await openPicker(page, "EVM");
  await expect(
    base.locator(".wallet-picker-list").getByRole("button"),
  ).toHaveText(["MetaMask", "Coinbase Wallet"]);
  await base
    .getByRole("button", { name: "Coinbase Wallet", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "EVM wallet confirmed" }),
  ).toBeVisible();
  const solana = await openPicker(page, "Solana");
  await expect(
    solana.locator(".wallet-picker-list").getByRole("button"),
  ).toHaveText(["Phantom", "Solflare"]);
  await solana.getByRole("button", { name: "Solflare", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Solana wallet confirmed" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { walletCalls: string[] }).walletCalls,
    ),
  ).toEqual([
    "Coinbase:eth_requestAccounts",
    "Coinbase:personal_sign",
    "Coinbase:personal_sign",
    "Coinbase:personal_sign",
    "Solflare:connect",
    "Solflare:signMessage",
  ]);
  expect(
    writes.filter((w) => w.path === "wallets/register").map((w) => w.body),
  ).toEqual([
    { chain: "base", address: evmAddress },
    { chain: "robinhood", address: evmAddress },
    { chain: "ethereum", address: evmAddress },
    { chain: "solana", address: solanaAddress },
  ]);
});

// The repository's 200% text-enlargement fixture at the 320px reflow width,
// plus a 160 CSS px layout, which is what native 200% browser zoom gives a
// 320px screen.
for (const scenario of [
  { name: "320px with 200% text", width: 320, textScale: 2 },
  { name: "320px at 200% browser zoom", width: 160, textScale: 1 },
]) {
  test(`open modal reflows at ${scenario.name}`, async ({ page }, info) => {
    test.skip(
      info.project.name !== "chromium-mobile",
      "Sets its own viewport; runs once",
    );
    await payments(page);
    await providers(page);
    await page.setViewportSize({ width: scenario.width, height: 800 });
    for (const chain of ["EVM", "Solana"] as const) {
      await page.goto("/account#wallets");
      const dialog = await openPicker(page, chain);
      await expect(
        dialog.locator(".wallet-picker-list").getByRole("button"),
      ).toHaveCount(2);
      if (scenario.textScale === 2)
        await page.evaluate(() => {
          // Read every size first so nested text is enlarged exactly once.
          const typography = [
            ...document.querySelectorAll<HTMLElement>("body *"),
          ].map((element) => ({
            element,
            font: getComputedStyle(element).fontSize,
            line: getComputedStyle(element).lineHeight,
          }));
          for (const { element, font, line } of typography) {
            element.style.fontSize = `${Number.parseFloat(font) * 2}px`;
            if (line !== "normal")
              element.style.lineHeight = `${Number.parseFloat(line) * 2}px`;
          }
        });
      await expect(
        dialog.getByRole("button", { name: "Close wallet picker" }),
      ).toBeInViewport();
      expect(
        await dialog.evaluate((element) => {
          const box = element.getBoundingClientRect();
          return {
            dialogScroll: element.scrollWidth - element.clientWidth,
            insideViewport: box.left >= 0 && box.right <= window.innerWidth,
            escaping: [...element.querySelectorAll("*")]
              .filter((child) => {
                const rect = child.getBoundingClientRect();
                return rect.left < box.left - 1 || rect.right > box.right + 1;
              })
              .map((child) => child.textContent?.slice(0, 40)),
          };
        }),
      ).toEqual({ dialogScroll: 0, insideViewport: true, escaping: [] });
      await expectAccessible(page);
      await page.screenshot({
        path: info.outputPath(
          `wallet-modal-${chain.toLowerCase()}-${scenario.width}.png`,
        ),
      });
      await dialog.getByRole("button", { name: "Close wallet picker" }).click();
      await expect(dialog).not.toBeVisible();
    }
  });
}

const savedAddress = "0x2222222222222222222222222222222222222222";
const savedEvmWallet = (
  chain: "base" | "robinhood" | "ethereum",
  authorized: boolean,
): SavedWallet => ({
  chain,
  claimId: `saved-claim-${chain}`,
  address: savedAddress,
  authorized,
});
const savedEvm = (authorized: boolean): SavedWallet[] =>
  (["base", "robinhood", "ethereum"] as const).map((chain) =>
    savedEvmWallet(chain, authorized),
  );
const walletCalls = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { walletCalls: string[] }).walletCalls,
  );

async function chooseMetaMask(page: Page, action: "Change" | "Connect") {
  await page
    .getByRole("button", { name: `${action} EVM wallet`, exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Connect an EVM wallet" });
  await dialog.getByRole("button", { name: "MetaMask", exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

test("changing a confirmed EVM wallet opens the account picker and asks before registering the new account", async ({
  page,
}, info) => {
  const writes = await payments(page, savedEvm(true));
  await providers(page, false, { connected: savedAddress });
  await page.goto("/account#wallets");
  await chooseMetaMask(page, "Change");
  const confirmation = page.getByRole("region", {
    name: "Register a different EVM address?",
  });
  await expect(confirmation).toBeVisible();
  await expect(
    confirmation.getByRole("heading", {
      name: "Register a different EVM address?",
    }),
  ).toBeFocused();
  await expect(confirmation).toContainText(`Saved address${savedAddress}`);
  await expect(confirmation).toContainText(`Wallet account${evmAddress}`);
  // The picker ran before the account read, and nothing is registered yet.
  expect(await walletCalls(page)).toEqual([
    "MetaMask:wallet_requestPermissions",
    "MetaMask:eth_requestAccounts",
  ]);
  expect(writes).toEqual([]);
  await expect(
    page.getByRole("button", { name: "Change EVM wallet", exact: true }),
  ).toBeDisabled();
  await expectAccessible(page);
  await page.screenshot({
    path: info.outputPath("wallet-change-confirmation.png"),
    fullPage: true,
  });
  await confirmation
    .getByRole("button", { name: "Register wallet account", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "EVM wallet confirmed" }),
  ).toBeVisible();
  await expect(confirmation).toHaveCount(0);
  expect(writes.map((w) => w.path)).toEqual(
    Array.from({ length: 3 }, () => [
      "wallets/register",
      "wallets/challenge",
      "wallets/authorize",
    ]).flat(),
  );
  expect(
    writes.filter((w) => w.path === "wallets/register").map((w) => w.body),
  ).toEqual([
    { chain: "base", address: evmAddress },
    { chain: "robinhood", address: evmAddress },
    { chain: "ethereum", address: evmAddress },
  ]);
  expect((await walletCalls(page)).at(-1)).toBe("MetaMask:personal_sign");
});

test("keeping the saved address registers nothing and returns focus to the wallet button", async ({
  page,
}) => {
  const writes = await payments(page, savedEvm(true));
  await providers(page, false, { connected: savedAddress });
  await page.goto("/account#wallets");
  await chooseMetaMask(page, "Change");
  await page
    .getByRole("button", { name: "Keep saved address", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Register a different EVM address?" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({
      hasText: "Kept your saved EVM address. Nothing was registered.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Change EVM wallet", exact: true }),
  ).toBeFocused();
  expect(writes).toEqual([]);
  expect(await walletCalls(page)).not.toContain("MetaMask:personal_sign");
});

test("connecting with an unconfirmed saved address asks before registering a different active account", async ({
  page,
}) => {
  const writes = await payments(page, savedEvm(false));
  await providers(page);
  await page.goto("/account#wallets");
  await chooseMetaMask(page, "Connect");
  await expect(
    page.getByRole("region", { name: "Register a different EVM address?" }),
  ).toBeVisible();
  // Not a change of a confirmed wallet, so no account picker is forced.
  expect(await walletCalls(page)).toEqual(["MetaMask:eth_requestAccounts"]);
  expect(writes).toEqual([]);
});

test("connecting the saved address confirms it without an extra step", async ({
  page,
}) => {
  const writes = await payments(page, savedEvm(false));
  await providers(page, false, { connected: savedAddress });
  await page.goto("/account#wallets");
  await chooseMetaMask(page, "Connect");
  await expect(
    page.getByRole("status").filter({ hasText: "EVM wallet confirmed" }),
  ).toBeVisible();
  expect(writes[0]).toEqual({
    path: "wallets/register",
    body: { chain: "base", address: savedAddress },
  });
});

for (const rejectedSignature of [2, 3]) {
  test(`a rejected EVM signature ${rejectedSignature} stays visible after partial confirmation and can resume`, async ({
    page,
  }) => {
    const saved: SavedWallet[] = [];
    const writes = await payments(page, saved);
    await page.route("**/api/v1/payments/wallets/authorize", async (route) => {
      const registration = writes
        .filter((write) => write.path === "wallets/register")
        .at(-1)?.body;
      if (!registration) throw new Error("Missing wallet registration");
      saved.push({
        chain: registration.chain as SavedWallet["chain"],
        claimId: "fixture",
        address: registration.address,
        authorized: true,
      });
      await route.fallback();
    });
    await providers(page, false, { rejectSignature: rejectedSignature });
    await page.goto("/account#wallets");
    await chooseMetaMask(page, "Connect");

    const card = page.getByRole("article", { name: "EVM wallet" });
    // The confirmed Base state comes from the reconciliation GET, not the
    // action's stale account. Its arrival must not erase the signature error.
    await expect(
      card.getByRole("img", { name: "Base, confirmed", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toContainText(
      "Wallet signature rejected by user.",
    );
    expect(saved.map((wallet) => wallet.chain)).toEqual(
      ["base", "robinhood", "ethereum"].slice(0, rejectedSignature - 1),
    );
    expect(
      writes.filter((write) => write.path === "wallets/authorize"),
    ).toHaveLength(rejectedSignature - 1);

    await chooseMetaMask(page, "Change");
    await expect(
      page.getByRole("status").filter({ hasText: "EVM wallet confirmed" }),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(saved.map((wallet) => wallet.chain)).toEqual([
      "base",
      "robinhood",
      "ethereum",
    ]);
    expect(
      writes.filter((write) => write.path === "wallets/authorize"),
    ).toHaveLength(3);
    expect(
      writes.filter(
        (write) =>
          write.path === "wallets/register" && write.body.chain === "base",
      ),
    ).toHaveLength(1);
  });
}

test("a wallet without an account picker falls back to its connected account", async ({
  page,
}) => {
  // Base and Ethereum are already confirmed at this address; only Robinhood
  // Chain needs a signature.
  const writes = await payments(page, [
    savedEvmWallet("base", true),
    savedEvmWallet("robinhood", false),
    savedEvmWallet("ethereum", true),
  ]);
  await providers(page, false, {
    connected: savedAddress,
    permissions: "unsupported",
  });
  await page.goto("/account#wallets");
  await chooseMetaMask(page, "Change");
  await expect(
    page.getByRole("status").filter({ hasText: "EVM wallet confirmed" }),
  ).toBeVisible();
  expect(await walletCalls(page)).toEqual([
    "MetaMask:wallet_requestPermissions",
    "MetaMask:eth_requestAccounts",
    "MetaMask:personal_sign",
  ]);
  expect(writes.filter((w) => w.path === "wallets/register")).toEqual([
    {
      path: "wallets/register",
      body: { chain: "robinhood", address: savedAddress },
    },
  ]);
});

test("rejecting the account picker stops the change", async ({ page }) => {
  const writes = await payments(page, savedEvm(true));
  await providers(page, false, {
    connected: savedAddress,
    permissions: "rejected",
  });
  await page.goto("/account#wallets");
  await chooseMetaMask(page, "Change");
  await expect(page.getByRole("alert")).toBeVisible();
  expect(await walletCalls(page)).toEqual([
    "MetaMask:wallet_requestPermissions",
  ]);
  expect(writes).toEqual([]);
});

for (const scenario of [
  { name: "320px with 200% text", width: 320, textScale: 2 },
  { name: "320px at 200% browser zoom", width: 160, textScale: 1 },
]) {
  test(`wallet change confirmation reflows at ${scenario.name}`, async ({
    page,
  }, info) => {
    test.skip(
      info.project.name !== "chromium-mobile",
      "Sets its own viewport; runs once",
    );
    await payments(page, savedEvm(true));
    await providers(page, false, { connected: savedAddress });
    await page.setViewportSize({ width: scenario.width, height: 800 });
    await page.goto("/account#wallets");
    await chooseMetaMask(page, "Change");
    const confirmation = page.getByRole("region", {
      name: "Register a different EVM address?",
    });
    await expect(confirmation).toBeVisible();
    if (scenario.textScale === 2)
      await page.evaluate(() => {
        const typography = [
          ...document.querySelectorAll<HTMLElement>("body *"),
        ].map((element) => ({
          element,
          font: getComputedStyle(element).fontSize,
          line: getComputedStyle(element).lineHeight,
        }));
        for (const { element, font, line } of typography) {
          element.style.fontSize = `${Number.parseFloat(font) * 2}px`;
          if (line !== "normal")
            element.style.lineHeight = `${Number.parseFloat(line) * 2}px`;
        }
      });
    // The site lays out at a 320px minimum, so the 160px case checks only
    // that nothing escapes the confirmation itself.
    if (scenario.width === 320)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        ),
      ).toBeLessThanOrEqual(1);
    expect(
      await confirmation.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return [...element.querySelectorAll("*")]
          .filter((child) => {
            const rect = child.getBoundingClientRect();
            return rect.left < box.left - 1 || rect.right > box.right + 1;
          })
          .map((child) => child.textContent?.slice(0, 40));
      }),
    ).toEqual([]);
    await expectAccessible(page);
    await page.screenshot({
      path: info.outputPath(`wallet-change-${scenario.width}.png`),
      fullPage: true,
    });
  });
}

// Pending registration leaves the verified wallet active until authorization.
test("a rejected signature after a wallet change keeps the verified wallet active", async ({
  page,
  diagnostics,
}, info) => {
  diagnostics.allowCanceledBackgroundReads();
  const wallets = savedEvm(true);
  // Keep the merged layout regression meaningful: a distinct, already verified
  // Ethereum wallet leaves three chain rows even when the Base change is rejected.
  wallets[2] = {
    ...wallets[2],
    address: "0x3333333333333333333333333333333333333333",
  };
  const writes = await payments(page, wallets);
  await providers(page, false, {
    connected: savedAddress,
    rejectSignature: 1,
  });
  await page.goto("/account#wallets");
  await chooseMetaMask(page, "Change");
  await page
    .getByRole("button", { name: "Register wallet account", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    `Wallet signature rejected by user. Your new Base address ${evmAddress} is saved but not confirmed. Your verified address ${savedAddress} remains active for payouts. Connect your new wallet again to confirm the replacement.`,
  );
  const saved = page.getByRole("region", { name: "Payout wallets" });
  await expect(saved).toContainText(savedAddress);
  await expect(saved).not.toContainText(evmAddress);
  await expect(
    saved.getByRole("img", { name: "Base, confirmed", exact: true }),
  ).toBeVisible();
  await expect(
    saved.getByRole("img", { name: "Robinhood Chain, confirmed", exact: true }),
  ).toBeVisible();
  await expect(
    saved.getByRole("img", { name: "Ethereum, confirmed", exact: true }),
  ).toBeVisible();
  async function expectReadableAddresses(label: string) {
    await saved.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath(`wallet-address-layout-${label}.png`),
      fullPage: true,
    });
    const addressLines = await saved
      .locator(".wallet-card-rows span[title]")
      .evaluateAll((addresses) =>
        addresses.map((address) => {
          const range = document.createRange();
          range.selectNodeContents(address);
          return new Set(
            Array.from(range.getClientRects(), (rect) => Math.round(rect.top)),
          ).size;
        }),
      );
    expect(addressLines.length).toBe(3);
    expect(
      addressLines,
      "short wallet addresses remain readable on one line",
    ).toEqual([1, 1, 1]);
    await expectAccessible(page);
  }
  await expectReadableAddresses("viewport");
  if (info.project.name === "chromium-mobile") {
    // The grid must not squeeze the addresses into narrow tablet columns.
    await page.setViewportSize({ width: 768, height: 1000 });
    await expectReadableAddresses("tablet");
  }
  expect(writes.map((w) => w.path)).toEqual([
    "wallets/register",
    "wallets/challenge",
  ]);
});
