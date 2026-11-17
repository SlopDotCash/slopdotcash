// spec/frontend/views.md, "A project card shows one reward variant per registry policy, and a paid bounty-only program replaces ordinary work on cards"; spec/frontend/projections.md, "Pool funding is Funded, Withdrawn or points only"
import { Arbitrary } from "effect";
import { contract } from "vibestack/testing";
import type { PoolDisplay } from "../../../gen/frontend__projections.ts";
import { hasProjectCardBounty, type SecurityProgramStatus } from "../../kernels/rewardSummary.ts";
import { vectors } from "../../kernels/vectors.ts";
import { bounty, community, mergeLine, pool, prize } from "./fixtures.ts";
import { cardLine, cardNotes, type ListedProject } from "./listing.ts";

const separateBounty = (status: SecurityProgramStatus): ListedProject => ({
  ...community[0]!,
  securityBounty: { rewardMode: "separate", status, eligibility: "in-scope-security", amount: { grossMinor: 50_000_000_000n, decimals: 6 }, funding: { state: "verified" } },
});

export const cardsHeadlineOnlyAnOpenOfferOrAFundedPool = vectors<ListedProject, ReturnType<typeof cardLine>>([
  [pool, { amount: "$5,000/mo" }],
  [{ ...pool, pool: "PoolWithdrawn" }, { amount: "Points only" }],
  [{ ...pool, pool: "PointsOnly" }, { amount: "Points only" }],
  [bounty, { amount: "$50k / Critical", state: "Funding verified" }],
  [prize, { amount: "$25k + points", state: "External prize" }],
  [community[0]!, { amount: "Points only" }],
  [separateBounty("open"), { amount: "$50k / Finding", state: "Funding verified" }],
  [separateBounty("paused"), { amount: "Points only" }],
  [separateBounty("closed"), { amount: "Points only" }],
  [separateBounty("draft"), { amount: "Points only" }],
], cardLine);

export const cardNotesKeepStateThenMergeActivity = vectors<ListedProject, string[]>([
  [pool, ["Last merge 2 days ago · 3 outside PRs waiting 7+ days"]],
  [bounty, ["Funding verified"]],
  [prize, ["External prize"]],
], (project) => cardNotes(project, mergeLine(project)));

const statuses: ReadonlyArray<SecurityProgramStatus> = ["draft", "pending-approval", "open", "paused", "closed"];
const displays: ReadonlyArray<PoolDisplay> = ["PoolFunded", "PoolWithdrawn", "PointsOnly"];
const policies: ReadonlyArray<ListedProject> = [pool, bounty, prize, ...statuses.map(separateBounty)].flatMap((project) => displays.map((display) => ({ ...project, pool: display })));

export const aCardNamesABountyOnlyWhenItIsTheOpenOfferAndAnAmountOnlyWhenFunded = contract({
  input: Arbitrary.Constant(policies),
  run: (projects) => projects.map(cardLine),
  deterministic: true,
  invariant: (projects, lines) =>
    projects.every((project, index) => {
      const { amount } = lines[index]!;
      return (!/ \/ (Critical|Finding)$/u.test(amount) || hasProjectCardBounty(project)) && (!amount.endsWith("/mo") || project.pool === "PoolFunded");
    }),
});
