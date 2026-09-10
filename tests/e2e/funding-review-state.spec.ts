/** State regressions use generated public artifacts. Competing preparations are
 * explicitly test-only; the published July proposal and its wallet are unchanged. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  type APIRequestContext,
  expect,
  type Page,
  test,
} from "@playwright/test";
import { assertCycleIndex, type CycleIndex } from "../../src/lib/cycle-index";
import { displayUsdc } from "../../src/lib/funding-review";
import {
  assertFundingPreparation,
  assertFundingReviewIndex,
  createFundingReview,
  type FundingReviewIndex,
} from "../../src/lib/funding-review-data";
import { assertLeaderboardSnapshot } from "../../src/lib/leaderboard";

const digest = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

async function generatedData(request: APIRequestContext) {
  const [reviewResponse, cycleResponse, snapshotResponse] = await Promise.all([
    request.get("/data/funding-reviews.json"),
    request.get("/data/cycles/index.json"),
    request.get("/data/leaderboard.json"),
  ]);
  for (const response of [reviewResponse, cycleResponse, snapshotResponse])
    expect(response.ok(), `Generated artifact missing: ${response.url()}`).toBe(
      true,
    );
  const reviews = assertFundingReviewIndex(await reviewResponse.json());
  const cycles: unknown = await cycleResponse.json();
  assertCycleIndex(cycles);
  assertLeaderboardSnapshot(await snapshotResponse.json());
  const august = reviews.reviews.find(
    (r) => r.projectId === "eliza" && r.cycleId === "2026-08",
  );
  const july = cycles.cycles.find(
    (c) => c.projectId === "eliza" && c.cycleId === "2026-07",
  );
  if (!august || !july)
    throw new Error(
      "Generate August preparation and the existing July cycle before this suite",
    );
  expect(
    cycles.cycles.some(
      (c) => c.projectId === "eliza" && c.cycleId === august.cycleId,
    ),
  ).toBe(false);
  return { reviews, cycles, august, july };
}

async function routeIndexes(
  page: Page,
  reviews: FundingReviewIndex,
  cycles: CycleIndex,
) {
  await page.route("**/data/funding-reviews.json*", (route) =>
    route.fulfill({ json: reviews }),
  );
  await page.route("**/data/cycles/index.json*", (route) =>
    route.fulfill({ json: cycles }),
  );
}

async function downloadedReview(page: Page) {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page
      .locator(".funding-workbench")
      .getByRole("button", { name: "Download review", exact: true })
      .click(),
  ]);
  const path = await download.path();
  if (!path) throw new Error("Review download has no readable file");
  return JSON.parse(await readFile(path, "utf8")) as {
    cycleId: string;
    sourceSnapshotSha256: string;
    rows: { actor: { id: string }; proposedMinor: string; reason: string }[];
  };
}

