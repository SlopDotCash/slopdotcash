import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  type ContributorAllocation,
  contributorAllocation,
  contributorAllocationState,
} from "../src/lib/contributor-allocation";
import type { PaymentsAccount } from "../src/lib/payments/contracts";

const tx = `0x${"a".repeat(64)}`;
const file = (overrides: Record<string, unknown> = {}) => ({
  distribution: {
    network: "robinhood-mainnet",
    token: {
      symbol: "SLOP",
      decimals: 18,
      address: "0x2222222222222222222222222222222222222222",
    },
    registrationClosesAt: "2027-02-08T17:00:00Z",
    closed: false,
    recipients: [
      {
        githubId: "101",
        amountBase: "1537000000000000000000",
        transactionId: null,
      },
      {
        githubId: "102",
        amountBase: "200000000000000000000000",
        transactionId: tx,
      },
    ],
    ...overrides,
  },
});
const wallet = (
  chain: PaymentsAccount["wallets"][number]["chain"],
  authorized: boolean,
  firstAuthorizedAt: string | null = "2026-12-01T00:00:00Z",
) =>
  ({
    chain,
    claimId: "c",
    address: "0x1",
    authorized,
    firstAuthorizedAt,
  }) as PaymentsAccount["wallets"][number];
const before = Date.parse("2026-12-01T00:00:00Z");
const after = Date.parse("2027-02-08T17:00:00Z");

describe("contributor allocation file", () => {
  test("the committed file publishes no allocation", () => {
    const committed = JSON.parse(
      readFileSync(
        new URL("../public/contributor-allocation.json", import.meta.url),
        "utf8",
      ),
    );
    expect(contributorAllocation(committed)).toBeNull();
  });

  test("a valid file resolves its chain from the network policy", () => {
    const value = contributorAllocation(file()) as ContributorAllocation;
    expect(value.chain).toBe("robinhood");
    expect(value.recipients.map((r) => r.githubId)).toEqual(["101", "102"]);
  });

  test.each([
    ["a non-EVM network", { network: "solana-mainnet" }],
    ["an unknown network", { network: "robinhood" }],
    ["a missing closed flag", { closed: undefined }],
    ["a local close time", { registrationClosesAt: "2027-02-08T17:00:00" }],
    [
      "a duplicate recipient",
      {
        recipients: [
          { githubId: "101", amountBase: "1", transactionId: null },
          { githubId: "101", amountBase: "2", transactionId: null },
        ],
      },
    ],
    [
      "a zero amount",
      {
        recipients: [{ githubId: "101", amountBase: "0", transactionId: null }],
      },
    ],
    [
      "a decimal amount",
      {
        recipients: [
          { githubId: "101", amountBase: "1.5", transactionId: null },
        ],
      },
    ],
    [
      "a malformed transaction",
      {
        recipients: [
          { githubId: "101", amountBase: "1", transactionId: "0xabc" },
        ],
      },
    ],
    [
      "a login instead of a GitHub id",
      {
        recipients: [
          { githubId: "octocat", amountBase: "1", transactionId: null },
        ],
      },
    ],
  ])("refuses %s", (_, overrides) => {
    expect(() => contributorAllocation(file(overrides))).toThrow(
      "could not be verified",
    );
  });
});

describe("contributor allocation state", () => {
  const value = contributorAllocation(file()) as ContributorAllocation;
  const [unsent, sent] = value.recipients;

  test("a recorded transfer is sent, whatever the wallet or date", () => {
    expect(contributorAllocationState(value, sent, [], after)).toBe("sent");
    expect(
      contributorAllocationState({ ...value, closed: true }, sent, [], after),
    ).toBe("sent");
  });

  test("only a confirmed wallet on the allocation's chain is scheduled", () => {
    expect(
      contributorAllocationState(
        value,
        unsent,
        [wallet("robinhood", true)],
        before,
      ),
    ).toBe("scheduled");
    expect(
      contributorAllocationState(
        value,
        unsent,
        [wallet("robinhood", false)],
        before,
      ),
    ).toBe("awaiting-wallet");
    expect(
      contributorAllocationState(value, unsent, [wallet("base", true)], before),
    ).toBe("awaiting-wallet");
  });

  test("a confirmed wallet stays scheduled after the deadline until the final batch", () => {
    expect(
      contributorAllocationState(
        value,
        unsent,
        [wallet("robinhood", true)],
        after,
      ),
    ).toBe("scheduled");
    expect(
      contributorAllocationState(
        { ...value, closed: true },
        unsent,
        [wallet("robinhood", true)],
        before,
      ),
    ).toBe("unclaimed");
  });

  test("no wallet by the deadline is unclaimed", () => {
    expect(contributorAllocationState(value, unsent, [], after - 1)).toBe(
      "awaiting-wallet",
    );
    expect(contributorAllocationState(value, unsent, [], after)).toBe(
      "unclaimed",
    );
    for (const firstAuthorizedAt of [
      value.registrationClosesAt,
      "2027-02-09T00:00:00Z",
      null,
      "invalid",
    ])
      expect(
        contributorAllocationState(
          value,
          unsent,
          [wallet("robinhood", true, firstAuthorizedAt)],
          after,
        ),
      ).toBe("unclaimed");
  });
});
