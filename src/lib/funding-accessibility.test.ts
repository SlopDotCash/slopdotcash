/** Synthetic policy fixtures only: no production identity or wallet claim. */
import { describe, expect, it } from "vitest";
import eliza from "../../projects/eliza/project.json";
import { assertProjectFundingIndex } from "./funding";
import { assertFundingCommitments } from "./funding-instruments.mjs";
import { assertProjectPolicyTransition } from "./project-policy.mjs";
import {
  assertHistoricalProjectDefinition,
  assertProjectDefinition,
} from "./project-schema.mjs";

const independent = "SysvarRent111111111111111111111111111111111";
function fixture() {
  return {
    ...structuredClone(eliza),
    reward: {
      ...eliza.reward,
      paymentMode: "disabled",
      fundingState: "committed",
      committedMinor: "5000000",
    },
    funding: {
      ...structuredClone(eliza.funding),
      commitments: [
        {
          kind: "squads-v4-vault",
          network: "solana",
          asset: "USDC",
          multisig: "11111111111111111111111111111111",
          vault: "Vote111111111111111111111111111111111111111",
          vaultIndex: 0,
          funderMember: "Stake11111111111111111111111111111111111111",
          funderActorId: "18633264",
          stewardMember: independent,
          stewardGithub: {
            actorId: "42",
            nodeId: "U_fixture_42",
            login: "independent-fixture",
          },
          monthlyCommitment: {
            cycleId: "2026-08",
            amountMinor: "5000000",
            accessibility: "unknown",
          },
          effectiveAt: "2026-08-01T00:00:00.000Z",
          deadline: "2026-09-01T00:00:00.000Z",
          replacedAt: null as string | null,
        },
      ],
    },
  };
}

