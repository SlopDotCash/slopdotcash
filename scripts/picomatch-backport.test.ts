import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";

type Matcher = (input: string) => boolean;
type Picomatch = (
  pattern: string,
  options?: {
    capture?: boolean;
    maxExtglobRecursion?: false;
    nocase?: boolean;
  },
) => Matcher;

const require = createRequire(import.meta.url);
const copies = [
  ["4.0.5 (Vite)", createRequire(require.resolve("vite"))],
  ["2.3.2 (micromatch)", createRequire(require.resolve("micromatch"))],
] as const;

for (const [version, requireFromConsumer] of copies) {
  const picomatch = requireFromConsumer("picomatch") as Picomatch;

  describe(`Picomatch ${version} backport`, () => {
    test("preserves file globs and deterministic repeated alternatives", () => {
      const matchFile = picomatch("src/**/*.{ts,tsx}");
      expect(matchFile("src/components/App.tsx")).toBe(true);
      expect(matchFile("src/components/App.js")).toBe(false);
      const matchRepeated = picomatch("src/+(ui|api).ts", { capture: true });
      expect(matchRepeated("src/uiapiui.ts")).toBe(true);
      expect(matchRepeated("src/apix.ts")).toBe(false);
      expect(matchRepeated("src/.ts")).toBe(false);
    });

    test("uses the literal fallback even with recursion checks disabled", () => {
      const match = picomatch("src/+([ab]).ts", {
        maxExtglobRecursion: false,
      });
      expect(match("src/+([ab]).ts")).toBe(true);
      expect(match("src/ab.ts")).toBe(false);
    });

    test("checks prefix ambiguity under case folding", () => {
      const match = picomatch("src/+(API|apis).ts", { nocase: true });
      expect(match("src/+(API|apis).ts")).toBe(true);
      expect(match("src/apis.ts")).toBe(false);
    });
  });
}
