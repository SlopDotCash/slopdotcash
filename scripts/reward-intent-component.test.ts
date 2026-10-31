/**
 * Historical reward proposals are checked by regenerating them and joining
 * each row on its intent id (PRD section 6). The actor suffix of that id is
 * `intentComponent`. A host that case-folds "I" to "ı" must keep the same
 * suffix the English host already records.
 */
import { expect, spyOn, test } from "bun:test";
import { intentComponent } from "../src/lib/reward-cycle";

test("a payout intent keeps its actor suffix when the host case-folds I", () => {
  const actorId = "U_kgDOBjI9abc";
  const english = intentComponent(actorId);
  expect(english).toBe("u_kgdobji9abc");
  const lower = spyOn(String.prototype, "toLowerCase").mockImplementation(
    function (this: string) {
      return this.toLocaleLowerCase("tr");
    },
  );
  try {
    expect(intentComponent(actorId)).toBe(english);
    expect(intentComponent("slopdotcash")).toBe("slopdotcash");
  } finally {
    lower.mockRestore();
  }
});
