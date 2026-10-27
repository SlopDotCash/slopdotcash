import { expect, test } from "bun:test";
import { solanaBase58 } from "../../contracts/solana/adapter";
import { parseTransaction } from "./solana";
import {
  LOOKUP_TABLE_PROGRAM,
  resolveSolanaAccounts,
  verifySolanaAccountProof,
} from "./solana-accounts";

const key = (n: number) => new Uint8Array(32).fill(n);
function transaction() {
  // Two tables deliberately interleave writable/readonly descriptors. Runtime
  // order is both writable sets followed by both readonly sets.
  return new Uint8Array([
    1,
    ...new Uint8Array(64),
    128,
    1,
    0,
    1,
    2,
    ...key(1),
    ...key(2),
    ...key(3),
    1,
    1,
    5,
    0,
    2,
    3,
    4,
    5,
    1,
    99,
    2,
    ...key(10),
    1,
    0,
    1,
    1,
    ...key(11),
    1,
    1,
    1,
    0,
  ]);
}
function table(a: number, b: number) {
  const bytes = new Uint8Array(120);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 1, true);
  view.setBigUint64(4, (1n << 64n) - 1n, true);
  view.setBigUint64(12, 90n, true);
  bytes.set(key(a), 56);
  bytes.set(key(b), 88);
  return bytes;
}
function rpcFor(
  change?: (
    data: Uint8Array,
    value: { owner: string; executable: boolean; data: [string, string] },
  ) => void,
) {
  return async <T>(method: string, params: unknown[]) => {
    expect(method).toBe("getAccountInfo");
    expect(params[1]).toEqual({ encoding: "base64", commitment: "finalized" });
    const bytes =
      params[0] === solanaBase58(key(10)) ? table(20, 21) : table(22, 23);
    const value = {
      owner: LOOKUP_TABLE_PROGRAM,
      executable: false,
      data: ["", "base64"] as [string, string],
    };
    change?.(bytes, value);
    value.data[0] = Buffer.from(bytes).toString("base64");
    return { context: { slot: 100 }, value } as T;
  };
}
test("versioned routes resolve runtime account order and bind every retained lookup to signed bytes", async () => {
  const raw = transaction(),
    parsed = parseTransaction(raw);
  const proof = await resolveSolanaAccounts(raw, parsed, rpcFor());
  expect(proof.keys).toEqual(
    [1, 2, 20, 23, 21, 22].map((n) => solanaBase58(key(n))),
  );
  expect(parsed.instructions[0].accounts.map((i) => proof.keys[i])).toEqual(
    [1, 20, 23, 21, 22].map((n) => solanaBase58(key(n))),
  );
  expect(
    verifySolanaAccountProof(raw, parsed, JSON.parse(JSON.stringify(proof))),
  ).toEqual(proof.keys);
  const changed = raw.slice();
  changed[parsed.blockhashOffset] ^= 1;
  expect(() =>
    verifySolanaAccountProof(changed, parseTransaction(changed), proof),
  ).toThrow("signed message");
  const reordered = structuredClone(proof);
  reordered.keys.reverse();
  expect(() => verifySolanaAccountProof(raw, parsed, reordered)).toThrow(
    "order",
  );
  const descriptor = structuredClone(proof);
  descriptor.tables[0].writableIndexes = [1];
  expect(() => verifySolanaAccountProof(raw, parsed, descriptor)).toThrow(
    "lookup evidence",
  );
});
test("missing, foreign, inactive, and unwarmed lookup tables refuse before route signing", async () => {
  const raw = transaction(),
    parsed = parseTransaction(raw);
  for (const mutate of [
    (_b: Uint8Array, v: { owner: string }) => {
      v.owner = solanaBase58(key(99));
    },
    (b: Uint8Array) => {
      new DataView(b.buffer).setBigUint64(4, 98n, true);
    },
    (b: Uint8Array) => {
      new DataView(b.buffer).setBigUint64(12, 100n, true);
    },
    (b: Uint8Array) => {
      b[21] = 2;
    },
    (_b: Uint8Array, v: { executable: boolean }) => {
      v.executable = true;
    },
  ])
    await expect(
      resolveSolanaAccounts(raw, parsed, rpcFor(mutate)),
    ).rejects.toThrow();
  await expect(
    resolveSolanaAccounts(
      raw,
      parsed,
      async <T>() => ({ context: { slot: 100 }, value: null }) as T,
    ),
  ).rejects.toThrow("unavailable");
});
test("out-of-range, duplicate, and malformed wire account references cannot enter a route proof", async () => {
  const raw = transaction();
  const out = parseTransaction(raw);
  out.lookups[0].writable = [2];
  await expect(resolveSolanaAccounts(raw, out, rpcFor())).rejects.toThrow(
    "exceeds",
  );
  const duplicate = parseTransaction(raw);
  duplicate.lookups[1].address = duplicate.lookups[0].address;
  await expect(resolveSolanaAccounts(raw, duplicate, rpcFor())).rejects.toThrow(
    "Duplicate",
  );
  await expect(
    resolveSolanaAccounts(
      raw,
      parseTransaction(raw),
      rpcFor((b) => b.set(key(1), 56)),
    ),
  ).rejects.toThrow("identity");
  expect(() => parseTransaction(new Uint8Array([...raw, 0]))).toThrow(
    "trailing",
  );
  expect(() => parseTransaction(raw.slice(0, -1))).toThrow("truncated");
  const badIx = raw.slice();
  badIx[170] = 255;
  expect(() => parseTransaction(badIx)).toThrow();
});
