/** Locks the universal bootstrap to the installer's fail-closed revision policy. */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "skills", "slop", "SKILL.md"), "utf8");

describe("Slop bootstrap revision authorization", () => {
  it("binds guide execution to independently checked immutable source", () => {
    assert.match(source, /scripts\/render-install-guide\.mjs/);
    assert.match(source, /src\/lib\/install-command\.ts/);
    assert.match(source, /protocol\/skill-revocations\.json/);
  });
});
