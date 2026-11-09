import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { copyText } from "./copy-text";

type CopyFeedback = "idle" | "copied" | "failed";

/** Feedback belongs to one displayed value and the latest copy attempt. */
export function useCopyFeedback(value: string, clearAfterMs?: number) {
  const generation = useRef(0);
  const [result, setResult] = useState({
    value,
    generation: 0,
    feedback: "idle" as CopyFeedback,
  });
  useLayoutEffect(() => {
    generation.current += 1;
    setResult({ value, generation: generation.current, feedback: "idle" });
    return () => {
      generation.current += 1;
    };
  }, [value]);

  useEffect(() => {
    if (result.feedback !== "copied" || clearAfterMs === undefined) return;
    const timer = window.setTimeout(() => {
      if (generation.current === result.generation) {
        setResult({ ...result, feedback: "idle" });
      }
    }, clearAfterMs);
    return () => window.clearTimeout(timer);
  }, [result, clearAfterMs]);

  const copy = () => {
    const attempt = ++generation.current;
    setResult({ value, generation: attempt, feedback: "idle" });
    const settle = (feedback: CopyFeedback) => {
      if (generation.current === attempt) {
        setResult({ value, generation: attempt, feedback });
      }
    };
    void copyText(value).then(
      () => settle("copied"),
      // error-policy:J4 Keep native denial distinct from copied feedback.
      () => settle("failed"),
    );
  };

  return {
    feedback: result.value === value ? result.feedback : "idle",
    copy,
  };
}
