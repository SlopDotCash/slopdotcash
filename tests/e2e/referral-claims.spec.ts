/** Real page/wallet interaction; backend SQLite and local-chain proof live in the referral suites. */
import type { Page } from "@playwright/test";
import {
  decodeFunctionData,
  encodeFunctionResult,
  type Hex,
  keccak256,
} from "viem";
import {
  REFERRAL_ABI,
  type ReferralAccount,
} from "../../src/lib/referral-claims";
import { buildTree } from "../../workers/referral-accrual/merkle";
import { expect, expectAccessible, test } from "./fixtures";
import {
  holdVaultWalletPreflight,
  leaveWithVaultPreflight,
  releaseVaultPreflight,
} from "./vault-request-fixture";

const unit = 10n ** 18n;
const wallet = "0x1111111111111111111111111111111111111111";
const distributor = "0x3333333333333333333333333333333333333333";
const token = "0x2222222222222222222222222222222222222222";
const code: Hex = "0x60006000";
function record(): ReferralAccount {
  const tree = buildTree([{ address: wallet, cumulativeBase: 100n * unit }]);
  if (!tree) throw new Error("Missing fixture tree");
  const now = new Date().toISOString();
  return {
    enabled: true,
    status: "ready",
    program: {
      network: "robinhood-testnet",
      chainId: 46630,
      token,
      distributor,
      codeHash: keccak256(code),
      decimals: 18,
    },
    observedAt: now,
    finalizedAt: now,
    wallet,
    accruedBase: (150n * unit).toString(),
    claimedBase: (20n * unit).toString(),
    claimableBase: (80n * unit).toString(),
    pendingBase: (50n * unit).toString(),
    paused: false,
    ended: false,
    latestVoided: false,
    pendingUntil: null,
    claim: {
      period: "2026-11",
      epoch: 0,
      root: tree.root,
      cumulativeBase: (100n * unit).toString(),
      proof: tree.leaves[0].proof,
    },
  };
}
async function setup(page: Page) {
  let current: ReferralAccount | { enabled: false } = record();
  let estimate: (() => Promise<void>) | null = null;
  let send: (() => Promise<string>) | null = null;
  const calls: string[] = [];
  const request = async ({
    method,
    params = [],
  }: {
    method: string;
    params?: unknown[];
  }) => {
    calls.push(method);
    if (method === "eth_requestAccounts" || method === "eth_accounts")
      return [wallet];
    if (method === "eth_chainId") return "0xb626";
    if (method === "eth_getCode") return code;
    if (method === "eth_estimateGas") {
      const wait = estimate;
      estimate = null;
      await wait?.();
      return "0x186a0";
    }
    if (method === "eth_sendTransaction") {
      const tx = params[0] as {
        from: string;
        to: string;
        value: string;
        data: Hex;
      };
      expect(tx).toMatchObject({
        from: wallet,
        to: distributor,
        value: "0x0",
      });
      expect(
        decodeFunctionData({ abi: REFERRAL_ABI, data: tx.data }),
      ).toMatchObject({ functionName: "claim", args: [100n * unit, []] });
      return send ? await send() : `0x${"f".repeat(64)}`;
    }
    if (method === "eth_call") {
      const call = params[0] as { data: Hex };
      const decoded = decodeFunctionData({
        abi: REFERRAL_ABI,
        data: call.data,
      });
      if (decoded.functionName === "token")
        return encodeFunctionResult({
          abi: REFERRAL_ABI,
          functionName: "token",
          result: token,
        });
      if (decoded.functionName === "paused")
        return encodeFunctionResult({
          abi: REFERRAL_ABI,
          functionName: "paused",
          result: false,
        });
      if (decoded.functionName === "claimed")
        return encodeFunctionResult({
          abi: REFERRAL_ABI,
          functionName: "claimed",
          result: 20n * unit,
        });
      if (decoded.functionName === "currentRoot")
        return encodeFunctionResult({
          abi: REFERRAL_ABI,
          functionName: "currentRoot",
          result: [record().claim?.root as Hex, 100n * unit, 0n],
        });
      if (decoded.functionName === "claim") return "0x";
    }
    throw new Error(`Unexpected wallet method ${method}`);
  };
  // Playwright transports Error name/message but drops custom wallet codes.
  // Carry the code explicitly, then recreate the provider error in the browser.
  await page.exposeFunction(
    "referralWalletRequest",
    async (input: { method: string; params?: unknown[] }) => {
      try {
        return { value: await request(input) };
      } catch (cause) {
        return {
          error: {
            message: cause instanceof Error ? cause.message : String(cause),
            code: (cause as { code?: unknown } | null)?.code,
          },
        };
      }
    },
  );
  await page.addInitScript(() => {
    const w = window as unknown as {
      ethereum: unknown;
      referralWalletRequest: (input: unknown) => Promise<{
        value?: unknown;
        error?: { message: string; code?: unknown };
      }>;
    };
    w.ethereum = {
      isMetaMask: true,
      async request(input: unknown) {
        const result = await w.referralWalletRequest(input);
        if (result.error)
          throw Object.assign(new Error(result.error.message), {
            code: result.error.code,
          });
        return result.value;
      },
    };
  });
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({
      json: {
        session: { githubId: "900000100", githubLogin: "ref", admin: false },
      },
    }),
  );
  await page.route("**/api/v1/project-appeals", (route) =>
    route.fulfill({ json: { appeals: [] } }),
  );
  await page.route("**/api/v1/payments/me", (route) =>
    route.fulfill({
      json: {
        githubUserId: "900000100",
        wallets: [],
        payments: [],
        balances: [],
        monthlyAwards: [],
        directTransfers: [],
        walletObservations: [],
      },
    }),
  );
  await page.route("**/api/v1/referrals/me", (route) =>
    route.fulfill({ json: current }),
  );
  return {
    calls,
    set: (value: typeof current) => {
      current = value;
    },
    beforeEstimate: (wait: () => Promise<void>) => {
      estimate = wait;
    },
    sendWith: (result: () => Promise<string>) => {
      send = result;
    },
  };
}

