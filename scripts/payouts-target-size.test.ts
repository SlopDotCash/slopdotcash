import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** #1411 D6: earnings/Payouts and Disclosure text links stay at least 24px tall. */
const styles = readFileSync(
  join(import.meta.dirname, "../src/styles.css"),
  "utf8",
);

describe("payouts and disclosure target size (#1411 D6)", () => {
  test("styles keep a 24px minimum for Payouts and Disclosure link selectors", () => {
    const block =
      /\/\* Inline Payouts \/ Disclosure links keep a 24px target[\s\S]*?min-height:\s*24px;/u.exec(
        styles,
      );
    expect(block).not.toBeNull();
    const css = block?.[0];
    for (const selector of [
      ".faq-answer a",
      ".mechanism-flow a",
      ".money-summary a",
    ]) {
      expect(css).toContain(selector);
    }
  });

  test("negative: the D6 block does not lower the target below 24px", () => {
    const block =
      /\/\* Inline Payouts \/ Disclosure links keep a 24px target[\s\S]*?\n\}/u.exec(
        styles,
      );
    expect(block).not.toBeNull();
    expect(block?.[0]).not.toMatch(/min-height:\s*(?:[0-9]|1[0-9]|2[0-3])px/u);
  });
});
