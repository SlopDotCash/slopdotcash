import type { Fetcher } from "./bindings.ts";

/** @throws {never} */
export function fetchVia(fetcher: Fetcher): typeof globalThis.fetch {
  return (input, init) => fetcher.fetch(new Request(input, init));
}
