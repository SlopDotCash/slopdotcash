import { type ReactNode, useEffect } from "react";

// Content can render or grow after a direct load (snapshot data, web fonts),
// so the hash target is re-aligned until it settles or the reader takes over.
const HASH_SETTLE_MS = 10_000;
const READER_INPUT_EVENTS = [
  "keydown",
  "pointerdown",
  "touchstart",
  "wheel",
] as const;

function hashTargetId(hash: string): string {
  if (!hash) return "";
  try {
    return decodeURIComponent(hash.slice(1));
  } catch {
    // A malformed escape in a hand-typed URL names no element.
    return "";
  }
}

function scrollToTarget(targetId: string): boolean {
  const target = targetId ? document.getElementById(targetId) : null;
  if (!target) return false;
  for (
    let parent = target.parentElement;
    parent;
    parent = parent.parentElement
  ) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
  }
  target.scrollIntoView({ behavior: "auto", block: "start" });
  return true;
}

/**
 * The browser's native jump to a URL hash runs before the app renders, so a
 * direct load of /how-it-works#faq would otherwise stay at the top.
 */
export function useInitialHashScroll(): void {
  useEffect(() => {
    const targetId = hashTargetId(window.location.hash);
    if (!targetId) return;
    let settling = true;
    const align = () => {
      if (settling) scrollToTarget(targetId);
    };
    const observer = new MutationObserver(align);
    const timer = window.setTimeout(stop, HASH_SETTLE_MS);
    function stop() {
      settling = false;
      observer.disconnect();
      window.clearTimeout(timer);
      for (const type of READER_INPUT_EVENTS) {
        window.removeEventListener(type, stop);
      }
    }
    align();
    observer.observe(document.body, { childList: true, subtree: true });
    for (const type of READER_INPUT_EVENTS) {
      window.addEventListener(type, stop, { passive: true });
    }
    void document.fonts?.ready.then(align);
    return stop;
  }, []);
}

export function Link({
  ariaLabel,
  children,
  className,
  href,
  onNavigate,
  tabIndex,
}: {
  ariaLabel?: string;
  children: ReactNode;
  className?: string;
  href: string;
  onNavigate?: () => void;
  tabIndex?: number;
}) {
  const scrollAfterNavigation = () => {
    window.setTimeout(() => {
      const destination = new URL(href, window.location.href);
      if (scrollToTarget(hashTargetId(destination.hash))) return;
      window.scrollTo({ top: 0, behavior: "auto" });
    }, 0);
  };
  return (
    <a
      aria-label={ariaLabel}
      className={className}
      href={href}
      tabIndex={tabIndex}
      onClick={(event) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        window.history.pushState({}, "", href);
        window.dispatchEvent(new PopStateEvent("popstate"));
        onNavigate?.();
        scrollAfterNavigation();
      }}
    >
      {children}
    </a>
  );
}
