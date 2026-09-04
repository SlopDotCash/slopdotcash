/** Proves the Sablier commitment verifier needs quorum and fails closed. */

import { describe, expect, it } from "vitest";
import {
  assertSablierStreamState,
  EVM_FUNDING_USDC_CONTRACTS,
  SABLIER_LOCKUP_V4_CONTRACTS,
  SABLIER_STREAM_SELECTORS,
  type SablierNetwork,
  type SablierStreamCall,
} from "../src/lib/sablier-funding";
import {
  parseCommitmentSablierArguments,
  verifyCommitmentSablier,
} from "./verify-commitment-sablier";

const STREAM_ID = "512";
const RECIPIENT = `0x${"ab".repeat(20)}`;
const SENDER = `0x${"cd".repeat(20)}`;
const BLOCK_HASH = `0x${"ee".repeat(32)}`;

const BASE_HOSTS = [
  "mainnet.base.org",
  "base-rpc.publicnode.com",
  "base.drpc.org",
] as const;
const ETHEREUM_HOSTS = [
  "ethereum-rpc.publicnode.com",
  "eth.drpc.org",
  "cloudflare-eth.com",
] as const;

function addressWord(address: string): string {
  return `0x${"0".repeat(24)}${address.slice(2)}`;
}

function uintWord(value: bigint | number): string {
  return `0x${BigInt(value).toString(16).padStart(64, "0")}`;
}

const BOOL_FALSE = uintWord(0);
const BOOL_TRUE = uintWord(1);

type CallWords = Record<SablierStreamCall, string>;

function streamCallWords(
  network: SablierNetwork,
  overrides: Partial<CallWords> = {},
): CallWords {
  return {
    underlyingToken: addressWord(EVM_FUNDING_USDC_CONTRACTS[network]),
    recipient: addressWord(RECIPIENT),
    sender: addressWord(SENDER),
    depositedAmount: uintWord(9_000_000n),
    withdrawnAmount: uintWord(2_000_000n),
    refundedAmount: uintWord(1_000_000n),
    endTime: uintWord(1_800_000_000),
    wasCanceled: BOOL_FALSE,
    isDepleted: BOOL_FALSE,
    ...overrides,
  };
}

const VERIFIED_STREAM = {
  depositedMinor: "9000000",
  withdrawnMinor: "2000000",
  refundedMinor: "1000000",
  lockedMinor: "6000000",
  endTime: 1_800_000_000,
  recipient: RECIPIENT,
  sender: SENDER,
  streamId: STREAM_ID,
  wasCanceled: false,
  isDepleted: false,
};

interface AuthorityFixture {
  blockNumberHex: string;
  calls: CallWords;
  chainId: string;
}

function authorityFixture(
  network: SablierNetwork,
  blockNumber: number,
  overrides: Partial<CallWords> = {},
): AuthorityFixture {
  return {
    blockNumberHex: `0x${blockNumber.toString(16)}`,
    calls: streamCallWords(network, overrides),
    chainId: network === "base" ? "0x2105" : "0x1",
  };
}

function fetchByAuthority(fixtures: Record<string, AuthorityFixture | Error>) {
  const queried: string[] = [];
  const calls: Array<{ blockTag: unknown; data: string; host: string }> = [];
  const fetchImpl = async (url: URL, init?: RequestInit) => {
    queried.push(url.host);
    const request = JSON.parse(String(init?.body)) as {
      id: string;
      method: string;
      params: readonly unknown[];
    };
    const fixture = fixtures[url.host];
    if (fixture instanceof Error) throw fixture;
    if (!fixture) throw new Error(`unexpected authority ${url.host}`);
    let result: unknown;
    if (request.method === "eth_chainId") {
      result = fixture.chainId;
    } else if (request.method === "eth_getBlockByNumber") {
      result = { number: fixture.blockNumberHex, hash: BLOCK_HASH };
    } else if (request.method === "eth_call") {
      const call = request.params[0] as { data: string };
      calls.push({
        blockTag: request.params[1],
        data: call.data,
        host: url.host,
      });
      const selector = call.data.slice(0, 10);
      const entry = Object.entries(SABLIER_STREAM_SELECTORS).find(
        ([, candidate]) => candidate === selector,
      );
      if (!entry) throw new Error(`unexpected selector ${selector}`);
      result = fixture.calls[entry[0] as SablierStreamCall];
    } else {
      throw new Error(`unexpected method ${request.method}`);
    }
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: request.id, result }),
    );
  };
  return { calls, fetchImpl, queried };
}

