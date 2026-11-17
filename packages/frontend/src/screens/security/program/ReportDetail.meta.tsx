import { expect, fn, screen, userEvent } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { headings, reportText, submissions } from "./fixtures.ts";
import type { ReportDetailProps } from "./ReportDetail.tsx";

const onReview = fn();

export const meta: ComponentMeta<ReportDetailProps> = {
  args: {
    submission: submissions.reviewing,
    headings,
    open: true,
    onOpenChange: fn(),
    detail: { status: "ready", report: reportText },
    onRetry: fn(),
    busy: false,
    onRevise: fn(),
    onReview,
  },
  examples: {
    Loading: { detail: { status: "loading" } },
    Failed: { detail: { status: "error", message: "Private report access changed. Reload your private reports." } },
    SignedOut: { detail: { status: "signedOut" } },
    Stale: { detail: { status: "ready", report: reportText, refreshError: "The private report could not refresh." } },
    Closed: { open: false },
  },
  play: {
    // spec/frontend/reportDetails.md, "Private report IDs scope both heading references"
    Default: async () => {
      await expect(screen.getByRole("region").getAttribute("aria-labelledby")).toBe(`${headings.card} ${headings.summary}`);
      onReview.mockClear();
      await userEvent.type(screen.getByRole("textbox", { name: /Review reason/u }), "Reproduced on a fork.");
      await userEvent.click(screen.getByRole("button", { name: "Approve for owner review" }));
      await expect(onReview).toHaveBeenCalledWith("forward", "Reproduced on a fork.");
    },
    // spec/frontend/reportDetails.md, "An individual mount or close changes only its own submission"
    Closed: async () => {
      await expect(screen.queryByRole("region")).toBeNull();
    },
  },
};
