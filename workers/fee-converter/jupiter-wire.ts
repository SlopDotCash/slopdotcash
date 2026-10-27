import { JUPITER_ROUTE_SCHEMA } from "./jupiter-route-schema";

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
  if (data.length < 8 || data.length > 1232)
    throw new Error("Jupiter instruction size is invalid");
  const instruction = JUPITER_ROUTE_SCHEMA.instructions.find((candidate) =>
    candidate.discriminator.every((byte, index) => data[index] === byte),
  );
  if (!instruction)
    throw new Error("Jupiter instruction is not an admitted exact-in route");
  let offset = 8;
  let nodes = 0;
  const take = (length: number) => {
    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      offset + length > data.length
    )
      throw new Error("Truncated Jupiter instruction");
    const bytes = data.subarray(offset, offset + length);
    offset += length;
    return bytes;
  };
  const unsigned = (length: number) => {
    const bytes = take(length);
    let value = 0n;
    for (let i = bytes.length - 1; i >= 0; i--)
      value = (value << 8n) | BigInt(bytes[i]);
    return length <= 4 ? Number(value) : value;
  };
  const count = () => {
    const value = unsigned(4) as number;
    if (value > 256) throw new Error("Jupiter collection exceeds route bounds");
    return value;
  };
  const fields = (values: Field[], depth: number) =>
    Object.fromEntries(
      values.map((field) => [field.name, read(field.type, depth)]),
    );
  const read = (type: WireType, depth: number): unknown => {
    if (++nodes > 4096 || depth > 32)
      throw new Error("Jupiter instruction exceeds decode bounds");
    if (typeof type === "string") {
      const sizes: Record<string, number> = {
        u8: 1,
        u16: 2,
        u32: 4,
        u64: 8,
        u128: 16,
      };
      if (sizes[type]) return unsigned(sizes[type]);
      if (type === "bool") {
        const value = unsigned(1);
        if (value !== 0 && value !== 1)
          throw new Error("Invalid Jupiter boolean");
        return value === 1;
      }
      if (type === "bytes") return take(count());
      throw new Error(`Unsupported Jupiter wire type ${type}`);
    }
    if ("option" in type) {
      const present = unsigned(1);
      if (present === 0) return null;
      if (present !== 1) throw new Error("Invalid Jupiter option tag");
      return read(type.option, depth + 1);
    }
    if ("vec" in type)
      return Array.from({ length: count() }, () => read(type.vec, depth + 1));
    if ("array" in type)
      return Array.from({ length: type.array[1] }, () =>
        read(type.array[0], depth + 1),
      );
    const definition = JUPITER_ROUTE_SCHEMA.types[type.defined.name];
    if (!definition) throw new Error("Unknown Jupiter named wire type");
    if (definition.kind === "struct")
      return fields(definition.fields ?? [], depth + 1);
    const variant = definition.variants?.[unsigned(1) as number];
    if (!variant) throw new Error("Unknown Jupiter route variant");
    return {
      variant: variant.name,
      ...fields(variant.fields ?? [], depth + 1),
    };
  };
  const args = fields(instruction.args, 0);
  if (offset !== data.length)
    throw new Error("Trailing bytes after Jupiter route");
  const plan = args.route_plan;
  if (!Array.isArray(plan) || plan.length === 0)
    throw new Error("Jupiter route has no steps");
  return { name: instruction.name, accounts: instruction.accounts, args };
}
