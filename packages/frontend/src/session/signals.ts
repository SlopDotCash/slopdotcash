// spec/frontend/navigation.md, "An identity refresh applies only within the navigation lifetime that requested it"

/** @throws {never} */
export function nextRevalidation(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const visible = () => {
      if (document.visibilityState === "visible") settle();
    };
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) settle();
    };
    const stop = () => {
      window.removeEventListener("focus", settle);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("pageshow", restored);
      signal.removeEventListener("abort", stop);
    };
    function settle() {
      stop();
      resolve();
    }
    window.addEventListener("focus", settle);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("pageshow", restored);
    signal.addEventListener("abort", stop, { once: true });
  });
}
