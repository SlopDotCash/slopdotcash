import { expect, test } from "bun:test";
import { solanaBase58, solanaBase64 } from "../../contracts/solana/adapter";
import {
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
} from "../../contracts/solana/token-extensions";
import {
  ata,
  concat,
  createAta,
  message,
} from "../../contracts/solana/transactions";
import type { JupiterRouteExpectation } from "./jupiter-route";
import { JUPITER_PROGRAM, parseTransaction } from "./solana";
import { resolveSolanaAccounts } from "./solana-accounts";
import {
  assertSolanaRouteSimulation,
  reviewSolanaRouteAccounts,
} from "./solana-route-accounts";

const key = (n: number) => solanaBase58(new Uint8Array(32).fill(n));
const bytes = (n: number) => new Uint8Array(32).fill(n);
const u64 = (n: bigint) => {
  const data = new Uint8Array(8);
  new DataView(data.buffer).setBigUint64(0, n, true);
  return data;
};
const bpf = "BPFLoaderUpgradeab1e11111111111111111111111";
const system = "11111111111111111111111111111111";
type RpcAccount = {
  owner: string;
  executable: boolean;
  lamports: number;
  data: [string, string];
};
const rpcAccount = (
  owner: string,
  data: Uint8Array,
  executable = false,
): RpcAccount => ({
  owner,
  executable,
  lamports: 10_000_000,
  data: [solanaBase64(data), "base64"],
});
function tokenAccount(
  program: string,
  mint: number,
  amount: bigint,
  mutate?: (data: Uint8Array) => void,
) {
  const data = new Uint8Array(165);
  data.set(bytes(mint));
  data.set(bytes(1), 32);
  data.set(u64(amount), 64);
  data[108] = 1;
  mutate?.(data);
  return rpcAccount(program, data);
}

async function fixture(
  options: {
    extraHolding?: boolean;
    badMint?: boolean;
    token2022?: boolean;
    missing?: boolean;
  } = {},
) {
  const inputProgram = options.token2022 ? TOKEN_2022_PROGRAM : TOKEN_PROGRAM;
  const expected: JupiterRouteExpectation = {
    program: JUPITER_PROGRAM,
    wallet: key(1),
    inputMint: key(2),
    inputProgram,
    outputMint: key(3),
    outputProgram: TOKEN_PROGRAM,
    amountIn: 1000n,
    quotedOut: 2000n,
    minimumOut: 1990n,
    slippageBps: 50,
  };
  const source = ata(expected.inputMint, expected.wallet, inputProgram),
    destination = ata(expected.outputMint, expected.wallet);
  const accounts = [
    { key: inputProgram, write: false },
    { key: expected.wallet, write: false },
    { key: source, write: true },
    { key: destination, write: true },
    { key: JUPITER_PROGRAM, write: false },
    { key: expected.outputMint, write: false },
    { key: JUPITER_PROGRAM, write: false },
    { key: key(4), write: false },
    { key: JUPITER_PROGRAM, write: false },
    ...(options.extraHolding ? [{ key: key(6), write: true }] : []),
  ];
  const raw = concat(
    Uint8Array.of(1),
    new Uint8Array(64),
    message(expected.wallet, key(5), [
      {
        program: JUPITER_PROGRAM,
        accounts,
        data: Uint8Array.from([
          229,
          23,
          203,
          151,
          122,
          227,
          173,
          42,
          1,
          0,
          0,
          0,
          3,
          100,
          0,
          1,
          ...u64(1000n),
          ...u64(2000n),
          50,
          0,
          0,
        ]),
      },
    ]),
  );
  const parsed = parseTransaction(raw);
  const proof = await resolveSolanaAccounts(raw, parsed, async () => {
    throw new Error("no lookup tables in this case");
  });
  const inputMint = new Uint8Array(options.badMint ? 170 : 82);
  inputMint[44] = 6;
  inputMint[45] = 1;
  if (options.badMint) {
    inputMint[165] = 1;
    inputMint[166] = 1;
  }
  const outputMint = new Uint8Array(82);
  outputMint[44] = 6;
  outputMint[45] = 1;
  const state = new Map<string, RpcAccount | null>([
    [expected.wallet, rpcAccount(system, new Uint8Array())],
    [inputProgram, rpcAccount(bpf, new Uint8Array(), true)],
    [TOKEN_PROGRAM, rpcAccount(bpf, new Uint8Array(), true)],
    [JUPITER_PROGRAM, rpcAccount(bpf, new Uint8Array(), true)],
    [source, tokenAccount(inputProgram, 2, 2000n)],
    [destination, tokenAccount(TOKEN_PROGRAM, 3, 10n)],
    [expected.inputMint, rpcAccount(inputProgram, inputMint)],
    [expected.outputMint, rpcAccount(TOKEN_PROGRAM, outputMint)],
    [key(4), null],
    [key(6), tokenAccount(TOKEN_PROGRAM, 3, 30n)],
  ]);
  const requests: string[][] = [];
  const rpc = async <T>(method: string, params: unknown[]) => {
    expect(method).toBe("getMultipleAccounts");
    expect(params[1]).toEqual({ encoding: "base64", commitment: "finalized" });
    const addresses = params[0] as string[];
    requests.push(addresses);
    const values = addresses.map((address) => {
      if (!state.has(address)) throw new Error(`fixture lacks ${address}`);
      return state.get(address);
    });
    return {
      context: { slot: 1234 },
      value: options.missing ? values.slice(1) : values,
    } as T;
  };
  return { expected, source, destination, raw, parsed, proof, rpc, requests };
}