test("referrer reviews, signs once, and waits for verified claim status", async ({
  page,
}, info) => {
  const h = await setup(page);
  await page.goto("/earnings", { waitUntil: "networkidle" });
  const section = page.getByRole("region", { name: "Referral rewards" });
  await expect(section).toBeVisible();
  await expect(section).toContainText("80 program tokens");
  expect(h.calls).toEqual([]);
  const review = page.getByRole("button", { name: "Review with MetaMask" });
  await review.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("region", { name: "Review referral claim" }),
  ).toBeVisible();
  expect(h.calls).not.toContain("eth_sendTransaction");
  await expectAccessible(page);
  await page.screenshot({
    path: info.outputPath("referral-review.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Confirm claim in wallet" }).click();
  await expect(section).toContainText("Claim submitted");
  expect(h.calls.filter((m) => m === "eth_sendTransaction")).toHaveLength(1);
  await page.reload({ waitUntil: "networkidle" });
  await expect(section).toContainText("not yet verified");
  await expect(
    section.getByRole("button", { name: "Review with MetaMask" }),
  ).toHaveCount(0);
  const settled = record();
  settled.claimedBase = (100n * unit).toString();
  settled.claimableBase = "0";
  settled.claim = null;
  h.set(settled);
  await section.getByRole("button", { name: "Refresh record" }).click();
  await expect(section).toContainText("Your claim is verified");
  await expect(section).toContainText("100 program tokens");
  await page.screenshot({
    path: info.outputPath("referral-verified.png"),
    fullPage: true,
  });
});

function pause() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
const claimKey = `slop:referral-claim:robinhood-testnet:${distributor}:${wallet}`;

