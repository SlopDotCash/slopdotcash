/** Built-page lifecycle regressions with explicit wallet/API doubles; no real wallet writes. */
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const address = "0x1111111111111111111111111111111111111111";
type Write = { path: string; body: Record<string, string> };
type SavedWallet = {
  chain: string;
  claimId: string;
  address: string;
  authorized: boolean;
};
type WalletWindow = Window & {
  earningsWallet: {
    calls: string[];
    releaseConnect(): void;
    connectReturned: boolean;
  };
  earningsLoadReplyRead?: boolean;
};

async function fixture(
  page: Page,
  hold: "connect" | "challenge" | "authorize" | "register",
) {
  const writes: Write[] = [];
  const saved: SavedWallet[] = [];
  const savedActors = new Map<string, string>();
  let actor = "123";
  let claim = { chain: "base", address, claimId: "" };
  let releaseRequest = () => {};
  let requestStarted = () => {};
  let requestFinished = () => {};
  const waiting = new Promise<void>((resolve) => {
    requestStarted = resolve;
  });
  const release = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  const finished = new Promise<void>((resolve) => {
    requestFinished = resolve;
  });
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({
      json: { session: { githubId: actor, githubLogin: "qa", admin: false } },
    }),
  );
  await page.route("**/api/v1/project-appeals", (route) =>
    route.fulfill({ json: { appeals: [] } }),
  );
  await page.route("**/api/v1/notifications/email", (route) =>
    route.fulfill({
      json: {
        enabled: false,
        securityEnabled: false,
        enrollmentAvailable: false,
        pending: null,
        availability: "unverified",
      },
    }),
  );
  await page.route("**/api/v1/referrals/me", (route) =>
    route.fulfill({ json: { enabled: false } }),
  );
  await page.route("**/api/v1/payments/**", async (route) => {
    const path = new URL(route.request().url()).pathname.split("/payments/")[1];
    if (path === "me") {
      await route.fulfill({
        json: {
          githubUserId: actor,
          wallets: saved.filter(
            (wallet) => savedActors.get(wallet.claimId) === actor,
          ),
          payments: [],
          monthlyAwards: [],
          balances: [],
          directTransfers: [],
          walletObservations: [],
        },
      });
      return;
    }
    if (
      !["wallets/register", "wallets/challenge", "wallets/authorize"].includes(
        path,
      )
    )
      return route.fallback();
    if (hold === "register" && path === "wallets/register") actor = "456";
    const expected = route.request().headers()["x-slop-expected-github-id"];
    if (expected !== undefined && expected !== actor) {
      await route.fulfill({
        status: 403,
        json: { error: "actor_changed" },
      });
      return;
    }
    const body = route.request().postDataJSON() as Record<string, string>;
    writes.push({ path, body });
    if (path === "wallets/register")
      claim = {
        chain: body.chain,
        address: body.address,
        claimId: `claim-${body.chain}`,
      };
    if (path === "wallets/authorize") {
      saved.push({ ...claim, authorized: true });
      savedActors.set(claim.claimId, actor);
    }
    const delayed =
      (hold === "challenge" && path === "wallets/challenge") ||
      (hold === "authorize" && path === "wallets/authorize");
    if (delayed) {
      requestStarted();
      await release;
    }
    await route.fulfill({
      json:
        path === "wallets/register"
          ? { claimId: claim.claimId }
          : path === "wallets/challenge"
            ? {
                chain: claim.chain,
                address: claim.address,
                challengeId: `challenge-${claim.chain}`,
                message: `Confirm ${claim.chain} payout address`,
              }
            : {},
    });
    if (delayed) requestFinished();
  });
  await page.addInitScript(
    ({ address, holdConnect }) => {
      const calls: string[] = [];
      let releaseConnect = () => {};
      const gate = new Promise<void>((resolve) => {
        releaseConnect = resolve;
      });
      const control = { calls, releaseConnect, connectReturned: false };
      const provider = {
        isMetaMask: true,
        async request({ method }: { method: string }) {
          calls.push(method);
          if (method === "eth_requestAccounts") {
            if (holdConnect) await gate;
            control.connectReturned = true;
            return [address];
          }
          if (method === "personal_sign") return "0xfixture-signature";
          throw new Error(`Unexpected wallet method: ${method}`);
        },
      };
      Object.assign(window, { ethereum: provider, earningsWallet: control });
    },
    { address, holdConnect: hold === "connect" },
  );
  return {
    writes,
    saved,
    waiting,
    finished,
    releaseRequest,
    changeActor: (value: string) => {
      actor = value;
    },
  };
}

async function connect(page: Page) {
  await page.goto("/account#wallets", { waitUntil: "networkidle" });
  await page
    .getByRole("button", { name: "Connect EVM wallet", exact: true })
    .click();
  const picker = page.getByRole("dialog", { name: "Connect an EVM wallet" });
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: "MetaMask", exact: true }).click();
}

