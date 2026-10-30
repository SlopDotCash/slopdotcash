import {
  ata,
  concat,
  createAta,
  type Instruction,
  le,
  SYSTEM,
  TOKEN,
} from "../../contracts/solana/transactions";
import { decodeBase58Bytes } from "../../src/lib/base58";
import type { JupiterRouteExpectation } from "./jupiter-route";
import type { ParsedTransaction } from "./solana";
import {
  associatedAccountCreations,
  type SolanaAccountProof,
} from "./solana-accounts";

export const WRAPPED_SOL = "So11111111111111111111111111111111111111112";
const ASSOCIATED = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const COMPUTE = "ComputeBudget111111111111111111111111111111";

function short(value: number) {
  const bytes: number[] = [];
  do {
    const next = value & 127;
    value >>>= 7;
    bytes.push(next | (value ? 128 : 0));
  } while (value);
  return Uint8Array.from(bytes);
}

/** Add only an exact native transfer and sync to an otherwise unchanged Jupiter route. */
export function wrapNativeRoute(
  raw: Uint8Array,
  parsed: ParsedTransaction,
  proof: SolanaAccountProof,
  wallet: string,
  amount: bigint,
): Uint8Array {
  const source = ata(WRAPPED_SOL, wallet, TOKEN);
  if (!proof.keys.includes(source))
    throw new Error(
      "Native route does not use the fee wallet's wrapped SOL account",
    );
  const creations = associatedAccountCreations(parsed, proof.keys, wallet);
  const own: Instruction[] = [
    createAta(wallet, WRAPPED_SOL, wallet, TOKEN),
    {
      program: SYSTEM,
      accounts: [
        { key: wallet, write: true },
        { key: source, write: true },
      ],
      data: concat(Uint8Array.of(2, 0, 0, 0), le(amount)),
    },
    {
      program: TOKEN,
      accounts: [{ key: source, write: true }],
      data: Uint8Array.of(17),
    },
  ];
  const added = [
    ...new Set(
      own.flatMap((ix) => [
        ix.program,
        ...ix.accounts.map((account) => account.key),
      ]),
    ),
  ].filter(
    (key) =>
      !parsed.staticKeys.includes(key) &&
      (!proof.keys.includes(key) || [SYSTEM, TOKEN, ASSOCIATED].includes(key)),
  );
  const moved = new Set(added);
  const lookups = parsed.lookups
    .map((lookup, index) => ({
      address: lookup.address,
      writable: lookup.writable.filter(
        (_value, position) =>
          !moved.has(proof.tables[index].writableAddresses[position]),
      ),
      readonly: lookup.readonly.filter(
        (_value, position) =>
          !moved.has(proof.tables[index].readonlyAddresses[position]),
      ),
    }))
    .filter((lookup) => lookup.writable.length + lookup.readonly.length > 0);
  const staticKeys = [...parsed.staticKeys, ...added];
  const loaded = (writable: boolean) =>
    lookups.flatMap((lookup) => {
      const table = proof.tables.find(
        (entry) => entry.address === lookup.address,
      );
      if (!table) throw new Error("Native route lost a reviewed lookup table");
      const indexes = writable ? table.writableIndexes : table.readonlyIndexes;
      const addresses = writable
        ? table.writableAddresses
        : table.readonlyAddresses;
      return (writable ? lookup.writable : lookup.readonly).map(
        (index) => addresses[indexes.indexOf(index)],
      );
    });
  const keys = [...staticKeys, ...loaded(true), ...loaded(false)];
  if (keys.length > 256 || new Set(keys).size !== keys.length)
    throw new Error("Native route exceeds the account limit");
  const existing: Instruction[] = parsed.instructions
    .filter(
      (ix) =>
        !(
          ix.program === ASSOCIATED &&
          creations.some(
            (entry) =>
              entry.index === ix.accounts[1] &&
              proof.keys[entry.index] === source,
          )
        ),
    )
    .map((ix) => ({
      program: ix.program,
      accounts: ix.accounts.map((index) => ({
        key: proof.keys[index],
        write: false,
      })),
      data: ix.data,
    }));
  const instructions = [
    ...existing.filter((ix) => ix.program === COMPUTE),
    ...own,
    ...existing.filter((ix) => ix.program !== COMPUTE),
  ];
  const indexOf = (key: string) => {
    const index = keys.indexOf(key);
    if (index < 0)
      throw new Error("Native route account mapping is incomplete");
    return index;
  };
  const message = concat(
    ...(parsed.legacy ? [] : [Uint8Array.of(128)]),
    Uint8Array.of(
      parsed.requiredSignatures,
      parsed.readonlySigned,
      parsed.readonlyUnsigned + added.length,
    ),
    short(staticKeys.length),
    ...staticKeys.map(decodeBase58Bytes),
    raw.slice(parsed.blockhashOffset, parsed.blockhashOffset + 32),
    short(instructions.length),
    ...instructions.map((ix) =>
      concat(
        Uint8Array.of(indexOf(ix.program)),
        short(ix.accounts.length),
        Uint8Array.from(ix.accounts.map((account) => indexOf(account.key))),
        short(ix.data.length),
        ix.data,
      ),
    ),
    ...(parsed.legacy
      ? []
      : [
          short(lookups.length),
          ...lookups.map((lookup) =>
            concat(
              decodeBase58Bytes(lookup.address),
              short(lookup.writable.length),
              Uint8Array.from(lookup.writable),
              short(lookup.readonly.length),
              Uint8Array.from(lookup.readonly),
            ),
          ),
        ]),
  );
  const result = concat(Uint8Array.of(1), new Uint8Array(64), message);
  if (result.length > 1232)
    throw new Error("Native route exceeds the transaction size limit");
  return result;
}

/** Recheck the exact wrap before signing and when checking retained signed bytes. */
export function assertNativeWrap(
  parsed: ParsedTransaction,
  proof: SolanaAccountProof,
  expected: JupiterRouteExpectation,
) {
  if (!expected.nativeInput) return;
  if (expected.inputMint !== WRAPPED_SOL || expected.inputProgram !== TOKEN)
    throw new Error("Native input must use the classic wrapped SOL mint");
  const source = ata(WRAPPED_SOL, expected.wallet, TOKEN);
  const direct = parsed.instructions.filter(
    (ix) => ix.program === SYSTEM || ix.program === TOKEN,
  );
  if (direct.length !== 2)
    throw new Error("Native route must wrap its exact input once");
  const [transfer, sync] = direct;
  const accounts = (ix: typeof transfer) =>
    ix.accounts.map((index) => proof.keys[index]);
  if (
    transfer.program !== SYSTEM ||
    transfer.data.length !== 12 ||
    new DataView(transfer.data.buffer, transfer.data.byteOffset).getUint32(
      0,
      true,
    ) !== 2 ||
    new DataView(transfer.data.buffer, transfer.data.byteOffset).getBigUint64(
      4,
      true,
    ) !== expected.amountIn ||
    accounts(transfer).join() !== [expected.wallet, source].join() ||
    sync.program !== TOKEN ||
    sync.data.length !== 1 ||
    sync.data[0] !== 17 ||
    accounts(sync).join() !== source ||
    parsed.instructions.indexOf(sync) >
      parsed.instructions.findIndex((ix) => ix.program === expected.program)
  )
    throw new Error(
      "Native route transfer or sync differs from the exact reviewed input",
    );
}
