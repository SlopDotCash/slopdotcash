import { expect, screen } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { census, current, failed, loading, people, stewards } from "./fixtures.ts";
import type { PeopleProps } from "./People.tsx";

export const meta: ComponentMeta<PeopleProps> = {
  args: { census: current(census), members: { kind: "read", people: current(people) }, stewards, query: "" },
  examples: {
    Preview: { members: { kind: "preview", site: "https://slop.cash" } },
    MembersFailed: { members: { kind: "read", people: failed() } },
    CensusLoading: { census: loading() },
    Query: { query: "eri" },
  },
  play: {
    // spec/backend/accounts.md, "Public reads show only public open members and never publish anything"
    Default: async () => {
      await expect(screen.getAllByRole("listitem")).toHaveLength(3);
    },
    // spec/backend/xConnection.md, "The verified X ID is reserved forever to the first GitHub identity that links it"
    Preview: async () => {
      await expect(screen.getAllByRole("link").filter((link) => link.getAttribute("href") === "https://slop.cash/points#people")).toHaveLength(1);
    },
    // spec/backend/accounts.md, "Public reads show only public open members and never publish anything"
    MembersFailed: async () => {
      await expect(screen.getByRole("button", { name: "Retry members" })).toBeTruthy();
    },
    // spec/backend/accounts.md, "Public reads show only public open members and never publish anything"
    Query: async () => {
      await expect(screen.getAllByRole("listitem")).toHaveLength(1);
    },
  },
};
