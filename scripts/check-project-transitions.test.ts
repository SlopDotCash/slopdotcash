import { describe, expect, it } from "vitest";
import eliza from "../projects/eliza/project.json";
import { validateProjectTransitions } from "./check-project-transitions.mjs";

function entry(value: unknown): [string, string] {
  return ["projects/eliza/project.json", JSON.stringify(value)];
}

describe("project transition gate", () => {
  it("accepts unchanged policy and rejects silent terms history edits", () => {
    expect(validateProjectTransitions([entry(eliza)], [entry(eliza)])).toEqual({
      previous: 1,
      current: 1,
    });
    const rewritten = structuredClone(eliza);
    rewritten.terms.copyright.notice = "Rewritten without a new revision";
    expect(() =>
      validateProjectTransitions([entry(eliza)], [entry(rewritten)]),
    ).toThrow(/new revision/u);
  });

  it("rejects project deletion and malformed inventory paths", () => {
    expect(() => validateProjectTransitions([entry(eliza)], [])).toThrow(
      /cannot be deleted/u,
    );
    expect(() =>
      validateProjectTransitions(
        [["projects/../eliza/project.json", JSON.stringify(eliza)]],
        [entry(eliza)],
      ),
    ).toThrow(/not canonical/u);
  });
});
