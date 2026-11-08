# Complete signed Solana wire parsing

This isolated cohort starts at `4008930a58beeb65ee3eda9316453a8b6633159f`.
It addresses `workers/fee-converter/solana.ts:parseTransaction`, which parses
Jupiter responses, signed sends, native-fee reconciliation and retained
conversion evidence. PRD sections 2 and 6 require exact retained evidence and
bounded, reviewed payment behavior. This change proves the existing wire
parser; it changes no signing, payment, provider or authority policy. No
runtime defect is claimed.

## Architecture and production use

`workers/fee-converter/verified-solana-wire.ts` reads the actual native
`Uint8Array`. It returns a tagged failure or a complete typed transaction
with offsets and spans into that input. The original exported
`parseTransaction` remains the caller-facing wrapper. It consumes all the
new parser's fields to construct the same keys, instructions and lookups.

The six verified functions are:

| Function | Complete result |
| --- | --- |
| `readCompact` | The existing one-to-three-byte compact integer or its first refusal |
| `scanInstructions` | Every ordered instruction, static program index, account span and data span |
| `scanLookups` | Every ordered lookup address, writable-index span and readonly-index span |
| `lookupAccountCount` | The complete loaded-account count across those lookups |
| `accountsBelow` | Whether every instruction account index is below the global account count |
| `parseSolanaWire` | The entire signed legacy/v0 wire message or its original refusal |

Only `parseSolanaWire` is exported as a runtime function. The other functions
are private components of the same proof module. They do not call imported
proof contracts. The complete parser theorem refers to terminating byte
interpretations for compact lengths, instructions, lookups and the signed
message, including failure results; it does not merely assert scalar bounds.

The existing RPC/account-resolution, route review, wallet restrictions,
simulation, signing, receipt handling and broadcast callers are unchanged.
The parser establishes structural facts only. It does not establish that a
signature is valid, a program is allowed, a lookup table is authentic, an
account is writable, a router is honest or a transaction will succeed.

## Exact accepted format and refusal order

The compact decoder deliberately accepts the original format, including
nonminimal/overlong encodings and any terminating third-byte payload. It
accumulates seven-bit groups with powers of 128. These are the same disjoint
21-bit fields as the former mask/shift/or expression. A missing byte returns
`truncated transaction`; three continuation bytes return
`invalid compact length`. No new canonicality or 16-bit restriction is added.

The full parse preserves this order:

1. Decode the signature count before enforcing the message size. Therefore a
   malformed compact prefix still takes precedence over the 1,232-byte
   transaction limit.
2. Skip exactly that many 64-byte signatures, then require a message byte and
   the original size limit. Signature bytes remain uninterpreted.
3. Distinguish legacy from versioned messages using the high bit. A versioned
   message must use `0x80`. Reject an unsupported version before reading the
   signer header.
4. Read all three signer-header fields and the compact static-key count.
   Apply the same signer/header inequalities before reading static keys.
5. Require all 32-byte static keys and the 32-byte recent blockhash. Their
   exact starting offsets are retained.
6. Decode the instruction count and every instruction. Reject an out-of-range
   static program index before reading that instruction's account or data
   lengths. Program identity can never be substituted from a loaded address.
7. For v0 only, decode every lookup address and both index lists. Legacy
   messages do not have a lookup-count suffix.
8. Finally require full byte consumption, at most 256 total static/loaded
   accounts, and every instruction account index below that total. Preserve
   `invalid transaction account indexes or trailing bytes` for these cases.

Failures use the same seven Error messages in the original wrapper. No new
refusal or fallback result is introduced. Empty account/data lists,
zero-signature/header cases, repeated addresses and repeated indices retain
their existing parser behavior. Later semantic checks remain responsible
for accepting or refusing those structures.

## What is proved

The six functions pass **891 isolated Dafny obligations, zero errors** with
pinned LemmaScript 0.6.6 and Dafny 4.11.0. The generated executable bodies and
headers remain unchanged. Additional material consists of proved
interpretation functions and proof-only assertion blocks. Strict integrity
and function-obligation checks pass; there are no axioms, assumptions,
opaque imports or bodyless declarations.

The top-level contract is equality with the complete `SignedTransaction`
interpretation, including every error branch. Its explicit success contract
also establishes:

- the signature/header relationship and all readonly-header inequalities;
- the exact static-key/blockhash relationship and in-bounds message region;
- valid ordered instruction and lookup spans, with each program index in the
  static keys;
- the complete loaded-account count and the 256-account bound;
- every instruction's account reference below that combined count.

The instruction and lookup scan contracts establish exact complete output
and declared record counts on success. Their recursive interpretations
consume each length prefix and each declared span before proceeding. The
signed-message interpretation accepts only when its final cursor is exactly
the end of the supplied bytes. A prefix, skipped instruction, omitted lookup
or unconsumed suffix cannot satisfy that result.

