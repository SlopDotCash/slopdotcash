import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSettlementExecutionPlan } from "../src/lib/settlement-plan";
import { prepareSquadsBatchHandoff } from "../src/lib/squads-batch-handoff";
import {
  compileSquadsBatchChild,
  exactUsdcDecimal,
  joinBytes,
  littleEndian,
  solanaKeyBytes,
} from "../src/lib/squads-batch-message";
import {
  assertSquadsBindingLedger,
  assertSquadsBindingTransition,
  assertSquadsExecutionObservation,
  executionSha256,
  validateSquadsExecutionContext,
} from "../src/lib/squads-execution";
import {
  squadsBatchChildAddress,
  squadsExecutionAddress,
  squadsUsdcAta,
  verifySquadsExecution,
} from "../src/lib/squads-execution-verifier";
import {
  SPL_TOKEN_PROGRAM_ID,
  SQUADS_V4_PROGRAM_ID,
} from "../src/lib/squads-funding";
import { executionContext } from "../tests/squads-execution-context";
import { parseBatchHandoffArguments } from "./prepare-squads-batch";

const MEMBER = "Stake11111111111111111111111111111111111111";
const SOURCE = "Vote111111111111111111111111111111111111111";
function key(index: number) {
  let n = BigInt(
      `0x${createHash("sha256").update(`batch-recipient-${index}`).digest("hex")}`,
    ),
    s = "";
  const a = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  while (n) {
    s = a[Number(n % 58n)] + s;
    n /= 58n;
  }
  const bytes = createHash("sha256")
    .update(`batch-recipient-${index}`)
    .digest();
  let leading = 0;
  while (leading < bytes.length && bytes[leading] === 0) leading++;
  return "1".repeat(leading) + s;
}
async function fixture(contributors = 55) {
  const one = await executionContext();
  const allocation = JSON.parse(new TextDecoder().decode(one.allocationBytes));
  allocation.allocations = Array.from({ length: contributors }, (_, i) => ({
    ...allocation.allocations[0],
    intentId: `pay_eliza_2026_07_b${i}`,
    actor: { id: `U_B${i}`, login: `batch${i}` },
    wallet: {
      ...allocation.allocations[0].wallet,
      address: key(i),
      sourceUrl: `https://github.com/batch${i}/batch${i}/blob/${"a".repeat(40)}/README.md`,
    },
  }));
  allocation.totals = {
    suggestedMinor: String(contributors * 1000000),
    approvedMinor: String(contributors * 1000000),
    feeMinor: String(contributors * 10000),
  };
  const allocationBytes = new TextEncoder().encode(JSON.stringify(allocation));
  const plan = createSettlementExecutionPlan({
    allocation,
    allocationSha256: await executionSha256(allocationBytes),
    createdAt: "2026-08-15T00:01:00.000Z",
    feeRecipient: MEMBER,
    sourceOwner: one.ledger[0].vault,
  });
  const planBytes = new TextEncoder().encode(JSON.stringify(plan));
  const handoff = await prepareSquadsBatchHandoff({
    allocationBytes,
    planBytes,
    multisig: SOURCE,
    vaultIndex: 0,
    transactionIndex: "1",
    member: MEMBER,
  });
  return {
    allocationBytes,
    planBytes,
    plan,
    handoff,
    projectId: "eliza",
    baseLedger: [],
    ledger: [handoff.binding],
  };
}
const disc = (name: string) =>
  new Uint8Array(
    createHash("sha256").update(`account:${name}`).digest().subarray(0, 8),
  );
