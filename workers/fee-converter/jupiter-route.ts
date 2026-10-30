import { ata } from "../../contracts/solana/transactions";
import { decodeJupiterRoute } from "./jupiter-wire";
import type { ParsedTransaction } from "./solana";
import {
  type SolanaAccountProof,
  verifySolanaAccountProof,
} from "./solana-accounts";
import { assertNativeWrap } from "./solana-native-route";

export interface JupiterRouteExpectation {
  program: string;
  wallet: string;
  inputMint: string;
  inputProgram: string;
  outputMint: string;
  outputProgram: string;
  amountIn: bigint;
  quotedOut: bigint;
  minimumOut: bigint;
  slippageBps: number;
  /** The exact fee SOL is wrapped and spent atomically; existing WSOL stays untouched. */
  nativeInput?: true;
}

/** Bind the actual on-chain instruction, not the API's description, to the quote. */
export function assertJupiterRoute(
  raw: Uint8Array,
  parsed: ParsedTransaction,
  proof: SolanaAccountProof,
  expected: JupiterRouteExpectation,
) {
  const keys = verifySolanaAccountProof(raw, parsed, proof);
  assertNativeWrap(parsed, proof, expected);
  if (
    parsed.requiredSignatures !== 1 ||
    parsed.readonlySigned !== 0 ||
    keys[0] !== expected.wallet
  )
    throw new Error("Jupiter route requires the fee wallet as its sole signer");
  const routes = parsed.instructions.filter(
    (instruction) => instruction.program === expected.program,
  );
  if (routes.length !== 1)
    throw new Error("Jupiter transaction must contain exactly one route");
  const instruction = routes[0];
  const route = decodeJupiterRoute(instruction.data);
  if (instruction.accounts.length < route.accounts.length)
    throw new Error("Jupiter route account list is incomplete");
  const writable = (index: number) => {
    if (index < parsed.requiredSignatures)
      return index < parsed.requiredSignatures - parsed.readonlySigned;
    if (index < parsed.staticKeys.length)
      return index < parsed.staticKeys.length - parsed.readonlyUnsigned;
    return index < parsed.staticKeys.length + proof.loadedWritable.length;
  };
  const roles = new Map<string, string>();
  route.accounts.forEach((role, position) => {
    const index = instruction.accounts[position];
    if (
      !keys[index] ||
      (role.writable && !role.optional && !writable(index)) ||
      (role.signer && index !== 0)
    )
      throw new Error(`Jupiter route ${role.name} has incorrect privileges`);
    roles.set(role.name, keys[index]);
  });
  const required = (name: string, value: string) => {
    if (roles.get(name) !== value)
      throw new Error(`Jupiter route ${name} differs from the reviewed swap`);
  };
  const optional = (name: string, value: string) => {
    if (roles.has(name)) required(name, value);
  };
  required("user_transfer_authority", expected.wallet);
  const source = ata(
    expected.inputMint,
    expected.wallet,
    expected.inputProgram,
  );
  const destination = ata(
    expected.outputMint,
    expected.wallet,
    expected.outputProgram,
  );
  required(
    roles.has("user_source_token_account")
      ? "user_source_token_account"
      : "source_token_account",
    source,
  );
  required(
    roles.has("user_destination_token_account")
      ? "user_destination_token_account"
      : "destination_token_account",
    destination,
  );
  optional("source_mint", expected.inputMint);
  required("destination_mint", expected.outputMint);
  optional("source_token_program", expected.inputProgram);
  optional("destination_token_program", expected.outputProgram);
  optional("program", expected.program);
  if (roles.has("token_program"))
    required(
      "token_program",
      route.name.startsWith("shared_")
        ? expected.outputProgram
        : expected.inputProgram,
    );
  if (
    roles.has("user_destination_token_account") &&
    roles.has("destination_token_account")
  ) {
    const extraDestination = roles.get("destination_token_account");
    if (
      extraDestination !== expected.program &&
      extraDestination !== destination
    )
      throw new Error("Jupiter route redirects output to another account");
  }
  if (roles.has("platform_fee_account"))
    required("platform_fee_account", expected.program);
  if (roles.has("token_2022_program")) {
    const token2022 = roles.get("token_2022_program");
    if (
      token2022 !== expected.program &&
      token2022 !== expected.inputProgram &&
      token2022 !== expected.outputProgram
    )
      throw new Error("Jupiter route has a foreign token program");
  }
  const args = route.args;
  if (
    args.in_amount !== expected.amountIn ||
    args.quoted_out_amount !== expected.quotedOut ||
    args.slippage_bps !== expected.slippageBps ||
    !Number.isInteger(expected.slippageBps) ||
    expected.slippageBps < 0 ||
    expected.slippageBps > 10000 ||
    args.platform_fee_bps !== 0 ||
    (args.positive_slippage_bps !== undefined &&
      args.positive_slippage_bps !== 0) ||
    expected.amountIn <= 0n ||
    expected.quotedOut <= 0n ||
    expected.minimumOut <= 0n ||
    (expected.quotedOut * BigInt(10000 - expected.slippageBps)) / 10000n <
      expected.minimumOut
  )
    throw new Error(
      "Jupiter instruction amounts, fees or slippage differ from the reviewed swap",
    );
  return { source, destination, route: route.name };
}