test("a referral identity reply at committed removal cannot prompt the wallet", async ({
  page,
}) => {
  const h = await setup(page);
  await page.goto("/earnings", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Review with MetaMask" }).click();
  await expect(
    page.getByRole("region", { name: "Review referral claim" }),
  ).toBeVisible();
  await holdVaultWalletPreflight(page, ".referral-claims");
  await page.evaluate(() => {
    const current = window.location.href;
    window.history.replaceState(window.history.state, "", "/how-it-works");
    window.history.pushState({}, "", current);
  });
  await page.getByRole("button", { name: "Confirm claim in wallet" }).click();
  try {
    await leaveWithVaultPreflight(page);
    expect(h.calls).not.toContain("eth_sendTransaction");
    expect(
      await page.evaluate((key) => localStorage.getItem(key), claimKey),
    ).toBeNull();
  } finally {
    await releaseVaultPreflight(page);
  }
});

test("a granted referral cleanup lock cannot clear storage after committed removal", async ({
  page,
}) => {
  const h = await setup(page);
  await page.goto("/earnings", { waitUntil: "networkidle" });
  const pending = JSON.stringify({
    attemptId: "11111111-1111-4111-8111-111111111111",
    hash: null,
    cumulative: (100n * unit).toString(),
  });
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
    key: claimKey,
    value: pending,
  });
  const settled = record();
  settled.claimedBase = (100n * unit).toString();
  settled.claimableBase = "0";
  settled.claim = null;
  h.set(settled);
  await page.evaluate(() => {
    const request = navigator.locks.request.bind(navigator.locks);
    const state = { waiting: false, removed: false, release: () => {} };
    const observer = new MutationObserver(() => {
      if (state.waiting && !document.querySelector(".referral-claims")) {
        state.removed = true;
        state.release();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: (
          name: string,
          options: LockOptions,
          callback: (lock: Lock | null) => unknown,
        ) =>
          request(name, options, async (lock) => {
            if (lock && name.startsWith("slop:referral-claim:")) {
              state.waiting = true;
              await new Promise<void>((resolve) => {
                state.release = () => {
                  observer.disconnect();
                  resolve();
                };
              });
            }
            return callback(lock);
          }),
      },
    });
    Object.assign(window, { heldReferralLock: state });
    const current = window.location.href;
    window.history.replaceState(window.history.state, "", "/how-it-works");
    window.history.pushState({}, "", current);
  });
  try {
    await page.getByRole("button", { name: "Refresh record" }).click();
    await page.waitForFunction(
      () =>
        (
          window as unknown as {
            heldReferralLock: { waiting: boolean };
          }
        ).heldReferralLock.waiting,
    );
    await page.goBack();
    await expect(page).toHaveURL(/\/how-it-works$/u);
    await page.waitForFunction(
      () =>
        (
          window as unknown as {
            heldReferralLock: { removed: boolean };
          }
        ).heldReferralLock.removed,
    );
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    expect(
      await page.evaluate((key) => localStorage.getItem(key), claimKey),
    ).toBe(pending);
    expect(h.calls).not.toContain("eth_sendTransaction");
  } finally {
    await page.evaluate(() =>
      (
        window as unknown as {
          heldReferralLock?: { release(): void };
        }
      ).heldReferralLock?.release(),
    );
  }
});

