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

Four TLV runtime functions have contracts: `littleEndian16`, `zeroSuffix`,
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

The TLV-only standalone Dafny run verifies 12 declarations with zero errors. The strict
repository gate additionally regenerates the source, checks immutable generated
definitions and verifies each assertion separately. The TLV-only checkpoint passes
463 obligations for this parser and 1,898 across all ten modules, containing
47 selected runtime functions. Its receipt at
`evidence/lemmascript/1794152342792-47512/result.json` is the authority for those
counts and exact input hashes; `evidence/token-tlv/summary.json` binds the
workflow and benchmark results to the source bytes.

## TLV-only checkpoint performance

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

## TokenMetadata cursor follow-up

The follow-up on this branch also verifies `littleEndian32` and
`metadataPayloadValid`, used directly by `readTokenMint`. It removes the former
unproved `uint32` reader and metadata cursor loop. The 64-byte authority/mint
prefix and existing address checks remain in the caller.

The complete `MetadataValid` equivalence covers three length-prefixed fields,
the additional-metadata u32 count, two length-prefixed fields for every entry,
the existing count-versus-payload bound, and a zero-only final suffix.
`WalkFields` defines the exact cursor after a specified number of complete
fields; a missing header or payload yields failure. The runtime loops maintain
equality with that complete walk, not only cursor bounds. Every byte access is
proved in range. Lengths with the top bit set retain their unsigned u32 meaning.

Metadata contents remain arbitrary bytes, as before. The parser does not add
UTF-8, string-content, alignment, or account-size policy. The public reader
still throws `Malformed token metadata` for the same malformed inputs.

This portion uses the same no-copy Uint8Array mapping. Its low-byte shifts are
only by 8 and 16 bits; the byte bounds ensure their results remain nonnegative
and below the signed 32-bit limit, where the extractor's arithmetic shift model
matches JavaScript. The high byte uses exact multiplication to avoid an
unmodeled signed shift/unsigned-shift round trip. Field reads remain inline in
the hot loops rather than adding a function call for every cursor advance.

A differential run against the preceding `6bdfa02ee` implementation compares
19,053 public reader outcomes. It covers missing and truncated headers/fields,
large unsigned length words, vector counts, raw non-UTF8 bytes, padding and
expected-mint mismatches. All results and error class/messages match. The
generator seed is `0x89abcdef`. The 22 affected token/adapter/route workflow
tests pass with 231 assertions. Evidence for this portion is retained under
`evidence/token-metadata/`.

An initial extra per-field cursor helper caused measurable overhead and was
removed. All unfavorable measurements are retained. A focused final hot-loop
comparison uses 15 paired rounds after warmup: minimal and long-string cursor
walks are faster, while 8,181 empty key/value pairs take 20.791 ms versus
21.758 ms for 1,000 validations.

The final whole-reader comparison uses seven alternating pairs of fresh
processes with one fixed function callsite, after warmup. Its baseline is the
TLV-only commit `6bdfa02ee4076734a34088b6a86f3cef63cb7cee`; the after version
also verifies the metadata cursor. It measures:

| Metadata payload | Calls per process | Before / after median | After / before | Change per call |
| --- | ---: | ---: | ---: | ---: |
| Minimal 80 bytes | 30,000 | 300.064 / 374.823 ms | 1.249 | +0.002492 ms |
| 65,080-byte long string | 300 | 481.732 / 616.749 ms | 1.280 | +0.450056 ms |
| 65,528 bytes, 8,181 key/value pairs | 300 | 730.886 / 673.173 ms | 0.921 | -0.192375 ms |

This batch shows a measured overhead for the first two whole-reader cases,
despite the faster isolated cursor loop. Earlier same-process paired runs were
variable under host contention; they are also retained. The useful result is a
complete executable cursor contract and removed duplicate validation code,
not a general speed improvement. Integration must weigh the observed overhead;
no input cap, copy or policy change was added to conceal it.
The earlier TLV-only speed measurements are a separate checkpoint and do not
describe the final reader with metadata validation extracted.

The final metadata follow-up passes the strict repository proof gate:
631 isolated obligations for the combined TLV/metadata module and 2,066 across
the ten modules in this worktree, covering 49 selected runtime functions.
The exact-source receipt is
`evidence/lemmascript/1794153049323-87982/result.json`. The final 19,053-outcome
differential run, 22 workflow tests, typecheck and benchmark source hashes are
recorded by `evidence/token-metadata/summary.json`.

## Remaining boundaries

The proof does not verify base64, expected-mint decoding, token authorities,
account ownership, semantic metadata contents, RPC finality or signing. Those
remain in the existing callers and workflow tests. Metadata length words and
string/vector cursor bounds are covered by the follow-up above; UTF-8 validity
is deliberately not part of current behavior. Full Jupiter recursion, base58
and metadata meaning remain separate candidates.

Integration must add the new file to the shared source/state inventory and
retain the token-admission model mapping. This prototype does not regenerate
shared inventories or claim the full application has been proved.
