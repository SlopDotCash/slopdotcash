/**
 * The same-origin path named by a login `next` query (PRD section 3,
 * "Preserve return destination"). Login assigns this string with
 * `location.replace`. A result that starts with "//" names another origin:
 * URL parsing collapses "/.//host" and "/a/..//host" into that form after
 * the raw "//" check. Those values are refused, and the caller uses the
 * profile instead.
 */
export function loginReturnPath(search: string, origin: string): string | null {
  const next = new URLSearchParams(search).get("next");
  if (!next) return null;
  if (next === "earnings") return "/earnings";
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\"))
    return null;
  try {
    const url = new URL(next, origin);
    const destination = `${url.pathname}${url.search}${url.hash}`;
    const resolved = new URL(destination, origin);
    if (
      url.origin !== origin ||
      resolved.origin !== origin ||
      url.pathname === "/login" ||
      resolved.pathname === "/login" ||
      !destination.startsWith("/") ||
      destination.startsWith("//") ||
      destination.includes("\\")
    )
      return null;
    return destination;
  } catch {
    return null;
  }
}
