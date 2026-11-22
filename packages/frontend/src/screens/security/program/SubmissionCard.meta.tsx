import { expect, fn, screen, userEvent } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { caseRecord, draft, headings, nowMs, submissions } from "./fixtures.ts";
import { DepositLineView } from "./DepositLine.tsx";
import type { SubmissionCardProps } from "./SubmissionCard.tsx";

const onAct = fn();
const onOpenCase = fn();

export const meta: ComponentMeta<SubmissionCardProps> = {
  args: {
    submission: submissions.received,
    caseRecord,
    login: "octocat",
    headings,
    focused: false,
    expanded: true,
    onExpandedChange: fn(),
    draft,
    onDraft: fn(),
    nowMs,
    busy: false,
    error: null,
    needsGrant: false,
    onAct,
    onOpenCase,
  },
  examples: {
    NeedsInformation: { submission: submissions.needsInformation, caseRecord: undefined },
    Uncertain: { submission: submissions.uncertain },
    Verified: { submission: submissions.verified },
    SendFromTab: { submission: submissions.unsentFromTab, caseRecord: undefined },
    NeedsGrant: { needsGrant: true },
    Collapsed: { expanded: false },
    DepositNeeded: { deposit: <DepositLineView status={{ state: "needed", amountText: "395 SLOP", payPath: "/fee/report/sc_0123456789abcdef" }} end={{ status: "settled", href: null }} /> },
  },
  play: {
    // spec/security/forwarding.md, "Each request uses its own exact row revision and a reporter-only v1 grant"
    Default: async () => {
      onOpenCase.mockClear();
      await userEvent.click(screen.getByRole("button", { name: "Open case" }));
      await expect(onOpenCase).toHaveBeenCalledWith(caseRecord.id);
    },
    // spec/security/forwarding.md, "Each request uses its own exact row revision and a reporter-only v1 grant"
    Uncertain: async () => {
      onAct.mockClear();
      await userEvent.click(screen.getByRole("button", { name: "Check again" }));
      await expect(onAct).toHaveBeenCalledWith({ kind: "reconcile" });
    },
    // spec/frontend/drafts.md, "Submitted report text is kept only while its submission can still be sent and is erased on sign-out"
    SendFromTab: async () => {
      onAct.mockClear();
      await userEvent.click(screen.getByRole("button", { name: "Submit privately" }));
      await expect(onAct).toHaveBeenCalledWith({ kind: "send", draft });
    },
  },
};