describe("Sablier stream state assertions", () => {
  it("accepts only the canonical USDC stream for the expected recipient", () => {
    expect(
      assertSablierStreamState(streamCallWords("base"), "base", STREAM_ID, {
        blockNumber: 100,
        recipient: RECIPIENT,
      }),
    ).toEqual({ ...VERIFIED_STREAM, blockNumber: 100 });
    expect(() =>
      assertSablierStreamState(
        streamCallWords("base", {
          underlyingToken: addressWord(EVM_FUNDING_USDC_CONTRACTS.ethereum),
        }),
        "base",
        STREAM_ID,
        { blockNumber: 100, recipient: RECIPIENT },
      ),
    ).toThrow(/underlying token is not canonical USDC/u);
    expect(() =>
      assertSablierStreamState(
        streamCallWords("base", { recipient: addressWord(SENDER) }),
        "base",
        STREAM_ID,
        { blockNumber: 100, recipient: RECIPIENT },
      ),
    ).toThrow(/recipient is not the expected project address/u);
  });

  it("fails closed on malformed or non-canonical return data", () => {
    const expected = { blockNumber: 100, recipient: RECIPIENT };
    expect(() =>
      assertSablierStreamState(
        streamCallWords("base", { depositedAmount: "0x" }),
        "base",
        STREAM_ID,
        expected,
      ),
    ).toThrow(/not one canonical 32-byte return word/u);
    expect(() =>
      assertSablierStreamState(
        streamCallWords("base", {
          depositedAmount: uintWord((1n << 128n) + 1n),
        }),
        "base",
        STREAM_ID,
        expected,
      ),
    ).toThrow(/exceeds its declared integer width/u);
    expect(() =>
      assertSablierStreamState(
        streamCallWords("base", { wasCanceled: uintWord(2) }),
        "base",
        STREAM_ID,
        expected,
      ),
    ).toThrow(/not a canonical boolean word/u);
    expect(() =>
      assertSablierStreamState(
        streamCallWords("base", {
          underlyingToken: `0x${"11".repeat(32)}`,
        }),
        "base",
        STREAM_ID,
        expected,
      ),
    ).toThrow(/not a canonical address word/u);
    expect(() =>
      assertSablierStreamState(
        streamCallWords("base", {
          withdrawnAmount: uintWord(10_000_000n),
        }),
        "base",
        STREAM_ID,
        expected,
      ),
    ).toThrow(/locked balance is negative/u);
  });
});

