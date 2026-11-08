# Token-2022 extension parser: proof and compatibility research

This isolated follow-up starts from `b76807343fb0f51c5b7216705b1beafdbac21038`.
It implements one remaining parser candidate. It does not change token policy,
authority checks, signing, deployment, or the separate Quint verifier transport.

## Result and production connection

`contracts/solana/verified-token-extensions.ts` parses the complete Token-2022
type-length-value extension stream. The existing `readTokenMint` and
`readTokenAccount` functions call it and retain their original public results
and error messages. The parser returns each record's type, payload start and
payload length together. Both callers consume those records directly, so the
separate `extensionPayload` traversal is removed.

The scanner retains the existing order of refusal: account size, account type,
incomplete header, unsupported type, duplicate type, incomplete payload. It
still accepts a zero-only suffix as padding. It imposes no total account-size
cap. It never copies a remaining suffix or the complete input byte buffer.

Four actual runtime functions have contracts: `littleEndian16`, `zeroSuffix`,
`hasType` and `decodeTokenExtensions`. Generated definitions are unchanged in
the proof file; only fully defined predicates are added. There are no axioms,
assumptions, external-function stubs or disabled verification obligations.

## Complete scan invariant

`ParsedPrefix` establishes all of these properties at the scanner's cursor:

- Records begin at offset 166, follow one another without gaps, and end at
  the current cursor.
- Every complete four-byte header is in bounds.
- Every recorded type and length equals the little-endian bytes in its header.
- Every payload is fully in bounds; lengths lie between zero and 65,535.
- Every recorded type is allowed and appears only once.

`CompleteScan` characterizes every returned result. Success requires that the
entire suffix after the parsed records is zero padding. Every failure names a
real violation at the first unconsumed header, in the existing refusal order.
Thus the contract is about the whole parser result, including malformed input,
rather than an arithmetic helper detached from parsing.

The loop advances by a complete header plus its payload length. Its cursor is
bounded by the input length. The verifier checks every indexed byte read and
termination. The length precondition uses JavaScript's maximum safe integer;
this is the numeric model boundary, not a newly imposed runtime input limit.

## Explicit Uint8Array semantics

LemmaScript 0.6.6 does not directly extract the complete `Uint8Array` library
type. Its pinned extractor supports `//@ type <parameter> <type>` overrides
in `tools/dist/extract.js` and applies them in `tools/dist/resolve.js`.
The three byte-reading functions explicitly map `bytes` to `number[]` for
verification while retaining `Uint8Array` in their runtime signatures.

This mapping covers only length and bounded indexed reads. Those operations
have the same semantics here: the input is the owned `Uint8Array` created by
the existing RPC/base64 decoder, indexed elements are integers from 0 through
255, and the parser does not mutate or share the buffer. The proof uses no
array-only operation on that parameter. Mutation by external threads, detached
buffers and arbitrary cast objects are outside this contract.

This explicit representation boundary avoids a complete `Array.from` copy.
It is not an assumed external parser. The generated function bodies contain
the same cursor, header reads, duplicate checks, bounds checks and returns as
the actual TypeScript.

## Compatibility and workflow evidence

Pinned tools: Bun 1.3.14, Node 24.15.0, LemmaScript 0.6.6 and Dafny 4.11.0.
The isolated worktree retains captured results under `evidence/token-tlv/`;
these logs are not committed.

A deterministic differential run compares both public readers against the
exact baseline source. It covers 17,878 reader outcomes, including every small
account length through 230, classic and Token-2022 owners, account type values,
mutated checked-in fixture bytes, generated allowed/unsupported/duplicate records,
shortened payloads, and zero/nonzero trailing data. Both successful output
bytes/decimals/type order and error class/message match. The generator seed is
`0x12345678`.

The affected production workflow tests pass: 20 tests and 216 assertions across
the token reader, Solana adapter and fee-converter route preparation suites.
They include RPC-backed token admission, authority refusal, unknown extensions,
the complete owner paths, and versioned swap account review. The added public
reader regressions cover a 2 MiB padding suffix and ambiguous malformed-record
diagnostic precedence. These are local deterministic workflows, not a live
mainnet transaction or proof of RPC truth.

The standalone Dafny run verifies 12 declarations with zero errors. The strict
repository gate additionally regenerates the source, checks immutable generated
definitions and verifies each assertion separately. The final strict run passes
463 obligations for this parser and 1,898 across all ten modules, containing
47 selected runtime functions. Its receipt at
`evidence/lemmascript/1794152342792-47512/result.json` is the authority for those
counts and exact input hashes; `evidence/token-tlv/summary.json` binds the
workflow and benchmark results to the source bytes.

## Measured performance

Eleven paired rounds alternate the old/new order after warmup. The same input,
iteration count, Bun version and process are used. Median elapsed times are:

| Input | Parser and record lookup, old/new | Whole public reader, old/new |
| --- | --- | --- |
| 4,266-byte account | 4.312 / 0.635 ms for 25,000 calls | 25.965 / 26.282 ms for 500 calls |
| 65,705-byte account | 3.067 / 0.463 ms for 25,000 calls | 350.343 / 346.419 ms for 500 calls |
| 2,162,857-byte padded account | 151.852 / 13.064 ms for 15 calls | 263.978 / 159.960 ms for 10 calls |

The whole reader remains dominated by existing base64 decoding and metadata
checks for ordinary accounts. The small-input difference is within observed
timing noise. Removing repeated record lookup and using an indexed zero-suffix
scan materially improves the large-padding case. Raw paired samples, including
an earlier noisier run, remain in local evidence; these measurements are not a
guarantee for every engine or input.

## Remaining boundaries

The proof does not verify base64, expected-mint decoding, token authorities,
account ownership, metadata string/vector contents, RPC finality or signing.
Those remain in the existing callers and workflow tests. In particular, the
metadata `uint32` reader is not represented as proved merely because its input
extent comes from the verified TLV parser. Full Jupiter recursion, base58 and
metadata contents remain separate candidates.

Integration must add the new file to the shared source/state inventory and
retain the token-admission model mapping. This prototype does not regenerate
shared inventories or claim the full application has been proved.
