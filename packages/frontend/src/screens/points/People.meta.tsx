import { expect, screen } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { census, current, failed, history, loading, people, stewards } from "./fixtures.ts";
import type { PeopleProps } from "./People.tsx";

export const meta: ComponentMeta<PeopleProps> = {
  args: { census: current(census), members: { kind: "read", people: current(people) }, history: current(history), stewards, query: "" },
  examples: {
    Preview: { members: { kind: "preview", site: "https://slop.cash" } },
    MembersFailed: { members: { kind: "read", people: failed() } },
    CensusLoading: { census: loading() },
    Query: { query: "eri" },
  },
  play: {
    // spec/backend/accounts.md, "Public reads show only public open members and never publish anything"
    Default: async () => {
      await expect(screen.getByText("3 people")).toBeTruthy();
      await expect(screen.getAllByText("Public member")).toHaveLength(2);
      await expect(screen.getByText("Project maintainer · Slop")).toBeTruthy();
    },
    // spec/backend/xConnection.md, "The verified X ID is reserved forever to the first GitHub identity that links it"
    Preview: async () => {
      await expect(screen.getByRole("link", { name: "View public members" })).toBeTruthy();
      await expect(screen.queryByText("Public member")).toBeNull();
    },
    // spec/backend/accounts.md, "Public reads show only public open members and never publish anything"
    MembersFailed: async () => {
      await expect(screen.getByRole("button", { name: "Retry members" })).toBeTruthy();
    },
    // spec/backend/accounts.md, "Public reads show only public open members and never publish anything"
    Query: async () => {
      await expect(screen.getByText("1 people")).toBeTruthy();
    },
  },
};