describe("monthly commitment accessibility boundary", () => {
  it("requires append-only monthly history and refuses relabeling an old instrument", () => {
    const before = fixture();
    const changed = fixture();
    changed.funding.commitments[0].monthlyCommitment.cycleId = "2026-09";
    changed.funding.commitments[0].effectiveAt = "2026-09-01T00:00:00.000Z";
    changed.funding.commitments[0].deadline = "2026-10-01T00:00:00.000Z";
    expect(() => assertProjectPolicyTransition(before, changed)).toThrow(
      /historical commitment.*immutable/u,
    );
    const next = structuredClone(changed);
    next.funding.commitments[0].multisig =
      "SysvarC1ock11111111111111111111111111111111";
    next.funding.commitments[0].vaultIndex = 1;
    const retired = structuredClone(before.funding.commitments[0]);
    retired.replacedAt = next.funding.commitments[0].effectiveAt;
    next.funding.commitments.unshift(retired);
    expect(() => assertProjectPolicyTransition(before, next)).not.toThrow();
    const deleted = fixture();
    deleted.reward.committedMinor = "0";
    deleted.reward.fundingState = "pledged";
    deleted.funding.commitments = [];
    expect(() => assertProjectPolicyTransition(before, deleted)).toThrow(
      /append-only prefix/u,
    );
    const drifted = structuredClone(next);
    drifted.funding.commitments[0].monthlyCommitment.amountMinor = "1";
    expect(() => assertProjectPolicyTransition(before, drifted)).toThrow(
      /historical commitment.*immutable/u,
    );
  });
  it("keeps the current empty pledge valid and a committed unknown balance disabled", () => {
    expect(assertProjectDefinition(eliza).reward.paymentMode).toBe("disabled");
    const project = assertProjectDefinition(fixture());
    expect(
      project.funding.commitments?.[0].monthlyCommitment?.accessibility,
    ).toBe("unknown");
    expect(project.reward.paymentMode).toBe("disabled");
  });

  it("rejects activation and every invented accessible or inaccessible claim", () => {
    const enabled = fixture();
    enabled.reward.paymentMode = "enabled";
    expect(() => assertProjectDefinition(enabled)).toThrow(
      /accessibility is unknown/u,
    );
    for (const state of [
      "accessible",
      "inaccessible",
      "verified",
      "",
      null,
      true,
    ]) {
      const project = fixture();
      Object.assign(project.funding.commitments[0].monthlyCommitment, {
        accessibility: state,
      });
      expect(() => assertProjectDefinition(project)).toThrow(
        /accessibility must remain unknown/u,
      );
    }
    const forged = fixture();
    Object.assign(forged.funding.commitments[0].monthlyCommitment, {
      capabilityEvidence: "signed",
    });
    expect(() => assertProjectDefinition(forged)).toThrow(
      /unexpected or missing/u,
    );
  });

  it("keeps old instrument bytes readable only through the historical boundary", () => {
    const old = fixture();
    old.reward.paymentMode = "enabled";
    const instrument = old.funding.commitments[0] as unknown as Record<
      string,
      unknown
    >;
    delete instrument.monthlyCommitment;
    delete instrument.stewardGithub;
    instrument.deadline = "2026-12-01T00:00:00.000Z";
    const bytes = JSON.stringify(old);
    expect(assertHistoricalProjectDefinition(old).reward.paymentMode).toBe(
      "enabled",
    );
    expect(JSON.stringify(old)).toBe(bytes);
    expect(() => assertProjectDefinition(old)).toThrow(
      /monthly instrument binding/u,
    );
    old.reward.paymentMode = "disabled";
    old.reward.committedMinor = "0";
    old.reward.fundingState = "pledged";
    instrument.replacedAt = "2026-09-01T00:00:00.000Z";
    expect(assertProjectDefinition(old).funding.commitments).toHaveLength(1);
  });

  it("binds exact month, amount, and single active instrument", () => {
    for (const mutate of [
      (p: ReturnType<typeof fixture>) => {
        p.funding.commitments[0].effectiveAt = "2026-08-02T00:00:00.000Z";
      },
      (p: ReturnType<typeof fixture>) => {
        p.funding.commitments[0].deadline = "2026-10-01T00:00:00.000Z";
      },
      (p: ReturnType<typeof fixture>) => {
        p.funding.commitments[0].monthlyCommitment.amountMinor = "4999999";
      },
      (p: ReturnType<typeof fixture>) => {
        p.funding.commitments[0].monthlyCommitment.amountMinor =
          "999999999999999";
      },
      (p: ReturnType<typeof fixture>) => {
        p.funding.commitments[0].monthlyCommitment.amountMinor = "0";
      },
    ]) {
      const project = fixture();
      mutate(project);
      expect(() => assertProjectDefinition(project)).toThrow(/month|amount/u);
    }
    const duplicate = fixture();
    const extra = structuredClone(duplicate.funding.commitments[0]);
    extra.multisig = "SysvarC1ock11111111111111111111111111111111";
    extra.vaultIndex = 1;
    extra.replacedAt = "2026-08-15T00:00:00.000Z";
    // Use a second network to ensure per-network overlap checks are insufficient.
    (duplicate.funding.commitments as unknown[]).push({
      kind: "sablier-lockup-v4",
      network: "base",
      asset: "USDC",
      contract: "0xc19a09a66887017f603e5df420ed3cb9a5c07c0a",
      streamId: "42",
      monthlyCommitment: extra.monthlyCommitment,
      effectiveAt: extra.effectiveAt,
      deadline: extra.deadline,
      replacedAt: null,
    });
    expect(() => assertProjectDefinition(duplicate)).toThrow(/one instrument/u);
  });

  it("rejects project or funder identity aliases without claiming control from distinct IDs", () => {
    for (const identity of [
      { actorId: eliza.steward.github.actorId },
      { nodeId: eliza.steward.github.nodeId },
      { login: eliza.steward.github.login.toUpperCase() },
      { actorId: "18633264" },
    ]) {
      const project = fixture();
      Object.assign(project.funding.commitments[0].stewardGithub, identity);
      expect(() => assertProjectDefinition(project)).toThrow(
        /identity must differ/u,
      );
    }
    const missing = fixture();
    delete (
      missing.funding.commitments[0] as unknown as Record<string, unknown>
    ).stewardGithub;
    expect(() => assertProjectDefinition(missing)).toThrow(
      /named independent steward/u,
    );
  });

  it("excludes even replaced receiving routes and every declared project/funder key", () => {
    const project = fixture();
    project.funding.addresses = [
      {
        network: "solana",
        asset: "USDC",
        address: independent,
        effectiveAt: "2026-07-01T00:00:00.000Z",
        replacedAt: "2026-08-01T00:00:00.000Z",
      },
    ] as never;
    expect(() => assertProjectDefinition(project)).toThrow(
      /manifest-attributed/u,
    );
    for (const key of ["multisig", "vault", "funderMember"] as const) {
      const collision = fixture();
      collision.funding.commitments[0].stewardMember =
        collision.funding.commitments[0][key];
      expect(() => assertProjectDefinition(collision)).toThrow(
        /manifest-attributed|distinct/u,
      );
    }
  });

  it("cannot reuse the same instrument in a successor month", () => {
    const first = fixture().funding.commitments[0];
    first.replacedAt = "2026-09-01T00:00:00.000Z";
    const next = structuredClone(first);
    next.effectiveAt = "2026-09-01T00:00:00.000Z";
    next.deadline = "2026-10-01T00:00:00.000Z";
    next.replacedAt = null;
    next.monthlyCommitment.cycleId = "2026-09";
    expect(() => assertFundingCommitments([first, next])).toThrow(
      /duplicate instrument/u,
    );
  });

  it("publishes unknown for legacy indexes and refuses an accessible claim", () => {
    const old = {
      schemaVersion: "1",
      generatedAt: null,
      records: [],
      commitments: [],
    };
    expect(
      assertProjectFundingIndex(old, new Map(), new Map())
        .commitmentAccessibility,
    ).toBe("unknown");
    expect(() =>
      assertProjectFundingIndex(
        { ...old, commitmentAccessibility: "accessible" },
        new Map(),
        new Map(),
      ),
    ).toThrow(/accessibility must remain unknown/u);
  });
});
