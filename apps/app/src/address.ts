// spec/app/index.md, "The shell shows one route, opened from the address"; spec/app/index.md, "An old address opens the page that replaced it"
import { canonical, equal_app, type Event } from "../gen/app.ts";

/** The segments of `path`, split at "/" without empty ones and each percent-decoded, or undefined where one does not decode. */
export function segmentsOf(path: string): string[] | undefined {
  try {
    return path.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return undefined;
  }
}

/** The path that opens `segments`, each percent-encoded so that it stays one segment. */
export const pathTo = (segments: readonly string[]) => `/${segments.map(encodeURIComponent).join("/")}`;

/** The event that opens the page at `path` with the query `search` and the hash `hash`. */
export function openingOf(path: string, search: string, hash: string): Event {
  const segments = segmentsOf(path);
  return segments === undefined
    ? { type: "openUndecodable" }
    : { type: "open", segments, withX: new URLSearchParams(search).has("x"), securitySettings: hash === "#security-settings" };
}

const sections: Readonly<Record<string, string>> = { awards: "#monthly-awards", funding: "#funding" };

/** The address that replaces an old one in the history, its query kept and its section named, or undefined where the address is already canonical. */
export function canonicalAddress(path: string, search: string, hash: string): string | undefined {
  const segments = segmentsOf(path);
  if (segments === undefined) return undefined;
  const target = canonical(segments, hash === "#security-settings");
  if (equal_app(target, segments)) return undefined;
  const section = segments[0] === "wallet" ? "#wallets" : hash || (sections[segments[2] ?? ""] ?? "");
  return `${pathTo(target)}${search}${section}`;
}
