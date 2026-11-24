/**
 * The standing deposit page, `/deposit` (operator decision, 23 November 2026;
 * PRD section 5, "Standing deposit"). The deployed bundle has no contract
 * recorded and offers nothing; the browser-test build names a local contract
 * through the fee fixture to exercise the signed-in page, the record checks
 * and the wallet review. The API suite uses real SQLite.
 */
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { deploymentOrigins, deploymentTier } from "../../src/lib/deployment";
import {
  STANDING_DEPOSIT_CONTRACT,
  standingDepositItem,
} from "../../src/lib/standing-deposit.mjs";
import {
  SUBMISSION_FEE_BURN,
  SUBMISSION_FEE_CONTRACTS,
  SUBMISSION_FEE_TOKENS,
} from "../../src/lib/submission-fee.mjs";
import { expect, expectAccessibleReflow, test } from "./fixtures";
import {
  feeRecord,
  installWallet,
  scriptedWallet,
  serveFeeRecord,
} from "./submission-fee-pay-fixture";

const { site } = deploymentOrigins(
  deploymentTier(process.env.VITE_SLOP_ENVIRONMENT),
);
const GITHUB_ID = "900000097";
/** The legacy GitHub node ID form, which names the account above. */
const NODE_ID = Buffer.from(`04:User${GITHUB_ID}`).toString("base64");
const CONTRACT = "0x00000000000000000000000000000000005d0001";
const SLOP = SUBMISSION_FEE_TOKENS["robinhood-mainnet"].slop as string;
const PAYER = "0x00000000000000000000000000000000000000aa";
const WHOLE = 10n ** 18n;
const slop = (whole: number) => (BigInt(whole) * WHOLE).toString();

/** Names the local standing contract in the browser-test build. */
async function deploy(page: Page, contract: string | null) {
  await page.addInitScript(
    (fixture) => {
      (
        window as unknown as { __SLOP_FEE_FIXTURE__: unknown }
      ).__SLOP_FEE_FIXTURE__ = fixture;
    },
    contract === null ? {} : { standingDeposit: { contract, startBlock: 1 } },
  );
}

/**
 * Serves the build on the product origin, where the app reads the member
 * session, and answers the session read. Specific API routes registered
 * afterwards win over this one.
 */
async function signIn(page: Page, signedIn: boolean) {
  await page.route(`${site}/**`, (route) =>
    route.fulfill({
      path: join(
        process.cwd(),
        "dist",
        route.request().resourceType() === "document"
          ? "index.html"
          : new URL(route.request().url()).pathname,
      ),
    }),
  );
  await page.route(`${site}/api/v1/points/me`, (route) =>
    signedIn
      ? route.fulfill({
          json: {
            actor: { id: NODE_ID, login: "standing-test" },
            joinedAt: "2026-10-01T00:00:00Z",
            public: true,
            welcome: 5,
            referralCode: null,
          },
        })
      : route.fulfill({ status: 401, json: { error: "not_signed_in" } }),
  );
}

type Row = Record<string, unknown> | null;

function record(deposit: Row, extra: Record<string, unknown> = {}) {
  return {
    schema: "slop-standing-deposit-v1",
    deployed: true,
    network: "robinhood-mainnet",
    chainId: 4663,
    contract: CONTRACT,
    token: SLOP,
    symbol: "SLOP",
    decimals: 18,
    keptTo: SUBMISSION_FEE_BURN,
    quote: slop(790),
    deposit,
    covers: [],
    ...extra,
  };
}

const unpaid = (round = 1, amount = slop(790)) => ({
  round,
  item: standingDepositItem(GITHUB_ID, round),
  amount,
  askedAt: "2026-12-01T12:00:00.000Z",
  paid: null,
  withdrawRequestedAt: null,
  outcome: null,
  outcomeReason: null,
  outcomeAt: null,
  resolveTransaction: null,
});

/** Serves the API as the server would; returns the writes it saw. */
async function serve(page: Page, initial: () => ReturnType<typeof record>) {
  let current = initial();
  const writes: { path: string; githubId: string | null }[] = [];
  await page.route("**/api/v1/standing-deposit**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST") {
      writes.push({
        path,
        githubId: request.headers()["x-slop-expected-github-id"] ?? null,
      });
      if (path.endsWith("/withdraw")) {
        const row = current.deposit as Record<string, unknown> | null;
        current =
          row?.paid == null
            ? record(null)
            : record({
                ...row,
                withdrawRequestedAt: "2026-12-05T12:00:00.000Z",
              });
      } else if (current.deposit === null) current = record(unpaid());
    }
    return route.fulfill({ json: current });
  });
  return {
    writes,
    set: (next: ReturnType<typeof record>) => {
      current = next;
    },
  };
}

