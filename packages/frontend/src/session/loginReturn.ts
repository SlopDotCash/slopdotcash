// spec/frontend/composition.md, "Sign-in keeps only a safe same-origin return destination"
import type { ParsedNext } from "../../gen/frontend__composition.ts";

const loginPathname = "/login";

function isLoginPathname(pathname: string): boolean {
  return pathname.replace(/\/+$/u, "") === loginPathname;
}

const foreign: ParsedNext = { tag: "ForeignOrMalformed" };

function unsafe(path: string): boolean {
  return !path.startsWith("/") || path.startsWith("//") || path.includes("\\");
}

/** @throws {never} */
export function parseNext(search: string, origin: string): ParsedNext {
  const next = new URLSearchParams(search).get("next");
  if (!next) return foreign;
  if (next === "earnings") return { tag: "SameOriginPath", path: "/earnings" };
  if (unsafe(next)) return foreign;
  try {
    const url = new URL(next, origin);
    const destination = `${url.pathname}${url.search}${url.hash}`;
    const resolved = new URL(destination, origin);
    if (url.origin !== origin || resolved.origin !== origin) return foreign;
    if (isLoginPathname(url.pathname) || isLoginPathname(resolved.pathname)) return foreign;
    if (unsafe(destination)) return foreign;
    return { tag: "SameOriginPath", path: destination };
  } catch {
    return foreign;
  }
}
