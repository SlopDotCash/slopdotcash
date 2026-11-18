// spec/ui/status.md, "Payment states keep award, funding and settlement apart"; spec/frontend/directBountyPrompt.md, "Storage keeps the other leg and never grants settlement authority"
import { Alert, Button, Status, type TransactionStatusProps } from "@repo/ui";
import { RotateCcw } from "lucide-react";
import type { Presentation } from "../cases/labels.ts";

type Shown = TransactionStatusProps["presentation"];

export type Outcome = { readonly error: string | null; readonly stale: boolean };

export const sendPresentations = {
  unsent: { tone: "Neutral", icon: "Dot", label: "Not sent" },
  uncertain: { tone: "Caution", icon: "Alert", label: "Unconfirmed" },
  submitted: { tone: "Notice", icon: "Send", label: "Submitted" },
  finalized: { tone: "Positive", icon: "Check", label: "Finalized" },
} as const satisfies Record<string, Shown>;

export type SendState = keyof typeof sendPresentations;

/** What the payment slot keeps after a payment action: sent and waiting for finality, or verified from finalized evidence. */
export const paymentNotices = {
  submitted: { tone: "Caution", icon: "Clock", label: "Submitted" },
  verified: { tone: "Positive", icon: "Check", label: "Verified" },
} as const satisfies Record<string, Presentation>;

export function PaymentNotice({ notice }: { notice: Presentation | null }) {
  return notice ? (
    <p role="status">
      <Status presentation={notice} />
    </p>
  ) : null;
}

/** What the last action refused, with a way to read the current case when the case changed under it. */
export function ActionOutcome({ error, stale, onRefresh }: Outcome & { onRefresh: () => void }) {
  return error ? (
    <Alert
      variant="destructive"
      action={
        stale ? (
          <Button variant="link" onClick={onRefresh}>
            <RotateCcw aria-hidden className="size-4" /> Review current case
          </Button>
        ) : undefined
      }
    >
      {error}
    </Alert>
  ) : null;
}
