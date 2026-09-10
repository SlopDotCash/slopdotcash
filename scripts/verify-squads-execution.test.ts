import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertRewardAllocationManifest } from "../src/lib/rewards";
import {
  createSettlementExecutionPlan,
  type SettlementExecutionPlan,
  SOLANA_MAINNET_USDC_MINT,
} from "../src/lib/settlement-plan";
import {
  assertSquadsExecutionObservation,
  executionSha256,
  squadsExecutionTrackerLabel,
  validateSquadsExecutionContext,
} from "../src/lib/squads-execution";
import {
  deriveSquadsVaultAddress,
  SPL_TOKEN_PROGRAM_ID,
  SQUADS_V4_PROGRAM_ID,
} from "../src/lib/squads-funding";
import { compileSquadsExecutionRegistry } from "./sync-squads-execution-registry";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  LOOKUP_TABLE_PROGRAM_ID,
  parseSquadsExecutionArguments,
  squadsExecutionAddress,
  squadsUsdcAta,
  verifySquadsExecution,
} from "./verify-squads-execution";

const RECIPIENT = "11111111111111111111111111111111";
const SOURCE = "Vote111111111111111111111111111111111111111";
const FEE = "Stake11111111111111111111111111111111111111";
const COMMIT = "a".repeat(40);
function approvedAllocation() {
  return assertRewardAllocationManifest({
    schemaVersion: "1",
    kind: "reward-allocation",
    projectId: "eliza",
    cycleId: "2026-07",
    status: "approved",
    generatedAt: "2026-08-01T00:00:00.000Z",
    approvedAt: "2026-08-15T00:00:00.000Z",
    contributionWindow: {
      from: "2026-07-07T00:00:00.000Z",
      to: "2026-08-01T00:00:00.000Z",
    },
    review: {
      days: 14,
      lastMaterialChangeAt: "2026-08-01T00:00:00.000Z",
      endsAt: "2026-08-15T00:00:00.000Z",
    },
    currency: "USDC",
    chain: "solana",
    capMinor: "10000000000",
    feeBasisPoints: 100,
    scoringRuleVersion: "gitarmy-v1",
    sourceSnapshotSha256: "b".repeat(64),
    allocations: [
      {
        intentId: "pay_eliza_2026_07_u1",
        actor: { id: "U_1", login: "contributor" },
        score: 100,
        suggestedMinor: "1000000",
        approvedMinor: "1000000",
        state: "approved",
        wallet: {
          address: RECIPIENT,
          chain: "solana",
          observedAt: "2026-08-01T00:00:00.000Z",
          sourceCommit: COMMIT,
          sourceUrl: `https://github.com/contributor/contributor/blob/${COMMIT}/README.md`,
        },
        evidenceEventIds: ["event_1"],
        adjustmentReason: null,
        relatedParty: false,
        platformApproval: null,
      },
    ],
    totals: {
      suggestedMinor: "1000000",
      approvedMinor: "1000000",
      feeMinor: "10000",
    },
  });
}

