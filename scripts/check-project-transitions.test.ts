import { describe, expect, it } from "vitest";
import asi from "../projects/asi/project.json";
import deltaStar from "../projects/delta-star/project.json";
import eliza from "../projects/eliza/project.json";
import heirElementsSdk from "../projects/heir-elements-sdk/project.json";
import { validateProjectTransitions } from "./check-project-transitions.mjs";

function entry(value: { id: string }): [string, string] {
  return [`projects/${value.id}/project.json`, JSON.stringify(value)];
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

  it("rejects a non-boolean root-publication declaration", () => {
    const malformed = structuredClone(eliza) as unknown as {
      id: string;
      skill: Record<string, unknown>;
    };
    malformed.skill.publishAtRoot = "true";
    expect(() =>
      validateProjectTransitions([entry(eliza)], [entry(malformed)]),
    ).toThrow(/project identity/u);
  });

  it("requires an atomic inventory migration with exactly one root", () => {
    const current = [eliza, asi, deltaStar, heirElementsSdk];
    const legacy = current.map((project) => {
      const next = structuredClone(project) as unknown as {
        id: string;
        skill: { publishAtRoot?: unknown };
      };
      delete next.skill.publishAtRoot;
      return next;
    });
    const entries = (projects: Array<{ id: string }>) => projects.map(entry);

    expect(
      validateProjectTransitions(entries(legacy), entries(current)),
    ).toEqual({ previous: 4, current: 4 });

    const partial = structuredClone(current) as unknown as Array<{
      id: string;
      skill: { publishAtRoot?: unknown };
    }>;
    delete partial[3].skill.publishAtRoot;
    expect(() =>
      validateProjectTransitions(entries(legacy), entries(partial)),
    ).toThrow(/publishAtRoot/u);

    const multiple = structuredClone(current) as unknown as Array<{
      id: string;
      skill: { publishAtRoot?: unknown };
    }>;
    multiple[1].skill.publishAtRoot = true;
    expect(() =>
      validateProjectTransitions(entries(legacy), entries(multiple)),
    ).toThrow(/exactly one root publisher/u);

    expect(() =>
      validateProjectTransitions(entries(current), entries(legacy)),
    ).toThrow(/publishAtRoot/u);
  });
});
