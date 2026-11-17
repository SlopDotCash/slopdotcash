import { expect, fn, screen, userEvent } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { caseRecord, submissions } from "./fixtures.ts";
import type { SubmissionsPanelProps } from "./SubmissionsPanel.tsx";

const onRefresh = fn();
const listed = [submissions.verified, submissions.received, submissions.abandoned, submissions.needsInformation];

export const meta: ComponentMeta<SubmissionsPanelProps> = {
  args: {
    list: { status: "ready", submissions: listed, authorityUnavailable: false, refreshError: null },
    cases: [caseRecord],
    focusId: null,
    grantError: null,
    onRefresh,
    entry: (submission) => <p>{submission.id}</p>,
  },
  examples: {
    Linked: { focusId: submissions.abandoned.id },
    Loading: { list: { status: "loading" } },
    Failed: { list: { status: "failed", message: "Your private session could not be verified. Retry before viewing reports." } },
    Empty: { list: { status: "ready", submissions: [], authorityUnavailable: false, refreshError: null }, cases: [] },
    Degraded: { list: { status: "ready", submissions: listed, authorityUnavailable: true, refreshError: "The request failed. Try again." }, grantError: "grant_identity_mismatch" },
  },
  play: {
    // spec/frontend/drafts.md, "Submitted report text is kept only while its submission can still be sent and is erased on sign-out"
    Default: async () => {
      await expect(screen.queryByText(submissions.abandoned.id)).toBeNull();
      onRefresh.mockClear();
      await userEvent.click(screen.getByRole("button", { name: "Refresh reports" }));
      await expect(onRefresh).toHaveBeenCalled();
    },
    // spec/frontend/drafts.md, "Submitted report text is kept only while its submission can still be sent and is erased on sign-out"
    Linked: async () => {
      await expect(screen.getAllByText(/^ss_/u)[0]?.textContent).toBe(submissions.abandoned.id);
    },
    // spec/frontend/drafts.md, "Submitted report text is kept only while its submission can still be sent and is erased on sign-out"
    Empty: async () => {
      await expect(screen.getByText("You have no private reports yet.")).toBeTruthy();
    },
  },
};