test("a departed preflight cannot prompt and another view cannot overlap it", async ({
  page,
}) => {
  const h = await setup(page);
  await page.goto("/earnings", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Review with MetaMask" }).click();
  await expect(
    page.getByRole("region", { name: "Review referral claim" }),
  ).toBeVisible();
  const entered = pause(),
    held = pause();
  h.beforeEstimate(async () => {
    entered.release();
    await held.promise;
  });
  await page.getByRole("button", { name: "Confirm claim in wallet" }).click();
  await entered.promise;
  const other = await page.context().newPage();
  try {
    const second = await setup(other);
    await other.goto("/earnings", { waitUntil: "networkidle" });
    await other.getByRole("button", { name: "Review with MetaMask" }).click();
    await other
      .getByRole("button", { name: "Confirm claim in wallet" })
      .click();
    await expect(other.getByRole("alert")).toContainText(
      "active in another view",
    );
    expect(second.calls).not.toContain("eth_sendTransaction");
    await page.getByRole("link", { name: "Slop home", exact: true }).click();
    await expect(page).toHaveURL(/\/$/u);
    held.release();
    await expect
      .poll(async () =>
        other.evaluate(
          async (name) =>
            navigator.locks.request(name, { ifAvailable: true }, (lock) =>
              Boolean(lock),
            ),
          `${claimKey}:mutation`,
        ),
      )
      .toBe(true);
    expect(h.calls).not.toContain("eth_sendTransaction");
    expect(
      await other.evaluate((key) => localStorage.getItem(key), claimKey),
    ).toBeNull();
  } finally {
    held.release();
    await other.close();
  }
});

test("an active wallet request blocks cross-view reset and later permits recovery", async ({
  page,
}) => {
  const h = await setup(page);
  const entered = pause(),
    held = pause();
  h.sendWith(async () => {
    entered.release();
    await held.promise;
    return `0x${"f".repeat(64)}`;
  });
  await page.goto("/earnings", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Review with MetaMask" }).click();
  await page.getByRole("button", { name: "Confirm claim in wallet" }).click();
  await entered.promise;
  const before = await page.evaluate(
    (key) => localStorage.getItem(key),
    claimKey,
  );
  expect(JSON.parse(before!).attemptId).toMatch(/^[0-9a-f-]{36}$/iu);
  await page.getByRole("link", { name: "Slop home", exact: true }).click();
  const other = await page.context().newPage();
  try {
    await setup(other);
    await other.goto("/earnings", { waitUntil: "networkidle" });
    await other
      .getByRole("button", { name: "I checked wallet activity. Review again" })
      .click();
    await expect(other.getByRole("alert")).toContainText(
      "active in another view",
    );
    expect(
      await other.evaluate((key) => localStorage.getItem(key), claimKey),
    ).toBe(before);
    held.release();
    await expect
      .poll(() =>
        other.evaluate((key) => {
          const raw = localStorage.getItem(key);
          return raw ? JSON.parse(raw).hash : null;
        }, claimKey),
      )
      .toBe(`0x${"f".repeat(64)}`);
    await other.getByRole("button", { name: "Refresh record" }).click();
    await expect(
      other.getByRole("link", { name: "View transaction" }),
    ).toHaveAttribute("href", new RegExp(`0x${"f".repeat(64)}$`));
    await other
      .getByRole("button", { name: "I checked wallet activity. Review again" })
      .click();
    await expect(
      other.getByRole("button", { name: "Review with MetaMask" }),
    ).toBeVisible();
    expect(
      await other.evaluate((key) => localStorage.getItem(key), claimKey),
    ).toBeNull();
  } finally {
    held.release();
    await other.close();
  }
});

test("a browser without Web Locks cannot send or reset a claim", async ({
  page,
}) => {
  const h = await setup(page);
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "locks", {
      value: undefined,
      configurable: true,
    }),
  );
  await page.goto("/earnings", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Review with MetaMask" }).click();
  await page.getByRole("button", { name: "Confirm claim in wallet" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "cannot coordinate claim requests",
  );
  expect(h.calls).not.toContain("eth_sendTransaction");
  await page.evaluate(
    (key) =>
      localStorage.setItem(
        key,
        JSON.stringify({ hash: null, cumulative: "100" }),
      ),
    claimKey,
  );
  await page.getByRole("button", { name: "Refresh record" }).click();
  await page
    .getByRole("button", { name: "I checked wallet activity. Review again" })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "cannot coordinate claim requests",
  );
  expect(
    await page.evaluate((key) => localStorage.getItem(key), claimKey),
  ).not.toBeNull();
});

test("a departed declined request clears only its own locked marker", async ({
  page,
}) => {
  const h = await setup(page);
  const entered = pause(),
    held = pause();
  h.sendWith(async () => {
    entered.release();
    await held.promise;
    throw Object.assign(new Error("Wallet request declined"), { code: 4001 });
  });
  await page.goto("/earnings", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Review with MetaMask" }).click();
  await page.getByRole("button", { name: "Confirm claim in wallet" }).click();
  await entered.promise;
  await page.getByRole("link", { name: "Slop home", exact: true }).click();
  const other = await page.context().newPage();
  try {
    await setup(other);
    await other.goto("/earnings", { waitUntil: "networkidle" });
    await other
      .getByRole("button", { name: "I checked wallet activity. Review again" })
      .click();
    await expect(other.getByRole("alert")).toContainText(
      "active in another view",
    );
    held.release();
    await expect
      .poll(() => other.evaluate((key) => localStorage.getItem(key), claimKey))
      .toBeNull();
    await other.getByRole("button", { name: "Refresh record" }).click();
    await expect(
      other.getByRole("button", { name: "Review with MetaMask" }),
    ).toBeVisible();
    expect(
      h.calls.filter((method) => method === "eth_sendTransaction"),
    ).toHaveLength(1);
  } finally {
    held.release();
    await other.close();
  }
});

test("a failed hash write retains its transaction and clears only its stored attempt after verification", async ({
  page,
}) => {
  const h = await setup(page);
  await page.goto("/earnings", { waitUntil: "networkidle" });
  await page.evaluate(() => {
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (
        key.startsWith("slop:referral-claim:") &&
        JSON.parse(value).hash !== null
      )
        throw new DOMException("Storage is full", "QuotaExceededError");
      return write.call(this, key, value);
    };
  });
  await page.getByRole("button", { name: "Review with MetaMask" }).click();
  await page.getByRole("button", { name: "Confirm claim in wallet" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "could not save the claim status",
  );
  await expect(
    page.getByRole("link", { name: "View transaction" }),
  ).toHaveAttribute("href", new RegExp(`0x${"f".repeat(64)}$`));
  expect(
    JSON.parse(
      (await page.evaluate((key) => localStorage.getItem(key), claimKey))!,
    ).hash,
  ).toBeNull();
  const settled = record();
  settled.claimedBase = (100n * unit).toString();
  settled.claimableBase = "0";
  settled.claim = null;
  h.set(settled);
  await page.getByRole("button", { name: "Refresh record" }).click();
  await expect(
    page.getByRole("region", { name: "Referral rewards" }),
  ).toContainText("Your claim is verified");
  expect(
    await page.evaluate((key) => localStorage.getItem(key), claimKey),
  ).toBeNull();
});

test("unactivated referrals stay hidden; stale, paused and unknown claims cannot sign", async ({
  page,
}) => {
  const h = await setup(page);
  h.set({ enabled: false });
  await page.goto("/earnings", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", { name: "Referral rewards" }),
  ).toHaveCount(0);
  const stale = record();
  stale.status = "stale";
  h.set(stale);
  await page.reload({ waitUntil: "networkidle" });
  const section = page.getByRole("region", { name: "Referral rewards" });
  await expect(section).toContainText("record is stale");
  await expect(section).toContainText("80 program tokens");
  await expect(
    page.getByRole("button", { name: "Review with MetaMask" }),
  ).toHaveCount(0);
  const paused = record();
  paused.paused = true;
  h.set(paused);
  await section.getByRole("button", { name: "Refresh record" }).click();
  await expect(section).toContainText("Claims are paused");
  const unknown = record();
  unknown.status = "unknown";
  unknown.program = null;
  unknown.claim = null;
  unknown.claimableBase = null;
  unknown.claimedBase = null;
  unknown.pendingBase = null;
  h.set(unknown);
  await section.getByRole("button", { name: "Refresh record" }).click();
  await expect(section).toContainText("The claim record is not available yet.");
  await section.getByText("Reward details", { exact: true }).click();
  await expect(section.getByText("Unknown", { exact: true })).toHaveCount(4);
  await expect(section).toContainText("Unknown claimable");
  expect(h.calls).toEqual([]);
});

test("blocked claim storage keeps amounts visible and refuses a wallet send", async ({
  page,
}) => {
  const h = await setup(page);
  await page.goto("/earnings", { waitUntil: "networkidle" });
  await page.evaluate(() => {
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("slop:referral-claim:"))
        throw new DOMException("Storage is full", "QuotaExceededError");
      return write.call(this, key, value);
    };
  });
  const section = page.getByRole("region", { name: "Referral rewards" });
  await expect(section).toContainText("80 program tokens");
  await section.getByRole("button", { name: "Review with MetaMask" }).click();
  await page.getByRole("button", { name: "Confirm claim in wallet" }).click();
  await expect(section.getByRole("alert")).toContainText(
    "save the claim status",
  );
  expect(h.calls).not.toContain("eth_sendTransaction");
  await section.getByRole("button", { name: "Refresh record" }).click();
  await expect(section).toContainText("80 program tokens");
  expect(h.calls).not.toContain("eth_sendTransaction");
});

