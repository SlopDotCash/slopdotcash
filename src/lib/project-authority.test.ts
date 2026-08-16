import { describe, expect, it } from "vitest";
import {
  assertPrivateProjectOperators,
  authorityDriftReasons,
} from "./project-authority";

const observation = {
  repositoryId: "826170402",
  repositoryFullName: "elizaOS/eliza",
  integrationBranch: "develop",
  proofPresent: true,
  proofFileSha256: "a".repeat(64),
  licenseSha256: "b".repeat(64),
  inboundTermsSha256: "c".repeat(64),
  prizeRulesSha256: null,
};

describe("private project authority", () => {
  it("requires numeric unique actors and a private owner role", () => {
    expect(
      assertPrivateProjectOperators([
        { actorId: "123", roles: ["owner", "editor"] },
        { actorId: "456", roles: ["settler"] },
      ]),
    ).toHaveLength(2);
    expect(() =>
      assertPrivateProjectOperators([{ actorId: "login", roles: ["owner"] }]),
    ).toThrow(/actorId/u);
    expect(() =>
      assertPrivateProjectOperators([{ actorId: "123", roles: ["settler"] }]),
    ).toThrow(/owner/u);
  });

  it("pauses on transfer, proof removal, branch change, and terms drift", () => {
    const observed = {
      ...observation,
      repositoryId: "999",
      integrationBranch: "main",
      proofPresent: false,
      proofFileSha256: null,
      licenseSha256: "d".repeat(64),
      inboundTermsSha256: null,
    };
    expect(authorityDriftReasons(observation, observed)).toEqual([
      "repository-transfer-or-rename",
      "integration-branch-drift",
      "proof-removed",
      "proof-drift",
      "license-drift",
      "inbound-terms-drift",
    ]);
  });
});
