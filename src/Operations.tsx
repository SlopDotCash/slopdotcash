import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { copyText } from "./lib/copy-text";

/** Keep the complete verification value available while making it easy to copy. */
export function CopyIdentifier({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  const [feedback, setFeedback] = useState("");
  return (
    <span className="operations-identifier">
      <code>{value}</code>
      <button
        type="button"
        className="text-button"
        aria-label={`Copy ${label}`}
        onClick={() => {
          void copyText(value).then(
            () => setFeedback("Copied."),
            () => setFeedback("Copy failed. Select the value above."),
          );
        }}
      >
        {feedback === "Copied." ? (
          <Check aria-hidden="true" />
        ) : (
          <Copy aria-hidden="true" />
        )}
        Copy
      </button>
      {feedback ? <span role="status">{feedback}</span> : null}
    </span>
  );
}
