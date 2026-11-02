/**
 * Monthly shares use integer base units and largest remainder (PRD section 6).
 * Equal remainders follow the contributor tie order. That order also ranks
 * tied project and global standings. A host locale that case-folds "I" to
 * "ı" must award the same extra unit and keep the same order.
 */
import { expect, spyOn, test } from "bun:test";
import { compareActors } from "../src/lib/github-actor";
import {
  allocateIntegerTotal,
  type ProjectContributor,
} from "../src/lib/project-view";

function contributor(login: string, id: string): ProjectContributor {
  return {
    actor: {
      id,
      login,
      avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
      url: `https://github.com/${login}`,
      kind: "User",
    },
    adjustedWeight: 1,
  } as ProjectContributor;
}

function shares(people: readonly ProjectContributor[]): Record<string, string> {
  return Object.fromEntries(
    [...allocateIntegerTotal(1n, people)].map(([id, amount]) => [
      id,
      amount.toString(),
    ]),
  );
}

function standing(people: readonly ProjectContributor[]): string[] {
  return [...people]
    .sort((left, right) => compareActors(left.actor, right.actor))
    .map((person) => person.actor.login);
}

test("a tied monthly remainder keeps its recipient when the host locale is Turkish", () => {
  const people = [
    contributor("Idea", "node-upper"),
    contributor("idea", "node-lower"),
  ];
  const englishShares = shares(people);
  const englishStanding = standing(people);
  const originalCompare = String.prototype.localeCompare;
  const lower = spyOn(String.prototype, "toLowerCase").mockImplementation(
    function (this: string) {
      return this.toLocaleLowerCase("tr");
    },
  );
  const compare = spyOn(String.prototype, "localeCompare").mockImplementation(
    function (
      this: string,
      other: string,
      locales?: Intl.LocalesArgument,
      options?: Intl.CollatorOptions,
    ) {
      return originalCompare.call(this, other, locales ?? "tr", options);
    },
  );
  try {
    // One base unit, two equal weights. English order gives it to "idea".
    expect(englishShares).toEqual({
      "node-lower": "1",
      "node-upper": "0",
    });
    expect(englishStanding).toEqual(["idea", "Idea"]);
    expect(shares(people)).toEqual(englishShares);
    expect(standing(people)).toEqual(englishStanding);
    expect(
      [...allocateIntegerTotal(1n, people).values()].reduce(
        (total, amount) => total + amount,
        0n,
      ),
    ).toBe(1n);
  } finally {
    lower.mockRestore();
    compare.mockRestore();
  }
});
