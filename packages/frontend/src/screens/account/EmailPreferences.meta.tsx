import { expect, fn, screen, userEvent } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { EmailPreferencesProps } from "./EmailPreferences.tsx";
import { email } from "./fixtures.ts";

const onToggle = fn();
const onEdit = fn();
const onRequest = fn();
const onRetry = fn();

export const meta: ComponentMeta<EmailPreferencesProps> = {
  args: { panel: email.verified, signInHref: "/login?next=%2Faccount%23notifications", onToggle, onEdit, onRequest, onRetry },
  examples: {
    Unverified: { panel: email.unverified },
    Pending: { panel: email.pending },
    Unavailable: { panel: email.unavailable },
    Loading: { panel: email.loading },
    Failed: { panel: email.failed },
    SignedOut: { panel: email.signedOut },
    DestinationChanged: { panel: email.changed },
  },
  play: {
    // spec/backend/email.md, "Consent changes are compare-and-set and enabling binds the exact destination version"
    Default: async () => {
      onToggle.mockClear();
      await userEvent.click(screen.getByRole("switch", { name: "Security email" }));
      await expect(onToggle).toHaveBeenCalledWith("securityEnabled");
    },
    // spec/backend/email.md, "A verification request records the requested consent and is idempotent per request key"
    Unverified: async () => {
      onRequest.mockClear();
      await expect(screen.queryByRole("switch")).toBeNull();
      await userEvent.type(screen.getByRole("textbox", { name: "Email address" }), "octocat@example.com");
      await userEvent.click(screen.getByRole("checkbox", { name: "Activity email" }));
      await userEvent.click(screen.getByRole("button", { name: "Send verification" }));
      await expect(onRequest).toHaveBeenCalledWith({ email: "octocat@example.com", enabled: true, securityEnabled: false });
    },
    // spec/backend/email.md, "Consent changes are compare-and-set and enabling binds the exact destination version"
    Unavailable: async () => {
      onToggle.mockClear();
      await userEvent.click(screen.getByRole("switch", { name: "Activity email" }));
      await expect(onToggle).not.toHaveBeenCalled();
    },
    // spec/backend/email.md, "Consent changes are compare-and-set and enabling binds the exact destination version"
    DestinationChanged: async () => {
      await expect(screen.getByRole("alert").textContent).toBe("Your verified destination changed. Review it before turning on email.");
    },
  },
};
