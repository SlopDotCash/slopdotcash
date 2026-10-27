import { useCallback, useState } from "react";
import { errorMessage } from "./errors";

/**
 * Busy and error state for one user action. A rejected action becomes the
 * shown error. An action that resolves "navigating" keeps the controls busy
 * while the browser leaves the page.
 */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async (
      action: () => Promise<unknown>,
      failure: (caught: unknown) => string = (caught) => errorMessage(caught),
    ) => {
      setBusy(true);
      setError(null);
      let navigating = false;
      try {
        navigating = (await action()) === "navigating";
      } catch (caught) {
        setError(failure(caught));
      } finally {
        if (!navigating) setBusy(false);
      }
    },
    [],
  );
  return { busy, error, setError, run };
}