const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function keyBytes(key: string) {
  let number = 0n;
  for (const character of key)
    number = number * 58n + BigInt(alphabet.indexOf(character));
  const bytes = Buffer.alloc(32);
  for (let i = 31; i >= 0; i--) {
    bytes[i] = Number(number & 255n);
    number >>= 8n;
  }
  return bytes;
}
function encodeKey(bytes: Uint8Array) {
  let number = BigInt(`0x${Buffer.from(bytes).toString("hex")}`),
    text = "";
  while (number) {
    text = alphabet[Number(number % 58n)] + text;
    number /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    text = `1${text}`;
  }
  return text;
}
function u32(value: number) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
}
function vector(bytes: Buffer, count = bytes.length) {
  return Buffer.concat([u32(count), bytes]);
}
async function context(contributors = 1) {
  const vault = await deriveSquadsVaultAddress(SOURCE, 0);
  const base = approvedAllocation();
  if (!base.allocations[0].wallet)
    throw new Error("Fixture needs frozen wallet");
  const allocation = {
    ...base,
    allocations: Array.from({ length: contributors }, (_, i) => ({
      ...base.allocations[0],
      intentId: `pay_eliza_2026_07_u${i}`,
      actor: { id: `U_${i}`, login: `contributor${i}` },
      wallet: {
        ...base.allocations[0].wallet,
        address:
          i === 0
            ? RECIPIENT
            : encodeKey(createHash("sha256").update(`recipient-${i}`).digest()),
        sourceUrl: `https://github.com/contributor${i}/contributor${i}/blob/${COMMIT}/README.md`,
      },
    })),
    totals: {
      suggestedMinor: String(contributors * 1000000),
      approvedMinor: String(contributors * 1000000),
      feeMinor: String(contributors * 10000),
    },
    fundingBasis: {
      cycleId: "2026-07",
      fundingState: "committed",
      committedMinor: "10000000000",
      monthlyCapMinor: "10000000000",
      instrumentId: `squads-v4-vault:solana:${SOURCE}:0:${vault}`,
    },
  };
  const allocationBytes = new TextEncoder().encode(JSON.stringify(allocation));
  const plan = createSettlementExecutionPlan({
    allocation,
    allocationSha256: await executionSha256(allocationBytes),
    createdAt: "2026-08-15T00:01:00.000Z",
    feeRecipient: FEE,
    sourceOwner: vault,
  });
  const planBytes = new TextEncoder().encode(JSON.stringify(plan));
  return {
    projectId: "eliza",
    allocationBytes,
    planBytes,
    baseLedger: [],
    ledger: [
      {
        schemaVersion: "1",
        kind: "squads-execution-binding",
        projectId: "eliza",
        cycleId: "2026-07",
        planSha256: await executionSha256(planBytes),
        multisig: SOURCE,
        vault,
        vaultIndex: 0,
        transactionIndex: "1",
        proposalAccount: (await squadsExecutionAddress(SOURCE, "1", true))
          .address,
        vaultTransactionAccount: (
          await squadsExecutionAddress(SOURCE, "1", false)
        ).address,
      },
    ],
  };
}
type Context = Awaited<ReturnType<typeof context>>;
interface FixtureOptions {
  status?: number;
  create?: boolean;
  defect?: string;
  unchecked?: boolean;
  lookup?: boolean;
}
async function fixtures(input: Context, options: FixtureOptions = {}) {
  const plan = JSON.parse(
    new TextDecoder().decode(input.planBytes),
  ) as SettlementExecutionPlan;
  const binding = input.ledger[0];
  const proposal = Buffer.alloc(70);
  createHash("sha256")
    .update("account:Proposal")
    .digest()
    .copy(proposal, 0, 0, 8);
  keyBytes(SOURCE).copy(proposal, 8);
  proposal.writeBigUInt64LE(1n, 40);
  proposal[48] = options.status ?? 5;
  proposal[57] = (await squadsExecutionAddress(SOURCE, "1", true)).bump;
  const sourceAta = await squadsUsdcAta(binding.vault);
  const atas = await Promise.all(
    plan.transfers.map((row) => squadsUsdcAta(row.recipientOwner)),
  );
  const baseReadonly = [
    ...(!options.unchecked || options.create ? [SOLANA_MAINNET_USDC_MINT] : []),
    SPL_TOKEN_PROGRAM_ID,
    ...(options.create ? [ASSOCIATED_TOKEN_PROGRAM_ID] : []),
  ];
  const loadedWritable = [sourceAta, ...atas];
  const keys = options.lookup
    ? [binding.vault, ...baseReadonly, ...loadedWritable]
    : [binding.vault, ...loadedWritable, ...baseReadonly];
  if (options.create)
    for (const key of [
      ASSOCIATED_TOKEN_PROGRAM_ID,
      ...plan.transfers.map((row) => row.recipientOwner),
      RECIPIENT,
    ])
      if (!keys.includes(key)) keys.push(key);
  const instructions: Buffer[] = [];
  const instruction = (program: string, accounts: string[], data: Buffer) =>
    Buffer.concat([
      Buffer.from([keys.indexOf(program)]),
      vector(Buffer.from(accounts.map((key) => keys.indexOf(key)))),
      vector(data),
    ]);
  for (const [i, row] of plan.transfers.entries()) {
    if (options.create)
      instructions.push(
        instruction(
          ASSOCIATED_TOKEN_PROGRAM_ID,
          [
            binding.vault,
            atas[i],
            row.recipientOwner,
            SOLANA_MAINNET_USDC_MINT,
            RECIPIENT,
            SPL_TOKEN_PROGRAM_ID,
          ],
          Buffer.from([options.defect === "ata-op" ? 2 : 1]),
        ),
      );
    const data = Buffer.alloc(options.unchecked ? 9 : 10);
    data[0] = options.unchecked ? 3 : 12;
    data.writeBigUInt64LE(
      BigInt(row.amountMinor) +
        (options.defect === "amount" && i === 0 ? 1n : 0n),
      1,
    );
    if (!options.unchecked) data[9] = options.defect === "decimals" ? 9 : 6;
    const accounts = options.unchecked
      ? [sourceAta, atas[i], binding.vault]
      : [sourceAta, SOLANA_MAINNET_USDC_MINT, atas[i], binding.vault];
    if (options.defect === "recipient" && i === 0)
      accounts[options.unchecked ? 1 : 2] = atas[1];
    if (options.defect === "authority")
      accounts[accounts.length - 1] = sourceAta;
    instructions.push(instruction(SPL_TOKEN_PROGRAM_ID, accounts, data));
  }
  if (options.defect === "missing") instructions.pop();
  if (options.defect === "duplicate") instructions.push(instructions[0]);
  if (options.defect === "program")
    instructions[0][0] = keys.indexOf(SOLANA_MAINNET_USDC_MINT);
  const header = Buffer.alloc(83);
  createHash("sha256")
    .update("account:VaultTransaction")
    .digest()
    .copy(header, 0, 0, 8);
  keyBytes(SOURCE).copy(header, 8);
  header.writeBigUInt64LE(1n, 72);
  header[80] = (await squadsExecutionAddress(SOURCE, "1", false)).bump;
  for (let bump = 255; bump >= 0; bump--) {
    const digest = createHash("sha256")
      .update(
        Buffer.concat([
          Buffer.from("multisig"),
          keyBytes(SOURCE),
          Buffer.from("vault"),
          Buffer.from([0, bump]),
          keyBytes(SQUADS_V4_PROGRAM_ID),
          Buffer.from("ProgramDerivedAddress"),
        ]),
      )
      .digest();
    if (digest.equals(keyBytes(binding.vault))) {
      header[82] = bump;
      break;
    }
  }
  const transaction = Buffer.concat([
    header,
    u32(options.defect === "ephemeral" ? 1 : 0),
    Buffer.from([
      options.defect === "signer" ? 2 : 1,
      options.create ? 1 : 0,
      options.lookup ? 0 : atas.length + 1,
    ]),
    vector(
      Buffer.concat(
        (options.lookup ? keys.slice(0, 1 + baseReadonly.length) : keys).map(
          keyBytes,
        ),
      ),
      options.lookup ? 1 + baseReadonly.length : keys.length,
    ),
    vector(Buffer.concat(instructions), instructions.length),
    ...(options.lookup
      ? [
          u32(1),
          keyBytes("SysvarRent111111111111111111111111111111111"),
          vector(Buffer.from(loadedWritable.map((_, i) => i))),
          vector(
            Buffer.from(
              keys
                .slice(1 + baseReadonly.length + loadedWritable.length)
                .map((_, i) => loadedWritable.length + i),
            ),
          ),
        ]
      : [u32(options.defect === "lookup" ? 1 : 0)]),
  ]);
  const rows: Array<{ owner: string; executable: boolean; data: string[] }> = [
    proposal,
    transaction,
  ].map((bytes) => ({
    owner: SQUADS_V4_PROGRAM_ID,
    executable: false,
    data: [bytes.toString("base64"), "base64"],
  }));
  const tokens = new Map<string, unknown>();
  if (options.lookup) {
    const meta = Buffer.alloc(56);
    meta.writeUInt32LE(1);
    meta.writeBigUInt64LE((1n << 64n) - 1n, 4);
    const addresses = keys.slice(1 + baseReadonly.length);
    tokens.set("SysvarRent111111111111111111111111111111111", {
      owner: LOOKUP_TABLE_PROGRAM_ID,
      executable: false,
      data: [
        Buffer.concat([meta, ...addresses.map(keyBytes)]).toString("base64"),
        "base64",
      ],
    });
  }
  for (const [i, address] of [sourceAta, ...atas].entries()) {
    const bytes = Buffer.alloc(165);
    keyBytes(SOLANA_MAINNET_USDC_MINT).copy(bytes, 0);
    keyBytes(
      i === 0 ? binding.vault : plan.transfers[i - 1].recipientOwner,
    ).copy(bytes, 32);
    bytes[108] = 1;
    if (options.defect === "token-owner" && i === 1)
      keyBytes(SOURCE).copy(bytes, 32);
    if (options.defect === "token-mint") keyBytes(SOURCE).copy(bytes, 0);
    tokens.set(address, {
      owner: SPL_TOKEN_PROGRAM_ID,
      executable: false,
      data: [bytes.toString("base64"), "base64"],
    });
  }
  return { rows, tokens };
}
function rpc(fixture: Awaited<ReturnType<typeof fixtures>>) {
  return async (_url: URL, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body));
    expect(init?.redirect).toBe("error");
    expect(request.method).toBe("getMultipleAccounts");
    expect(request.params[1]).toMatchObject({
      encoding: "base64",
      commitment: "finalized",
    });
    const value = [
      ...fixture.rows,
      ...request.params[0]
        .slice(2)
        .map((address: string) => fixture.tokens.get(address) ?? null),
    ];
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: { context: { slot: 123 }, value },
      }),
    );
  };
}

