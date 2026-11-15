import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  MONTH_PLEDGE_DISCRIMINATOR,
  MONTH_PLEDGE_SIZE,
  PRE_PLEDGE_PROJECT_SIZE,
  PROJECT_DISCRIMINATOR,
  PROJECT_SIZE,
  readSolanaMonthPledges,
  type SolanaEscrowConfig,
  solanaBase58,
  solanaExpirePledgeInstruction,
  solanaMonthPledgeAddress,
  solanaPledgeMonthsInstructions,
  solanaProgramAddress,
  solanaVaultAddress,
} from "./adapter";
import { solanaPledgeMonthsMessage } from "./month-pledge";
import { SolanaWalletActionError } from "./wallet-transactions";

const PROGRAM = "7E5ZRh5y6Xgg7k3kdS75CMiTE2efoq9PqNWR5fCVDavQ";
const SYSTEM = "11111111111111111111111111111111";
const PROJECT = solanaBase58(new Uint8Array(32).fill(7));
const OWNER = solanaBase58(new Uint8Array(32).fill(3));
const OTHER = solanaBase58(new Uint8Array(32).fill(4));
const BLOCKHASH = solanaBase58(new Uint8Array(32).fill(5));
const deployment = {
  programId: PROGRAM,
  projectPda: PROJECT,
  vault: solanaVaultAddress(PROGRAM, PROJECT),
  owner: OWNER,
} as SolanaEscrowConfig;
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
// Anchor discriminators computed independently of the adapter's encoder.
const anchor = (name: string) =>
  createHash("sha256").update(name).digest().subarray(0, 8);
const le32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
const le64 = (n: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
};
const pledgeAddress = (period: number) =>
  solanaProgramAddress(PROGRAM, [
    Buffer.from("pledge"),
    new Uint8Array(32).fill(7),
    le32(period),
  ]);

describe("pledge_month instructions", () => {
  test("one instruction per period: owner, project, pledge PDA, system program", () => {
    const ix = solanaPledgeMonthsInstructions(deployment, {
      wallet: OWNER,
      periods: [202612, 202701],
      amountMinor: 1_000_000_000n,
    });
    expect(ix).toHaveLength(2);
    expect(ix[0].program).toBe(PROGRAM);
    expect(ix[0].accounts).toEqual([
      { key: OWNER, write: true },
      { key: PROJECT, write: true },
      { key: pledgeAddress(202612), write: true },
      { key: SYSTEM, write: false },
    ]);
    expect(solanaMonthPledgeAddress(PROGRAM, PROJECT, 202701)).toBe(
      pledgeAddress(202701),
    );
    expect(pledgeAddress(202612)).not.toBe(pledgeAddress(202701));
    expect([...ix[1].data]).toEqual([
      ...anchor("global:pledge_month"),
      ...le32(202701),
      ...le64(1_000_000_000n),
    ]);
  });

  test("refuses another wallet, a non-positive amount, bad, repeated or too many periods", () => {
    const plan = { wallet: OWNER, periods: [202612], amountMinor: 1n };
    const build = (change: Partial<typeof plan>) => () =>
      solanaPledgeMonthsInstructions(deployment, { ...plan, ...change });
    expect(build({})).not.toThrow();
    expect(build({ wallet: OTHER })).toThrow("vault owner");
    expect(build({ amountMinor: 0n })).toThrow("positive");
    expect(build({ amountMinor: 1n << 64n })).toThrow("u64");
    expect(build({ periods: [] })).toThrow("1 to 12");
    expect(build({ periods: [202613] })).toThrow("YYYYMM");
    expect(build({ periods: [199912] })).toThrow("YYYYMM");
    expect(build({ periods: [202612.5] })).toThrow("YYYYMM");
    expect(build({ periods: [202612, 202612] })).toThrow("once");
    const thirteen = Array.from({ length: 13 }, (_, i) =>
      i < 12 ? 202701 + i : 202801,
    );
    expect(build({ periods: thirteen })).toThrow("1 to 12");
  });

  test("twelve pledges fit in one legacy transaction", () => {
    const periods = Array.from({ length: 12 }, (_, i) =>
      i === 0 ? 202612 : 202700 + i,
    );
    const msg = solanaPledgeMonthsMessage(deployment, {
      wallet: OWNER,
      periods,
      amountMinor: 5n,
      blockhash: BLOCKHASH,
    });
    // Owner, project and 12 pledge PDAs writable; system program and program read-only.
    expect([...msg.slice(0, 3)]).toEqual([1, 0, 2]);
    expect(msg[3]).toBe(16);
    // One signature plus its count byte and the message: under Solana's 1232-byte packet.
    expect(1 + 64 + msg.length).toBeLessThanOrEqual(1232);
    expect(() =>
      solanaPledgeMonthsMessage(deployment, {
        wallet: OTHER,
        periods,
        amountMinor: 5n,
        blockhash: BLOCKHASH,
      }),
    ).toThrow(SolanaWalletActionError);
  });

  test("expire_pledge names the project, the pledge and the month address", () => {
    const ix = solanaExpirePledgeInstruction(deployment, 202611);
    expect(ix.accounts).toEqual([
      { key: PROJECT, write: true },
      { key: pledgeAddress(202611), write: true },
      {
        key: solanaProgramAddress(PROGRAM, [
          Buffer.from("month"),
          new Uint8Array(32).fill(7),
          le32(202611),
        ]),
        write: false,
      },
    ]);
    expect([...ix.data]).toEqual([
      ...anchor("global:expire_pledge"),
      ...le32(202611),
    ]);
  });
});

