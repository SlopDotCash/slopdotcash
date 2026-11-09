import { expect, test } from "bun:test";
import { contributorPullSearchUrl } from "../src/lib/profiles";

test("contributor pull counts use the public search", () => {
  expect(contributorPullSearchUrl("octocat", "is:merged")).toBe(
    "https://github.com/search?q=is%3Apr%20author%3Aoctocat%20is%3Amerged&type=pullrequests",
  );
  expect(contributorPullSearchUrl("octocat", "is:open")).toBe(
    "https://github.com/search?q=is%3Apr%20author%3Aoctocat%20is%3Aopen&type=pullrequests",
  );
  expect(contributorPullSearchUrl("octocat", "is:closed is:unmerged")).toBe(
    "https://github.com/search?q=is%3Apr%20author%3Aoctocat%20is%3Aclosed%20is%3Aunmerged&type=pullrequests",
  );
});