test.beforeEach(async ({ diagnostics }) => {
  diagnostics.allowPreviewApiMisses();
});

test("the deployed bundle has no standing contract: one sentence, no control, no read", async ({
  page,
}) => {
  // The recorded deployment itself; recording it must change this test.
  expect(STANDING_DEPOSIT_CONTRACT).toBeNull();
  await deploy(page, null);
  await signIn(page, true);
  let reads = 0;
  await page.route("**/api/v1/standing-deposit**", (route) => {
    reads += 1;
    return route.abort();
  });
  await page.goto(`${site}/deposit`, { waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", { level: 1, name: "Standing deposit" }),
  ).toBeVisible();
  await expect(page).toHaveTitle("Standing deposit · Slop");
  await expect(page.getByRole("main")).toContainText(
    "Standing deposits are not available yet.",
  );
  await expect(page.getByRole("main").getByRole("button")).toHaveCount(0);
  expect(reads).toBe(0);
  await expectAccessibleReflow(page, "standing-deposit-not-deployed");
});

test("signed out, the terms and the contract come first, then the sign-in button", async ({
  page,
  diagnostics,
}) => {
  // A signed-out session answers 401, which the browser reports.
  diagnostics.allow(
    /^console Failed to load resource: the server responded with a status of 401 \(Unauthorized\) at .+\/api\/v1\/points\/me$/u,
  );
  await deploy(page, CONTRACT);
  await signIn(page, false);
  await page.goto(`${site}/deposit`, { waitUntil: "networkidle" });
  const terms = page.getByRole("region", {
    name: "How a standing deposit works",
  });
  await expect(terms.getByRole("listitem")).toHaveCount(6);
  for (const sentence of [
    "worth 10 US dollars at Slop's published SLOP rate",
    "Up to 10 covered pull requests can be open at once",
    "within 21 days and adds slop-keep-fee, and both still stand 48 hours later",
    "An ordinary close costs nothing.",
    "sent back to the wallet that paid it 21 days later",
    "ends 340 days after payment",
    "365 days after the deposit",
  ])
    await expect(terms).toContainText(sentence);
  await expect(terms.getByText(CONTRACT, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Sign in with GitHub" }),
  ).toBeVisible();
  // Nothing in the copy sells a faster or better review.
  await expect(page.getByRole("main")).not.toContainText(/faster|priority/iu);
  await expectAccessibleReflow(page, "standing-deposit-signed-out");
});

test("a member asks for one, sees the amount, reviews the payment into the standing contract, and cancels it", async ({
  page,
}) => {
  await deploy(page, CONTRACT);
  await signIn(page, true);
  await installWallet(page, scriptedWallet(PAYER).answer);
  const server = await serve(page, () => record(null));
  await page.goto(`${site}/deposit`, { waitUntil: "networkidle" });
  await page
    .getByRole("button", {
      name: "Ask for a standing deposit of 790 SLOP",
      exact: true,
    })
    .click();
  const due = page.getByRole("region", { name: "Deposit due" });
  await expect(due).toContainText("790 SLOP on Robinhood Chain.");
  expect(server.writes).toEqual([
    { path: "/api/v1/standing-deposit", githubId: GITHUB_ID },
  ]);
  await page
    .getByRole("button", { name: "Pay from a wallet", exact: true })
    .click();
  const pay = page.getByRole("region", { name: "Pay the standing deposit" });
  await pay
    .getByRole("button", { name: "Connect MetaMask", exact: true })
    .click();
  await expect(pay.getByRole("radio")).toHaveCount(1);
  await pay
    .getByRole("button", { name: "Review deposit", exact: true })
    .click();
  const review = pay.getByRole("region", { name: "Review deposit" });
  for (const text of ["790 SLOP", CONTRACT, SLOP, SUBMISSION_FEE_BURN, PAYER])
    await expect(review.getByText(text, { exact: false })).toBeVisible();
  // Never the per pull request contract.
  await expect(
    review.getByText(SUBMISSION_FEE_CONTRACTS["robinhood-mainnet"] as string, {
      exact: false,
    }),
  ).toHaveCount(0);
  await expectAccessibleReflow(page, "standing-deposit-review");

  await page.goto(`${site}/deposit`, { waitUntil: "networkidle" });
  await page
    .getByRole("button", { name: "Cancel this deposit", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm cancellation", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Ask for a standing deposit of 790 SLOP",
    }),
  ).toBeVisible();
  expect(server.writes.at(-1)).toEqual({
    path: "/api/v1/standing-deposit/withdraw",
    githubId: GITHUB_ID,
  });
});

test("a paid deposit shows its cover and withdraws once, after a confirmation", async ({
  page,
}) => {
  await deploy(page, CONTRACT);
  await signIn(page, true);
  const paid = {
    ...unpaid(),
    paid: {
      at: "2026-12-01T13:00:00.000Z",
      network: "robinhood-mainnet",
      depositId: 3,
      token: SLOP,
      amount: slop(790),
      transaction: `0x${"ab".repeat(32)}`,
      finalized: true,
    },
  };
  const server = await serve(page, () =>
    record(paid, {
      covers: [
        {
          repository: "elizaOS/eliza",
          pullNumber: 12,
          state: "watch",
          open: true,
        },
      ],
    }),
  );
  await page.goto(`${site}/deposit`, { waitUntil: "networkidle" });
  await expect(
    page.getByRole("region", { name: "Payment recorded" }),
  ).toContainText("790 SLOP on Robinhood Chain");
  await expect(page.getByRole("main")).toContainText(
    "It covers your new pull requests until Nov 6, 2027",
  );
  await expect(
    page.getByRole("region", { name: "Covered pull requests" }),
  ).toContainText("elizaOS/eliza #12 · Open · Covered");
  await expect(page.getByRole("region", { name: "Deposit due" })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  await expect(page.getByRole("main")).toContainText(
    "New pull requests stop being covered now.",
  );
  // The confirmation can be dismissed without a write.
  await page
    .getByRole("button", { name: "Keep the deposit", exact: true })
    .click();
  expect(server.writes).toEqual([]);
  await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  await page
    .getByRole("button", { name: "Confirm withdrawal", exact: true })
    .click();
  await expect(page.getByRole("main")).toContainText(
    "Withdrawal requested on Dec 5, 2026. It is due back to the wallet that paid it on Dec 26, 2026",
  );
  await expect(
    page.getByRole("button", { name: "Withdraw", exact: true }),
  ).toHaveCount(0);
  expect(server.writes).toHaveLength(1);
  await expectAccessibleReflow(page, "standing-deposit-withdrawn");
});

test("a record naming another contract, token, destination or account is refused and nothing can be paid", async ({
  page,
}) => {
  await deploy(page, CONTRACT);
  await signIn(page, true);
  const attacker = "0x000000000000000000000000000000000000bEEF";
  const server = await serve(page, () => record(unpaid()));
  for (const next of [
    record(unpaid(), { contract: attacker }),
    record(unpaid(), { token: attacker }),
    record(unpaid(), { keptTo: attacker }),
    record(unpaid(), {
      contract: SUBMISSION_FEE_CONTRACTS["robinhood-mainnet"],
    }),
    record({ ...unpaid(), item: standingDepositItem("900000098", 1) }),
    record({ ...unpaid(), item: standingDepositItem(GITHUB_ID, 2) }),
    record(unpaid(1, "790000000000000000001")),
  ]) {
    server.set(next);
    await page.goto(`${site}/deposit`, { waitUntil: "networkidle" });
    await expect(page.getByRole("alert")).toContainText(
      "The standing deposit record could not be checked against Slop's published addresses. Do not pay from this page.",
    );
    await expect(page.getByText(attacker, { exact: false })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /pay|connect/iu }),
    ).toHaveCount(0);
  }
});

