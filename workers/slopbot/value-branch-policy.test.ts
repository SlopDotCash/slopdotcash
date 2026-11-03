import { expect, test } from "bun:test";
import { declaredIntegrationBranch } from "./value-branch-policy";

const declaration = "Pull requests target `development`.";
const lines = (...parts: string[]) => parts.join("\n");

test("an inline triple-backtick span does not hide the branch declaration", () => {
  expect(
    declaredIntegrationBranch(
      lines("```bun run verify``` passes.", declaration),
    ),
  ).toBe("development");
  expect(
    declaredIntegrationBranch(lines("````run `x` now```` done.", declaration)),
  ).toBe("development");
  expect(
    declaredIntegrationBranch(
      lines(declaration, "```bun run verify``` passes."),
    ),
  ).toBe("development");
});

test("real fences still hide declarations", () => {
  expect(
    declaredIntegrationBranch(lines("```", declaration, "```")),
  ).toBeNull();
  expect(
    declaredIntegrationBranch(lines("```md", declaration, "```")),
  ).toBeNull();
  // A tilde fence's info string may contain backticks; it still opens.
  expect(
    declaredIntegrationBranch(lines("~~~ `info`", declaration, "~~~")),
  ).toBeNull();
  expect(declaredIntegrationBranch(declaration)).toBe("development");
});

test("fence state after an inline span stays consistent", () => {
  // An info'd line inside an open fence does not close it.
  expect(
    declaredIntegrationBranch(
      lines("```", "```js extra", declaration, "```", declaration),
    ),
  ).toBe("development");
  // A real fence opened after an inline span still hides its contents, and a
  // closing fence with trailing spaces still closes it.
  expect(
    declaredIntegrationBranch(
      lines(
        "```bun run verify``` passes.",
        "```",
        declaration.replace("development", "hidden"),
        "```   ",
        declaration,
      ),
    ),
  ).toBe("development");
});
