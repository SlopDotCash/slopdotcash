// No deploy script may fix a token or a new role address: the factory serves
// any ERC-20, and the registrar, fee recipient and identity authority come from
// the environment (Base alone defaults to the published Base fee recipient).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { BASE_PLATFORM_FEE_RECIPIENT } from "../../src/lib/platform-fee-recipients.mjs";

const read = (file: string) =>
  readFileSync(`contracts/evm/script/${file}`, "utf8");
const NETWORK_SCRIPTS = [
  "DeployBase.s.sol",
  "DeployBaseSepolia.s.sol",
  "DeployRobinhood.s.sol",
  "DeployRobinhoodTestnet.s.sol",
  "DeployEthereum.s.sol",
  "DeployEthereumSepolia.s.sol",
];

describe("deploy scripts", () => {
  test("network scripts fix no address; only Base takes the default fee recipient", () => {
    for (const file of NETWORK_SCRIPTS) {
      const source = read(file);
      expect(source).not.toMatch(/0x[0-9a-fA-F]{40}/);
      expect(source).toMatch(
        new RegExp(`return deploy\\(\\d+, ${file === "DeployBase.s.sol"}\\);`),
      );
    }
  });
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
