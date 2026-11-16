// spec/app/index.md, "The shell shows one route, opened from the address"
// The address the browser opened, as the event that opens its route: the path's segments split at "/", empty ones
// dropped and each percent-decoded, and whether the query carries `x`.
import type { Event } from "../gen/app.ts";

/** The segments of `path`, or undefined where one does not percent-decode. */
export function segmentsOf(path: string): string[] | undefined {
  try {
    return path.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return undefined;
  }
}

/** The path that opens `segments`, each percent-encoded so that it stays one segment. */
export const pathTo = (segments: readonly string[]) => `/${segments.map(encodeURIComponent).join("/")}`;

/** The event that opens the page at `path` with the query `search`. */
export function openingOf(path: string, search: string): Event {
  const segments = segmentsOf(path);
  return segments === undefined ? { type: "openUndecodable" } : { type: "open", segments, withX: new URLSearchParams(search).has("x") };
}