test("every resolved account and the input mint are inspected before a swap is admitted", async () => {
  for (const token2022 of [false, true]) {
    const f = await fixture({ token2022 });
    const review = await reviewSolanaRouteAccounts(
      f.rpc,
      f.raw,
      f.parsed,
      f.proof,
      f.expected,
    );
    expect(new Set(f.requests.flat())).toEqual(
      new Set([...f.proof.keys, f.expected.inputMint]),
    );
    expect(review.observations.map((entry) => entry.address)).toEqual(
      f.requests.flat(),
    );
    assertSolanaRouteSimulation(review, 1235, [
      tokenAccount(f.expected.inputProgram, 2, 1000n),
      tokenAccount(TOKEN_PROGRAM, 3, 2000n),
    ]);
  }
});

test("unrelated writable holdings and unsupported Token-2022 mints never reach signing", async () => {
  for (const options of [
    { extraHolding: true },
    { token2022: true, badMint: true },
    { missing: true },
  ]) {
    const f = await fixture(options);
    await expect(
      reviewSolanaRouteAccounts(f.rpc, f.raw, f.parsed, f.proof, f.expected),
    ).rejects.toThrow();
  }
});

test("simulation must preserve authority and prove the exact debit and minimum credit", async () => {
  const f = await fixture();
  const review = await reviewSolanaRouteAccounts(
    f.rpc,
    f.raw,
    f.parsed,
    f.proof,
    f.expected,
  );
  const valid = [
    tokenAccount(TOKEN_PROGRAM, 2, 1000n),
    tokenAccount(TOKEN_PROGRAM, 3, 2000n),
  ];
  expect(() =>
    assertSolanaRouteSimulation(review, 1235, [
      tokenAccount(TOKEN_PROGRAM, 2, 999n),
      valid[1],
    ]),
  ).toThrow("exact input");
  expect(() =>
    assertSolanaRouteSimulation(review, 1235, [
      valid[0],
      tokenAccount(TOKEN_PROGRAM, 3, 1999n),
    ]),
  ).toThrow("minimum output");
  expect(() =>
    assertSolanaRouteSimulation(review, 1235, [
      valid[0],
      tokenAccount(TOKEN_PROGRAM, 3, 2000n, (data) => {
        data[72] = 1;
      }),
    ]),
  ).toThrow("authority or layout");
  expect(() =>
    assertSolanaRouteSimulation(review, 1235, [valid[0], null]),
  ).toThrow("removed");
});

