// spec/frontend/views.md, "Recent Points sum each UTC day of the last days including today"; spec/frontend/projections.md, "Ordinary public payment rows require finalized evidence and a public account"
import type { DirectTransfer } from "@repo/settlement/client";
import { paidCycle } from "../cycles/fixtures.ts";
import type { CycleShare, MembershipFacts } from "./profile.ts";

export const aliceMember: MembershipFacts = { actor: { id: "U_kgDOAAAD6Q", login: "alice" }, welcome: 5, socialPoints: 10 };

export const shares: ReadonlyArray<CycleShare> = paidCycle.contributors.filter((contributor) => contributor.actor.login === "alice").map((contributor) => ({ contributor, cycle: paidCycle }));

export const transfers: ReadonlyArray<DirectTransfer> = [
  {
    projectId: "slop",
    contributionMonth: "2026-09",
    githubUserId: "1001",
    login: "alice",
    network: "base-mainnet",
    chain: "base",
    recipient: "0x00000000000000000000000000000000000a11ce",
    amountMicro: "50000000",
    transactionId: "0x" + "c".repeat(64),
    blockTime: "2026-10-03T00:00:00.000Z",
  },
];

export const nameOf = (projectId: string): string | undefined => (projectId === "slop" ? "Slop" : undefined);
