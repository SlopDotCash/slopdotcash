import { expect, type Page } from "@playwright/test";

/** Hold a complete, real review response before the application receives it. */
export async function holdVaultCreationReview(page: Page, url: string) {
  await page.evaluate((url) => {
    const original = window.fetch;
    const state = {
      captured: 0,
      waiting: false,
      released: false,
      status: 0,
      bodyBytes: 0,
      release: () => {},
      restore: () => {},
    };
    const release = new Promise<void>((resolve) => {
      state.release = resolve;
    });
    const heldFetch = async (...args: Parameters<typeof window.fetch>) => {
      const response = await original.apply(window, args);
      const init = args[1];
      if (
        response.url === url &&
        init?.method === "POST" &&
        typeof init.body === "string" &&
        JSON.parse(init.body).step === "review"
      ) {
        state.captured += 1;
        // Finish the transport first. An aborted browser response can emit
        // requestfailed after headers without resolving Response.finished().
        state.bodyBytes = (await response.clone().arrayBuffer()).byteLength;
        state.status = response.status;
        state.waiting = true;
        await release;
        state.released = true;
      }
      return response;
    };
    window.fetch = Object.assign(heldFetch, original);
    state.restore = () => {
      window.fetch = original;
      state.release();
    };
    Object.assign(window, { heldVaultCreationReview: state });
  }, url);
}

export async function waitForVaultCreationReview(page: Page) {
  await page.waitForFunction(
    () =>
      (
        window as typeof window & {
          heldVaultCreationReview: { waiting: boolean };
        }
      ).heldVaultCreationReview.waiting,
  );
  return page.evaluate(() => {
    const { captured, status, bodyBytes } = (
      window as typeof window & {
        heldVaultCreationReview: {
          captured: number;
          status: number;
          bodyBytes: number;
        };
      }
    ).heldVaultCreationReview;
    return { captured, status, bodyBytes };
  });
}

export async function releaseVaultCreationReview(page: Page) {
  if (page.isClosed()) return;
  await page.evaluate(() => {
    (
      window as typeof window & {
        heldVaultCreationReview?: { restore(): void };
      }
    ).heldVaultCreationReview?.restore();
  });
}

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
