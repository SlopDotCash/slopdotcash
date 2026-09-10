import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertProjectCommitmentRecord } from "../src/lib/funding-commitment";
import { findProject, type ProjectDefinition } from "../src/lib/projects.mjs";
import {
  assertFundingDepositRequest,
  createFundingDepositEvidence,
  writeFundingDepositEvidence,
} from "./prepare-funding-deposit";
import type { verifyCommitmentSquads } from "./verify-commitment-squads";
import type { verifyFundingSolana } from "./verify-funding-solana";

const SIGNATURE = "3".repeat(88);
const request = { project: "eliza", cycle: "2026-08", signature: SIGNATURE };
function context() {
  const project = {
    ...(structuredClone(findProject("eliza")) as ProjectDefinition),
  };
  project.funding = {
    ...project.funding,
    commitments: [
      {
        kind: "squads-v4-vault",
        network: "solana",
        asset: "USDC",
        multisig: "xmWqhNJwNL4z4BcDo1Yh7BbStLU7omVafZNmg91y2Vg",
        vault: "FTK6ckiPWbe1jAiRtcPCz9sCrvCV6Y6hAJhAU5b9S3nv",
        vaultIndex: 0,
        funderMember: "Stake11111111111111111111111111111111111111",
        stewardMember: "SysvarRent111111111111111111111111111111111",
        funderActorId: "123",
        effectiveAt: "2026-08-01T00:00:00.000Z",
        deadline: "2026-09-01T00:00:00.000Z",
        replacedAt: null,
        monthlyCommitment: {
          cycleId: "2026-08",
          amountMinor: "10000000",
          accessibility: "unknown",
        },
      },
    ],
  };
  return {
    project,
    manifestRevision: "a".repeat(40),
    history: { records: [], commitments: [] },
  };
}
function verifiers() {
  const calls: unknown[] = [];
  const chainEvidence = {
    signature: SIGNATURE,
    slot: 100,
    blockTime: Date.parse("2026-08-15T00:00:00.000Z") / 1000,
  };
  const verifier = {
    version: "commitment-squads-v2" as const,
    checkedAt: "2026-09-10T00:00:00.000Z",
    evidenceUrl: `https://solscan.io/tx/${SIGNATURE}`,
    reason: null,
  };
  const verifyDeposit: typeof verifyCommitmentSquads = async (input) => {
    calls.push(input);
    return {
      mode: "deposit",
      event: "deposit",
      state: "verified-on-chain",
      multisig: input.multisig,
      vault: input.vault,
      vaultIndex: input.vaultIndex,
      funderMember: input.funderMember,
      stewardMember: input.stewardMember,
      finality: { kind: "finalized" },
      verifier,
      chainEvidence,
      authorities: [
        { authority: "https://api.mainnet-beta.solana.com/" },
        { authority: "https://solana-rpc.publicnode.com/" },
      ],
    };
  };
  const verifyTransfer: typeof verifyFundingSolana = async (input) => {
    calls.push(input);
    return {
      state: "verified-on-chain",
      finality: { kind: "finalized" },
      verifier: { ...verifier, version: "funding-solana-v1" },
      chainEvidence,
    };
  };
  return { calls, verifyDeposit, verifyTransfer };
}

