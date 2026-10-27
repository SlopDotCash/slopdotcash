import { expect, test } from "bun:test";
import { solanaBase58 } from "../../contracts/solana/adapter";
import { TOKEN_PROGRAM } from "../../contracts/solana/token-extensions";
import { ata, concat, message } from "../../contracts/solana/transactions";
import {
  assertJupiterRoute,
  type JupiterRouteExpectation,
} from "./jupiter-route";
import { JUPITER_PROGRAM, parseTransaction } from "./solana";
import { resolveSolanaAccounts } from "./solana-accounts";

const key = (n: number) => solanaBase58(new Uint8Array(32).fill(n));
const expected: JupiterRouteExpectation = {
  program: JUPITER_PROGRAM,
  wallet: key(1),
  inputMint: key(2),
  outputMint: key(3),
  inputProgram: TOKEN_PROGRAM,
  outputProgram: TOKEN_PROGRAM,
  amountIn: 1000n,
  quotedOut: 2000n,
  minimumOut: 1990n,
  slippageBps: 50,
};
const u64 = (n: bigint) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, true);
  return [...b];
};
function fixture({
  input = 1000n,
  destination = ata(expected.outputMint, expected.wallet),
  sourceWritable = true,
  routes = 1,
} = {}) {
  const ix = {
    program: JUPITER_PROGRAM,
    accounts: [
      { key: TOKEN_PROGRAM, write: false },
      { key: expected.wallet, write: false },
      { key: ata(expected.inputMint, expected.wallet), write: sourceWritable },
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
      ...u64(input),
      ...u64(2000n),
      50,
      0,
      0,
    ]),
  };
  const raw = concat(
    Uint8Array.of(1),
    new Uint8Array(64),
    message(
      expected.wallet,
      key(5),
      Array.from({ length: routes }, () => ix),
    ),
  );
  const parsed = parseTransaction(raw);
  return { raw, parsed };
}
async function check(options?: Parameters<typeof fixture>[0]) {
  const { raw, parsed } = fixture(options);
  const proof = await resolveSolanaAccounts(raw, parsed, async () => {
    throw new Error("legacy route must not read lookup tables");
  });
  return assertJupiterRoute(raw, parsed, proof, expected);
}

test("the instruction binds an exact input and output to the fee wallet", async () => {
  expect(await check()).toEqual({
    source: ata(expected.inputMint, expected.wallet),
    destination: ata(expected.outputMint, expected.wallet),
    route: "route",
  });
  await expect(check({ input: 1001n })).rejects.toThrow(
    "amounts, fees or slippage",
  );
  await expect(
    check({ destination: ata(expected.outputMint, key(9)) }),
  ).rejects.toThrow("user_destination_token_account");
  await expect(check({ sourceWritable: false })).rejects.toThrow("privileges");
  await expect(check({ routes: 2 })).rejects.toThrow("exactly one route");
});
