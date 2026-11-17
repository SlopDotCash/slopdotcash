import { expect, screen } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { loginHref, sessions } from "../fixtures.ts";
import type { SignInPanelProps } from "./SignInPanel.tsx";

export const meta: ComponentMeta<SignInPanelProps> = {
  args: { view: sessions.signedOut, href: loginHref },
  examples: { Checking: { view: sessions.checking }, Failed: { view: sessions.failed }, Purpose: { view: sessions.failed, purpose: "Sign in to see your security cases." } },
  play: {
    // spec/frontend/navigation.md, "A signed-out private destination keeps its URL and shows sign-in in place with private reads disabled"
    Default: async () => {
      await expect(screen.getByRole("link", { name: "Sign in with GitHub" }).getAttribute("href")).toBe(loginHref);
    },
    // spec/frontend/navigation.md, "A signed-out private destination keeps its URL and shows sign-in in place with private reads disabled"
    Failed: async () => {
      await expect([screen.getByRole("alert").textContent, screen.getByRole("link").textContent]).toEqual([sessions.failed.message, "Sign in with GitHub"]);
    },
    // spec/frontend/navigation.md, "A signed-out private destination keeps its URL and shows sign-in in place with private reads disabled"
    Purpose: async () => {
      await expect([screen.getByText("Sign in to see your security cases.").tagName, screen.getByRole("alert").textContent]).toEqual(["P", sessions.failed.message]);
    },
    // spec/frontend/navigation.md, "A signed-out private destination keeps its URL and shows sign-in in place with private reads disabled"
    Checking: async () => {
      await expect([screen.getByText("Checking sign-in…").getAttribute("aria-live"), screen.queryByRole("link")]).toEqual(["polite", null]);
    },
  },
};
