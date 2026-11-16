import { deriveAllocationFundingBasis } from "../../src/lib/allocation-funding";
import { PROJECTS, type ProjectDefinition } from "../../src/lib/projects.mjs";
import { archivedPaidCycleIndex } from "../fixtures";
import { expect, expectAccessible, test } from "./fixtures";

function fixtureProject(id: string): ProjectDefinition {
  const project = PROJECTS.find((entry) => entry.id === id);
  if (!project) throw new Error(`Missing fixture project ${id}`);
  return project;
}

/** The shared July paid cycle, with the fee of the current project policy. */
function paidJulyCycle(project: ProjectDefinition) {
  const [cycle] = archivedPaidCycleIndex().cycles;
  return {
    ...cycle,
    reward: {
      ...cycle.reward,
      feeMinor: (
        (BigInt(cycle.reward.approvedMinor) *
          BigInt(project.reward.feeBasisPoints)) /
        10_000n
      ).toString(),
    },
  };
}

/** A closed month without awards under the project's frozen funding basis. */
function closedCycle(project: ProjectDefinition, month: string) {
  const [year, number] = month.split("-").map(Number);
  const from = Math.max(
    Date.UTC(year, number - 1, 1),
    Date.parse(project.reward.rewardStartAt),
  );
  const to = Date.UTC(year, number, 1);
  const prefix = `/data/cycles/${project.id}/${month}`;
  return {
    ...archivedPaidCycleIndex().cycles[0],
    projectId: project.id,
    cycleId: month,
    state: "closed-no-awards" as const,
    generatedAt: new Date(to + 86_400_000).toISOString(),
    contributionWindow: {
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
    },
    reviewEndsAt: null,
    approvedAt: null,
    settledAt: null,
    reward: {
      currency: "USDC",
      capMinor: "0",
      suggestedMinor: "0",
      approvedMinor: "0",
      paidMinor: "0",
      feeMinor: "0",
      sharePartsPerMillion: null,
      fundingBasis: deriveAllocationFundingBasis(project, month),
    },
    contributors: [],
    files: {
      sourceSnapshot: {
        sha256: "a".repeat(64),
        url: `${prefix}/source-snapshot.json`,
      },
      proposal: { sha256: "a".repeat(64), url: `${prefix}/proposal.json` },
      allocation: null,
      executionPlan: null,
      settlement: null,
      windup: null,
    },
  };
}

test("archive filters narrow published cycles and Clear filters restores them", async ({
  page,
  diagnostics,
}, info) => {
  diagnostics.allowPreviewApiMisses();
  diagnostics.allowCanceledBackgroundReads();
  const eliza = fixtureProject("eliza");
  const other = fixtureProject("asi");
  const index = archivedPaidCycleIndex();
  // Canonical order: newest month first, then project id.
  index.cycles = [
    closedCycle(other, "2026-10"),
    closedCycle(eliza, "2026-10"),
    paidJulyCycle(eliza),
  ] as typeof index.cycles;
  await page.route("**/data/cycles/index.json?**", (route) =>
    route.fulfill({ json: index }),
  );
  await page.goto("/cycles", { waitUntil: "networkidle" });
  const count = page.locator(".cycle-filters").getByRole("status");
  const records = page.locator(".cycle-records article.cycle-record");
  const project = page.getByRole("combobox", { name: "Project", exact: true });
  const month = page.getByRole("combobox", { name: "Month", exact: true });
  const state = page.getByRole("combobox", { name: "State", exact: true });
  await expect(count).toHaveText("3 of 3 cycles");
  await expect(records).toHaveCount(3);

  await project.selectOption(eliza.id);
  await expect(count).toHaveText("2 of 3 cycles");
  await expect(records).toHaveCount(2);
  await expect(page).toHaveURL(`/cycles?project=${eliza.id}`);
  await state.selectOption("paid");
  await expect(count).toHaveText("1 of 3 cycles");
  await expect(
    records.getByRole("link", { name: new RegExp(`^${eliza.name} · `, "u") }),
  ).toHaveAttribute("href", `/cycles/${eliza.id}/2026-07`);
  await expect(page).toHaveURL(`/cycles?project=${eliza.id}&state=paid`);

  // No paid October cycle exists, so the page offers to clear the filters.
  await month.selectOption("2026-10");
  await expect(count).toHaveText("0 of 3 cycles");
  await expect(records).toHaveCount(0);
  await expect(
    page.getByText("No cycles match these filters.", { exact: false }),
  ).toBeVisible();
  await expect(page).toHaveURL(
    `/cycles?project=${eliza.id}&state=paid&month=2026-10`,
  );
  await expectAccessible(page);
  await page.screenshot({
    path: info.outputPath("no-matching-cycles.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expect(count).toHaveText("3 of 3 cycles");
  await expect(records).toHaveCount(3);
  await expect(project).toHaveValue("");
  await expect(month).toHaveValue("");
  await expect(state).toHaveValue("");
  await expect(page).toHaveURL("/cycles");
  await expect(
    page.getByRole("button", { name: "Clear filters", exact: true }),
  ).toHaveCount(0);

  // A filtered address restores the same selection after a reload.
  await month.selectOption("2026-10");
  await page.reload({ waitUntil: "networkidle" });
  await expect(month).toHaveValue("2026-10");
  await expect(count).toHaveText("2 of 3 cycles");
  await expectAccessible(page);
});
