// No deploy script may fix a token or a new role address: the factory serves
// any ERC-20, and the registrar, fee recipient and identity authority come from
// the environment (Base alone defaults to the published Base fee recipient).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { BASE_PLATFORM_FEE_RECIPIENT } from "../../src/lib/platform-fee-recipients.mjs";

const read = (file: string) =>
  readFileSync(`contracts/evm/script/${file}`, "utf8");

describe("deploy scripts", () => {
  test("roles come from the environment; only Base has a default fee recipient", () => {
    const shared = read("DeployEscrowFactory.sol");
    for (const key of [
      'envAddress("ESCROW_REGISTRAR")',
      'envAddress("ESCROW_IDENTITY_AUTHORITY")',
      'envAddress("ESCROW_FEE_RECIPIENT")',
      'envOr("ESCROW_FEE_RECIPIENT", BASE_PUBLISHED_FEE_RECIPIENT)',
    ])
      expect(shared).toContain(key);
    const addresses = shared.match(/0x[0-9a-fA-F]{40}/g) ?? [];
    expect(addresses.map((value) => value.toLowerCase())).toEqual([
      BASE_PLATFORM_FEE_RECIPIENT,
    ]);
  });
});
