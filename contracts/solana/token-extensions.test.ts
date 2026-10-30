import { describe, expect, test } from "bun:test";
import { decodeBase58Bytes } from "../../src/lib/base58";
import {
  ACCOUNT_SIZE,
  MINT_SIZE,
  readTokenAccount,
  readTokenMint,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
} from "./token-extensions";

/**
 * Live mainnet bytes of the approved Pump.fun mint
 * `35fWL6pdJqpconRZPrawUAQegw1QF3p2tgN7mzhTpump` (PMUP), read at finalized slot
 * 461754400: a Token-2022 mint with disabled mint and freeze authorities whose only
 * records are MetadataPointer (18, 64 bytes) and TokenMetadata (19, 124 bytes).
 */
const LIVE_MINT =
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAiK37/nBbAwAGAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAARIAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB7pPFAi0yXAWoPNhsO1RzVnxGcRnvXIGGuq7K5sqxWvEwB8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHuk8UCLTJcBag82Gw7VHNWfEZxGe9cgYa6rsrmyrFa8EAAAAUE1VUAQAAABQTVVQJAAAAGh0dHBzOi8vbS5yYXBpZGxhdW5jaC5pby9tLzllRk93TUNDVgAAAAA=";
/** A live token account of that mint: account type 2 plus ImmutableOwner (7, 0 bytes). */
const LIVE_ACCOUNT =
  "Huk8UCLTJcBag82Gw7VHNWfEZxGe9cgYa6rsrmyrFa+RbI0ckYu41JqAT511C8ekMOYhrXQNUJOKdYXGpWJKyom9WZFiUQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgcAAAA=";
const APPROVED_MINT = decodeBase58Bytes(
  "35fWL6pdJqpconRZPrawUAQegw1QF3p2tgN7mzhTpump",
);
const OTHER_MINT = new Uint8Array(32).fill(4);
const bytes = (base64: string) =>
  Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
const account = (owner: string, data: Uint8Array) => ({
  owner,
  executable: false,
  lamports: 1,
  data: [Buffer.from(data).toString("base64"), "base64"],
});
/** A copy of the live mint with one byte range changed. */
const mutatedMint = (
  mutate: (data: Uint8Array) => Uint8Array | undefined,
): Uint8Array => {
  const data = bytes(LIVE_MINT).slice();
  return mutate(data) ?? data;
};
/** A Token-2022 token account: the 165-byte base, an account type and its records. */
function tokenAccount(records: Uint8Array, type = 2): Uint8Array {
  const data = new Uint8Array(ACCOUNT_SIZE + 1 + records.length);
  data.set(APPROVED_MINT, 0);
  data.set(new Uint8Array(32).fill(3), 32);
  data[ACCOUNT_SIZE] = type;
  data.set(records, ACCOUNT_SIZE + 1);
  return data;
}
/** A classic SPL mint with the given decimals. */
function classicMint(decimals: number, size = MINT_SIZE): Uint8Array {
  const data = new Uint8Array(size);
  data[44] = decimals;
  data[45] = 1;
  return data;
}
const record = (...values: number[]) => Uint8Array.from(values);