test("newly created destination ATAs verify the output mint and refuse unrelated ATA creations", async () => {
  const expected: JupiterRouteExpectation = {
    program: JUPITER_PROGRAM,
    wallet: key(1),
    inputMint: key(2),
    inputProgram: TOKEN_PROGRAM,
    outputMint: key(3),
    outputProgram: TOKEN_PROGRAM,
    amountIn: 1000n,
    quotedOut: 2000n,
    minimumOut: 1990n,
    slippageBps: 50,
  };
  const source = ata(expected.inputMint, expected.wallet, TOKEN_PROGRAM);
  const destination = ata(expected.outputMint, expected.wallet, TOKEN_PROGRAM);
  const routeInstruction = {
    program: JUPITER_PROGRAM,
    accounts: [
      { key: TOKEN_PROGRAM, write: false },
      { key: expected.wallet, write: false },
      { key: source, write: true },
      { key: destination, write: true },
      { key: JUPITER_PROGRAM, write: false },
      { key: expected.outputMint, write: false },
      { key: JUPITER_PROGRAM, write: false },
      { key: key(4), write: false },
      { key: JUPITER_PROGRAM, write: false },
    ],
    data: Uint8Array.from([
      229,
      23,
      203,
      151,
      122,
      227,
      173,
      42,
      1,
      0,
      0,
      0,
      3,
      100,
      0,
      1,
      ...u64(1000n),
      ...u64(2000n),
      50,
      0,
      0,
    ]),
  };
  const mintBytes = new Uint8Array(82);
  mintBytes[44] = 6;
  mintBytes[45] = 1;
  const runCase = async (options: {
    outputMintState?: RpcAccount | null;
    extraCreateMint?: string;
    extraCreateProgram?: string;
  }) => {
    const instructions = [
      createAta(
        expected.wallet,
        expected.outputMint,
        expected.wallet,
        TOKEN_PROGRAM,
      ),
      ...(options.extraCreateMint
        ? [
            createAta(
              expected.wallet,
              options.extraCreateMint,
              expected.wallet,
              options.extraCreateProgram ?? TOKEN_PROGRAM,
            ),
          ]
        : []),
      routeInstruction,
    ];
    const raw = concat(
      Uint8Array.of(1),
      new Uint8Array(64),
      message(expected.wallet, key(5), instructions),
    );
    const parsed = parseTransaction(raw);
    const proof = await resolveSolanaAccounts(raw, parsed, async () => {
      throw new Error("no lookup tables in this case");
    });
    const state = new Map<string, RpcAccount | null>([
      [expected.wallet, rpcAccount(system, new Uint8Array())],
      [system, rpcAccount(bpf, new Uint8Array(), true)],
      [
        "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
        rpcAccount(bpf, new Uint8Array(), true),
      ],
      [TOKEN_PROGRAM, rpcAccount(bpf, new Uint8Array(), true)],
      [TOKEN_2022_PROGRAM, rpcAccount(bpf, new Uint8Array(), true)],
      [JUPITER_PROGRAM, rpcAccount(bpf, new Uint8Array(), true)],
      [source, tokenAccount(TOKEN_PROGRAM, 2, 2000n)],
      [destination, null],
      [expected.inputMint, rpcAccount(TOKEN_PROGRAM, mintBytes)],
      [
        expected.outputMint,
        options.outputMintState === undefined
          ? rpcAccount(TOKEN_PROGRAM, mintBytes)
          : options.outputMintState,
      ],
      [key(4), null],
      [key(9), rpcAccount(TOKEN_PROGRAM, mintBytes)],
      [ata(key(9), expected.wallet, TOKEN_PROGRAM), null],
      [ata(expected.outputMint, expected.wallet, TOKEN_2022_PROGRAM), null],
    ]);
    const rpc = async <T>(_method: string, params: unknown[]) => {
      const addresses = params[0] as string[];
      return {
        context: { slot: 1234 },
        value: addresses.map((address) => {
          if (!state.has(address)) throw new Error(`fixture lacks ${address}`);
          return state.get(address);
        }),
      } as T;
    };
    return reviewSolanaRouteAccounts(rpc, raw, parsed, proof, expected);
  };

  const valid = await runCase({});
  expect(valid.destination).toBeNull();
  expect(valid.destinationAddress).toBe(destination);

  for (const invalid of [
    { outputMintState: null },
    { outputMintState: rpcAccount(system, new Uint8Array()) },
    { outputMintState: rpcAccount(TOKEN_PROGRAM, mintBytes, true) },
    { outputMintState: rpcAccount(TOKEN_2022_PROGRAM, mintBytes) },
    { extraCreateMint: key(9) },
    { extraCreateMint: expected.inputMint },
    {
      extraCreateMint: expected.outputMint,
      extraCreateProgram: TOKEN_2022_PROGRAM,
    },
  ]) {
    await expect(runCase(invalid)).rejects.toThrow();
  }
});
