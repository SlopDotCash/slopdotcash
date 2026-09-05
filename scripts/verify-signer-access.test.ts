import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import eliza from "../projects/eliza/project.json";
import { assertProjectDefinition } from "../src/lib/project-schema.mjs";
import {
  assertSignerAccessReport,
  type SignerAccessReport,
  signerAccessCommitMessage,
  signerCapabilityMessage,
  squadsAccessInstrumentId,
  verifySignerAccess,
} from "./verify-signer-access";

function base58(bytes: Uint8Array): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let number = BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
  let result = "";
  while (number > 0n) {
    result = alphabet[Number(number % 58n)] + result;
    number /= 58n;
  }
  let leading = 0;
  while (leading < bytes.length && bytes[leading] === 0) leading++;
  return "1".repeat(leading) + result;
}
function fixture(role: "funder" | "steward" = "funder") {
  const keys = generateKeyPairSync("ed25519");
  const other = generateKeyPairSync("ed25519");
  const member = base58(
    keys.publicKey.export({ format: "der", type: "spki" }).subarray(-32),
  );
  const otherMember = base58(
    other.publicKey.export({ format: "der", type: "spki" }).subarray(-32),
  );
  const instrument = {
    kind: "squads-v4-vault" as const,
    network: "solana" as const,
    asset: "USDC" as const,
    multisig: "11111111111111111111111111111111",
    vault: "Vote111111111111111111111111111111111111111",
    vaultIndex: 0,
    funderActorId: "18633264",
    funderMember: role === "funder" ? member : otherMember,
    stewardMember: role === "steward" ? member : otherMember,
    stewardGithub: {
      actorId: "42",
      nodeId: "U_fixture_42",
      login: "independent-fixture",
    },
    monthlyCommitment: {
      cycleId: "2026-09",
      amountMinor: "5000000",
      accessibility: "unknown" as const,
    },
    effectiveAt: "2026-09-01T00:00:00.000Z",
    deadline: "2026-10-01T00:00:00.000Z",
    replacedAt: null,
  };
  const project = assertProjectDefinition({
    ...structuredClone(eliza),
    reward: {
      ...eliza.reward,
      fundingState: "committed",
      committedMinor: "5000000",
      paymentMode: "disabled",
    },
    funding: { ...eliza.funding, commitments: [instrument] },
  });
  const report: SignerAccessReport = {
    kind: "slop-signer-access",
    schemaVersion: "1",
    projectId: project.id,
    manifestRevision: "a".repeat(40),
    cycleId: "2026-09",
    instrumentId: squadsAccessInstrumentId(instrument),
    actorId: role === "funder" ? "18633264" : "42",
    role,
    member,
    capability: "can-sign",
    reportedAt: "2026-09-05T20:00:00.000Z",
    expiresAt: "2026-09-06T20:00:00.000Z",
    reason: "I can sign with the reviewed member key.",
    memberSignature: null,
    sourceRepository: "example/evidence",
    sourceCommit: "b".repeat(40),
  };
  report.memberSignature = sign(
    null,
    Buffer.from(signerCapabilityMessage(report)),
    keys.privateKey,
  ).toString("base64");
  const commit = () => ({
    oid: report.sourceCommit,
    message: `${signerAccessCommitMessage(report)}\n`,
    signature: {
      isValid: true,
      state: "VALID",
      signer: {
        databaseId: Number(report.actorId),
        id: role === "steward" ? "U_fixture_42" : "U_funder",
      },
    },
  });
  const input = () => ({
    report,
    project,
    manifestRevision: report.manifestRevision,
    now: "2026-09-05T20:01:00.000Z",
    readCommit: async () => commit(),
  });
  return { report, project, commit, input };
}

