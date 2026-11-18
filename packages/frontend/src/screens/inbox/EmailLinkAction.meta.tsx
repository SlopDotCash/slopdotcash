import { expect, fn, screen, userEvent } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { EmailLinkActionProps } from "./EmailLinkAction.tsx";

const onConfirm = fn();
const onDismiss = fn();
const onRetryCheck = fn();

export const meta: ComponentMeta<EmailLinkActionProps> = {
  args: { link: "verify", step: "ready", signInHref: "/login?next=%2Finbox", onConfirm, onDismiss, onRetryCheck },
  examples: {
    Unsubscribe: { link: "unsubscribe" },
    SignIn: { step: "signIn" },
    Checking: { step: "checking" },
    AccountChanged: { step: "recheck", error: "Wrong account for this link" },
    Invalid: { step: "invalid" },
    Verified: { step: "done" },
    WrongAccount: { error: "Wrong account for this link" },
  },
  play: {
    // spec/frontend/emailAction.md, "An email verify or unsubscribe token survives sign-in and is applied once to the signed-in account"
    Default: async () => {
      onConfirm.mockClear();
      await userEvent.click(screen.getByRole("button", { name: "Verify email" }));
      await expect(onConfirm).toHaveBeenCalledTimes(1);
    },
    // spec/frontend/emailAction.md, "An email verify or unsubscribe token survives sign-in and is applied once to the signed-in account"
    SignIn: async () => {
      await expect(screen.queryByRole("button", { name: "Verify email" })).toBeNull();
      await expect(screen.getByRole("link").getAttribute("href")).toBe("/login?next=%2Finbox");
    },
  },
};