describe("readTokenMint", () => {
  test("admits the live approved metadata-only mint", () => {
    const mint = readTokenMint(
      account(TOKEN_2022_PROGRAM, bytes(LIVE_MINT)),
      APPROVED_MINT,
    );
    expect(mint.program).toBe(TOKEN_2022_PROGRAM);
    expect(mint.extensions).toEqual([18, 19]);
    expect(mint.decimals).toBe(6);
  });

  test("admits trailing zero padding after the last record", () => {
    const padded = mutatedMint((data) => {
      const next = new Uint8Array(data.length + 8);
      next.set(data);
      return next;
    });
    expect(
      readTokenMint(account(TOKEN_2022_PROGRAM, padded), APPROVED_MINT)
        .extensions,
    ).toEqual([18, 19]);
  });

  test("keeps classic SPL mints", () => {
    const mint = readTokenMint(
      account(TOKEN_PROGRAM, classicMint(9)),
      APPROVED_MINT,
    );
    expect(mint.program).toBe(TOKEN_PROGRAM);
    expect(mint.decimals).toBe(9);
    expect(mint.extensions).toEqual([]);
  });

  test("refuses an unsupported owner and a non-base64 account", () => {
    expect(() =>
      readTokenMint(
        account("11111111111111111111111111111111", classicMint(6)),
      ),
    ).toThrow();
    expect(() =>
      readTokenMint({
        owner: TOKEN_2022_PROGRAM,
        data: [Buffer.from(classicMint(6)).toString("hex"), "hex"],
        executable: false,
        lamports: 1,
      }),
    ).toThrow();
    // A base mint has no extension under either program, and the subset admits it.
    expect(
      readTokenMint(account(TOKEN_2022_PROGRAM, classicMint(6))).extensions,
    ).toEqual([]);
    expect(() =>
      readTokenMint(account(TOKEN_2022_PROGRAM, classicMint(6, 40))),
    ).toThrow();
  });

  test("refuses an uninitialized mint and a wrong classic layout", () => {
    const uninitialized = classicMint(6);
    uninitialized[45] = 0;
    expect(() =>
      readTokenMint(account(TOKEN_PROGRAM, uninitialized)),
    ).toThrow();
    expect(() =>
      readTokenMint(account(TOKEN_PROGRAM, classicMint(6, 83))),
    ).toThrow();
    expect(() =>
      readTokenMint(account(TOKEN_PROGRAM, classicMint(6, 40))),
    ).toThrow();
  });

  test("refuses a Token-2022 mint whose authorities are not disabled", () => {
    const tagged = mutatedMint((data) => {
      data[46] = 1;
      return undefined;
    });
    expect(() => readTokenMint(account(TOKEN_2022_PROGRAM, tagged))).toThrow();
    const mintAuthority = mutatedMint((data) => {
      data[0] = 1;
      return undefined;
    });
    expect(() =>
      readTokenMint(account(TOKEN_2022_PROGRAM, mintAuthority)),
    ).toThrow();
    const malformedAuthorityTag = mutatedMint((data) => {
      data[47] = 1;
      return undefined;
    });
    expect(() =>
      readTokenMint(account(TOKEN_2022_PROGRAM, malformedAuthorityTag)),
    ).toThrow();
  });

  test("applies the authority rule to a base Token-2022 mint", () => {
    for (const offset of [0, 46]) {
      const mint = classicMint(6);
      mint[offset] = 1;
      mint.fill(9, offset + 4, offset + 36);
      expect(() => readTokenMint(account(TOKEN_2022_PROGRAM, mint))).toThrow();
      expect(readTokenMint(account(TOKEN_PROGRAM, mint)).decimals).toBe(6);
    }
  });

  test("admits revoked authorities that retain their old key bytes", () => {
    // SPL's pack_coption_key(None) clears the four-byte tag only. Revoking a
    // previously active authority therefore leaves its old key in the body.
    for (const mint of [classicMint(6), bytes(LIVE_MINT).slice()]) {
      mint.fill(9, 4, 36);
      mint.fill(7, 50, 82);
      expect(
        readTokenMint(account(TOKEN_2022_PROGRAM, mint), APPROVED_MINT)
          .decimals,
      ).toBe(6);
    }
  });

  test("refuses every other or unknown mint extension", () => {
    // A TransferFeeConfig record is not admitted.
    const transferFee = mutatedMint((data) => {
      data[234] = 1;
      data[235] = 0;
      return undefined;
    });
    expect(() =>
      readTokenMint(account(TOKEN_2022_PROGRAM, transferFee)),
    ).toThrow();
    // A mint carrying an account-only extension is refused too.
    const immutableOwner = Uint8Array.from([
      ...bytes(LIVE_MINT).slice(0, 362),
      7,
      0,
      0,
      0,
    ]);
    expect(() =>
      readTokenMint(account(TOKEN_2022_PROGRAM, immutableOwner)),
    ).toThrow();
    // A duplicate record is refused.
    const duplicate = Uint8Array.from([
      ...bytes(LIVE_MINT).slice(0, 362),
      18,
      0,
      0,
      0,
    ]);
    expect(() =>
      readTokenMint(account(TOKEN_2022_PROGRAM, duplicate)),
    ).toThrow();
  });

  test("refuses a truncated, mistyped or unpadded base", () => {
    const truncatedRecord = bytes(LIVE_MINT).slice(0, 360);
    expect(() =>
      readTokenMint(account(TOKEN_2022_PROGRAM, truncatedRecord)),
    ).toThrow();
    const wrongType = mutatedMint((data) => {
      data[165] = 2;
      return undefined;
    });
    expect(() =>
      readTokenMint(account(TOKEN_2022_PROGRAM, wrongType)),
    ).toThrow();
    const padded = mutatedMint((data) => {
      data[100] = 7;
      return undefined;
    });
    expect(() => readTokenMint(account(TOKEN_2022_PROGRAM, padded))).toThrow();
  });

  test("refuses metadata that does not name the requested mint", () => {
    expect(() =>
      readTokenMint(account(TOKEN_2022_PROGRAM, bytes(LIVE_MINT)), OTHER_MINT),
    ).toThrow();
    const embedded = mutatedMint((data) => {
      data[238 + 32] = 5;
      return undefined;
    });
    expect(() =>
      readTokenMint(account(TOKEN_2022_PROGRAM, embedded), APPROVED_MINT),
    ).toThrow();
  });

  test("refuses malformed metadata", () => {
    const badUri = mutatedMint((data) => {
      // The uri length at the end of the metadata payload overruns the payload.
      data[318] = 0xff;
      data[319] = 0xff;
      return undefined;
    });
    expect(() =>
      readTokenMint(account(TOKEN_2022_PROGRAM, badUri), APPROVED_MINT),
    ).toThrow();
    const badAdditional = mutatedMint((data) => {
      // An additional-metadata count larger than the payload can hold.
      data[358] = 0xff;
      data[359] = 0xff;
      data[360] = 0xff;
      data[361] = 0xff;
      return undefined;
    });
    expect(() =>
      readTokenMint(account(TOKEN_2022_PROGRAM, badAdditional), APPROVED_MINT),
    ).toThrow();
  });
});

