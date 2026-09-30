import { describe, expect, it } from "vitest";
import {
  assertPublicSignerReport,
  type PublicSignerReport,
  publicSignerStatus,
} from "./signer-capability";

const report: PublicSignerReport = {
  projectId: "eliza",
  cycleId: "2026-09",
  instrumentId:
    "squads-v4-vault:solana:11111111111111111111111111111111:0:Vote111111111111111111111111111111111111111",
  role: "funder",
  member: "11111111111111111111111111111111",
  capability: "can-sign",
  reportedAt: "2026-09-05T20:00:00.000Z",
  expiresAt: "2026-09-06T20:00:00.000Z",
  reason: "Synthetic public report.",
  sourceRepository: "example/evidence",
  sourceCommit: "a".repeat(40),
};
const at = (value: string) => Date.parse(value);
describe("public signer capability, never payment availability", () => {
  it("requires both roles for one instrument and expires at the exact boundary", () => {
    const both = [
      report,
      { ...report, role: "steward" as const, sourceCommit: "b".repeat(40) },
    ];
    expect(publicSignerStatus([report], at("2026-09-06T00:00:00.000Z"))).toBe(
      "unknown",
    );
    expect(publicSignerStatus(both, at("2026-09-06T19:59:59.999Z"))).toBe(
      "both-signers-current",
    );
    expect(publicSignerStatus(both, at("2026-09-06T20:00:00.000Z"))).toBe(
      "unknown",
    );
    expect(() =>
      publicSignerStatus(
        [report, { ...both[1], cycleId: "2026-10" }],
        at("2026-09-06T00:00:00.000Z"),
      ),
    ).toThrow("one exact monthly instrument");
  });
  it("retains a published loss despite later or future positive claims", () => {
    const loss = assertPublicSignerReport({
      ...report,
      capability: "lost-access",
      expiresAt: null,
    });
    const future = {
      ...report,
      reportedAt: "2026-09-07T00:00:00.000Z",
      expiresAt: "2026-09-08T00:00:00.000Z",
    };
    expect(
      publicSignerStatus([future, loss], at("2026-09-06T00:00:00.000Z")),
    ).toBe("inaccessible");
    expect(publicSignerStatus([future], at("2026-09-06T00:00:00.000Z"))).toBe(
      "unknown",
    );
  });
  it("rejects unsafe source links, extended lifetimes, and expiring losses", () => {
    for (const change of [
      { sourceRepository: "https://evil.invalid" },
      { role: ["funder"] },
      { capability: ["can-sign"] },
      { sourceCommit: "main" },
      { expiresAt: "2026-09-07T20:00:00.000Z" },
      { capability: "lost-access" },
      { paymentAuthorized: true },
    ])
      expect(() =>
        assertPublicSignerReport({ ...report, ...change }),
      ).toThrow();
  });
  it("requires the creator and the independent signer on a project vault and never Slop", () => {
    const instrumentId =
      "squads-project-vault:solana:SysvarC1ock11111111111111111111111111111111:0:Vote111111111111111111111111111111111111111";
    const creator: PublicSignerReport = {
      ...report,
      instrumentId,
      role: "creator",
      member: "BPFLoaderUpgradeab1e11111111111111111111111",
    };
    const independent: PublicSignerReport = {
      ...report,
      instrumentId,
      role: "independent",
      member: "SysvarRecentB1ockHashes11111111111111111111",
      sourceCommit: "b".repeat(40),
    };
    const at1 = at("2026-09-06T00:00:00.000Z");
    expect(publicSignerStatus([creator], at1)).toBe("unknown");
    expect(publicSignerStatus([creator, independent], at1)).toBe(
      "creator-and-independent-current",
    );
    expect(
      publicSignerStatus(
        [creator, independent],
        at("2026-09-06T20:00:00.000Z"),
      ),
    ).toBe("unknown");
    expect(
      publicSignerStatus(
        [
          creator,
          { ...independent, capability: "lost-access", expiresAt: null },
        ],
        at1,
      ),
    ).toBe("inaccessible");
    // Roles are bound to the instrument kind: a 2-of-2 role cannot satisfy a
    // project vault and Slop's vote-only key has no role at all.
    expect(() =>
      assertPublicSignerReport({ ...creator, role: "funder" }),
    ).toThrow("Invalid public signer report");
    expect(() =>
      assertPublicSignerReport({ ...report, role: "creator" }),
    ).toThrow("Invalid public signer report");
    expect(() =>
      assertPublicSignerReport({ ...creator, role: "slop" }),
    ).toThrow("Invalid public signer report");
  });
});
