/**
 * Host-stable string order for Points, digests, and Slopbot value evidence.
 * Host-default localeCompare can reverse mixed-case ids under Turkish locales
 * (i/I); pin English collation like #2059 review order.
 */
export function compareEnglish(left: string, right: string): number {
  return left.localeCompare(right, "en");
}