test("published July proposal overrides competing preparation amounts and locks its exact wallet proof", async ({
  page,
  request,
}) => {
  const { reviews, cycles, august, july } = await generatedData(request);
  const locked = july.contributors.find(
    (r) =>
      r.wallet && august.contributors.some((a) => a.actor.id === r.actor.id),
  );
  if (!locked?.wallet)
    throw new Error(
      "Expected existing July wallet proof shared with the August census",
    );
  // Verify real public source bytes, without manufacturing an approved/paid cycle.
  for (const reference of [july.files.proposal, july.files.sourceSnapshot]) {
    const response = await request.get(reference.url);
    expect(response.ok()).toBe(true);
    expect(digest(await response.body())).toBe(reference.sha256);
  }
  const proposalResponse = await request.get(july.files.proposal.url);
  const proposal = await proposalResponse.json();
  expect(proposal.status).toBe("proposed");
  expect(
    proposal.allocations.find(
      (r: { actor: { id: string } }) => r.actor.id === locked.actor.id,
    ).wallet,
  ).toEqual(locked.wallet);

  // Deliberately competing preparation, routed only in this test. It claims no
  // approval, has no locked destination, and cannot supersede the real proposal.
  const {
    status: _status,
    paymentAuthorized: _payment,
    proposalPublished: _published,
    rewardKind: _kind,
    capMinor: _cap,
    ...base
  } = august;
  const competing = createFundingReview(
    assertFundingPreparation({
      ...base,
      cycleId: july.cycleId,
      sourceSnapshotSha256: digest("test-only competing July preparation"),
      provenance: {
        ...base.provenance,
        snapshotFrom: "2026-07-01T00:00:00.000Z",
        snapshotTo: "2026-08-01T00:00:00.000Z",
        periodFrom: july.contributionWindow.from,
        periodTo: "2026-08-01T00:00:00.000Z",
      },
      contributors: base.contributors.map(
        ({
          simulatedMinor: _minor,
          externalSharePartsPerMillion: _share,
          ...row
        }) => ({ ...row, wallet: null, lookupUnavailable: false }),
      ),
    }),
  );
  expect(
    competing.contributors.find((r) => r.actor.id === locked.actor.id)
      ?.simulatedMinor,
  ).not.toBe(locked.suggestedMinor);
  const fixture = assertFundingReviewIndex({
    ...reviews,
    reviews: [...reviews.reviews, competing],
  });
  await routeIndexes(page, fixture, cycles);
  await page.goto("/projects/eliza/funding");
  const panel = page.locator(".funding-workbench");
  await panel.getByLabel("Contribution month").selectOption(july.cycleId);
  await expect(panel).toContainText("Published cycle records are shown below");
  await panel.getByLabel("Find contributor").fill(locked.actor.login);
  const row = panel.locator("tbody tr").filter({
    has: page.getByRole("link", { name: locked.actor.login, exact: true }),
  });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(`Locked for ${july.cycleId}`);
  await expect(row.locator(".wallet-address")).toHaveText(
    locked.wallet.address,
  );
  await expect(
    row.getByRole("link", { name: "Registered · view proof" }),
  ).toHaveAttribute("href", locked.wallet.sourceUrl);
  await expect(
    row.getByRole("link", { name: "View locked proposal" }),
  ).toHaveAttribute("href", july.files.proposal.url);
  await expect(
    row.getByLabel(`USDC for ${locked.actor.login}`, { exact: true }),
  ).toHaveValue(displayUsdc(locked.suggestedMinor));
  await expect(row).not.toContainText("Missing registration");
});

test("failed cycle fetch keeps preparation visible but disables review download and local save", async ({
  page,
  request,
}) => {
  const { reviews, cycles, august } = await generatedData(request);
  await routeIndexes(page, reviews, cycles);
  // Registered last so every initial fetch and retry fails, rather than silently
  // restoring an empty cycle index that would make preparation appear editable.
  await page.route("**/data/cycles/index.json*", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Test-only cycle service unavailable" },
    }),
  );
  await page.goto("/projects/eliza/funding");
  const panel = page.locator(".funding-workbench");
  await expect(panel.getByLabel("Contribution month")).toHaveValue(
    august.cycleId,
  );
  await expect(panel.locator("tbody tr")).toHaveCount(
    august.contributors.length,
  );
  await expect(panel).toContainText("Published cycle state is unavailable");
  await expect(panel).toContainText("Lock status unavailable");
  await expect(
    panel.getByRole("button", { name: "Download review", exact: true }),
  ).toBeDisabled();
  await expect(
    panel.getByRole("button", {
      name: "Save draft on this device",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(panel).not.toContainText("Not locked");
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((k) =>
        k.startsWith("slop:funding-review:"),
      ),
    ),
  ).toEqual([]);
});

test("switching contribution months clears the previous amount, reason and invalid-input state", async ({
  page,
  request,
}) => {
  const { reviews, cycles, august, july } = await generatedData(request);
  const actor = august.contributors.find(
    (r) =>
      BigInt(r.simulatedMinor ?? "0") > 1n &&
      july.contributors.some((j) => j.actor.id === r.actor.id),
  );
  if (!actor?.simulatedMinor)
    throw new Error("Expected contributor present in both generated months");
  const previous = july.contributors.find((r) => r.actor.id === actor.actor.id);
  if (!previous) throw new Error("Missing July contributor");
  await routeIndexes(page, reviews, cycles);
  await page.goto("/projects/eliza/funding");
  const panel = page.locator(".funding-workbench");
  await expect(panel.getByLabel("Contribution month")).toHaveValue(
    august.cycleId,
  );
  await panel.getByLabel("Find contributor").fill(actor.actor.login);
  const amount = panel.getByLabel(`USDC for ${actor.actor.login}`, {
    exact: true,
  });
  const reason = panel.getByLabel(`Reason for ${actor.actor.login}`, {
    exact: true,
  });
  await amount.fill("0.000001");
  await reason.fill("Test-only unsaved reduction");
  await expect(
    panel.getByRole("button", { name: "Download review", exact: true }),
  ).toBeEnabled();
  await amount.fill("1e8");
  await expect(
    panel.getByRole("button", { name: "Download review", exact: true }),
  ).toBeDisabled();
  await panel.getByLabel("Contribution month").selectOption(july.cycleId);
  await expect(amount).toHaveValue(displayUsdc(previous.suggestedMinor));
  await expect(reason).toHaveValue("");
  await panel.getByLabel("Contribution month").selectOption(august.cycleId);
  await expect(amount).toHaveValue(displayUsdc(actor.simulatedMinor));
  await expect(reason).toHaveValue("");
  await expect(
    panel.getByRole("button", { name: "Download review", exact: true }),
  ).toBeEnabled();
  const exported = await downloadedReview(page);
  expect(exported.cycleId).toBe(august.cycleId);
  expect(exported.sourceSnapshotSha256).toBe(august.sourceSnapshotSha256);
  expect(
    exported.rows.find((r) => r.actor.id === actor.actor.id),
  ).toMatchObject({ proposedMinor: actor.simulatedMinor, reason: "" });
});

