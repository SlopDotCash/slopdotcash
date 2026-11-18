import { expect, screen } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { nameOf, shares, transfers } from "./fixtures.ts";
import type { ProfilePaymentsProps } from "./ProfilePayments.tsx";

export const meta: ComponentMeta<ProfilePaymentsProps> = {
  args: {
    cycles: shares,
    githubId: "1001",
    direct: { status: "Current", value: transfers },
    vault: { status: "Empty", value: [] },
    nameOf,
    nowMs: Date.parse("2026-11-17T12:00:00.000Z"),
    tier: "production",
  },
  examples: {
    NoIdentity: { githubId: undefined, direct: { status: "Idle", value: undefined }, vault: { status: "Idle", value: undefined } },
    DirectFailed: { direct: { status: "Failed", value: undefined, onRetry: () => undefined } },
    Nothing: { cycles: [], direct: { status: "Empty", value: [] } },
  },
  play: {
    // spec/frontend/projections.md, "Ordinary public payment rows require finalized evidence and a public account"
    Default: async () => {
      await expect(screen.getByText("$250")).toBeTruthy();
      await expect(screen.getAllByRole("listitem")).toHaveLength(2);
    },
    // spec/frontend/projections.md, "Ordinary public payment rows require finalized evidence and a public account"
    NoIdentity: async () => {
      await expect([screen.getByRole("img", { name: "Unavailable" }), screen.queryByRole("button")]).toEqual([expect.anything(), null]);
    },
    // spec/frontend/projections.md, "Ordinary public payment rows require finalized evidence and a public account"
    DirectFailed: async () => {
      await expect([screen.getByRole("button", { name: "Retry payment records" }), screen.getByRole("img", { name: "Unavailable" })]).toEqual([expect.anything(), expect.anything()]);
    },
    // spec/frontend/projections.md, "Ordinary public payment rows require finalized evidence and a public account"
    Nothing: async () => {
      await expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    },
  },
};
