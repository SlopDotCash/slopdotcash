import { expect, test } from "bun:test";
import { githubUserIdFromNodeId } from "../src/lib/github-actor";

test("a current GitHub node ID decodes at the shortest MessagePack width GitHub emits", () => {
  // Values that GitHub's GraphQL API returns with X-Github-Next-Global-ID: 1.
  expect(githubUserIdFromNodeId("U_kgAB")).toBe("1");
  expect(githubUserIdFromNodeId("U_kgDMgg")).toBe("130");
  expect(githubUserIdFromNodeId("U_kgDNA-g")).toBe("1000");
  expect(githubUserIdFromNodeId("U_kgDOAAEB0A")).toBe("66000");
  // A wider spelling of user 1 is not a GitHub ID.
  expect(githubUserIdFromNodeId("U_kgDMAQ")).toBeNull();
  expect(githubUserIdFromNodeId("U_kgDOAAAAAQ")).toBeNull();
});