describe("independently authenticated signer access reports", () => {
  it.each(["funder", "steward"] as const)(
    "verifies %s GitHub identity and member proof",
    async (role) => {
      const f = fixture(role);
      expect(await verifySignerAccess(f.input())).toEqual(f.report);
    },
  );
  it.each(["funder", "steward"] as const)(
    "authenticates %s loss without requiring the lost key",
    async (role) => {
      const f = fixture(role);
      f.report.capability = "lost-access";
      f.report.memberSignature = null;
      f.report.expiresAt = null;
      f.report.reason = "Signing capability was lost.";
      expect(await verifySignerAccess(f.input())).toEqual(f.report);
    },
  );
  it("does not accept a GitHub signature alone as capability proof", async () => {
    const f = fixture();
    f.report.memberSignature = Buffer.alloc(64).toString("base64");
    await expect(verifySignerAccess(f.input())).rejects.toThrow(
      "Member capability signature",
    );
  });
  it("rejects forged identity-point signatures accepted by native permissive verification", async () => {
    const f = fixture();
    const publicKey = Buffer.alloc(32);
    publicKey[0] = 1;
    const signature = Buffer.alloc(64);
    signature[0] = 1;
    f.report.member = base58(publicKey);
    f.report.memberSignature = signature.toString("base64");
    const rawProject = structuredClone(f.project);
    const instrument = rawProject.funding.commitments?.[0];
    if (instrument?.kind !== "squads-v4-vault") throw new Error("fixture");
    const project = assertProjectDefinition({
      ...rawProject,
      funding: {
        ...rawProject.funding,
        commitments: [{ ...instrument, funderMember: f.report.member }],
      },
    });
    await expect(verifySignerAccess({ ...f.input(), project })).rejects.toThrow(
      "Member capability signature",
    );
  });
  it.each(["reason", "reportedAt", "sourceRepository"])(
    "binds %s into the member proof",
    async (field) => {
      const f = fixture();
      if (field === "reason") f.report.reason = "Changed claim";
      if (field === "reportedAt")
        f.report.reportedAt = "2026-09-05T20:00:01.000Z";
      if (field === "sourceRepository")
        f.report.sourceRepository = "another/repository";
      await expect(verifySignerAccess(f.input())).rejects.toThrow(
        "Member capability signature",
      );
    },
  );
  it.each([
    "invalid",
    "wrong-actor",
    "wrong-message",
    "wrong-commit",
    "wrong-node",
  ])("rejects GitHub evidence: %s", async (failure) => {
    const f = fixture("steward");
    const commit = f.commit();
    if (failure === "invalid") commit.signature.isValid = false;
    if (failure === "wrong-actor") commit.signature.signer.databaseId = 99;
    if (failure === "wrong-message") commit.message += "extra text";
    if (failure === "wrong-commit") commit.oid = "c".repeat(40);
    if (failure === "wrong-node") commit.signature.signer.id = "U_other";
    await expect(
      verifySignerAccess({ ...f.input(), readCommit: async () => commit }),
    ).rejects.toThrow("GitHub signature");
  });
  it("rejects role substitution and future reports", async () => {
    const f = fixture();
    f.report.role = "steward";
    await expect(verifySignerAccess(f.input())).rejects.toThrow("authority");
    f.report.role = "funder";
    await expect(
      verifySignerAccess({ ...f.input(), now: "2026-09-05T19:00:00.000Z" }),
    ).rejects.toThrow("time");
  });
  it("rejects expanded lifetime, expiring loss, unknown fields and control characters", () => {
    const f = fixture();
    for (const change of [
      { expiresAt: "2026-09-07T20:00:00.000Z" },
      { capability: "lost-access" },
      { reason: "unsafe\ncopy" },
      { arbitrary: true },
    ])
      expect(() =>
        assertSignerAccessReport({ ...f.report, ...change }),
      ).toThrow();
  });
  it("fails closed on unavailable GitHub authority", async () => {
    const f = fixture();
    await expect(
      verifySignerAccess({
        ...f.input(),
        readCommit: async () => {
          throw new Error("unavailable");
        },
      }),
    ).rejects.toThrow("unavailable");
  });
});
