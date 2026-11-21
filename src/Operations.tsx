import { Check, Copy, X } from "lucide-react";
import { useCopyFeedback } from "./lib/use-copy-feedback";
import "./operations-copy.css";

/** A compact copy action with the same label for sighted and screen-reader users. */
export function CopyButton({
  label,
  text,
  successMessage = "Copied.",
}: {
  label: string;
  text: string;
  successMessage?: string;
}) {
  const { feedback, copy } = useCopyFeedback(text);
  const action = `Copy ${label}`;
  return (
    <span className="operations-copy">
      <button
        type="button"
        className="text-button operations-copy-button"
        aria-label={action}
        title={feedback === "copied" ? successMessage : action}
        onClick={copy}
      >
        {feedback === "copied" ? (
          <Check aria-hidden="true" />
        ) : feedback === "failed" ? (
          <X aria-hidden="true" className="operations-copy-error" />
        ) : (
          <Copy aria-hidden="true" />
        )}
      </button>
      {feedback !== "idle" ? (
        <span
          role="status"
          className={
            feedback === "failed" ? "operations-copy-error" : "visually-hidden"
          }
        >
          {feedback === "copied" ? successMessage : "Copy failed"}
        </span>
      ) : null}
    </span>
  );
}

/** Preserve the complete value alongside its inline copy action. */
export function CopyIdentifier({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <span className="operations-identifier">
      <code>{value}</code>
      <CopyButton label={label} text={value} />
    </span>
  );
}

/** Touch and keyboard users can reveal the exact value before copying it. */
export function CompactIdentifier({
  label,
  value,
  preview,
  open,
}: {
  label: string;
  value: string;
  preview: string;
  /** Shows the full value without a click, as during a signing review. */
  open?: boolean;
}) {
  return (
    <details className="compact-identifier" open={open}>
      <summary aria-label={`Show full ${label}`}>{preview}</summary>
      <CopyIdentifier label={label} value={value} />
    </details>
  );
}
