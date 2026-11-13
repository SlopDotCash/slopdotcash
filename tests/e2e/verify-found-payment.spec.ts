/**
 * A captured synthetic direct-payment case whose recovery found an existing
 * transfer. The page only submits the found transaction IDs for verification;
 * it never signs or sends anything.
 */
import { readFileSync } from "node:fs";
import { expect, expectAccessible, test } from "./fixtures";

const OWNER = "710000001";
const FOUND =
  "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYVCJjBRAh5ycQLZ5bm8aJcsEHbFqjCbQBEsD1sCxcHuShSVCHDEDj";

type Case = {
  id: string;
  projectId: string;
  revision: number;
  viewerRoles: string[];
  paymentState: string;
  settlement: Record<string, unknown> & {
    recovery: Record<string, unknown> | null;
  };
};

test("Verify found payment submits only the found transfer and shows the paid result", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  const captured = JSON.parse(
    readFileSync(
      new URL("../fixtures/solana-recovery-case.json", import.meta.url),
      "utf8",
    ),
  ).case as Case;
  let record: Case = {
    ...structuredClone(captured),
    settlement: {
      ...structuredClone(captured.settlement),
      recovery: {
        ...structuredClone(captured.settlement.recovery),
        mode: "payment-found",
        messages: [],
        transactionIds: [FOUND],
      },
    },
  };
  const posted: Record<string, unknown>[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/v1/project-session")
      return route.fulfill({
        json: {
          session: { githubId: OWNER, githubLogin: "solana-owner" },
        },
      });
    if (path === "/api/v1/security-cases")
      return route.fulfill({
        json: {
          viewer: { githubId: OWNER, githubLogin: "solana-owner" },
          programs: [
            { projectId: record.projectId, roles: record.viewerRoles },
          ],
          cases: [record],
        },
      });
    if (path === "/api/v1/security-submissions")
      return route.fulfill({
        json: { recipientGithubId: OWNER, automatic: false, submissions: [] },
      });
    if (path === `/api/v1/security-cases/${record.id}`)
      return route.fulfill({ json: { case: record } });
    if (
      path === `/api/v1/security-cases/${record.id}/actions` &&
      request.method() === "POST"
    ) {
      expect(request.headers()["x-slop-expected-github-id"]).toBe(OWNER);
      posted.push(request.postDataJSON());
      record = {
        ...record,
        revision: record.revision + 1,
        paymentState: "paid",
        settlement: {
          ...record.settlement,
          state: "paid",
          transactionIds: [FOUND],
          confirmedTransactionIds: [FOUND],
          remainingTransfers: [],
          transactionId: FOUND,
          recovery: null,
        },
      };
      return route.fulfill({ json: { case: record } });
    }
    return route.fallback();
  });
  await page.goto(`/security?case=${record.id}`, { waitUntil: "networkidle" });
  const payment = page.getByRole("region", { name: "Private payment" });
  const recovery = payment.getByRole("group", { name: "Payment recovery" });
  await expect(
    recovery.getByText(
      "An existing payment was found. Verify it before continuing.",
      { exact: true },
    ),
  ).toBeVisible();
  await recovery
    .getByRole("button", { name: "Verify found payment", exact: true })
    .click();
  await expect(recovery).toHaveCount(0);
  expect(posted).toHaveLength(1);
  const [request] = posted;
  expect(request).toMatchObject({
    action: "verify-payment",
    expectedRevision: captured.revision,
    confirmation: true,
    transactionIds: [FOUND],
  });
  // Each verification carries its own idempotency key.
  expect(request.idempotencyKey).toEqual(expect.any(String));
  expect(Object.keys(request).sort()).toEqual([
    "action",
    "confirmation",
    "expectedRevision",
    "idempotencyKey",
    "transactionIds",
  ]);
  await expect(payment.getByText("Finalized transaction")).toBeVisible();
  await expect(
    payment.getByRole("link", { name: "Review your payout wallet" }),
  ).toHaveCount(0);
  await expectAccessible(page);
});