test("refresh retains an unverified claim when storage becomes unreadable", async ({
  page,
}) => {
  const h = await setup(page);
  await page.goto("/earnings", { waitUntil: "networkidle" });
  const section = page.getByRole("region", { name: "Referral rewards" });
  await section.getByRole("button", { name: "Review with MetaMask" }).click();
  await page.getByRole("button", { name: "Confirm claim in wallet" }).click();
  await expect(section).toContainText("Claim submitted");
  await page.evaluate(() => {
    const read = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) {
      if (key.startsWith("slop:referral-claim:"))
        throw new DOMException("Storage is blocked", "SecurityError");
      return read.call(this, key);
    };
  });
  const refreshed = page.waitForResponse("**/api/v1/referrals/me");
  await section.getByRole("button", { name: "Refresh record" }).click();
  await refreshed;
  await expect(section).toContainText("not yet verified");
  await expect(
    section.getByRole("link", { name: "View transaction" }),
  ).toBeVisible();
  await expect(
    section.getByRole("button", { name: "Review with MetaMask" }),
  ).toHaveCount(0);
  expect(h.calls.filter((m) => m === "eth_sendTransaction")).toHaveLength(1);
  const settled = record();
  settled.claimedBase = (100n * unit).toString();
  settled.claimableBase = "0";
  settled.claim = null;
  h.set(settled);
  await section.getByRole("button", { name: "Refresh record" }).click();
  await expect(section).toContainText("Your claim is verified");
});

