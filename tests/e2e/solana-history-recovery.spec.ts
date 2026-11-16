/**
 * Actual built UI and browser storage, with a captured synthetic handler case.
 * Wallet/HTTP authorities are controlled here; native retirement has separate
 * chain evidence. No transaction-sending feature is made available.
 */
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
} from "node:crypto";
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { decodeBase58Bytes, encodeBase58Bytes } from "../../src/lib/base58";
import { expect, expectAccessible, test } from "./fixtures";

type Snapshot = {
  case: {
    id: string;
    projectId: string;
    revision: number;
    viewerRoles: string[];
    allowedActions?: string[];
    settlement: {
      ownerRequest?: {
        payer: { address: string };
        solana?: { transaction: string; messageId: string };
      };
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

/** Hold decoded data at an inner parent gate, while leaving the parent mounted. */
async function holdParentGate(
  page: Page,
  caseId: string,
  caseReads: number,
  followingSessions: number,
) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(
    ({ caseId, caseReads, followingSessions }) => {
      const state = {
        cases: 0,
        remaining: -1,
        waiting: false,
        returned: false,
        release: () => {},
      };
      Object.assign(window, { heldPaymentGate: state });
      const json = Response.prototype.json;
      Response.prototype.json = async function (this: Response) {
        const body = await json.call(this);
        const path = this.url ? new URL(this.url).pathname : "";
        let hold = false;
        if (path === `/api/v1/security-cases/${caseId}`) {
          state.cases += 1;
          if (state.cases === caseReads) {
            state.remaining = followingSessions;
            hold = followingSessions === 0;
          }
        } else if (path === "/api/v1/project-session" && state.remaining > 0) {
          state.remaining -= 1;
          hold = state.remaining === 0;
        }
        if (hold && !state.waiting) {
          state.waiting = true;
          await new Promise<void>((resolve) => {
            state.release = resolve;
          });
          state.returned = true;
        }
        return body;
      };
    },
    { caseId, caseReads, followingSessions },
  );
}

async function departHeldPayment(page: Page, leaveParent = false) {
  await page.waitForFunction(
    () =>
      (window as typeof window & { heldPaymentGate: { waiting: boolean } })
        .heldPaymentGate.waiting,
  );
  if (leaveParent) {
    await page.evaluate(() => {
      const current = window.location.href;
      window.history.replaceState(window.history.state, "", "/how-it-works");
      window.history.pushState({}, "", current);
    });
    await page.goBack();
    await expect(page).toHaveURL(/\/how-it-works$/u);
  } else {
    await page
      .getByRole("button", { name: "Back to reports", exact: true })
      .click();
  }
  await expect(
    page.getByRole("button", { name: "Back to reports", exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() =>
    (
      window as typeof window & { heldPaymentGate: { release(): void } }
    ).heldPaymentGate.release(),
  );
  await page.waitForFunction(
    () =>
      (window as typeof window & { heldPaymentGate: { returned: boolean } })
        .heldPaymentGate.returned,
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

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
          const signature = Uint8Array.from(
            await bridge.historyWalletSign([...message]),
          );
          setTimeout(() => {
            Object.assign(window, { historyWalletReturned: true });
          }, 0);
          return [
            {
              signedMessage: message,
              signature,
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

async function setup(page: Page, fallback = false) {
  const record = structuredClone(snapshot.case);
  if (fallback) {
    delete record.settlement.ownerRequest;
    record.allowedActions = ["verify-payment"];
  }
  // A public deterministic fixture key replaces the captured random payer.
  // Keep the message's payer slot, ID and unsigned transaction consistent.
  const key = createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      Buffer.alloc(32, 19),
    ]),
    format: "der",
    type: "pkcs8",
  });
  const publicKey = createPublicKey(key)
    .export({ format: "der", type: "spki" })
    .subarray(-32);
  const payer = encodeBase58Bytes(publicKey);
  record.settlement.recovery.payer = payer;
  if (record.settlement.ownerRequest)
    record.settlement.ownerRequest.payer.address = payer;
  for (const challenge of record.settlement.recovery.messages) {
    const previousId = challenge.messageId;
    const bytes = Buffer.from(challenge.message, "base64");
    bytes.set(publicKey, 4);
    challenge.message = bytes.toString("base64");
    challenge.messageId = encodeBase58Bytes(
      createHash("sha256").update(bytes).digest(),
    );
    const plan = record.settlement.ownerRequest?.solana;
    if (plan?.messageId === previousId) {
      const wire = Buffer.from(plan.transaction, "base64");
      wire.set(bytes, 65);
      plan.transaction = wire.toString("base64");
      plan.messageId = challenge.messageId;
    }
  }
  let actor = OWNER;
  let failVerification = false;
  let invalidSignature = false;
  let onSign: (() => Promise<void>) | undefined;
  const signed: number[][] = [];
  const posted: unknown[] = [];
  const submittedKey = `slop:bounty-solana:v1:${record.id}:${record.settlement.recovery.generation}:fixture:${OWNER}`;
  if (fallback)
    await page.addInitScript(
      ({ key, signature }) => {
        sessionStorage.setItem(key, JSON.stringify({ signature }));
      },
      { key: submittedKey, signature: "1".repeat(64) },
    );
  await page.exposeFunction("historyWalletAccount", () => ({
    address: record.settlement.recovery.payer,
    publicKey: [...decodeBase58Bytes(record.settlement.recovery.payer)],
  }));
  await page.exposeFunction("historyWalletSign", async (message: number[]) => {
    signed.push(message);
    await onSign?.();
    return invalidSignature
      ? Array<number>(64).fill(255)
      : [...sign(null, Buffer.from(message), key)];
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
    submittedKey,
    setActor: (value: string) => {
      actor = value;
    },
    setFailure: (value: boolean) => {
      failVerification = value;
    },
    setInvalidSignature: (value: boolean) => {
      invalidSignature = value;
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
  // The account check runs again after signing, before any local cache write.
  expect(
    await page.evaluate((key) => sessionStorage.getItem(key), flow.cacheKey),
  ).toBeNull();
});

test("a newer case revision refreshes recovery before signing and retries with its revision", async ({
  page,
}) => {
  const flow = await setup(page);
  await flow.connect();
  await expect(
    page.getByRole("button", { name: "Check expired payment", exact: true }),
  ).toBeEnabled();
  flow.record.revision += 1;
  await flow.check();
  await expect(
    page.getByRole("button", {
      name: "Connect History-only wallet",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Check expired payment", exact: true }),
  ).toBeDisabled();
  expect(flow.signed).toHaveLength(0);
  expect(flow.posted).toHaveLength(0);
  await flow.connect();
  await flow.check();
  await expect.poll(() => flow.posted.length).toBe(1);
  expect(flow.posted[0]).toMatchObject({
    action: "recover-payment",
    expectedRevision: flow.record.revision,
  });
  expect(flow.signed).toHaveLength(1);
});

test("a refreshed case revision keeps valid cached history proof for the next attempt", async ({
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
  expect(flow.signed).toHaveLength(1);
  expect(flow.posted).toHaveLength(1);
  flow.record.revision += 1;
  flow.setFailure(false);
  await flow.check();
  await expect(
    page.getByRole("button", {
      name: "Connect History-only wallet",
      exact: true,
    }),
  ).toBeVisible();
  expect(flow.posted).toHaveLength(1);
  await flow.connect();
  await flow.check();
  await expect.poll(() => flow.posted.length).toBe(2);
  expect(flow.posted[1]).toMatchObject({
    action: "recover-payment",
    expectedRevision: flow.record.revision,
  });
  expect(flow.signed).toHaveLength(1);
});

test("an invalid wallet signature is not cached and a retry can repair it", async ({
  page,
}) => {
  const flow = await setup(page);
  await flow.connect();
  flow.setInvalidSignature(true);
  await flow.check();
  await expect(
    page.getByRole("alert").filter({ hasText: "invalid recovery signature" }),
  ).toBeVisible();
  expect(flow.posted).toHaveLength(0);
  expect(
    await page.evaluate((key) => sessionStorage.getItem(key), flow.cacheKey),
  ).toBeNull();
  flow.setInvalidSignature(false);
  await flow.check();
  await expect.poll(() => flow.posted.length).toBe(1);
  expect(flow.signed).toHaveLength(2);
});

test("a poisoned cached signature is replaced by a valid wallet proof", async ({
  page,
}) => {
  const flow = await setup(page);
  const message = flow.record.settlement.recovery.messages[0];
  const invalid = encodeBase58Bytes(new Uint8Array(64).fill(255));
  await page.evaluate(
    ({ key, message, signature }) => {
      sessionStorage.setItem(
        key,
        JSON.stringify({
          [message.messageId]: { message: message.message, signature },
        }),
      );
    },
    { key: flow.cacheKey, message, signature: invalid },
  );
  await flow.connect();
  await flow.check();
  await expect.poll(() => flow.posted.length).toBe(1);
  expect(flow.signed).toHaveLength(1);
  const saved = await page.evaluate(
    (key) => JSON.parse(sessionStorage.getItem(key)!),
    flow.cacheKey,
  );
  expect(saved[message.messageId].signature).not.toBe(invalid);
});

test("leaving a recovery child during signing cannot cache or post the old proof", async ({
  page,
}) => {
  const flow = await setup(page);
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = () => resolve();
  });
  flow.holdSigning(() => pending);
  await flow.connect();
  await flow.check();
  await expect.poll(() => flow.signed.length).toBe(1);
  await page
    .getByRole("button", { name: "Back to reports", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Check expired payment", exact: true }),
  ).toHaveCount(0);
  release();
  await page.waitForFunction(
    () =>
      (window as Window & { historyWalletReturned?: boolean })
        .historyWalletReturned,
  );
  expect(flow.posted).toHaveLength(0);
  expect(
    await page.evaluate((key) => sessionStorage.getItem(key), flow.cacheKey),
  ).toBeNull();
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

for (const boundary of ["authorization", "post-preflight"] as const) {
  test(`leaving submitted payment recovery during ${boundary} retires the action`, async ({
    page,
  }) => {
    const flow = await setup(page, true);
    const recovery = page.getByRole("region", {
      name: "Submitted payment recovery",
      exact: true,
    });
    const input = recovery.getByLabel("Transaction signature 1", {
      exact: true,
    });
    await expect(input).toHaveValue("1".repeat(64));
    const candidate = encodeBase58Bytes(new Uint8Array(64).fill(2));
    await input.fill(candidate);
    // The first case GET authorizes candidate persistence. The second is the
    // parent's verification GET; its post-read session is followed by the
    // POST wrapper's own session preflight, which must retain child ownership.
    await holdParentGate(
      page,
      flow.record.id,
      boundary === "authorization" ? 1 : 2,
      boundary === "authorization" ? 0 : 2,
    );
    await recovery
      .getByRole("button", { name: "Verify submitted payments", exact: true })
      .click();
    try {
      await departHeldPayment(page);
      expect(flow.posted).toHaveLength(0);
      const saved = await page.evaluate(
        (key) => JSON.parse(sessionStorage.getItem(key)!),
        flow.submittedKey,
      );
      expect(saved.signature).toBe("1".repeat(64));
      if (boundary === "authorization") expect(saved.candidate).toBeUndefined();
      else expect(saved.candidate).toBe(candidate);
      await expect(recovery).toHaveCount(0);
    } finally {
      await page.evaluate(() =>
        (
          window as typeof window & { heldPaymentGate: { release(): void } }
        ).heldPaymentGate.release(),
      );
    }
  });
}

for (const owner of ["child", "parent"] as const) {
  test(`leaving the Solana recovery ${owner} during the inner POST preflight prevents dispatch`, async ({
    page,
  }) => {
    const flow = await setup(page);
    await flow.connect();
    // Each fresh signature has a pre-sign and pre-cache authorization GET,
    // followed by a final GET. Then come that GET's identity check, the child's
    // identity check, and the mutation wrapper's identity preflight.
    await holdParentGate(
      page,
      flow.record.id,
      flow.record.settlement.recovery.messages.length * 2 + 1,
      3,
    );
    await flow.check();
    try {
      await departHeldPayment(page, owner === "parent");
      expect(flow.posted).toHaveLength(0);
      expect(flow.signed).toHaveLength(
        flow.record.settlement.recovery.messages.length,
      );
      expect(
        await page.evaluate(
          (key) => sessionStorage.getItem(key),
          flow.cacheKey,
        ),
      ).not.toBeNull();
    } finally {
      await page.evaluate(() =>
        (
          window as typeof window & { heldPaymentGate: { release(): void } }
        ).heldPaymentGate.release(),
      );
    }
  });
}