describe("Sablier commitment verifier", () => {
  it("verifies a Base stream when two authorities agree exactly", async () => {
    const { calls, fetchImpl, queried } = fetchByAuthority({
      [BASE_HOSTS[0]]: authorityFixture("base", 101),
      [BASE_HOSTS[1]]: authorityFixture("base", 102),
      [BASE_HOSTS[2]]: authorityFixture("base", 103, {
        depositedAmount: uintWord(8_000_000n),
      }),
    });
    const result = await verifyCommitmentSablier({
      network: "base",
      streamId: STREAM_ID,
      recipient: RECIPIENT,
      fetchImpl,
    });
    expect(new Set(queried)).toEqual(new Set(BASE_HOSTS));
    expect(result).toMatchObject({
      mode: "state",
      state: "verified-on-chain",
      network: "base",
      contract: SABLIER_LOCKUP_V4_CONTRACTS.base,
      ...VERIFIED_STREAM,
      blockNumber: 102,
      verifier: {
        version: "commitment-sablier-v1",
        evidenceUrl: `https://basescan.org/address/${SABLIER_LOCKUP_V4_CONTRACTS.base}`,
        reason: null,
      },
    });
    expect(result.authorities).toEqual([
      {
        authority: `https://${BASE_HOSTS[0]}/`,
        blockNumber: 101,
        blockHash: BLOCK_HASH,
      },
      {
        authority: `https://${BASE_HOSTS[1]}/`,
        blockNumber: 102,
        blockHash: BLOCK_HASH,
      },
    ]);
    for (const call of calls) {
      const fixture = {
        "mainnet.base.org": "0x65",
        "base-rpc.publicnode.com": "0x66",
        "base.drpc.org": "0x67",
      }[call.host];
      expect(call.blockTag).toBe(fixture);
    }
  });

  it("verifies an Ethereum stream against all three authorities", async () => {
    const { fetchImpl } = fetchByAuthority({
      [ETHEREUM_HOSTS[0]]: authorityFixture("ethereum", 200),
      [ETHEREUM_HOSTS[1]]: authorityFixture("ethereum", 201),
      [ETHEREUM_HOSTS[2]]: authorityFixture("ethereum", 202),
    });
    const result = await verifyCommitmentSablier({
      network: "ethereum",
      streamId: STREAM_ID,
      recipient: RECIPIENT,
      fetchImpl,
    });
    expect(result).toMatchObject({
      network: "ethereum",
      contract: SABLIER_LOCKUP_V4_CONTRACTS.ethereum,
      lockedMinor: "6000000",
      blockNumber: 202,
      verifier: {
        evidenceUrl: `https://etherscan.io/address/${SABLIER_LOCKUP_V4_CONTRACTS.ethereum}`,
      },
    });
    expect(result.authorities).toHaveLength(3);
  });

  it("refuses a quorum when stream states disagree", async () => {
    const { fetchImpl } = fetchByAuthority({
      [BASE_HOSTS[0]]: authorityFixture("base", 101),
      [BASE_HOSTS[1]]: authorityFixture("base", 102, {
        withdrawnAmount: uintWord(3_000_000n),
      }),
      [BASE_HOSTS[2]]: new Error("authority offline"),
    });
    await expect(
      verifyCommitmentSablier({
        network: "base",
        streamId: STREAM_ID,
        recipient: RECIPIENT,
        fetchImpl,
      }),
    ).rejects.toThrow(/did not reach commitment quorum/u);
  });

  it("refuses equal net balances backed by different stream states", async () => {
    const { fetchImpl } = fetchByAuthority({
      [BASE_HOSTS[0]]: authorityFixture("base", 101),
      [BASE_HOSTS[1]]: authorityFixture("base", 102, {
        depositedAmount: uintWord(10_000_000n),
        withdrawnAmount: uintWord(3_000_000n),
      }),
      [BASE_HOSTS[2]]: new Error("authority offline"),
    });

    await expect(
      verifyCommitmentSablier({
        network: "base",
        streamId: STREAM_ID,
        recipient: RECIPIENT,
        fetchImpl,
      }),
    ).rejects.toThrow(/did not reach commitment quorum/u);
  });

  it("refuses authorities serving the wrong chain or malformed data", async () => {
    const wrongChain = authorityFixture("base", 101);
    wrongChain.chainId = "0x1";
    const malformed = authorityFixture("base", 102, {
      recipient: "not-hex",
    });
    const { fetchImpl } = fetchByAuthority({
      [BASE_HOSTS[0]]: wrongChain,
      [BASE_HOSTS[1]]: malformed,
      [BASE_HOSTS[2]]: authorityFixture("base", 103),
    });
    await expect(
      verifyCommitmentSablier({
        network: "base",
        streamId: STREAM_ID,
        recipient: RECIPIENT,
        fetchImpl,
      }),
    ).rejects.toThrow(/did not reach commitment quorum/u);
  });

  it("reports a canceled, depleted stream truthfully", async () => {
    const drained = {
      depositedAmount: uintWord(9_000_000n),
      withdrawnAmount: uintWord(5_000_000n),
      refundedAmount: uintWord(4_000_000n),
      wasCanceled: BOOL_TRUE,
      isDepleted: BOOL_TRUE,
    };
    const { fetchImpl } = fetchByAuthority({
      [BASE_HOSTS[0]]: authorityFixture("base", 101, drained),
      [BASE_HOSTS[1]]: authorityFixture("base", 102, drained),
      [BASE_HOSTS[2]]: authorityFixture("base", 103, drained),
    });
    const result = await verifyCommitmentSablier({
      network: "base",
      streamId: STREAM_ID,
      recipient: RECIPIENT,
      fetchImpl,
    });
    expect(result).toMatchObject({
      lockedMinor: "0",
      withdrawnMinor: "5000000",
      refundedMinor: "4000000",
      wasCanceled: true,
      isDepleted: true,
    });
  });

  it("rejects invalid inputs before querying any authority", async () => {
    let queried = false;
    const fetchImpl = async () => {
      queried = true;
      return new Response();
    };
    await expect(
      verifyCommitmentSablier({
        network: "polygon",
        streamId: STREAM_ID,
        recipient: RECIPIENT,
        fetchImpl,
      }),
    ).rejects.toThrow(/network must be base or ethereum/u);
    await expect(
      verifyCommitmentSablier({
        network: "base",
        streamId: "0",
        recipient: RECIPIENT,
        fetchImpl,
      }),
    ).rejects.toThrow(/stream id is not a canonical uint256 integer/u);
    await expect(
      verifyCommitmentSablier({
        network: "base",
        streamId: "1".repeat(79),
        recipient: RECIPIENT,
        fetchImpl,
      }),
    ).rejects.toThrow(/stream id is not a canonical uint256 integer/u);
    await expect(
      verifyCommitmentSablier({
        network: "base",
        streamId: STREAM_ID,
        recipient: RECIPIENT.toUpperCase(),
        fetchImpl,
      }),
    ).rejects.toThrow(/recipient is not a canonical EVM address/u);
    expect(queried).toBe(false);
  });
});

describe("Sablier commitment CLI parser", () => {
  it("parses only the exact documented arguments", () => {
    expect(
      parseCommitmentSablierArguments([
        "--network",
        "base",
        "--stream-id",
        STREAM_ID,
        "--recipient",
        RECIPIENT,
      ]),
    ).toEqual({ network: "base", streamId: STREAM_ID, recipient: RECIPIENT });
    expect(() => parseCommitmentSablierArguments(["--vault", "x"])).toThrow(
      /Usage/u,
    );
    expect(() => parseCommitmentSablierArguments(["--network"])).toThrow(
      /Usage/u,
    );
    expect(() =>
      parseCommitmentSablierArguments(["--network", "--stream-id"]),
    ).toThrow(/Usage/u);
    expect(() =>
      parseCommitmentSablierArguments([
        "--network",
        "base",
        "--network",
        "ethereum",
      ]),
    ).toThrow(/Usage/u);
  });
});