describe("readTokenAccount", () => {
  test("admits the live ImmutableOwner token account", () => {
    const reading = readTokenAccount(
      account(TOKEN_2022_PROGRAM, bytes(LIVE_ACCOUNT)),
    );
    expect(reading.program).toBe(TOKEN_2022_PROGRAM);
    expect(reading.extensions).toEqual([7]);
  });

  test("admits a Token-2022 token account with no extension", () => {
    // The real no-extension shape is the 165-byte base with no account-type byte.
    const base = new Uint8Array(ACCOUNT_SIZE);
    base.set(APPROVED_MINT, 0);
    const reading = readTokenAccount(account(TOKEN_2022_PROGRAM, base));
    expect(reading.extensions).toEqual([]);
    expect(readTokenAccount(account(TOKEN_PROGRAM, base)).extensions).toEqual(
      [],
    );
  });

  test("keeps classic SPL token accounts", () => {
    const classic = new Uint8Array(ACCOUNT_SIZE);
    expect(readTokenAccount(account(TOKEN_PROGRAM, classic)).program).toBe(
      TOKEN_PROGRAM,
    );
    expect(() =>
      readTokenAccount(account(TOKEN_PROGRAM, new Uint8Array(169))),
    ).toThrow();
    expect(() =>
      readTokenAccount(account(TOKEN_2022_PROGRAM, new Uint8Array(169))),
    ).toThrow();
  });

  test("admits ImmutableOwner with trailing padding and refuses a payload", () => {
    const padded = tokenAccount(record(7, 0, 0, 0, 0, 0, 0, 0, 0));
    expect(
      readTokenAccount(account(TOKEN_2022_PROGRAM, padded)).extensions,
    ).toEqual([7]);
    const payload = tokenAccount(record(7, 0, 4, 0, 1, 2, 3, 4));
    expect(() =>
      readTokenAccount(account(TOKEN_2022_PROGRAM, payload)),
    ).toThrow();
  });

  test("refuses every other or unknown token-account extension", () => {
    const transferFeeAmount = tokenAccount(
      record(2, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    );
    expect(() =>
      readTokenAccount(account(TOKEN_2022_PROGRAM, transferFeeAmount)),
    ).toThrow();
    const memoTransfer = tokenAccount(record(7, 0, 0, 0, 8, 0, 1, 0));
    expect(() =>
      readTokenAccount(account(TOKEN_2022_PROGRAM, memoTransfer)),
    ).toThrow();
    const duplicate = tokenAccount(record(7, 0, 0, 0, 7, 0, 0, 0));
    expect(() =>
      readTokenAccount(account(TOKEN_2022_PROGRAM, duplicate)),
    ).toThrow();
    const truncated = tokenAccount(record(7, 0, 3, 0, 1));
    expect(() =>
      readTokenAccount(account(TOKEN_2022_PROGRAM, truncated)),
    ).toThrow();
  });
});
