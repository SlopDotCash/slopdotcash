import { type ReactNode, useEffect, useRef } from "react";

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
    let parent: HTMLElement | null = target;
    parent;
    parent = parent.parentElement
  ) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
  }
  target.scrollIntoView({ behavior: "auto", block: "start" });
  return true;
}

/**
 * A fragment can name content that is still loading on direct entry or
 * client navigation. Reuse the bounded observer for each destination.
 */
export function useHashScroll(href: string): void {
  const positions = useRef(new Map<string, { left: number; top: number }>());
  const active = useRef<{ key: string; href: string } | null>(null);
  const restoring = useRef<{ left: number; top: number } | undefined>(
    undefined,
  );
  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const entry = event.state?.__slopHashScroll;
      restoring.current =
        event.isTrusted && entry?.href === window.location.href
          ? positions.current.get(entry.key)
          : undefined;
      active.current = null;
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, []);
  useEffect(() => {
    const restore = restoring.current;
    restoring.current = undefined;
    const targetId = hashTargetId(new URL(href).hash);
    if (!targetId) return;
    const currentHref = window.location.href;
    const previous = window.history.state?.__slopHashScroll;
    const entry = {
      key: previous?.href === currentHref ? previous.key : crypto.randomUUID(),
      href: currentHref,
    };
    window.history.replaceState(
      { ...window.history.state, __slopHashScroll: entry },
      "",
    );
    active.current = entry;
    let settling = true;
    const align = () => {
      if (!settling) return;
      if (restore) window.scrollTo({ ...restore, behavior: "instant" });
      else scrollToTarget(targetId);
    };
    const remember = () => {
      if (active.current !== entry || entry.href !== window.location.href)
        return;
      // Native history restoration can run after React's first frame. Keep
      // that transient offset out of the saved entry and restore it again.
      // Reader input stops settling before its scroll event is recorded.
      if (settling && restore) align();
      else positions.current.set(entry.key, { left: scrollX, top: scrollY });
    };
    const observer = new MutationObserver(align);
    const timer = window.setTimeout(stop, HASH_SETTLE_MS);
    // Native traversal can scroll against the outgoing page before React paints.
    const frame = window.requestAnimationFrame(align);
    function stop() {
      settling = false;
      observer.disconnect();
      window.clearTimeout(timer);
      window.cancelAnimationFrame(frame);
      for (const type of READER_INPUT_EVENTS) {
        window.removeEventListener(type, stop, true);
      }
    }
    align();
    window.addEventListener("scroll", remember, { passive: true });
    observer.observe(document.body, { childList: true, subtree: true });
    for (const type of READER_INPUT_EVENTS) {
      // Stop before native scrolling. A passive wheel handler can run after
      // the scroll event and let restoration undo the reader's first gesture.
      window.addEventListener(type, stop, {
        capture: true,
        passive: type !== "wheel",
      });
    }
    void document.fonts?.ready.then(align);
    return () => {
      stop();
      window.removeEventListener("scroll", remember);
    };
  }, [href]);
}

export function Link({
  ariaCurrent,
  ariaLabel,
  children,
  className,
  href,
  onNavigate,
}: {
  ariaCurrent?: "page";
  ariaLabel?: string;
  children: ReactNode;
  className?: string;
  href: string;
  onNavigate?: () => void;
}) {
  const scrollAfterNavigation = () => {
    window.setTimeout(() => {
      const destination = new URL(window.location.href);
      if (scrollToTarget(hashTargetId(destination.hash))) return;
      window.scrollTo({ top: 0, behavior: "auto" });
    }, 0);
  };
  return (
    <a
      aria-current={ariaCurrent}
      aria-label={ariaLabel}
      className={className}
      href={href}
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