async function leave(page: Page) {
  await page.getByRole("link", { name: "Slop home", exact: true }).click();
  await expect(page).toHaveURL(/\/$/u);
  await expect(
    page.getByRole("button", { name: "Confirm in your wallet…", exact: true }),
  ).toHaveCount(0);
}

async function settle(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

test.beforeEach(({ diagnostics }) => diagnostics.allowPreviewApiMisses());

test("departed wallet connection cannot start payout registration", async ({
  page,
}) => {
  const state = await fixture(page, "connect");
  await connect(page);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as WalletWindow).earningsWallet.calls,
      ),
    )
    .toEqual(["eth_requestAccounts"]);
  try {
    await leave(page);
  } finally {
    await page.evaluate(() =>
      (window as unknown as WalletWindow).earningsWallet.releaseConnect(),
    );
  }
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as WalletWindow).earningsWallet.connectReturned,
      ),
    )
    .toBe(true);
  await settle(page);
  expect(state.writes).toEqual([]);
  expect(
    await page.evaluate(
      () => (window as unknown as WalletWindow).earningsWallet.calls,
    ),
  ).toEqual(["eth_requestAccounts"]);
});

test("departed challenge response cannot open a signature request", async ({
  page,
}) => {
  const state = await fixture(page, "challenge");
  await connect(page);
  await state.waiting;
  try {
    await leave(page);
  } finally {
    state.releaseRequest();
  }
  await state.finished;
  await settle(page);
  expect(state.writes.map((entry) => entry.path)).toEqual([
    "wallets/register",
    "wallets/challenge",
  ]);
  expect(
    await page.evaluate(
      () => (window as unknown as WalletWindow).earningsWallet.calls,
    ),
  ).toEqual(["eth_requestAccounts"]);
  expect(state.saved).toEqual([]);
});

test("an accepted confirmation survives departure without starting the next chain", async ({
  page,
}) => {
  const state = await fixture(page, "authorize");
  await connect(page);
  await state.waiting;
  try {
    await leave(page);
  } finally {
    state.releaseRequest();
  }
  await state.finished;
  await settle(page);
  expect(state.writes.map((entry) => entry.path)).toEqual([
    "wallets/register",
    "wallets/challenge",
    "wallets/authorize",
  ]);
  expect(state.saved).toEqual([
    { chain: "base", claimId: "claim-base", address, authorized: true },
  ]);
  expect(
    await page.evaluate(
      () => (window as unknown as WalletWindow).earningsWallet.calls,
    ),
  ).toEqual(["eth_requestAccounts", "personal_sign"]);
  // A new mounted view reads the accepted record; the old completion did not undo it.
  await page.goto("/account#wallets", { waitUntil: "networkidle" });
  await expect(
    page
      .getByRole("article", { name: "EVM wallet" })
      .getByRole("img", { name: "Base, confirmed", exact: true }),
  ).toBeVisible();
});

test("a silently changed account stops a connected wallet before registration", async ({
  page,
}) => {
  const state = await fixture(page, "connect");
  await connect(page);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as WalletWindow).earningsWallet.calls,
      ),
    )
    .toEqual(["eth_requestAccounts"]);
  state.changeActor("456");
  await page.evaluate(() =>
    (window as unknown as WalletWindow).earningsWallet.releaseConnect(),
  );
  await expect(page.getByRole("alert")).toContainText("Your account changed");
  expect(state.writes).toEqual([]);
  await expect(page.getByRole("article", { name: "EVM wallet" })).toHaveCount(
    0,
  );
  expect(
    await page.evaluate(
      () => (window as unknown as WalletWindow).earningsWallet.calls,
    ),
  ).toEqual(["eth_requestAccounts"]);
});

test("the expected actor blocks a swap between the session check and registration", async ({
  page,
  diagnostics,
}) => {
  const state = await fixture(page, "register");
  diagnostics.allowResponse(403, "POST", "/api/v1/payments/wallets/register");
  await connect(page);
  await expect(page.getByRole("alert")).toContainText("Your account changed");
  expect(state.writes).toEqual([]);
  expect(state.saved).toEqual([]);
  expect(
    await page.evaluate(
      () => (window as unknown as WalletWindow).earningsWallet.calls,
    ),
  ).toEqual(["eth_requestAccounts"]);
});

test("a silently changed account cannot sign an already requested challenge", async ({
  page,
}) => {
  const state = await fixture(page, "challenge");
  await connect(page);
  await state.waiting;
  state.changeActor("456");
  state.releaseRequest();
  await state.finished;
  await expect(page.getByRole("alert")).toContainText("Your account changed");
  expect(state.writes.map((entry) => entry.path)).toEqual([
    "wallets/register",
    "wallets/challenge",
  ]);
  expect(state.saved).toEqual([]);
  expect(
    await page.evaluate(
      () => (window as unknown as WalletWindow).earningsWallet.calls,
    ),
  ).toEqual(["eth_requestAccounts"]);
});

