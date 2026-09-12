import type { ReactNode } from "react";
export function Link({
  ariaLabel,
  children,
  className,
  href,
  onNavigate,
}: {
  ariaLabel?: string;
  children: ReactNode;
  className?: string;
  href: string;
  onNavigate?: () => void;
}) {
  const scrollAfterNavigation = () => {
    window.setTimeout(() => {
      const destination = new URL(href, window.location.href);
      const targetId = destination.hash
        ? decodeURIComponent(destination.hash.slice(1))
        : "";
      const target = targetId ? document.getElementById(targetId) : null;
      if (target) {
        target.scrollIntoView({ behavior: "auto", block: "start" });
        return;
      }
      window.scrollTo({ top: 0, behavior: "auto" });
    }, 0);
  };
  return (
    <a
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