describe("Squads exact plan verifier", () => {
  it("publishes validated bindings only and refuses substituted plan bytes", async () => {
    const input = await context();
    const root = await mkdtemp(join(tmpdir(), "slop-execution-index-"));
    try {
      await mkdir(join(root, "funding/executions"), { recursive: true });
      await mkdir(join(root, "cycles/eliza/2026-07"), { recursive: true });
      await writeFile(
        join(root, "funding/executions/ledger.json"),
        `${JSON.stringify(input.ledger)}\n`,
      );
      await writeFile(
        join(root, "cycles/eliza/2026-07/allocation.json"),
        input.allocationBytes,
      );
      await writeFile(
        join(root, "cycles/eliza/2026-07/execution-plan.json"),
        input.planBytes,
      );
      expect((await compileSquadsExecutionRegistry(root)).ledger).toEqual(
        input.ledger,
      );
      await writeFile(
        join(root, "cycles/eliza/2026-07/execution-plan.json"),
        Buffer.concat([input.planBytes, Buffer.from(" ")]),
      );
      await expect(compileSquadsExecutionRegistry(root)).rejects.toThrow(
        /binding/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("renders matched executed as settlement-unverified, rejects fake paid/foreign bindings, and expires observations", async () => {
    const input = await context();
    const result = await verifySquadsExecution(input, {
      fetchImpl: rpc(await fixtures(input)),
    });
    const checked = assertSquadsExecutionObservation(result, result.binding);
    expect(
      squadsExecutionTrackerLabel(checked, Date.parse(checked.observedAt)),
    ).toBe("Proposal executed · settlement unverified");
    expect(
      squadsExecutionTrackerLabel(
        checked,
        Date.parse(checked.observedAt) + 300000,
      ),
    ).toContain("stale");
    expect(() =>
      assertSquadsExecutionObservation(
        { ...result, paymentVerified: true },
        result.binding,
      ),
    ).toThrow();
    expect(() =>
      assertSquadsExecutionObservation(result, {
        ...result.binding,
        projectId: "asi",
      }),
    ).toThrow();
  });
  it.each(["foreign", "deactivated", "recent", "out-of-range", "substitution"])(
    "rejects %s lookup table evidence",
    async (defect) => {
      const input = await context();
      const fixture = await fixtures(input, { lookup: true });
      const key = "SysvarRent111111111111111111111111111111111";
      const table = fixture.tokens.get(key) as {
        owner: string;
        data: string[];
      };
      const bytes = Buffer.from(table.data[0], "base64");
      if (defect === "foreign") table.owner = SPL_TOKEN_PROGRAM_ID;
      if (defect === "deactivated") bytes.writeBigUInt64LE(122n, 4);
      if (defect === "recent") bytes.writeBigUInt64LE(123n, 12);
      if (defect === "substitution") keyBytes(SOURCE).copy(bytes, 56);
      table.data[0] = (
        defect === "out-of-range" ? bytes.subarray(0, 56) : bytes
      ).toString("base64");
      const result = await verifySquadsExecution(input, {
        fetchImpl: rpc(fixture),
      });
      expect(result.instructionVerification).toBe("unverified");
    },
  );

  it.each([55, 199])(
    "verifies all %s recipients plus fee in one bound proposal with lookup tables and bounded RPC chunks",
    async (count) => {
      const input = await context(count);
      const fixture = await fixtures(input, {
        lookup: true,
        create: count === 55,
      });
      const sizes: number[] = [];
      const result = await verifySquadsExecution(input, {
        fetchImpl: async (url, init) => {
          sizes.push(JSON.parse(String(init?.body)).params[0].length);
          return rpc(fixture)(url, init);
        },
      });
      expect(result.instructionVerification).toBe("verified");
      expect(result.binding.planSha256).toBe(input.ledger[0].planSha256);
      expect(sizes.every((size) => size <= 100)).toBe(true);
      if (count === 199)
        expect(sizes.filter((size) => size === 100)).toHaveLength(6);
      expect(result.paymentVerified).toBe(false);
    },
  );
  it.each([false, true])(
    "matches exact ordered transfers including fee; unchecked=%s",
    async (unchecked) => {
      const input = await context();
      const result = await verifySquadsExecution(input, {
        fetchImpl: rpc(await fixtures(input, { unchecked })),
      });
      expect(result).toMatchObject({
        status: "plan-matched",
        instructionVerification: "verified",
        proposalStatus: "executed",
        paymentVerified: false,
        retirementVerified: false,
      });
      expect(result.accountEvidence?.authorities).toHaveLength(3);
    },
  );
  it("permits canonical ATA creates and missing destinations before execution", async () => {
    const input = await context();
    const fixture = await fixtures(input, { create: true, status: 3 });
    fixture.tokens.delete(await squadsUsdcAta(RECIPIENT));
    const result = await verifySquadsExecution(input, {
      fetchImpl: rpc(fixture),
    });
    expect(result.instructionVerification).toBe("verified");
    expect(result.proposalStatus).toBe("approved");
    expect(result.paymentVerified).toBe(false);
  });
  it.each([0, 1, 2, 3, 6])(
    "decodes proposal status %s without treating it as payment",
    async (status) => {
      const input = await context();
      const result = await verifySquadsExecution(input, {
        fetchImpl: rpc(await fixtures(input, { status })),
      });
      expect(result.proposalStatus).toBe(
        [
          "draft",
          "active",
          "rejected",
          "approved",
          "unknown",
          "executed",
          "cancelled",
        ][status],
      );
      expect(result.paymentVerified).toBe(false);
    },
  );
  it.each([
    "amount",
    "recipient",
    "authority",
    "decimals",
    "missing",
    "duplicate",
    "program",
    "lookup",
    "ephemeral",
    "signer",
    "token-owner",
    "token-mint",
    "ata-op",
  ])("refuses %s even when proposal status says executed", async (defect) => {
    const input = await context();
    const result = await verifySquadsExecution(input, {
      fetchImpl: rpc(
        await fixtures(input, { defect, create: defect === "ata-op" }),
      ),
    });
    expect(result.status).toBe("unverified");
    expect(result.accountEvidence).toBeNull();
  });
  it("rejects exact-byte plan/allocation tampering and foreign project before RPC", async () => {
    const input = await context();
    await expect(
      validateSquadsExecutionContext({
        ...input,
        planBytes: Buffer.concat([input.planBytes, Buffer.from(" ")]),
      }),
    ).rejects.toThrow(/binding/);
    await expect(
      validateSquadsExecutionContext({ ...input, projectId: "asi" }),
    ).rejects.toThrow(/Foreign/);
    await expect(
      validateSquadsExecutionContext({
        ...input,
        allocationBytes: Buffer.concat([
          input.allocationBytes,
          Buffer.from(" "),
        ]),
      }),
    ).rejects.toThrow(/bytes/);
  });
  it.each(["owner", "index", "discriminator", "executing", "truncated", "pda"])(
    "refuses %s account evidence",
    async (defect) => {
      const input = await context();
      const fixture = await fixtures(input, {
        status: defect === "executing" ? 4 : 5,
      });
      if (defect === "owner") fixture.rows[0].owner = RECIPIENT;
      if (["index", "discriminator", "pda"].includes(defect)) {
        const bytes = Buffer.from(fixture.rows[0].data[0], "base64");
        bytes[defect === "index" ? 40 : defect === "pda" ? 57 : 0] ^= 1;
        fixture.rows[0].data[0] = bytes.toString("base64");
      }
      if (defect === "truncated")
        fixture.rows[1].data[0] = Buffer.alloc(87).toString("base64");
      const result = await verifySquadsExecution(input, {
        fetchImpl: rpc(fixture),
      });
      expect(result.accountEvidence).toBeNull();
      expect(result.paymentVerified).toBe(false);
    },
  );
  it("requires identical bytes across two providers, not matching status alone", async () => {
    const input = await context();
    const fixture = await fixtures(input);
    let count = 0;
    const result = await verifySquadsExecution(input, {
      fetchImpl: async (url, init) => {
        const copy = structuredClone(fixture);
        const bytes = Buffer.from(copy.rows[0].data[0], "base64");
        bytes[49] = count++;
        copy.rows[0].data[0] = bytes.toString("base64");
        return rpc(copy)(url, init);
      },
    });
    expect(result.accountEvidence).toBeNull();
  });
  it("refuses missing executed destination instead of declaring payment", async () => {
    const input = await context();
    const fixture = await fixtures(input, { create: true });
    fixture.tokens.clear();
    const result = await verifySquadsExecution(input, {
      fetchImpl: rpc(fixture),
    });
    expect(result.instructionVerification).toBe("unverified");
  });
  it("returns unknown on RPC failure, oversized response or invalid response identity", async () => {
    for (const fetchImpl of [
      async () => {
        throw new Error("offline");
      },
      async () =>
        new Response("{}", { headers: { "content-length": "99999999" } }),
      async () => new Response('{"jsonrpc":"2.0","id":"foreign"}'),
    ]) {
      const result = await verifySquadsExecution(await context(), {
        fetchImpl,
      });
      expect(result.accountEvidence).toBeNull();
      expect(result.proposalStatus).toBe("unknown");
    }
  });
  it("allows two-provider quorum with a third unavailable", async () => {
    const input = await context();
    const fixture = await fixtures(input);
    const result = await verifySquadsExecution(input, {
      fetchImpl: async (url, init) => {
        if (url.hostname === "solana.drpc.org") throw new Error("offline");
        return rpc(fixture)(url, init);
      },
    });
    expect(result.accountEvidence?.authorities).toHaveLength(2);
  });
  it("rejects missing, repeated and alternate authority CLI flags", () => {
    for (const args of [
      [],
      ["--project", "eliza", "--project", "asi"],
      ["--rpc", "https://example.org"],
    ])
      expect(() => parseSquadsExecutionArguments(args)).toThrow();
  });
});
