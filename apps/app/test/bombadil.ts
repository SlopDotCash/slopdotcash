// spec/app/index.md, "Story: Open a page by its address"
import { always } from "@antithesishq/bombadil";
import { extract } from "@antithesishq/bombadil/browser";
export * from "@antithesishq/bombadil/browser/defaults";

const landmarks = extract(({ document }) => ({
  busy: document.querySelector('main[aria-busy="true"]') !== null,
  mains: document.querySelectorAll("main").length,
  headings: document.querySelectorAll("h1").length,
}));

// spec/app/index.md, "The shell shows one route, opened from the address"
export const oneRouteIsShown = always(() => landmarks.current.busy || (landmarks.current.mains === 1 && landmarks.current.headings === 1));

const signInReturns = extract(({ document, window }) =>
  [...document.querySelectorAll("a")]
    .filter((link) => link.textContent?.trim() === "Sign in with GitHub")
    .every((link) => {
      const target = new URL(link.href);
      const next = target.searchParams.get("next");
      const here = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      return target.pathname === "/login" && (next === null ? here === "/" : next === here);
    }),
);

// spec/frontend/navigation.md, "A signed-out private destination keeps its URL and shows sign-in in place with private reads disabled"; spec/frontend/composition.md, "Sign-in keeps only a safe same-origin return destination"
export const signInReturnsToTheAddress = always(() => signInReturns.current);

const foreignScripts = extract(({ document, window }) =>
  [...document.querySelectorAll("script[src]")].filter((script) => new URL(script.getAttribute("src") ?? "", window.location.href).origin !== window.location.origin).length,
);

// spec/frontend/presentation.md, "Only production slop.cash loads the approved first-party Cloudflare beacon"
export const noThirdPartyScriptOutsideProduction = always(() => foreignScripts.current === 0);

const wordmark = extract(({ document, window }) => {
  const host = window.location.hostname.toLowerCase().replace(/\.$/u, "");
  const domain = host === "slop.tech" || host === "www.slop.tech" ? "slop.tech" : "slop.cash";
  const home = document.querySelector('a[aria-label="Slop home"]');
  return home === null || (home.textContent ?? "").includes(domain);
});

// spec/frontend/presentation.md, "The wordmark and footer domain follow the serving host"
export const wordmarkFollowsTheHost = always(() => wordmark.current);

const fitsTheViewport = extract(({ document, window }) => document.documentElement.scrollWidth <= window.innerWidth);

// spec/frontend/projections.md, "Interface capability requirements survive responsive and accessibility modes"
export const noHorizontalScroll = always(() => fitsTheViewport.current);
