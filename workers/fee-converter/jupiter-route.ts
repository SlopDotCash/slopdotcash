import { ata } from "../../contracts/solana/transactions";
import { decodeJupiterRoute } from "./jupiter-wire";
import {
  type SolanaAccountProof,
  verifySolanaAccountProof,
} from "./solana-accounts";
import { assertNativeWrap } from "./solana-native-route";
import type { JupiterRouteExpectation } from "./solana-route-types";
import type { ParsedTransaction } from "./solana-transaction";
import {
  invalidRouteRole,
  routeAmountsMatch,
  routeBindingError,
  routeValue,
} from "./verified-jupiter-policy";

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
  const invalid = invalidRouteRole(
    route.accounts,
    instruction.accounts,
    keys,
    parsed.requiredSignatures,
    parsed.readonlySigned,
    parsed.staticKeys.length,
    parsed.readonlyUnsigned,
    proof.loadedWritable.length,
  );
  if (invalid >= 0)
    throw new Error(
      `Jupiter route ${route.accounts[invalid].name} has incorrect privileges`,
    );
  const roles = route.accounts.map((role, position) => ({
    name: role.name,
    value: keys[instruction.accounts[position]],
  }));
  if (routeValue(roles, "user_transfer_authority") !== expected.wallet)
    throw new Error(
      "Jupiter route user_transfer_authority differs from the reviewed swap",
    );
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
  const bindingError = routeBindingError(
    roles,
    {
      ...expected,
      source,
      destination,
    },
    route.name.startsWith("shared_"),
  );
  if (bindingError !== "") throw new Error(bindingError);
  const args = route.args;
  if (
    !Number.isInteger(expected.slippageBps) ||
    !routeAmountsMatch(
      args.in_amount as bigint,
      args.quoted_out_amount as bigint,
      args.slippage_bps as number,
      args.platform_fee_bps as number,
      (args.positive_slippage_bps === undefined
        ? 0
        : args.positive_slippage_bps) as number,
      expected.amountIn,
      expected.quotedOut,
      expected.slippageBps,
      expected.minimumOut,
    )
  )
    throw new Error(
      "Jupiter instruction amounts, fees or slippage differ from the reviewed swap",
    );
  return { source, destination, route: route.name };
}
