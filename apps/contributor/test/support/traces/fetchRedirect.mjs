// spec/contributor/sessionExchange.md, "A lost response preserves server registration without claiming local receipt"
import { env } from "node:process";
const redirects = JSON.parse(env.SLOP_TEST_REDIRECTS ?? "{}");
const original = globalThis.fetch;

globalThis.fetch = (input, init) => {
  const requested = input instanceof globalThis.Request ? input : undefined;
  const url = new globalThis.URL(requested === undefined ? String(input) : requested.url);
  const target = redirects[url.origin];
  if (typeof target !== "string") return original(input, init);
  const moved = new globalThis.URL(`${url.pathname}${url.search}`, target);
  return original(requested === undefined ? moved : new globalThis.Request(moved, requested), init);
};