## Native adapters and numeric domain

The explicit `Uint8Array`-to-proof-sequence mapping covers only its byte
length and guarded indexed reads. The runtime never boxes the complete
buffer into a number array. Each real byte is an integer in `[0, 255]`.
The caller supplies a native byte view, so the proof's byte and length
preconditions hold without a new public guard.

The first compact integer is at most 2,097,151. Its 64-byte signature
multiplication is therefore exact. After the size check, the parser works
inside at most 1,232 bytes. Other compact lengths have the same bound and
are checked against remaining bytes before being used. These actual
bounds keep all arithmetic in JavaScript's exact integer range. The theorem
does not extend arbitrary number arrays, detached/mutating buffers, proxies
or overridden byte-view methods into the native input domain.

The static-key block now has one complete extent check before the wrapper
encodes its keys. Previously the loop checked one 32-byte key at a time.
Both have the same first observable refusal because base58 conversion of
an in-bounds native 32-byte value is total and has no external side effect.
Base58 conversion remains in the original wrapper and is not an imported
axiom of this byte-parser theorem.

The wrapper uses the original `raw.slice` operation for keys, instruction
data and lookup addresses, and the original array expansion for index
lists. A plain `Uint8Array` still produces copied instruction data. A Node
`Buffer` still follows its native slice/view behavior. The original byte
view's offset is respected; no read is made against the surrounding backing
buffer. Those wrapper/native operations are reviewed and compared against
the baseline, rather than called a separately compiled whole-wrapper proof.

## Validation

Captured scripts, hashes and logs remain under ignored
`evidence/solana-parser/`; they are not committed.

- A comparison imports the real original and new `parseTransaction` from
  separate worktrees. **10,448 inputs agree**, including **6,657 accepted**
  inputs. It compares full output and all seven error messages, and confirms
  that parsing does not change input bytes. Cases cover legacy/v0, each
  truncation point, byte mutations throughout headers and payloads, one-,
  two- and three-byte compact forms, suffixes, oversized inputs and seeded
  arbitrary byte strings, plus nonzero-offset Uint8Array and Buffer views.
- The original fee-converter, native-gas and Solana route-preparation suites
  pass before and after: **104 tests, 620 assertions, zero failures**.
  These execute the actual conversion/claim, signing, retained-evidence,
  account lookup and recovery paths with controlled providers and storage.
- Separate native checks preserve copied `Uint8Array` data and shared
  `Buffer` data views after the source buffer is changed.
- TypeScript and scoped formatter/linter checks pass.

These results establish local executable/proof compatibility. They do not
claim live RPC correctness, mainnet signing or broadcast, finality, router
execution, wallet authority or payment acceptance.

## Bounded runtime comparison

The complete public parser was timed on four accepted messages. Each case
used 50 paired warmups and 11 alternating rounds of 1,000 calls. A second
bounded run used the same protocol. Both runs first checked full output
agreement; neither boxes the input buffer.

Median milliseconds per parse (original / new) were:

| Message | Bytes | First run | Repeat |
| --- | ---: | ---: | ---: |
| Legacy, 16 data bytes | 186 | 0.010827 / 0.009854 | 0.077395 / 0.022172 |
| Legacy, 1,000 data bytes | 1,171 | 0.043901 / 0.014856 | 0.009368 / 0.009874 |
| Legacy, 100 instructions | 566 | 0.187265 / 0.017891 | 0.180622 / 0.193555 |
| V0, eight lookup tables | 768 | 0.389166 / 0.292628 | 0.255539 / 0.427536 |

The host showed substantial scheduling/GC variability. For the v0 fixture,
90th-percentile round costs were 0.660952 / 0.522536 ms in the first run and
0.302355 / 0.629634 ms in the repeat. The repeat's maximum costs were
0.365918 / 0.750296 ms. For the 100-instruction fixture, repeat maxima were
0.501353 / 0.337624 ms. The two runs do not support a stable speedup or a
stable regression ratio.

The span representation allocates additional instruction/lookup descriptor
objects. It avoids temporary byte copies for headers, compact fields and
intermediate index lists; final public data copies/views remain unchanged.
These are explicit integration tradeoffs, not a general performance claim.
The original three-byte compact bitwise expression is represented by exact
small-integer remainder/multiplication in the new decoder. The end-to-end
measurements include that cost. No collection cap or policy change was
introduced to obtain the proof.

An independent read-only peer review found no substantive discrepancy in the
final source. It ran 231 targeted fixtures and 928 checks against the real
old and new parsers, including all seven errors, zero-signature messages,
legacy/v0, total-account boundaries of 256/257, nonzero-offset views and
post-parse alias checks. It independently confirmed compact-format
compatibility, refusal precedence and native ownership behavior. These are
additional native-wrapper checks, separate from the compiled byte theorem.