test("accepted A authorization remains recorded without starting B's next chain", async ({
  page,
}) => {
  const state = await fixture(page, "authorize");
  await connect(page);
  await state.waiting;
  state.changeActor("456");
  state.releaseRequest();
  await state.finished;
  await expect(page.getByRole("alert")).toContainText("Your account changed");
  expect(state.writes.map((entry) => entry.path)).toEqual([
    "wallets/register",
    "wallets/challenge",
    "wallets/authorize",
  ]);
  expect(state.saved).toEqual([
    { chain: "base", claimId: "claim-base", address, authorized: true },
  ]);
  expect(
    await page.evaluate(
      () => (window as unknown as WalletWindow).earningsWallet.calls,
    ),
  ).toEqual(["eth_requestAccounts", "personal_sign"]);
});

test("wallet access loss prevents a retained account load from restoring the old view", async ({
  page,
  diagnostics,
}) => {
  const state = await fixture(page, "connect");
  await page.goto("/account#wallets", { waitUntil: "networkidle" });
  const card = page.getByRole("article", { name: "EVM wallet" });
  await expect(card).toBeVisible();

  // Observe consumption of the held HTTP body. This is a Web API boundary,
  // not an exposed application callback. The task runs after the JSON/await
  // continuations drain; settle() then waits for the browser's rendered frames.
  await page.evaluate(() => {
    const readJson = Response.prototype.json;
    Response.prototype.json = async function (this: Response) {
      const value = await readJson.call(this);
      if (this.headers.get("x-earnings-held-session") === "1") {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
          (window as unknown as WalletWindow).earningsLoadReplyRead = true;
          channel.port1.close();
          channel.port2.close();
        };
        channel.port2.postMessage(null);
      }
      return value;
    };
  });

  let actor = "123";
  let failFirstSession = true;
  let holdFinalSession = false;
  let capturedFinalSession = false;
  let announceFinalSession = () => {};
  let releaseFinalSession = () => {};
  let finishFinalSession = () => {};
  const finalSessionStarted = new Promise<void>((resolve) => {
    announceFinalSession = () => resolve();
  });
  const finalSessionRelease = new Promise<void>((resolve) => {
    releaseFinalSession = () => resolve();
  });
  const finalSessionFinished = new Promise<void>((resolve) => {
    finishFinalSession = () => resolve();
  });
  diagnostics.allowResponse(503, "GET", "/api/v1/project-session");
  await page.route("**/api/v1/project-session", async (route) => {
    if (failFirstSession) {
      failFirstSession = false;
      await route.fulfill({
        status: 503,
        json: { error: "unavailable", message: "Session lookup unavailable." },
      });
      return;
    }
    const observedActor = actor;
    const retained = holdFinalSession && !capturedFinalSession;
    if (retained) {
      capturedFinalSession = true;
      announceFinalSession();
      await finalSessionRelease;
    }
    await route.fulfill({
      ...(retained ? { headers: { "x-earnings-held-session": "1" } } : {}),
      json: {
        session: { githubId: observedActor, githubLogin: "qa", admin: false },
      },
    });
    if (retained) finishFinalSession();
  });
  await page.route("**/api/v1/payments/me", async (route) => {
    // The next session read belongs to the refresh that just received /me.
    holdFinalSession = true;
    await route.fallback();
  });
  const chooseWallet = async () => {
    await page
      .getByRole("button", { name: "Connect EVM wallet", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Connect an EVM wallet" })
      .getByRole("button", { name: "MetaMask", exact: true })
      .click();
  };

  try {
    // Produce the existing Retry control without discarding verified A data.
    await chooseWallet();
    await expect(page.getByRole("alert")).toContainText(
      "Session lookup unavailable.",
    );
    await expect(card).toBeVisible();
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await finalSessionStarted;

    // A's refresh has already captured its final session response. A separate
    // wallet operation now sees B and invalidates the private account view.
    actor = "456";
    state.changeActor(actor);
    await chooseWallet();
    await expect(page.getByRole("alert")).toContainText("Your account changed");
    await expect(card).toHaveCount(0);

    releaseFinalSession();
    await finalSessionFinished;
    await page.waitForFunction(
      () => (window as unknown as WalletWindow).earningsLoadReplyRead,
    );
    await settle(page);
    await expect(card).toHaveCount(0);
    await expect(
      page.getByRole("status").filter({ hasText: "Checking your payouts" }),
    ).toHaveCount(0);
    expect(state.writes).toEqual([]);
    expect(
      await page.evaluate(
        () => (window as unknown as WalletWindow).earningsWallet.calls,
      ),
    ).toEqual([]);
  } finally {
    releaseFinalSession();
  }
});
