import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyFixtureSkills } from "../tests/fixture-overlay.mjs";

// Rendered skill copies: the shared scripts read the project.json beside them.
const skills = mkdtempSync(join(tmpdir(), "contributor-skills-"));
copyFixtureSkills(skills);
afterAll(() => rmSync(skills, { recursive: true, force: true }));

function disclose(skill: string): string {
  const result = spawnSync(
    process.execPath,
    [
      join(skills, skill, "scripts/run-receipt.mjs"),
      "disclose",
      "--provider",
      "Anthropic",
      "--model",
      "claude-opus-5-5",
      "--client",
      "claude-code",
    ],
    { encoding: "utf8" },
  );
  expect(result.status).toBe(0);
  const marker = result.stdout.match(/^<!-- (\S+) \{/mu)?.[1];
  expect(marker).toBeDefined();
  return marker as string;
}

test("ordinary attribution uses the Slop marker unless the target repository requires its legacy one", () => {
  expect(disclose("contribute-to-feed")).toBe(
    "slop-contribution-attribution:v1",
  );
  expect(disclose("contribute-to-slopdotcash")).toBe(
    "slop-contribution-attribution:v1",
  );
  // elizaOS/eliza's own PR validator accepts only its legacy marker.
  expect(disclose("contribute-to-eliza")).toBe("eliza-computer-attribution:v1");
});
