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
    Current: { freshness: registries.current },
    Failed: { freshness: registries.failed },
    NeedsCurrent: { kind: "ManageProject", freshness: registries.stale },
    Independent: { kind: "Inbox", freshness: registries.failed },
  },
  play: {
    // spec/frontend/registry.md, "A page that acts on a project manifest needs a current registry and other pages show the last good registry labelled stale"
    Default: async () => {
      onRetry.mockClear();
      await expect([screen.getByRole("status").textContent, screen.getByText("Leaderboard rows") !== null]).toEqual(["Projects may be outdated · updated Nov 15, 2026, 09:30 UTC.Try again", true]);
      await userEvent.click(screen.getByRole("button", { name: "Try again" }));
      await expect(onRetry).toHaveBeenCalledOnce();
    },
    // spec/frontend/registry.md, "A failed live registry read installs the last published registry labelled stale with its sync time, and both failing shows the error"
    Failed: async () => {
      await expect([screen.getByRole("heading").textContent, screen.getByRole("alert").textContent, screen.queryByText("Leaderboard rows")]).toEqual(["Projects are unavailable", "Project data could not load.Try again", null]);
    },
    // spec/frontend/registry.md, "A page that acts on a project manifest needs a current registry and other pages show the last good registry labelled stale"
    NeedsCurrent: async () => {
      await expect(screen.getByRole("alert").textContent).toBe("This page needs current project data.Try again");
    },
    // spec/frontend/registry.md, "A page that acts on a project manifest needs a current registry and other pages show the last good registry labelled stale"
    Independent: async () => {
      await expect([screen.queryByRole("alert"), screen.queryByRole("status"), screen.getByText("Leaderboard rows") !== null]).toEqual([null, null, true]);
    },
  },
};
