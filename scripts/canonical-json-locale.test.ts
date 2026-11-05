import { expect, spyOn, test } from "bun:test";
import { canonicalJson } from "../src/lib/canonical-json";

function withTurkishLocale(run: () => void) {
  const original = String.prototype.localeCompare;
  const locale = spyOn(String.prototype, "localeCompare").mockImplementation(
    function (
      this: string,
      other: string,
      locales?: Intl.LocalesArgument,
      options?: Intl.CollatorOptions,
    ) {
      return original.call(this, other, locales ?? "tr", options);
    },
  );
  try {
    run();
  } finally {
    locale.mockRestore();
  }
}

// Vetting-manifest-shaped keys. Under the Turkish default collation
// "Image" sorts before "id"; the English order keeps "id" first. The
// canonical form must stay byte-compatible with the English order on
// every host because wallet-proof, vetting and payment-keeper digests
// compare its exact bytes.
const manifest = {
  installedPermissions: [],
  Image: "ghcr.io/example/app:1",
  id: "app",
};

const ENGLISH_BYTES =
  '{"id":"app","Image":"ghcr.io/example/app:1","installedPermissions":[]}';

test("canonical JSON is byte-identical to the English order on an English host", () => {
  expect(canonicalJson(manifest)).toBe(ENGLISH_BYTES);
});

test("canonical JSON keeps the English key order under a Turkish default locale", () => {
  withTurkishLocale(() => {
    expect(canonicalJson(manifest)).toBe(ENGLISH_BYTES);
  });
});

test("nested objects keep the English key order under a Turkish default locale", () => {
  withTurkishLocale(() => {
    const value = {
      plan: { request: { id: "a", Image: "b" }, family: "evm" },
    };
    expect(canonicalJson(value)).toBe(
      '{"plan":{"family":"evm","request":{"id":"a","Image":"b"}}}',
    );
  });
});