test("an unreadable pending marker does not hide amounts or permit an unchecked retry", async ({
  page,
}) => {
  const h = await setup(page);
  await page.addInitScript(
    ({ wallet, distributor }) => {
      localStorage.setItem(
        `slop:referral-claim:robinhood-testnet:${distributor}:${wallet}`,
        "{broken",
      );
    },
    { wallet, distributor },
  );
  await page.goto("/earnings", { waitUntil: "networkidle" });
  const section = page.getByRole("region", { name: "Referral rewards" });
  await expect(section).toContainText("80 program tokens");
  await expect(section).toContainText("Check wallet activity");
  await expect(
    section.getByRole("button", { name: "Review with MetaMask" }),
  ).toHaveCount(0);
  await section
    .getByRole("button", { name: "I checked wallet activity. Review again" })
    .click();
  await section.getByRole("button", { name: "Review with MetaMask" }).click();
  await page.getByRole("button", { name: "Confirm claim in wallet" }).click();
  await expect(section).toContainText("Claim submitted");
  expect(h.calls.filter((m) => m === "eth_sendTransaction")).toHaveLength(1);
});

test("an older stored claim cannot confirm the newer request on this page", async ({
  page,
}) => {
  const h = await setup(page);
  await page.goto("/earnings", { waitUntil: "networkidle" });
  const section = page.getByRole("region", { name: "Referral rewards" });
  await section.getByRole("button", { name: "Review with MetaMask" }).click();
  await page.getByRole("button", { name: "Confirm claim in wallet" }).click();
  await expect(section).toContainText("Claim submitted");
  await page.evaluate(
    ({ wallet, distributor, cumulative }) => {
      localStorage.setItem(
        `slop:referral-claim:robinhood-testnet:${distributor}:${wallet}`,
        JSON.stringify({ hash: `0x${"a".repeat(64)}`, cumulative }),
      );
    },
    { wallet, distributor, cumulative: (20n * unit).toString() },
  );
  const refreshed = page.waitForResponse("**/api/v1/referrals/me");
  await section.getByRole("button", { name: "Refresh record" }).click();
  await refreshed;
  await expect(section).toContainText("not yet verified");
  await expect(section).not.toContainText("Your claim is verified");
  await expect(
    section.getByRole("button", { name: "Review with MetaMask" }),
  ).toHaveCount(0);
  await expect(
    section.getByRole("link", { name: "View transaction" }),
  ).toHaveAttribute("href", new RegExp(`0x${"f".repeat(64)}$`));
  expect(h.calls.filter((m) => m === "eth_sendTransaction")).toHaveLength(1);
});
