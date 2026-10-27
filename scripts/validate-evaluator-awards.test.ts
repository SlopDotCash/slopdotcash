/// <reference types="bun-types" />
import { afterAll, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadEvaluatorAwardEvents } from "../src/lib/evaluator-awards";

const fixture = JSON.parse(
  readFileSync(
    resolve(
      import.meta.dir,
      "../tests/fixtures/history/evaluations/eliza/award-neutize-pr-25803.json",
    ),
    "utf8",
  ),
);
const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** Loads the awards through the production loader, as `evaluations:check` does. */
function load(awards: Record<string, unknown>) {
  const root = mkdtempSync(join(tmpdir(), "evaluator-awards-"));
  roots.push(root);
  mkdirSync(join(root, "eliza"));
  for (const [name, award] of Object.entries(awards)) {
    writeFileSync(join(root, "eliza", name), JSON.stringify(award));
  }
  return loadEvaluatorAwardEvents(root);
}

describe("evaluator award source uniqueness", () => {
  test("awards for two different pull requests both load", () => {
    const events = load({
      "award-a.json": fixture,
      "award-b.json": {
        ...fixture,
        id: "award_neutize_pr_25804",
        source: {
          ...fixture.source,
          id: "PR_kwDOMT5cIs8AAAABAsy-6A",
          number: 25804,
          url: "https://github.com/elizaOS/eliza/pull/25804",
        },
      },
    });
    expect(events.map((event) => event.source.number)).toEqual([25803, 25804]);
  });

  test("one pull request under its legacy node ID and another URL spelling is a duplicate", () => {
    // MDExOlB1bGxSZXF1ZXN0NDM0MTkzOTk0Mw== is base64 of
    // "011:PullRequest4341939943", the legacy ID of PR_kwDOMT5cIs8AAAABAsy-5w.
    expect(() =>
      load({
        "award-a.json": fixture,
        "award-b.json": {
          ...fixture,
          id: "award_neutize_pr_25803_again",
          source: {
            ...fixture.source,
            id: "MDExOlB1bGxSZXF1ZXN0NDM0MTkzOTk0Mw==",
            url: "https://github.com/elizaos/eliza/pull/25803",
          },
        },
      }),
    ).toThrow("evaluator award ids and sources must be unique");
  });
});
