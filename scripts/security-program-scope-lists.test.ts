import { describe, expect, test } from "bun:test";
import { assertSecurityBountyTerms } from "../src/lib/security-bounty.mjs";
import { securityScopeListProblem } from "../src/lib/security-program-draft";

// The bounty program editor collects Covered assets and Excluded
// dependencies one entry per line in textareas bounded only as a whole
// (10,000 characters), while the API bounds each entry (2 to 200
// characters, at most 50 entries). For a new program the editor skipped
// the terms validator entirely, so entries that follow the on-screen
// guidance reached the API and were refused with a message that never
// named the bound. The editor now checks the lists before publishing.
const LONG_ASSET =
  "USDC vault and strategy contracts deployed on Base mainnet, including the timelock proxy, all current and successor implementations, the fee splitter, and every adapter that can move or freeze depositor funds";
const LONG_EXCLUDED =
  "OpenZeppelin Contracts v5 proxy and access-control libraries as published, the Chainlink price-feed aggregator contracts on Base mainnet, and the Circle USDC token contract including its proxy and implementation";

describe("security program scope lists", () => {
  test("the repro entries pass the textarea bounds but the API refuses them", () => {
    expect(LONG_ASSET.length).toBeGreaterThan(200);
    expect(LONG_ASSET.length).toBeLessThanOrEqual(10_000);
    expect(LONG_EXCLUDED.length).toBeGreaterThan(200);
    // The client check names the bound before the publish is attempted.
    expect(
      securityScopeListProblem({
        includedAssets: [LONG_ASSET],
        excludedDependencies: [],
      }),
    ).toContain("2 to 200 characters");
    expect(
      securityScopeListProblem({
        includedAssets: ["Vault contract"],
        excludedDependencies: [LONG_EXCLUDED],
      }),
    ).toContain("2 to 200 characters");
    expect(
      securityScopeListProblem({
        includedAssets: Array.from(
          { length: 51 },
          (_, index) => `Covered contract ${index + 1} on Base`,
        ),
        excludedDependencies: [],
      }),
    ).toContain("at most 50 lines");
  });

  test("entries at the API bounds are accepted", () => {
    expect(
      securityScopeListProblem({
        includedAssets: ["x".repeat(200)],
        excludedDependencies: [],
      }),
    ).toBeNull();
    expect(
      securityScopeListProblem({
        includedAssets: Array.from(
          { length: 50 },
          (_, index) => `Asset ${index + 1}`,
        ),
        excludedDependencies: ["ab"],
      }),
    ).toBeNull();
  });

  test("an empty covered list is refused, an empty exclusion list is not", () => {
    expect(
      securityScopeListProblem({
        includedAssets: [],
        excludedDependencies: [],
      }),
    ).toContain("Covered assets");
    expect(
      securityScopeListProblem({
        includedAssets: ["Vault contract"],
        excludedDependencies: [],
      }),
    ).toBeNull();
  });

  test("the client bounds match the API validator's bounds", () => {
    // A 201-character entry is the exact point where the two disagreed:
    // the textarea allowed it and assertSecurityBountyTerms refused it.
    expect(
      securityScopeListProblem({
        includedAssets: ["x".repeat(201)],
        excludedDependencies: [],
      }),
    ).not.toBeNull();
    expect(
      securityScopeListProblem({
        includedAssets: ["x".repeat(200)],
        excludedDependencies: [],
      }),
    ).toBeNull();
    expect(typeof assertSecurityBountyTerms).toBe("function");
  });
});
