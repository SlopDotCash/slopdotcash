import { expect, fn, screen, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { LinkReportsViewProps } from "./LinkReports.tsx";

const projects = [
  { id: "vault", name: "Vault" },
  { id: "bridge", name: "Bridge" },
];
const onVerify = fn(() => Promise.resolve({ key: "k-1", error: "Internal error", unavailable: true }));
const onRecord = fn(() => Promise.resolve({ key: null, error: null }));
const onImport = fn(() => Promise.resolve({ note: "1 imported", error: null }));
const claim = <button type="button">Link report</button>;

export const meta: ComponentMeta<LinkReportsViewProps> = {
  args: { projects, maintained: [], automatic: true, fallback: false, claim, onVerify, onRecord, onImport },
  examples: {
    Manual: { automatic: false, maintained: [projects[0]] },
    Import: { maintained: projects },
  },
  play: {
    // spec/security/forwarding.md, "A separate exact advisory read links one verified receipt to the saved case"
    Default: async () => {
      onVerify.mockClear();
      await userEvent.click(screen.getByRole("button", { name: "Link report" }));
      const verify = screen.getByRole("region", { name: "Verify a GitHub report" });
      await userEvent.type(within(verify).getByLabelText("GitHub advisory ID"), "GHSA-2c3f-4g5h-6j7m");
      await userEvent.click(within(verify).getByRole("button", { name: "Verify" }));
      await expect(onVerify).toHaveBeenCalledWith("vault", "GHSA-2c3f-4g5h-6j7m", null);
      await expect(await within(verify).findByRole("alert")).toBeVisible();
      await expect(within(verify).getByRole("button", { name: "Link report" })).toBeVisible();
    },
    // spec/security/cases.md, "A case is received once, from a Slop receipt, a verified GitHub receipt or a confirmed legacy claim"
    Manual: async () => {
      onRecord.mockClear();
      await userEvent.click(screen.getByRole("button", { name: "Link report" }));
      await expect(screen.getByRole("region", { name: "Link a GitHub report" })).toBeVisible();
      const record = screen.getByRole("region", { name: "Import" });
      await userEvent.type(within(record).getByLabelText("GitHub advisory ID"), "GHSA-3c4f-5g6h-7j8m");
      await userEvent.type(within(record).getByLabelText("Reporter ID"), "900000123");
      await userEvent.type(within(record).getByLabelText("Reporter login"), "fixture-researcher");
      await userEvent.type(within(record).getByLabelText("Received (UTC)"), "2026-10-30T14:05");
      await userEvent.click(within(record).getByRole("checkbox"));
      await userEvent.click(within(record).getByRole("button", { name: "Record" }));
      await expect(onRecord).toHaveBeenCalledWith(
        { projectId: "vault", advisory: "GHSA-3c4f-5g6h-7j8m", reporterGithubId: "900000123", reporterGithubLogin: "fixture-researcher", receivedAt: "2026-10-30T14:05", confirmation: true },
        null,
      );
    },
    // spec/security/cases.md, "A case is received once, from a Slop receipt, a verified GitHub receipt or a confirmed legacy claim"
    Import: async () => {
      onImport.mockClear();
      await userEvent.click(screen.getByRole("button", { name: "Link report" }));
      const imported = screen.getByRole("region", { name: "Import" });
      await userEvent.selectOptions(within(imported).getByLabelText("Project"), "bridge");
      await userEvent.click(within(imported).getByRole("button", { name: "Import from GitHub" }));
      await expect(onImport).toHaveBeenCalledWith("bridge");
      await expect(await within(imported).findByRole("status")).toBeVisible();
    },
  },
};
