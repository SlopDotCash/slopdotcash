import { expect, fn, screen, userEvent, waitFor } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { type AccountMenuProps, AccountMenuItem } from "./AccountMenu.tsx";

const onSignOut = fn();

/** Waits until the menu has closed. */
const closed = () => waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

/** Opens the menu from its trigger with the keyboard and returns the trigger. */
const open = async () => {
  const trigger = screen.getByRole("button", { name: /octocat/ });
  trigger.focus();
  await userEvent.keyboard("{Enter}");
  await screen.findByRole("menu");
  return trigger;
};

export const meta: ComponentMeta<AccountMenuProps> = {
  args: {
    login: "octocat",
    onSignOut,
    points: "1,240 points",
    children: ["Settings", "Payouts", "Inbox"].map((page) => (
      <AccountMenuItem key={page} asChild>
        <a href={`#${page.toLowerCase()}`}>{page}</a>
      </AccountMenuItem>
    )),
  },
  play: {
    // spec/frontend/presentation.md, "Settings keeps wallet and email controls expanded without account navigation tabs"
    // spec/frontend/navigation.md, "Navigation gates private destinations on a signed-in account"
    Default: async () => {
      onSignOut.mockClear();
      const trigger = await open();
      await expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Settings", "Payouts", "Inbox", "Sign out"]);
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect([screen.queryByRole("menu"), document.activeElement]).toEqual([null, trigger]));
      await open();
      await userEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
      await closed();
      await expect(onSignOut).toHaveBeenCalledOnce();
    },
    // spec/ui/controls.md, "A disabled or busy control refuses activation and stays named"
    Loading: async () => {
      onSignOut.mockClear();
      await open();
      const item = screen.getByRole("menuitem", { name: "Sign out" });
      await userEvent.click(item);
      await expect([item.getAttribute("aria-busy"), screen.queryByRole("menu") !== null]).toEqual(["true", true]);
      await expect(onSignOut).not.toHaveBeenCalled();
      await userEvent.keyboard("{Escape}");
      await closed();
    },
  },
};