describe("trusted deposit evidence preparation", () => {
  it("derives full deposit amount and exact instrument, produces a valid immutable record without activating funding", async () => {
    const authority = context();
    const before = structuredClone(authority);
    const services = verifiers();
    const result = await createFundingDepositEvidence(
      request,
      authority,
      services,
    );
    expect(result.record).toMatchObject({
      event: "deposit",
      projectId: "eliza",
      manifestRevision: authority.manifestRevision,
      amountMinor: "10000000",
      transactionId: SIGNATURE,
      observedAt: "2026-08-15T00:00:00.000Z",
      supersedes: null,
    });
    expect(
      assertProjectCommitmentRecord(
        result.record,
        authority.project.funding.commitments ?? [],
      ),
    ).toEqual(result.record);
    expect(result.evidence).toMatchObject({
      request: { cycle: "2026-08" },
      paymentAuthorized: false,
      fundingActivated: false,
    });
    expect(authority).toEqual(before);
    expect(services.calls[0]).toMatchObject({
      mode: "deposit",
      amountMinor: "10000000",
      vault:
        authority.project.funding.commitments?.[0].kind === "squads-v4-vault"
          ? authority.project.funding.commitments[0].vault
          : "",
    });
    expect(Object.keys(services.calls[0] as object)).not.toContain("rpcUrl");
  });
  it("preserves an explicit amount above the safe-float range exactly and keeps retry identity stable", async () => {
    const first = await createFundingDepositEvidence(
      { ...request, amountMinor: "9007199254740993" },
      context(),
      verifiers(),
    );
    const second = await createFundingDepositEvidence(
      request,
      context(),
      verifiers(),
    );
    expect(first.record.amountMinor).toBe("9007199254740993");
    expect(first.record.recordId).toBe(second.record.recordId);
    expect(first.recordPath).toBe(second.recordPath);
  });
  it.each(["0", "1.5", "-1", "01", "18446744073709551616", "1\nBOGUS=x"])(
    "rejects invalid amount %s before verification",
    async (amountMinor) => {
      const services = verifiers();
      await expect(
        createFundingDepositEvidence(
          { ...request, amountMinor },
          context(),
          services,
        ),
      ).rejects.toThrow(/integer/);
      expect(services.calls).toEqual([]);
    },
  );
  it("rejects wrong cycle, missing/replaced instrument and unregistered project before RPC", async () => {
    for (const kind of ["cycle", "missing", "replaced", "project"]) {
      const authority = context();
      const services = verifiers();
      if (kind === "missing")
        authority.project.funding = {
          ...authority.project.funding,
          commitments: [],
        };
      if (kind === "replaced")
        authority.project.funding = {
          ...authority.project.funding,
          commitments: authority.project.funding.commitments?.map(
            (instrument) => ({
              ...instrument,
              replacedAt: "2026-09-01T00:00:00.000Z",
            }),
          ),
        };
      await expect(
        createFundingDepositEvidence(
          {
            ...request,
            ...(kind === "cycle" ? { cycle: "2026-09" } : {}),
            ...(kind === "project" ? { project: "other" } : {}),
          },
          authority,
          services,
        ),
      ).rejects.toThrow(/instrument|project/);
      expect(services.calls).toEqual([]);
    }
  });
  it("rejects replay across projects and both funding record families", async () => {
    const existing = await createFundingDepositEvidence(
      request,
      context(),
      verifiers(),
    );
    const services = verifiers();
    await expect(
      createFundingDepositEvidence(
        request,
        {
          ...context(),
          history: {
            records: [],
            commitments: [{ ...existing.record, projectId: "other" }],
          },
        },
        services,
      ),
    ).rejects.toThrow(/already has funding evidence/);
    expect(services.calls).toEqual([]);
  });
  it("fails verifier outages and transaction disagreement without emitting a record", async () => {
    const services = verifiers();
    await expect(
      createFundingDepositEvidence(request, context(), {
        ...services,
        verifyDeposit: async () => {
          throw new Error("No quorum");
        },
      }),
    ).rejects.toThrow(/No quorum/);
    await expect(
      createFundingDepositEvidence(request, context(), {
        ...services,
        verifyTransfer: async (input) => {
          const result = await services.verifyTransfer(input);
          return {
            ...result,
            chainEvidence: { ...result.chainEvidence, slot: 101 },
          };
        },
      }),
    ).rejects.toThrow(/did not agree/);
  });
  it("refuses deposits before instrument activation", async () => {
    const services = verifiers();
    const prior = {
      signature: SIGNATURE,
      slot: 100,
      blockTime: Date.parse("2026-07-31T00:00:00.000Z") / 1000,
    };
    await expect(
      createFundingDepositEvidence(request, context(), {
        verifyDeposit: async (input) => ({
          ...(await services.verifyDeposit(input)),
          chainEvidence: prior,
        }),
        verifyTransfer: async (input) => ({
          ...(await services.verifyTransfer(input)),
          chainEvidence: prior,
        }),
      }),
    ).rejects.toThrow(/not active/);
  });
  it("writes one canonical record and preserves it on a second attempt", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deposit-evidence-"));
    try {
      const result = await createFundingDepositEvidence(
        request,
        context(),
        verifiers(),
      );
      await writeFundingDepositEvidence(
        directory,
        join(directory, "evidence"),
        result,
      );
      const original = await readFile(
        join(directory, result.recordPath),
        "utf8",
      );
      await expect(
        writeFundingDepositEvidence(
          directory,
          join(directory, "second-evidence"),
          result,
        ),
      ).rejects.toThrow(/refusing to replace/);
      expect(await readFile(join(directory, result.recordPath), "utf8")).toBe(
        original,
      );
      expect(JSON.parse(original)).toEqual(result.record);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("rejects caller-supplied authority and shell input", () => {
    expect(() =>
      assertFundingDepositRequest({
        ...request,
        project: "eliza; touch /tmp/no",
      }),
    ).toThrow();
    expect(() =>
      assertFundingDepositRequest({ ...request, signature: "--rpc-url" }),
    ).toThrow();
    expect(() =>
      assertFundingDepositRequest(
        Object.assign({ ...request }, { vault: "caller-controlled" }),
      ),
    ).toThrow();
  });
});
