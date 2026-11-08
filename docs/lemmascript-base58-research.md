# Complete base58 conversion proof

This isolated follow-up starts from
`54be5f519e1565abc74da0f43c05f0571aa0c9c3`. It addresses the byte/encoding
candidate in the frontend research report. The result is a production-used
proof of the complete conversion loops, not a length-only check or a claim
about signatures, wallet authority or chain evidence.

## Production paths

`src/lib/base58.ts` supplies the shared decoder used by wallet and payout
consent checks, Solana vault/commitment actions, token-mint and account
readers, the fee-conversion route parser, and payment executor signatures.
Its encoder supplies the Solana bounty payment and recovery flows.

`contracts/solana/adapter.ts` also had its own equivalent BigInt encoder,
exported as `solanaBase58` and used for parsed public keys and program-derived
addresses. That duplicate now aliases the canonical `encodeBase58Bytes`.
The existing exported name and internal callers remain intact.

`src/lib/byte-encoding.ts` was also reviewed. Its base64url routines depend
on native `atob`/`btoa`; its buffer routine delegates allocation and copying
to native typed arrays, and its hex routine is a library export. Replacing
these to manufacture extra small proofs would not improve the selected
conversion guarantee. They are unchanged.

## Architecture and contracts

The public API remains `encodeBase58Bytes(Uint8Array): string` and
`decodeBase58Bytes(string): Uint8Array`. The alphabet and
`TypeError("invalid base58 value")` refusal are unchanged.

The three production functions in `src/lib/verified-base58.ts` are:

| Function | Complete contract |
| --- | --- |
| `base58Digit` | Returns the unique index for an alphabet character, and returns -1 if and only if the supplied string equals none of the 58 characters. |
| `convertRadixDigits` | The BigInt Horner/division encoder preserves numeric value and exact leading-zero count, and every output digit is in range. Its actual production call converts byte digits in base 256 to digits in base 58. |
| `decodeBase58Digits` | The original nested byte-carry algorithm preserves the complete input value and leading-zero count, and returns only bytes from 0 through 255. |

The encoder accepts digits in a radix from 2 through 256 and emits digits in
a radix from 2 through 256; the only production call passes 256 and 58.
`Uint8Array` iteration supplies exact integer byte values. The decoder's
input digits are created only after `base58Digit` has returned a valid
index. These are actual caller-established domains, not new public guards
or caps. Number-to-BigInt and BigInt-to-Number conversions operate only on
these bounded integer digits.

The decoder retains its native `& 255` and `>> 8` operations. Before each
byte is processed, carry is at most 57; adding 58 times a byte gives at most
14,847. This nonnegative range lies far below signed 32-bit overflow, so the
generated remainder/division semantics match those operations. All byte
positions, carries, bounds and loop conservation are proved. The extra-carry
loop and the all-zero special case are included.

The alphabet string is written as six concatenated pieces, with exactly the
same 58 characters. This lets the pinned solver discharge its character
facts without a long-literal unfolding limit. `AlphabetUnique` proves that
no two positions contain the same character. The lookup contract includes
the inverse property, not only that an accepted result is in range.

## Roundtrip and leading zeros

The two complete conversion proofs establish both numeric value and the
exact count of leading zero digits. `CanonicalDigitsUnique` proves that
two valid digit sequences in the same radix with those two properties must
be identical. `RadixRoundTrip` composes the proved encoder and decoder
postconditions in either direction. It does not assume a conversion result
is correct instead of proving its loop.

The mathematical kernel and alphabet composition establishes both roundtrip
directions: bytes return after encoding and decoding, and valid alphabet
strings return after decoding and encoding. The native `Uint8Array`, string
iteration and output-mapping wrappers are reviewed and differentially
checked; this is not a separately compiled whole-wrapper theorem. An empty
input stays empty. Every leading zero byte becomes one leading `1`, and
every leading `1` becomes one zero byte. A run made only of zero bytes or
`1` characters retains its full length; numeric value alone would not prove
this property.

The proof uses the repository's JavaScript UTF-16 string model. Native
`for...of` remains in the public decoder. Nonalphabet characters, including
paired and unpaired surrogates, fail before a result is returned. No Unicode
normalization or case folding is introduced.

## Rejected implementations and measured cost

A first decoder prototype used exact BigInt conversion. It preserved values
but took 409 ms versus 99 ms for the old byte-carry decoder on an 8,192-byte
payload in the first paired run, about 4.1 times as long. It was rejected.
A second prototype replaced byte extraction with Number remainder and
`Math.floor`; a later paired run took 379 ms versus 33 ms at the same size.
It was also rejected. Neither slower decoder is in production source.

