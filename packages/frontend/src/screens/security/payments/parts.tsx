// spec/ui/status.md, "Payment states keep award, funding and settlement apart"; spec/frontend/directBountyPrompt.md, "Storage keeps the other leg and never grants settlement authority"
import { Alert, Button, type TransactionStatusProps } from "@repo/ui";
import { RotateCcw } from "lucide-react";

type Presentation = TransactionStatusProps["presentation"];

export type Outcome = { readonly error: string | null; readonly stale: boolean; readonly notice: string | null };

export const sendPresentations = {
  unsent: { tone: "Neutral", icon: "Dot", label: "Not sent" },
  uncertain: { tone: "Caution", icon: "Alert", label: "Not confirmed" },
  submitted: { tone: "Notice", icon: "Send", label: "Submitted" },
  finalized: { tone: "Positive", icon: "Check", label: "Finalized" },
} as const satisfies Record<string, Presentation>;

export type SendState = keyof typeof sendPresentations;

/** What the last action said: a refusal, with a way to read the current case when the case changed under it, or a saved notice. */
export function ActionOutcome({ error, stale, notice, onRefresh }: Outcome & { onRefresh: () => void }) {
  return (
    <>
      {notice ? <p role="status">{notice}</p> : null}
      {error ? (
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
      ) : null}
    </>
  );
}