async function accounts(f: Awaited<ReturnType<typeof fixture>>, executed = 0) {
  const binding = f.handoff.binding;
  const proposal = new Uint8Array(70);
  proposal.set(disc("Proposal"));
  proposal.set(solanaKeyBytes(SOURCE), 8);
  proposal.set(littleEndian(1, 8), 40);
  proposal[48] = executed === binding.children.length ? 5 : 3;
  proposal[57] = (await squadsExecutionAddress(SOURCE, "1", true)).bump;
  // Vault bump is independently derived by the reference single fixture decoder.
  const vaultBump = await (async () => {
    const { ed25519 } = await import("@noble/curves/ed25519.js");
    for (let b = 255; b >= 0; b--) {
      const hash = createHash("sha256")
        .update(
          joinBytes([
            new TextEncoder().encode("multisig"),
            solanaKeyBytes(SOURCE),
            new TextEncoder().encode("vault"),
            new Uint8Array([0, b]),
            solanaKeyBytes(SQUADS_V4_PROGRAM_ID),
            new TextEncoder().encode("ProgramDerivedAddress"),
          ]),
        )
        .digest();
      try {
        ed25519.Point.fromBytes(hash);
      } catch {
        return b;
      }
    }
    throw new Error("No bump");
  })();
  const batch = joinBytes([
    disc("Batch"),
    solanaKeyBytes(SOURCE),
    solanaKeyBytes(MEMBER),
    littleEndian(1, 8),
    new Uint8Array([
      (await squadsExecutionAddress(SOURCE, "1", false)).bump,
      0,
      vaultBump,
    ]),
    littleEndian(binding.children.length, 4),
    littleEndian(executed, 4),
  ]);
  const state = new Map<
    string,
    { owner: string; executable: boolean; data: [string, string] }
  >();
  const put = (
    address: string,
    bytes: Uint8Array,
    owner: string = SQUADS_V4_PROGRAM_ID,
  ) =>
    state.set(address, {
      owner,
      executable: false,
      data: [Buffer.from(bytes).toString("base64"), "base64"],
    });
  put(binding.proposalAccount, proposal);
  put(binding.batchAccount, batch);
  for (const child of binding.children) {
    const message = await compileSquadsBatchChild(
      f.plan,
      child.transferIndexes,
    );
    put(
      child.transactionAccount,
      joinBytes([
        disc("VaultBatchTransaction"),
        new Uint8Array([
          (await squadsBatchChildAddress(SOURCE, "1", child.transactionIndex))
            .bump,
        ]),
        littleEndian(0, 4),
        message.storedBytes,
      ]),
    );
  }
  for (const owner of [
    binding.vault,
    ...f.plan.transfers.map((t) => t.recipientOwner),
  ]) {
    const bytes = new Uint8Array(165);
    bytes.set(solanaKeyBytes(f.plan.token.mint));
    bytes.set(solanaKeyBytes(owner), 32);
    bytes[108] = 1;
    put(await squadsUsdcAta(owner), bytes, SPL_TOKEN_PROGRAM_ID);
  }
  const fetchImpl = async (_url: URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const keys = body.params[0] as string[];
    expect(keys.length).toBeLessThanOrEqual(100);
    return Response.json({
      jsonrpc: "2.0",
      id: body.id,
      result: {
        context: { slot: 900 },
        value: keys.map((k) => state.get(k) ?? null),
      },
    });
  };
  return { state, fetchImpl, put, batch, proposal };
}
describe("bounded Squads Batch contract and external handoff", () => {
  it("covers 55 recipients and fee once in 12 children with measured packet/account bounds", async () => {
    const f = await fixture();
    const h = f.handoff;
    expect(h.binding.children).toHaveLength(12);
    expect(h.binding.children.flatMap((c) => c.transferIndexes)).toEqual(
      Array.from({ length: 56 }, (_, i) => i),
    );
    expect(
      h.children
        .flatMap((c) => c.transfers)
        .filter((t) => t.kind === "platform-fee"),
    ).toHaveLength(1);
    for (const op of [...h.setup, h.activate, ...h.execute]) {
      expect(op.measurement.wireBytes).toBe(
        Buffer.from(op.measurement.templateBase64, "base64").length,
      );
      expect(op.measurement.wireBytes).toBeLessThanOrEqual(1232);
      expect(op.measurement.accountCount).toBeLessThanOrEqual(64);
      expect(op.measurement.simulation).toBe("not-run");
    }
    expect(h.simulation).toBe("not-run");
    expect(h.paymentVerified).toBe(false);
    expect(Math.max(...h.setup.map((op) => op.measurement.wireBytes))).toBe(
      1053,
    );
    expect(Math.max(...h.execute.map((op) => op.measurement.wireBytes))).toBe(
      878,
    );
    expect(
      Math.max(...h.execute.map((op) => op.measurement.accountCount)),
    ).toBe(23);
    expect(h.execute[0].simulationRequest.method).toBe("simulateTransaction");
    expect(await validateSquadsExecutionContext(f)).toEqual(h.binding);
    expect(
      await prepareSquadsBatchHandoff({
        allocationBytes: f.allocationBytes,
        planBytes: f.planBytes,
        multisig: SOURCE,
        vaultIndex: 0,
        transactionIndex: "1",
        member: MEMBER,
      }),
    ).toEqual(h);
  });
  it("retains the existing 200-transfer parent contract without omitted or new fee plans", async () => {
    const f = await fixture(199);
    expect(f.handoff.binding.children).toHaveLength(40);
    expect(f.handoff.children.flatMap((c) => c.transfers)).toHaveLength(200);
    const rpc = await accounts(f);
    expect(
      (await verifySquadsExecution(f, { fetchImpl: rpc.fetchImpl }))
        .instructionVerification,
    ).toBe("verified");
  }, 30000);
  it("uses integer-only decimal conversion above Number precision", () => {
    expect(exactUsdcDecimal("9007199254740993")).toBe("9007199254.740993");
    expect(exactUsdcDecimal("1")).toBe("0.000001");
    expect(() => exactUsdcDecimal("1e6")).toThrow();
  });
  it.each(["duplicate", "omit", "reorder", "foreign-account", "extra-field"])(
    "rejects child %s",
    async (defect) => {
      const f = await fixture(6);
      const b = structuredClone(f.handoff.binding);
      if (defect === "duplicate") b.children[1].transferIndexes[0] = 0;
      if (defect === "omit") b.children.pop();
      if (defect === "reorder") b.children.reverse();
      if (defect === "foreign-account")
        b.children[1].transactionAccount = b.children[0].transactionAccount;
      if (defect === "extra-field")
        Object.assign(b.children[0], { paid: true });
      await expect(
        validateSquadsExecutionContext({ ...f, ledger: [b] }),
      ).rejects.toThrow();
    },
  );
  it("rejects tampered message digest and replacing accepted child coverage", async () => {
    const f = await fixture(6);
    const b = structuredClone(f.handoff.binding);
    b.children[0].messageSha256 = "f".repeat(64);
    await expect(
      validateSquadsExecutionContext({ ...f, ledger: [b] }),
    ).rejects.toThrow(/hash/);
    expect(() =>
      assertSquadsBindingTransition([f.handoff.binding], [b]),
    ).toThrow(/immutable/);
    expect(() =>
      assertSquadsBindingLedger([f.handoff.binding, f.handoff.binding]),
    ).toThrow(/Duplicate/);
  });
  it.each([0, 1, 12])(
    "observes exact children and execution prefix %i without claiming payment",
    async (executed) => {
      const f = await fixture();
      const rpc = await accounts(f, executed);
      const result = await verifySquadsExecution(f, {
        fetchImpl: rpc.fetchImpl,
      });
      expect(result.instructionVerification).toBe("verified");
      expect(result.batchProgress).toEqual({
        totalChildren: 12,
        executedChildren: executed,
      });
      expect(result.paymentVerified).toBe(false);
      expect(
        assertSquadsExecutionObservation(result, f.handoff.binding),
      ).toEqual(result);
    },
    30000,
  );
  it.each([
    "missing-child",
    "wrong-owner",
    "wrong-bump",
    "wrong-discriminator",
    "changed-message",
    "extra-child",
    "bad-progress",
  ])("fails closed on %s", async (defect) => {
    const f = await fixture(6);
    const rpc = await accounts(f);
    const c = f.handoff.binding.children[0].transactionAccount;
    const value = rpc.state.get(c);
    if (!value) throw new Error("fixture");
    const bytes = Buffer.from(value.data[0], "base64");
    if (defect === "missing-child") rpc.state.delete(c);
    if (defect === "wrong-owner") value.owner = SPL_TOKEN_PROGRAM_ID;
    if (defect === "wrong-bump") {
      bytes[8] ^= 1;
      rpc.put(c, bytes);
    }
    if (defect === "wrong-discriminator") {
      bytes[0] ^= 1;
      rpc.put(c, bytes);
    }
    if (defect === "changed-message") {
      bytes[bytes.length - 5] ^= 1;
      rpc.put(c, bytes);
    }
    if (defect === "extra-child") {
      rpc.batch[83]++;
      rpc.put(f.handoff.binding.batchAccount, rpc.batch);
    }
    if (defect === "bad-progress") {
      rpc.batch[87] = 3;
      rpc.put(f.handoff.binding.batchAccount, rpc.batch);
    }
    const result = await verifySquadsExecution(f, { fetchImpl: rpc.fetchImpl });
    expect(result.instructionVerification).toBe("unverified");
    expect(result.batchProgress).toBe(null);
  });
  it("refuses invented progress and signing CLI inputs", async () => {
    const f = await fixture(1);
    const rpc = await accounts(f);
    const result = await verifySquadsExecution(f, { fetchImpl: rpc.fetchImpl });
    expect(() =>
      assertSquadsExecutionObservation(
        { ...result, batchProgress: { totalChildren: 1, executedChildren: 1 } },
        f.handoff.binding,
      ),
    ).toThrow();
    expect(() => parseBatchHandoffArguments(["--keypair", "secret"])).toThrow();
  });
  it("does not claim child progress without two identical complete RPC observations", async () => {
    const f = await fixture(6),
      first = await accounts(f, 0),
      second = await accounts(f, 1);
    const result = await verifySquadsExecution(f, {
      fetchImpl: async (url, init) => {
        if (url.host === "solana.drpc.org") throw new Error("unavailable");
        return (
          url.host === "api.mainnet-beta.solana.com" ? first : second
        ).fetchImpl(url, init);
      },
    });
    expect(result.instructionVerification).toBe("unverified");
    expect(result.batchProgress).toBe(null);
  });
  it("requires existing destination accounts for the observed executed prefix", async () => {
    const f = await fixture(6),
      rpc = await accounts(f, 1);
    rpc.state.delete(await squadsUsdcAta(f.plan.transfers[0].recipientOwner));
    expect(
      (await verifySquadsExecution(f, { fetchImpl: rpc.fetchImpl }))
        .instructionVerification,
    ).toBe("unverified");
  });
  it("refuses root mutation and decreasing slots during child/token reads", async () => {
    const f = await fixture(6),
      rpc = await accounts(f);
    for (const defect of ["slot", "mutation"]) {
      const result = await verifySquadsExecution(f, {
        fetchImpl: async (url, init) => {
          const response = await rpc.fetchImpl(url, init),
            body = await response.json();
          const request = JSON.parse(String(init?.body));
          if (request.id.endsWith("-1")) body.result.context.slot = 1000;
          if (request.id.endsWith("-2")) {
            if (defect === "mutation") {
              body.result.context.slot = 1000;
              const bytes = Buffer.from(body.result.value[1].data[0], "base64");
              bytes[87] = 1;
              body.result.value[1].data[0] = bytes.toString("base64");
            } else expect(request.params[1].minContextSlot).toBe(1000);
          }
          return Response.json(body);
        },
      });
      expect(result.instructionVerification).toBe("unverified");
    }
  });
});
