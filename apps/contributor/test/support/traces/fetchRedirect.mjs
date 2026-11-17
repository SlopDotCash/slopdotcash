// spec/contributor/sessionExchange.md, "A lost response preserves server registration without claiming local receipt"
const redirects = JSON.parse(process.env.SLOP_TEST_REDIRECTS ?? "{}");
const original = globalThis.fetch;

globalThis.fetch = (input, init) => {
  const requested = input instanceof Request ? input : undefined;
  const url = new URL(requested === undefined ? String(input) : requested.url);
  const target = redirects[url.origin];
  if (typeof target !== "string") return original(input, init);
  const moved = new URL(`${url.pathname}${url.search}`, target);
  return original(requested === undefined ? moved : new Request(moved, requested), init);
};
