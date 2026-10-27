import { describe, expect, test } from "bun:test";
import {
  collectedProfileProjects,
  isCarriedProfileRepository,
  profileRepositoryProject,
} from "../src/lib/profiles";

const collected = new Set(["SlopDotCash/asi", "SlopDotCash/proximityprize"]);
const collectedProjects = collectedProfileProjects([...collected]);

describe("profile census transfer dedup", () => {
  test("both names of a renamed repository resolve to one project", () => {
    expect(profileRepositoryProject("elizaOS/asi")).toBe("asi");
    expect(profileRepositoryProject("SlopDotCash/asi")).toBe("asi");
    expect(profileRepositoryProject("elizaOS/proximityprize")).toBe(
      "delta-star",
    );
    expect(profileRepositoryProject("SlopDotCash/proximityprize")).toBe(
      "delta-star",
    );
    expect(collectedProjects.has("asi")).toBe(true);
    expect(collectedProjects.has("delta-star")).toBe(true);
  });

  test("a previous row under the old name is not carried", () => {
    expect(
      isCarriedProfileRepository("elizaOS/asi", collected, collectedProjects),
    ).toBe(false);
    expect(
      isCarriedProfileRepository(
        "elizaOS/proximityprize",
        collected,
        collectedProjects,
      ),
    ).toBe(false);
    expect(
      isCarriedProfileRepository(
        "SlopDotCash/asi",
        collected,
        collectedProjects,
      ),
    ).toBe(false);
  });

  test("rows for retired projects and unknown names are still carried", () => {
    expect(
      isCarriedProfileRepository(
        "Canonry/canonry",
        collected,
        collectedProjects,
      ),
    ).toBe(true);
    expect(
      isCarriedProfileRepository(
        "some/unknown-repo",
        collected,
        collectedProjects,
      ),
    ).toBe(true);
  });
});