The final implementation retains the original bitwise hot loop. A bounded
paired run used 3 warmups and 10 alternating before/after samples, with 100
calls per sample for 32/64 bytes, 10 for 1,024 bytes and one for 8,192 bytes.
The same bytes included two leading zeros. Full outputs were checked outside
the timed span. Median milliseconds per call were:

| Bytes | Encode before → after | Decode before → after |
| --- | --- | --- |
| 32 | 0.0036 → 0.0048 | 0.0052 → 0.0083 |
| 64 | 0.0085 → 0.0133 | 0.0113 → 0.0119 |
| 1,024 | 1.881 → 1.760 | 0.458 → 0.564 |
| 8,192 | 207.627 → 201.878 | 32.487 → 33.179 |

These are bounded host measurements, not a speedup claim. Small inputs have
extra array/lookup overhead; the 1,024-byte decode sample rose by 0.106 ms.
The large decode regression was removed: the final 8,192-byte difference was
0.692 ms, about 2.1%. Shared-host scheduling, garbage collection and solver
activity can affect these samples. Typed-array conversion and extra digit
arrays remain explicit allocation costs. Raw samples and both rejected
prototype receipts are retained in ignored `evidence/base58/`.

## Evidence and limits

The pinned tools are Bun 1.3.14, Node 24.15.0, LemmaScript 0.6.6 and
Dafny 4.11.0. Dependencies are read-only symlinks to the installed tools;
no package or shared worktree was changed.

The full three-function module passes **704 strict Dafny obligations,
0 errors**, including canonical uniqueness, roundtrip composition and
alphabet uniqueness. Generated runtime bodies remain unchanged in the
checked proof. Added statements in those bodies are `assert ... by` blocks;
other additions are proved mathematical functions and lemmas. Strict
integrity and source-function obligation checks pass. There are no imported
axioms, assumptions, bodyless methods or unproved external conversion calls.

The unchanged affected workflow tests pass on the frozen baseline and the
new source: **24 tests, 235 assertions, 0 failures** each. They exercise real
wallet-possession HTTP/D1 state and signature verification, Solana vault
account parsing and public-key derivation, monthly commitment construction,
and fee-converter route preparation/refusal. Their chain/RPC fixtures are
controlled; they are not live signing or mainnet evidence.

Saved differential checks compare 1,517 byte encodings, 2,317 decodings,
63 exact invalid-character errors and 1,517 Solana adapter encodings against
the original implementation. Cases include empty/all-zero values, every
single byte, varied zero prefixes, randomized payloads, an 8,192-byte payload,
typed-array offsets, valid strings, whitespace, excluded ASCII characters,
non-ASCII characters, paired surrogates and lone surrogates. Inputs remain
unchanged. Type checking and focused formatting/lint checks pass.

The native string/typed-array adapters and JavaScript runtime allocation are
reviewed boundaries. The theorem does not establish heap capacity or timing,
concurrent mutation of a shared input buffer, platform string iteration,
cryptographic signature truth, wallet control, valid Solana account lengths,
transaction authorization or finality. Existing callers retain those checks.
No new limits or fallback success paths are added. The public decoder still
accepts any finite valid base58 length within available runtime resources.

Reproduce the focused checks from this worktree with:

The native Node registry-sync entry point also imports this codec through
`funding-address.mjs`. Its first integration check found an extensionless
import that Bun accepted but Node 24 could not resolve. The codec now uses
the explicit `.ts` dependency path. Both no-emit TypeScript projects allow
that syntax. `bun run projects:sync`, a direct Node roundtrip with leading
zero bytes, and TypeScript checking pass with this correction. This is a
runtime-resolution fix; it changes no base58 arithmetic or proof body.

```sh
lsc check --backend=dafny --time-limit=30 \
  --extra-flags=--isolate-assertions src/lib/verified-base58.ts
bun test ./contracts/solana/adapter.test.ts \
  ./contracts/solana/monthly-commitment.test.ts \
  ./scripts/wallet-possession.test.ts \
  ./workers/fee-converter/solana-route-prepare.test.ts
bun run typecheck
```

The source hashes, exact-head results and raw comparison/benchmark outputs
are kept under ignored `evidence/base58/`. Captured artifacts are not committed.
The root agent owns the master manifest and inventories. This branch does
not publish, push, merge, sign or send a transaction.
