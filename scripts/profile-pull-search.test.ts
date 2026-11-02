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

test("contributor pull counts do not open the signed-in pull dashboard", () => {
  for (const qualifier of ["is:merged", "is:open", "is:closed is:unmerged"]) {
    const href = contributorPullSearchUrl(
      "profile-only-contributor",
      qualifier,
    );
    expect(href.startsWith("https://github.com/search?")).toBe(true);
    expect(href).not.toContain("github.com/pulls");
    expect(new URL(href).searchParams.get("type")).toBe("pullrequests");
  }
});
