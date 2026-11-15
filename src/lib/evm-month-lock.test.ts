import { expect, test } from "bun:test";
import { decodeFunctionData, encodeAbiParameters, parseAbi } from "viem";
import type { EscrowDeployment } from "./escrow-policy.mjs";
import {
  assertWithdrawalOutsideLocks,
  lockEnds,
  lockPeriods,
  lockRefusal,
  PLEDGED_FUNDS_SELECTOR,
  pledgedFundsRefusal,
  readWalletPledges,
} from "./evm-month-lock";
import type { VaultConnection } from "./evm-vault-actions";

const VAULT = "0x0000000000000000000000000000000000000003";
const deployment = {
  network: "base-sepolia",
  vault: VAULT,
  owner: "0x0000000000000000000000000000000000000001",
} as EscrowDeployment;
const abi = parseAbi([
  "function openPledgedGross() view returns (uint128)",
  "function monthPledges(uint32) view returns (uint128 amount, bool open)",
]);

/**
 * A wallet whose vault has the pledge getters, reverts on them with no data,
 * or whose RPC fails.
 */
function wallet(
  pledges: Record<number, bigint> | null | "rpc-down",
  open = 0n,
): VaultConnection {
  return {
    address: deployment.owner,
    evmRequest: async (method: string, params: unknown[]) => {
      if (method !== "eth_call") throw new Error(`Unexpected ${method}`);
      if (pledges === "rpc-down")
        throw Object.assign(new Error("Request timed out"), { code: -32603 });
      if (pledges === null)
        throw Object.assign(new Error("execution reverted"), {
          code: 3,
          data: "0x",
        });
      const { data } = params[0] as { data: `0x${string}` };
      const call = decodeFunctionData({ abi, data });
      if (call.functionName === "openPledgedGross")
        return encodeAbiParameters([{ type: "uint128" }], [open]);
      const amount = pledges[call.args[0] as number] ?? 0n;
      return encodeAbiParameters(
        [{ type: "uint128" }, { type: "bool" }],
        [amount, amount > 0n],
      );
    },
  } as unknown as VaultConnection;
}

test("locks start in the current UTC month and end on the 4th two months later", () => {
  expect(lockPeriods("2026-12", 3)).toEqual(["2026-12", "2027-01", "2027-02"]);
  expect(lockEnds("2026-12").toISOString()).toBe("2027-02-04T00:00:00.000Z");
  expect(lockEnds("2026-11").toISOString()).toBe("2027-01-04T00:00:00.000Z");
});

test("the contract's refusals read in plain words", () => {
  expect(PLEDGED_FUNDS_SELECTOR).toBe("0x498acb6b");
  expect(
    lockRefusal({ message: "execution reverted", data: "0x655126bb" })?.message,
  ).toContain("never lowered");
  expect(lockRefusal({ data: "0xa3bf9d5b" })?.message).toContain("free funds");
  expect(lockRefusal({ data: "0xb4fa3fb3" })?.message).toContain(
    "Review the lock again",
  );
  expect(lockRefusal(new Error("user rejected"))).toBeNull();
  const refusal = pledgedFundsRefusal({
    message: "execution reverted",
    data: `${PLEDGED_FUNDS_SELECTOR}`,
  });
  expect(refusal?.message).toContain("locked for a month");
  expect(
    pledgedFundsRefusal({
      cause: { error: { message: "reverted with PledgedFunds()" } },
    }),
  ).not.toBeNull();
  expect(pledgedFundsRefusal(new Error("insufficient funds"))).toBeNull();
});

test("an RPC failure is not read as a vault without pledge support", async () => {
  await expect(
    readWalletPledges(deployment, wallet("rpc-down"), []),
  ).rejects.toThrow("Request timed out");
  // The withdrawal review falls back; the contract still refuses locked funds.
  expect(
    await assertWithdrawalOutsideLocks(
      deployment,
      wallet("rpc-down"),
      "100",
      "100",
    ),
  ).toBe(false);
});

test("a vault without pledge support reads null and keeps the page's guard", async () => {
  expect(await readWalletPledges(deployment, wallet(null), ["2026-12"])).toBe(
    null,
  );
  expect(
    await assertWithdrawalOutsideLocks(deployment, wallet(null), "100", "100"),
  ).toBe(false);
});

test("an upgraded vault reads its pledges and refuses a withdrawal into them", async () => {
  const locked = wallet({ 202612: 250n, 202701: 250n }, 500n);
  const read = await readWalletPledges(deployment, locked, [
    "2026-12",
    "2027-01",
    "2027-02",
  ]);
  expect(read?.openPledgedGross).toBe(500n);
  expect(read?.pledges.get("2026-12")).toEqual({ amount: 250n, open: true });
  expect(read?.pledges.get("2027-02")).toEqual({ amount: 0n, open: false });
  // 700 free with 500 locked: 200 can leave, 201 cannot.
  expect(
    await assertWithdrawalOutsideLocks(deployment, locked, "700", "200"),
  ).toBe(true);
  await expect(
    assertWithdrawalOutsideLocks(deployment, locked, "700", "201"),
  ).rejects.toThrow("locked for a month");
});
