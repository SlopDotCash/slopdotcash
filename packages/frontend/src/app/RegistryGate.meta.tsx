import { PageHeader } from "@repo/ui";
import { expect, fn, screen, userEvent } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { registries } from "../fixtures.ts";
import type { RegistryGateProps } from "./RegistryGate.tsx";

const onRetry = fn();

export const meta: ComponentMeta<RegistryGateProps> = {
  args: {
    kind: "Points",
    freshness: registries.stale,
    onRetry,
    frame: (children, title = "Leaderboard") => (
      <main className="flex flex-col gap-4">
        <PageHeader title={title} />
        {children}
      </main>
    ),
    children: <p>Leaderboard rows</p>,
  },
  examples: {
    Loading: { freshness: undefined },
    Current: { freshness: registries.current },
    Failed: { freshness: registries.failed },
    NeedsCurrent: { kind: "ManageProject", freshness: registries.stale },
    Independent: { kind: "Inbox", freshness: registries.failed },
  },
  play: {
    // spec/frontend/registry.md, "A page that acts on a project manifest needs a current registry and other pages show the last good registry labelled stale"
    Default: async () => {
      onRetry.mockClear();
      await expect([screen.getByRole("status") !== null, screen.getByText("Leaderboard rows") !== null]).toEqual([true, true]);
      await userEvent.click(screen.getByRole("button"));
      await expect(onRetry).toHaveBeenCalledOnce();
    },
    // spec/frontend/registry.md, "A failed live registry read installs the last published registry labelled stale with its sync time, and both failing shows the error"
    Loading: async () => {
      await expect([screen.getAllByRole("status").length > 0, screen.queryByText("Leaderboard rows")]).toEqual([true, null]);
    },
    // spec/frontend/registry.md, "A failed live registry read installs the last published registry labelled stale with its sync time, and both failing shows the error"
    Failed: async () => {
      await expect([screen.getByRole("alert") !== null, screen.queryByText("Leaderboard rows")]).toEqual([true, null]);
    },
    // spec/frontend/registry.md, "A page that acts on a project manifest needs a current registry and other pages show the last good registry labelled stale"
    NeedsCurrent: async () => {
      await expect([screen.getByRole("alert") !== null, screen.queryByText("Leaderboard rows")]).toEqual([true, null]);
    },
    // spec/frontend/registry.md, "A page that acts on a project manifest needs a current registry and other pages show the last good registry labelled stale"
    Independent: async () => {
      await expect([screen.queryByRole("alert"), screen.queryByRole("status"), screen.getByText("Leaderboard rows") !== null]).toEqual([null, null, true]);
    },
  },
};
