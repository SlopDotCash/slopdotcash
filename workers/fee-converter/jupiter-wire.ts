import { JUPITER_ROUTE_SCHEMA } from "./jupiter-route-schema";
import { materializeJupiterArgs } from "./jupiter-values";
import { decodeJupiterBytes } from "./verified-jupiter-wire";

type WireType =
  | string
  | { defined: { name: string } }
  | { vec: WireType }
  | { option: WireType }
  | { array: [WireType, number] };
interface Field {
  name: string;
  type: WireType;
}
interface WireDefinition {
  kind: "struct" | "enum";
  fields?: Field[];
  variants?: { name: string; fields?: Field[] }[];
}
export interface JupiterWireSchema {
  instructions: {
    name: string;
    discriminator: number[];
    accounts: {
      name: string;
      writable: boolean;
      signer: boolean;
      optional: boolean;
    }[];
    args: Field[];
  }[];
  types: Record<string, WireDefinition>;
}

/**
 * Decode the whole exact-in instruction, including variable route steps.
 * Reading a fixed trailer is unsafe: Borsh may ignore appended bytes, so an
 * attacker could append a different amount after the amount the program uses.
 */
export function decodeJupiterRoute(data: Uint8Array) {
  const decoded = decodeJupiterBytes(data);
  if (decoded.error !== 0) {
    switch (decoded.error) {
      case 1:
        throw new Error("Jupiter instruction size is invalid");
      case 2:
        throw new Error(
          "Jupiter instruction is not an admitted exact-in route",
        );
      case 3:
        throw new Error("Truncated Jupiter instruction");
      case 4:
        throw new Error("Jupiter collection exceeds route bounds");
      case 5:
        throw new Error("Jupiter instruction exceeds decode bounds");
      case 6:
        throw new Error("Invalid Jupiter boolean");
      case 8:
        throw new Error("Invalid Jupiter option tag");
      case 10:
        throw new Error("Unknown Jupiter route variant");
      case 11:
        throw new Error("Trailing bytes after Jupiter route");
      case 12:
        throw new Error("Jupiter route has no steps");
      default:
        throw new Error("Unknown Jupiter decode result");
    }
  }
  const instruction = JUPITER_ROUTE_SCHEMA.instructions.find(
    (candidate) => candidate.name === decoded.value.name,
  );
  if (!instruction)
    throw new Error("Jupiter instruction is not an admitted exact-in route");
  return {
    name: decoded.value.name,
    accounts: instruction.accounts,
    args: materializeJupiterArgs(data, decoded.value),
  };
}
