// spec/contributor/sessionExchange.md, "A lost response preserves server registration without claiming local receipt"
import { env } from "node:process";

const redirects: unknown = JSON.parse(env.SLOP_TEST_REDIRECTS ?? "{}");
const original = globalThis.fetch;

globalThis.fetch = (input, init) => {
  const requested = input instanceof Request ? input : undefined;
  const url = new URL(input instanceof Request ? input.url : input);
  const target: unknown = typeof redirects === "object" && redirects !== null ? Reflect.get(redirects, url.origin) : undefined;
  if (typeof target !== "string") return original(input, init);
  const moved = new globalThis.URL(`${url.pathname}${url.search}`, target);
  return original(requested === undefined ? moved : new globalThis.Request(moved, requested), init);
};
