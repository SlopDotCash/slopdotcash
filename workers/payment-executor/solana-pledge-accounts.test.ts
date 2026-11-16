import { afterEach, expect, test } from "bun:test";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  PRE_PLEDGE_PROJECT_SIZE,
  PROJECT_SIZE,
  solanaMonthPledgeAddress,
} from "../../contracts/solana/adapter";
import { projectAccruedFees } from "../fee-converter/solana";
import { PROJECT_SIZES, readSolanaProject } from "./solana";

const PROGRAM = "11111111111111111111111111111112";
const PROJECT = "SysvarRent111111111111111111111111111111111";
const projectDisc = bytesToHex(
  sha256(new TextEncoder().encode("account:Project")).slice(0, 8),
);

function projectAccount(size: number, accrued = 0n) {
  const data = new Uint8Array(size);
  data.set(
    Uint8Array.from(projectDisc.match(/../g) ?? [], (h) => parseInt(h, 16)),
    0,
  );
  if (size >= 324) new DataView(data.buffer).setBigUint64(316, accrued, true);
  return {
    owner: PROGRAM,
    data: [Buffer.from(data).toString("base64"), "base64"],
    executable: false,
    lamports: 1,
  };
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
function rpcAnswers(value: unknown) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { value } }), {
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}
const config = {
  rpcUrl: "https://rpc.invalid",
  programId: PROGRAM,
} as Parameters<typeof readSolanaProject>[0];

test("the executor reads a Project before and after the pledge migration", async () => {
  expect(PROJECT_SIZES).toEqual([PRE_PLEDGE_PROJECT_SIZE, PROJECT_SIZE]);
  for (const size of [PRE_PLEDGE_PROJECT_SIZE, PROJECT_SIZE]) {
    rpcAnswers(projectAccount(size));
    expect(
      (await readSolanaProject(config, PROJECT, projectDisc))?.length,
    ).toBe(size);
  }
  rpcAnswers(projectAccount(300));
  await expect(readSolanaProject(config, PROJECT, projectDisc)).rejects.toThrow(
    "Account layout mismatch",
  );
  rpcAnswers(null);
  expect(await readSolanaProject(config, PROJECT, projectDisc)).toBeNull();
});

test("the fee converter reads accrued fees from both Project sizes", () => {
  expect(
    projectAccruedFees(projectAccount(PRE_PLEDGE_PROJECT_SIZE, 7n), PROGRAM),
  ).toBe(7n);
  expect(projectAccruedFees(projectAccount(PROJECT_SIZE, 9n), PROGRAM)).toBe(
    9n,
  );
  expect(() => projectAccruedFees(projectAccount(320, 1n), PROGRAM)).toThrow(
    "Account layout mismatch",
  );
});

test("a month's pledge account is one per project and month", () => {
  const december = solanaMonthPledgeAddress(PROGRAM, PROJECT, 202612);
  expect(solanaMonthPledgeAddress(PROGRAM, PROJECT, 202612)).toBe(december);
  expect(solanaMonthPledgeAddress(PROGRAM, PROJECT, 202701)).not.toBe(december);
});