test("saved drafts restore only for the exact project, month, source and budget", async ({
  page,
  request,
}) => {
  const { reviews, cycles, august } = await generatedData(request);
  const actor = august.contributors.find(
    (r) => BigInt(r.simulatedMinor ?? "0") > 1n,
  );
  if (!actor?.simulatedMinor)
    throw new Error("Expected positive preparation allocation");
  let currentReviews = reviews;
  await routeIndexes(page, reviews, cycles);
  await page.route("**/data/funding-reviews.json*", (route) =>
    route.fulfill({ json: currentReviews }),
  );
  await page.goto("/projects/eliza/funding");
  const panel = page.locator(".funding-workbench");
  await expect(panel.getByLabel("Contribution month")).toHaveValue(
    august.cycleId,
  );
  await panel.getByLabel("Find contributor").fill(actor.actor.login);
  const amount = panel.getByLabel(`USDC for ${actor.actor.login}`, {
    exact: true,
  });
  const reason = panel.getByLabel(`Reason for ${actor.actor.login}`, {
    exact: true,
  });
  await amount.fill("0.000001");
  await reason.fill("Test-only saved reduction");
  await panel
    .getByRole("button", { name: "Save draft on this device", exact: true })
    .click();
  await expect(panel).toContainText("Draft saved on this device");
  const key = `slop:funding-review:eliza:${august.cycleId}:${august.sourceSnapshotSha256}:${august.capMinor}`;
  const saved = await page.evaluate((k) => localStorage.getItem(k), key);
  expect(saved).not.toBeNull();

  await page.reload();
  await expect(panel).toContainText(
    "Saved draft restored for this exact source and budget",
  );
  await panel.getByLabel("Find contributor").fill(actor.actor.login);
  await expect(amount).toHaveValue("0.000001");
  await expect(reason).toHaveValue("Test-only saved reduction");
  const restored = await downloadedReview(page);
  expect(restored.sourceSnapshotSha256).toBe(august.sourceSnapshotSha256);
  expect(
    restored.rows.find((r) => r.actor.id === actor.actor.id)?.proposedMinor,
  ).toBe("1");

  // Same contributor/month/cap, different source: the previous local edit must
  // not attach itself to a replacement snapshot. The old draft remains intact.
  const replacementSha = digest(
    `test-only replacement:${august.sourceSnapshotSha256}`,
  );
  currentReviews = assertFundingReviewIndex({
    ...reviews,
    reviews: reviews.reviews.map((r) =>
      r === august ? { ...r, sourceSnapshotSha256: replacementSha } : r,
    ),
  });
  await page.reload();
  await expect(panel.getByLabel("Contribution month")).toHaveValue(
    august.cycleId,
  );
  await panel.getByLabel("Find contributor").fill(actor.actor.login);
  await expect(amount).toHaveValue(displayUsdc(actor.simulatedMinor));
  await expect(reason).toHaveValue("");
  await expect(panel).not.toContainText("Saved draft restored");
  const fresh = await downloadedReview(page);
  expect(fresh.sourceSnapshotSha256).toBe(replacementSha);
  expect(
    fresh.rows.find((r) => r.actor.id === actor.actor.id)?.proposedMinor,
  ).toBe(actor.simulatedMinor);
  expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBe(saved);
});
