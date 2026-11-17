import { expect, fn, screen, userEvent } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { loginHref, sessions } from "../fixtures.ts";
import type { AccountControlProps } from "./AccountControl.tsx";

const onSignOut = fn();

const menuItems = async (login: string) => {
  const trigger = screen.getByRole("button", { name: new RegExp(login) });
  trigger.focus();
  await userEvent.keyboard("{Enter}");
  await screen.findByRole("menu");
  return screen.getAllByRole("menuitem").map((item) => item.textContent);
};

export const meta: ComponentMeta<AccountControlProps> = {
  args: { view: sessions.member, loginHref, onLoginPage: false, signingOut: false, signOutFailed: false, onSignOut },
  examples: {
    Admin: { view: sessions.admin },
    SignedOut: { view: sessions.signedOut },
    OnLoginPage: { view: sessions.signedOut, onLoginPage: true },
    Checking: { view: sessions.checking },
    SignOutFailed: { signOutFailed: true },
    SigningOut: { signingOut: true },
  },
  play: {
    // spec/frontend/presentation.md, "Settings keeps wallet and email controls expanded without account navigation tabs"; spec/backend/accounts.md, "Sign-out ends only the caller's session and revocation never reaches another account"
    Default: async () => {
      onSignOut.mockClear();
      await expect(await menuItems("octocat")).toEqual(["View profile", "Inbox", "Payouts", "Settings", "Sign out"]);
      await userEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
      await expect(onSignOut).toHaveBeenCalledOnce();
    },
    // spec/frontend/navigation.md, "Navigation gates private destinations on a signed-in account"
    Admin: async () => {
      await expect(await menuItems("hubot")).toEqual(["View profile", "Inbox", "Payouts", "Settings", "Admin", "Sign out"]);
      await userEvent.keyboard("{Escape}");
    },
    // spec/frontend/composition.md, "Sign-in keeps only a safe same-origin return destination"
    SignedOut: async () => {
      await expect(screen.getByRole("link", { name: "Log in" }).getAttribute("href")).toBe(loginHref);
    },
    // spec/frontend/composition.md, "Sign-in keeps only a safe same-origin return destination"
    OnLoginPage: async () => {
      await expect(screen.queryByRole("link", { name: "Log in" })).toBeNull();
    },
  },
};
