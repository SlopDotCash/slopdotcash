import { expect, type Page } from "@playwright/test";

/** Hold the final wallet identity reply after gas estimation, before sending. */
export async function holdVaultWalletPreflight(
  page: Page,
  removedSelector?: string,
) {
  await page.evaluate((selector) => {
    type Provider = {
      request(input: { method: string; params?: unknown[] }): Promise<unknown>;
    };
    const provider = (window as unknown as { ethereum: Provider }).ethereum;
    const original = provider.request;
    const state = {
      estimated: false,
      waiting: false,
      removed: false,
      released: false,
      release: () => {},
      restore: () => {},
    };
    const observer = new MutationObserver(() => {
      if (selector && state.waiting && !document.querySelector(selector)) {
        state.removed = true;
        state.release();
      }
    });
    if (selector)
      observer.observe(document.body, { childList: true, subtree: true });
    provider.request = async (input) => {
      const value = await original.call(provider, input);
      if (input.method === "eth_estimateGas") state.estimated = true;
      if (input.method === "eth_chainId" && state.estimated && !state.waiting) {
        state.waiting = true;
        await new Promise<void>((resolve) => {
          state.release = () => {
            state.released = true;
            observer.disconnect();
            resolve();
          };
        });
      }
      return value;
    };
    state.restore = () => {
      state.release();
      provider.request = original;
      observer.disconnect();
    };
    Object.assign(window, { heldVaultPreflight: state });
  }, removedSelector);
}

export async function waitForVaultPreflight(page: Page) {
  await page.waitForFunction(
    () =>
      (window as typeof window & { heldVaultPreflight: { waiting: boolean } })
        .heldVaultPreflight.waiting,
  );
}

export async function releaseVaultPreflight(page: Page) {
  await page.evaluate(() => {
    (
      window as typeof window & { heldVaultPreflight?: { restore(): void } }
    ).heldVaultPreflight?.restore();
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

export async function leaveWithVaultPreflight(page: Page) {
  await waitForVaultPreflight(page);
  await page.goBack();
  await page.waitForFunction(() => {
    const state = (
      window as typeof window & {
        heldVaultPreflight: { removed: boolean; released: boolean };
      }
    ).heldVaultPreflight;
    return state.removed && state.released;
  });
  await releaseVaultPreflight(page);
  await expect(page).toHaveURL(/\/how-it-works$/u);
}