test("the per pull request pay page points to /deposit once the standing contract is recorded", async ({
  page,
}) => {
  await page.addInitScript(
    (fixture) => {
      (
        window as unknown as { __SLOP_FEE_FIXTURE__: unknown }
      ).__SLOP_FEE_FIXTURE__ = fixture;
    },
    {
      switchedOn: true,
      standingDeposit: { contract: CONTRACT, startBlock: 1 },
    },
  );
  await serveFeeRecord(page, 826170402, 7, () => feeRecord(826170402, 7));
  await page.goto("/fee/elizaOS/eliza/7", { waitUntil: "networkidle" });
  const due = page.getByRole("region", { name: "Fee due" });
  await expect(due).toContainText(
    "Contribute often? A standing deposit can stand in for this fee on projects that accept it, once you have a merged pull request there.",
  );
  await expect(
    due.getByRole("link", { name: "standing deposit", exact: true }),
  ).toHaveAttribute("href", "/deposit");
});

test("the FAQ answers whether the fee can be skipped, and says it is not open yet", async ({
  page,
}) => {
  await page.goto("/how-it-works#faq", { waitUntil: "networkidle" });
  const answer = page.locator("#faq").locator("article", {
    has: page.getByRole("heading", {
      name: "Can I skip the fee on every pull request?",
    }),
  });
  await expect(answer).toContainText(
    "Not yet. Slop has not opened standing deposits.",
  );
  await expect(answer).toContainText("an ordinary close costs nothing.");
  await expect(answer).toContainText(
    "It does not buy a review, a merge or Points.",
  );
  await expect(answer.getByRole("link")).toHaveCount(0);
});
