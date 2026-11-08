/**
 * Actual built UI and browser storage, with a captured synthetic handler case.
 * Wallet/HTTP authorities are controlled here; native retirement has separate
 * chain evidence. No transaction-sending feature is made available.
 */
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { decodeBase58Bytes } from "../../src/lib/base58";
import { expect, expectAccessible, test } from "./fixtures";

type Snapshot = {
  case: {
    id: string;
    projectId: string;
    revision: number;
    viewerRoles: string[];
    settlement: {
      recovery: {
        generation: number;
        payer: string;
        messages: { messageId: string; message: string }[];
      };
    };
  };
};
const snapshot = JSON.parse(
  readFileSync(
    new URL("../fixtures/solana-recovery-case.json", import.meta.url),
    "utf8",
  ),
) as Snapshot;
const OWNER = "710000001";

function installWallet() {
  const bridge = window as unknown as {
    historyWalletAccount(): Promise<{ address: string; publicKey: number[] }>;
    historyWalletSign(message: number[]): Promise<number[]>;
  };
  let accounts: {
    address: string;
    publicKey: Uint8Array;
    chains: string[];
    features: string[];
  }[] = [];
  const wallet = {
    name: "History-only wallet",
    version: "1.0.0",
    icon: "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E",
    chains: ["solana:mainnet"],
    get accounts() {
      return accounts;
    },
    features: {
      "standard:connect": {
        version: "1.0.0",
        async connect() {
          const account = await bridge.historyWalletAccount();
          accounts = [
            {
              address: account.address,
              publicKey: Uint8Array.from(account.publicKey),
              chains: ["solana:mainnet"],
              features: ["solana:signMessage"],
            },
          ];
          return { accounts };
        },
      },
      "solana:signMessage": {
        version: "1.0.0",
        async signMessage({ message }: { message: Uint8Array }) {
          return [
            {
              signedMessage: message,
              signature: Uint8Array.from(
                await bridge.historyWalletSign([...message]),
              ),
            },
          ];
        },
      },
    },
  };
  window.addEventListener("wallet-standard:app-ready", (event) =>
    (event as CustomEvent).detail.register(wallet),
  );
}

async function setup(page: Page) {
  const record = structuredClone(snapshot.case);
  let actor = OWNER;
  let failVerification = false;
  let onSign: (() => Promise<void>) | undefined;
  const signed: number[][] = [];
  const posted: unknown[] = [];
  await page.exposeFunction("historyWalletAccount", () => ({
    address: record.settlement.recovery.payer,
    publicKey: [...decodeBase58Bytes(record.settlement.recovery.payer)],
  }));
  await page.exposeFunction("historyWalletSign", async (message: number[]) => {
    signed.push(message);
    await onSign?.();
    // A controlled provider response, not a claim of cryptographic validity.
    return Array<number>(64).fill(7);
  });
  await page.addInitScript(installWallet);
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/project-session") {
      await route.fulfill({
        json: {
          session: {
            githubId: actor,
            githubLogin: "solana-owner",
            admin: false,
          },
        },
      });
    } else if (path === "/api/v1/security-cases") {
      await route.fulfill({
        json: {
          viewer: { githubId: actor, githubLogin: "solana-owner" },
          programs: [
            { projectId: record.projectId, roles: record.viewerRoles },
          ],
          cases: [record],
        },
      });
    } else if (path === "/api/v1/security-submissions") {
      await route.fulfill({
        json: { recipientGithubId: actor, automatic: false, submissions: [] },
      });
    } else if (path === `/api/v1/security-cases/${record.id}`) {
      await route.fulfill({ json: { case: record } });
    } else if (path === `/api/v1/security-cases/${record.id}/actions`) {
      posted.push(route.request().postDataJSON());
      await route.fulfill(
        failVerification
          ? {
              status: 503,
              json: {
                error: "temporarily_unavailable",
                message: "History verification unavailable.",
              },
            }
          : { json: { case: record } },
      );
    } else {
      await route.fallback();
    }
  });
  await page.goto(`/security?case=${record.id}`);
  const recovery = page.locator(".direct-bounty-payment").filter({
    hasText: "Sign expired request messages to check chain history.",
  });
  const connect = () =>
    recovery
      .getByRole("button", { name: "Connect History-only wallet", exact: true })
      .click();
  const check = () =>
    page
      .getByRole("button", { name: "Check expired payment", exact: true })
      .click();
  const cacheKey = `slop:bounty-history:v1:${record.id}:${record.settlement.recovery.generation}:${OWNER}`;
  return {
    record,
    signed,
    posted,
    connect,
    check,
    cacheKey,
    setActor: (value: string) => {
      actor = value;
    },
    setFailure: (value: boolean) => {
      failVerification = value;
    },
    holdSigning: (callback: () => Promise<void>) => {
      onSign = callback;
    },
  };
}

test.beforeEach(({ diagnostics }) => {
  diagnostics.allowPreviewApiMisses();
});

test("expired-message proof retries reuse exact cached signatures after a failed check and reload", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowResponse(
    503,
    "POST",
    `/api/v1/security-cases/${snapshot.case.id}/actions`,
  );
  const flow = await setup(page);
  await flow.connect();
  flow.setFailure(true);
  await flow.check();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "History verification unavailable." }),
  ).toBeVisible();
  expect(flow.signed).toEqual([
    [
      ...Buffer.from(
        flow.record.settlement.recovery.messages[0].message,
        "base64",
      ),
    ],
  ]);
  expect(flow.posted).toHaveLength(1);
  flow.setFailure(false);
  await page.reload();
  await flow.connect();
  await flow.check();
  await expect.poll(() => flow.posted.length).toBe(2);
  expect(flow.signed).toHaveLength(1);
  expect(flow.posted[1]).toMatchObject({
    action: "recover-payment",
    expectedRevision: flow.record.revision,
    signatures: [
      { messageId: flow.record.settlement.recovery.messages[0].messageId },
    ],
  });
  await expectAccessible(page);
});

test("account change during a message prompt cannot submit cached proof under the departed actor", async ({
  page,
}) => {
  const flow = await setup(page);
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  flow.holdSigning(() => pending);
  await flow.connect();
  await flow.check();
  await expect.poll(() => flow.signed.length).toBe(1);
  flow.setActor("710000003");
  release();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Your account changed or signed out." }),
  ).toBeVisible();
  expect(flow.posted).toHaveLength(0);
  // Completion may retain its old-key cache; that is not write authority.
  expect(
    await page.evaluate((key) => sessionStorage.getItem(key), flow.cacheKey),
  ).not.toBeNull();
});

test("a failed history-proof cache write is visible and cannot submit an incomplete proof", async ({
  page,
}) => {
  const flow = await setup(page);
  await flow.connect();
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("slop:bounty-history:v1:"))
        throw new DOMException(
          "History cache is unavailable",
          "QuotaExceededError",
        );
      return original.call(this, key, value);
    };
  });
  await flow.check();
  await expect(
    page.getByRole("alert").filter({ hasText: "History cache is unavailable" }),
  ).toBeVisible();
  expect(flow.signed).toHaveLength(1);
  expect(flow.posted).toHaveLength(0);
});