function project(size: number, pledgedOpen: bigint) {
  const data = new Uint8Array(size);
  data.set(Buffer.from(PROJECT_DISCRIMINATOR, "hex"));
  if (size >= 340)
    new DataView(data.buffer).setBigUint64(332, pledgedOpen, true);
  return data;
}
function pledge(
  period: number,
  amount: bigint,
  open: boolean,
  owner = PROJECT,
) {
  const data = new Uint8Array(MONTH_PLEDGE_SIZE);
  data.set(Buffer.from(MONTH_PLEDGE_DISCRIMINATOR, "hex"));
  data.set(
    owner === PROJECT ? new Uint8Array(32).fill(7) : new Uint8Array(32),
    8,
  );
  const view = new DataView(data.buffer);
  view.setUint32(40, period, true);
  view.setBigUint64(44, amount, true);
  data[52] = open ? 1 : 0;
  data[53] = 255;
  return data;
}
const encoded = (data: Uint8Array) => ({
  owner: PROGRAM,
  executable: false,
  lamports: 1,
  data: [Buffer.from(data).toString("base64"), "base64"],
});
function mockAccounts(accounts: (Uint8Array | null)[], periods: number[]) {
  const calls: unknown[] = [];
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    calls.push(body);
    expect(body.method).toBe("getMultipleAccounts");
    expect(body.params[0]).toEqual([
      PROJECT,
      ...periods.map((p) => pledgeAddress(p)),
    ]);
    expect(body.params[1].commitment).toBe("finalized");
    const result = {
      context: { slot: 9 },
      value: accounts.map((a) => (a === null ? null : encoded(a))),
    };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
  }) as typeof fetch;
  return calls;
}
const reader = (periods: number[]) =>
  readSolanaMonthPledges({
    rpcUrl: "https://rpc.invalid",
    network: "solana-mainnet",
    programId: PROGRAM,
    projectPda: PROJECT,
    periods,
  });

describe("readSolanaMonthPledges", () => {
  test("reads the open total and each period from one finalized call", async () => {
    const periods = [202611, 202612, 202701];
    const calls = mockAccounts(
      [
        project(PROJECT_SIZE, 300n),
        pledge(202611, 200n, false),
        pledge(202612, 300n, true),
        null,
      ],
      periods,
    );
    expect(await reader(periods)).toEqual({
      openPledgedGross: 300n,
      pledges: [
        { period: 202611, amount: 200n, open: false },
        { period: 202612, amount: 300n, open: true },
        { period: 202701, amount: 0n, open: false },
      ],
    });
    expect(calls).toHaveLength(1);
  });

  test("is null for a Project not yet migrated to the pledge layout", async () => {
    mockAccounts([project(PRE_PLEDGE_PROJECT_SIZE, 0n), null], [202612]);
    expect(await reader([202612])).toBeNull();
  });

  test("fails closed on a missing project, a foreign pledge or a period mismatch", async () => {
    mockAccounts([null, null], [202612]);
    await expect(reader([202612])).rejects.toThrow("Project account missing");
    mockAccounts(
      [project(PROJECT_SIZE, 1n), pledge(202612, 1n, true, OTHER)],
      [202612],
    );
    await expect(reader([202612])).rejects.toThrow("identity mismatch");
    mockAccounts(
      [project(PROJECT_SIZE, 1n), pledge(202701, 1n, true)],
      [202612],
    );
    await expect(reader([202612])).rejects.toThrow("identity mismatch");
    mockAccounts(
      [project(PROJECT_SIZE, 1n), project(PROJECT_SIZE, 1n)],
      [202612],
    );
    await expect(reader([202612])).rejects.toThrow("layout mismatch");
    await expect(reader([202613])).rejects.toThrow("YYYYMM");
  });
});
