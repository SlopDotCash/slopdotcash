import { useEffect, useState } from "react";

/** Render when a displayed time-dependent state reaches its next boundary. */
export function useTimeBoundary(timestamp: number | null): void {
  const [, render] = useState(0);
  useEffect(() => {
    if (timestamp === null) return;
    let timer: number | undefined;
    const schedule = () => {
      const remaining = timestamp - Date.now();
      if (remaining <= 0) {
        render((value) => value + 1);
      } else {
        // Long enrollment windows must not overflow the browser timer range.
        timer = window.setTimeout(schedule, Math.min(remaining, 2_147_483_647));
      }
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [timestamp]);
}

/** The current UTC day, refreshed at midnight even in an untouched tab. */
export function useUtcDay(): string {
  const now = new Date();
  useTimeBoundary(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
  return now.toISOString().slice(0, 10);
}
