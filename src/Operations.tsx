import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { copyText } from "./lib/copy-text";

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
  const [feedback, setFeedback] = useState<"copied" | "failed" | null>(null);
  const action = `Copy ${label}`;
  return (
    <span className="operations-copy">
      <button
        type="button"
        className="text-button operations-copy-button"
        aria-label={action}
        title={feedback === "copied" ? successMessage : action}
        onClick={() => {
          setFeedback(null);
          void copyText(text).then(
            () => setFeedback("copied"),
            () => setFeedback("failed"),
          );
        }}
      >
        {feedback === "copied" ? (
          <Check aria-hidden="true" />
        ) : (
          <Copy aria-hidden="true" />
        )}
      </button>
      {feedback ? (
        <span
          role="status"
          className={
            feedback === "failed" ? "operations-copy-error" : "visually-hidden"
          }
        >
          {feedback === "copied"
            ? successMessage
            : "Copy failed. Select and copy the text."}
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
