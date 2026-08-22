/** Locks the universal bootstrap to the installer's fail-closed revision policy. */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "skills", "slop", "SKILL.md"), "utf8");

describe("Slop bootstrap revision authorization", () => {
  it("permits only current develop or a byte-identical canonical ancestor", () => {
    assert.match(source, /current `develop` head/u);
    assert.match(source, /strict `develop` ancestor/u);
    assert.match(source, /complete canonical contributor-skill tree/u);
    assert.match(
      source,
      /same\s+bounded file set and byte-identical contents/u,
    );
    assert.match(
      source,
      /recursively bounded canonical Contents API inventory/u,
    );
  });

  it("binds renderers to the manifest and rejects unsafe ancestry", () => {
    assert.match(
      source,
      /every guide renderer revision to equal that manifest revision/u,
    );
    assert.match(source, /not\s+an independently moving branch name/u);
    assert.match(source, /does not by itself authorize an ancestor/u);
    assert.match(source, /reject a behind or divergent revision/u);
    assert.match(source, /any missing or extra path/u);
    assert.match(source, /any byte difference/u);
  });

  it("bootstraps the universal queue-first priority gates", () => {
    const reviews = source.search(
      /review, test, and[\s\S]{0,80}recommendation/iu,
    );
    const issues = source.search(/finish every valid existing issue/iu);
    const workflows = source.search(
      /repair every reproducible[\s\S]{0,80}failure/iu,
    );
    assert.ok(reviews >= 0);
    assert.ok(issues > reviews);
    assert.ok(workflows > issues);
    assert.match(source, /only after all three\s+gates are clear/iu);
    assert.match(
      source,
      /operator explicitly authorizes that exact issue\s+write/iu,
    );
  });
});
