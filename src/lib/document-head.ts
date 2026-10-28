import { useEffect } from "react";
import { SITE_ORIGIN } from "./site-routes";

/**
 * The canonical path the current route asks for, and how many not-found
 * views are mounted. A route's data can resolve to "no record" after the
 * route head is set, so either side may change last; both re-apply from this
 * state and the result does not depend on effect order.
 */
let routePath: string | null = null;
let notFoundViews = 0;

function applyHead() {
  const canonical = document.head.querySelector<HTMLLinkElement>(
    'link[rel="canonical"]',
  );
  let robots = document.head.querySelector<HTMLMetaElement>(
    'meta[name="robots"]',
  );
  // A missing page served by the app shell answers 200, so it must say
  // noindex itself, as the static 404 page does.
  if (routePath === null || notFoundViews > 0) {
    canonical?.remove();
    if (!robots) {
      robots = document.createElement("meta");
      robots.name = "robots";
      document.head.append(robots);
    }
    robots.content = "noindex";
    return;
  }
  if (robots?.content === "noindex") robots.remove();
  const href = `${SITE_ORIGIN}${routePath}`;
  if (canonical) canonical.href = href;
  else {
    const link = document.createElement("link");
    link.rel = "canonical";
    link.href = href;
    document.head.append(link);
  }
  document.head
    .querySelector<HTMLMetaElement>('meta[property="og:url"]')
    ?.setAttribute("content", href);
}

/** Sets the route's title and canonical path; `null` marks a missing page. */
export function setRouteHead(title: string, path: string | null) {
  document.title = title;
  routePath = path;
  applyHead();
}

/** While mounted, the page is a not-found result: noindex and no canonical. */
export function useNotFoundHead() {
  useEffect(() => {
    notFoundViews += 1;
    applyHead();
    return () => {
      notFoundViews -= 1;
      applyHead();
    };
  }, []);
}
