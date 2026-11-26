import { expect, fn, screen, userEvent } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { attempts } from "./fixtures.ts";
import type { JoinPointsProps } from "./JoinPoints.tsx";

const onStart = fn();

export const meta: ComponentMeta<JoinPointsProps> = {
  args: { session: "signedOut", attempt: attempts.idle, onStart },
  examples: {
    Checking: { session: "checking" },
    SessionFailed: { session: "failed" },
    Waiting: { attempt: attempts.waiting },
    Closed: { attempt: attempts.closed },
    Blocked: { attempt: attempts.blocked },
    Elsewhere: { elsewhere: { href: "https://slop.cash/login?next=%2Faccount", host: "slop.cash" } },
  },
  play: {
    // spec/backend/accounts.md, "A web sign-in consumes one web assertion and opens a public membership"
    Default: async () => {
      onStart.mockClear();
      await userEvent.click(screen.getByRole("button", { name: "Continue with GitHub" }));
      await expect(onStart).toHaveBeenCalledWith(false);
    },
    // spec/backend/accounts.md, "An ordinary sign-in cannot reopen a closed account; explicit reopening can"
    Closed: async () => {
      onStart.mockClear();
      await userEvent.click(screen.getByRole("button", { name: "Reopen account" }));
      await expect(onStart).toHaveBeenCalledWith(true);
    },
    // spec/backend/accounts.md, "A web sign-in consumes one web assertion and opens a public membership"
    Waiting: async () => {
      onStart.mockClear();
      await expect(screen.getByRole("button", { name: "Waiting for GitHub…" })).toHaveAttribute("aria-disabled", "true");
      await expect(onStart).not.toHaveBeenCalled();
    },
    // spec/frontend/composition.md, "Sign-in keeps only a safe same-origin return destination"
    Elsewhere: async () => {
      await expect(screen.getByRole("link", { name: "Continue with GitHub on slop.cash" }).getAttribute("href")).toBe("https://slop.cash/login?next=%2Faccount");
    },
  },
};
