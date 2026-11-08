# Jupiter signed-route decoder

This work replaces the generic Jupiter schema interpreter with generated typed
readers. `JUPITER_ROUTE_SCHEMA` remains the only format authority. It preserves
all admitted formats, returned values, native byte views, errors and limits.
The source baseline is `54be5f519e1565abc74da0f43c05f0571aa0c9c3`.

The full unfiltered deductive check passed with 15,551 verified obligations and
zero errors across all 35 selected production functions and their defined
helpers. The check took 1,135.75 seconds with unchanged input hashes. These
contracts cover the decoder below; they do not prove the whole application or
the deployed Jupiter program.

## Production use and scope

[`jupiter-wire.ts`](../workers/fee-converter/jupiter-wire.ts) calls
[`decodeJupiterBytes`](../workers/fee-converter/verified-jupiter-wire.ts), maps
its refusal code to the existing error message, and restores native byte views
through [`jupiter-values.ts`](../workers/fee-converter/jupiter-values.ts).
[`assertJupiterRoute`](../workers/fee-converter/jupiter-route.ts) continues to
check account privileges, wallets, mints, amounts, fees and slippage. Its real
callers remain:

- `reviewSolanaRouteAccounts`, before preparing a signed conversion;
- `D1ConversionStore`, when checking retained send evidence;
- `finalizedRouteCredit`, when checking the finalized signed transaction.

This serves PRD section 6's reviewed Solana conversion and same-wallet output
requirement. Account proofs, ATA derivation, signatures, native wrapping, RPC
finality and balance reconciliation are separate checks. This parser does not
prove those checks or attest the deployed Jupiter program.

The canonical schema contains four exact-in instruction layouts, 12 named
wire types, five structs, seven enums and 239 enum constructors. `Swap` contains
203 constructors; `CandidateSwap` contains 19. The other enums contain 17 in
total. There are 167 variant fields, 13 struct fields and 24 instruction fields.
The type graph is acyclic. Its maximum interpreter read depth is 10. Primitive
shapes are `u8`, `u16`, `u32`, `u64`, `u128`, `bool` and `bytes`; fixed arrays have
length 5, 16 or 32.

The four layouts remain distinct. The original layouts place the route vector
before amount fields. V2 places it after amount, slippage and fee fields.
Shared-account layouts add a leading account-id byte. A fixed trailer read
would not be correct.

There is no encoded `minimumOut` field. The unchanged route assertion binds
`in_amount`, `quoted_out_amount` and `slippage_bps` to the reviewed expectation,
requires zero platform and positive-slippage fees, and checks positive input,
quote and minimum values. It requires integer slippage from 0 through 10000 and
checks `floor(quotedOut * (10000 - slippageBps) / 10000) >= minimumOut`.
`solana.ts:signedMinimumOutput` permits the API's display threshold to be one
unit above that conservative encoded floor. This distinction is preserved.

## Why a generated typed parser was needed

The pinned toolchain is LemmaScript 0.6.6, Node 24.15.0, Bun 1.3.14 and Dafny
4.11.0. Annotation-only generation of the old interpreter fails on its unknown
heterogeneous record spread. A type-only recursive `WireValue` experiment also
fails there. Independent probes fail on mutable multi-statement closures and
native `Uint8Array.subarray` emission. TypeScript `throw` messages are discarded
by extraction and the statements become `assert false`, so they cannot specify
complete malformed-input refusal behavior.

The solution replaces captured state and exceptions inside the parser with
explicit cursor/node/depth parameters and error results. A deterministic
[single generator](../scripts/generate-jupiter-decoder.mjs) emits the executable
readers, their typed records, the native-value adapter and the defined Borsh
semantics. There is no second handwritten list of swap variants.

The generator emits 29 field-shape readers, four instruction-argument readers,
one raw integer reader and one dispatcher: 35 production functions selected
for verification. Helper functions are co-located so imported executable
contracts do not become opaque externs.

## Contracts

The raw integer reader computes the complete little-endian value, bounds every
read, and proves its result is below `256^width`. The one-, two- and four-byte
results convert to exact JavaScript numbers; eight- and sixteen-byte results
stay bigint. The proof uses native byte length and indexed reads without a
full-payload copy.

Every typed reader returns an error, final offset, node count and value. Its
postcondition equates the entire result with a separately generated recursive
Borsh semantics function. That defined function also proves cursor bounds,
node bounds, the strict node increment for each read, and value validity.
Repeating those same postconditions on every imperative return was removed;
the exact-result equality retains them through the defined semantics contract.

Collection loops preserve the equality between the initial parse and the
remaining parse with its accumulated prefix. They also preserve prefix order,
length, value validity, cursor bounds and node bounds. Fixed arrays and vectors
have explicit loop invariants. Byte vectors return `{ start, length }`
descriptors whose complete extents are proved to lie within the input.

The dispatcher covers every input length permitted by native `Uint8Array`;
malformed content is not excluded by a protocol-validity precondition. Its
existing admission limits remain:

| Check | Preserved rule |
| --- | --- |
| Instruction size | 8 through 1232 bytes |
| Discriminator | One of the four canonical eight-byte values |
| Collection count | At most 256 |
| Read budget | Increment before checking the 4096-node ceiling |
| Depth | Reject above 32 before reading the node |
| Boolean / option tag | Only 0 or 1 |
| Enum tag | Exact admitted ordinal |
| End of instruction | Reject every trailing byte |
| Route plan | Require a nonempty plan after the trailing-byte check |

The last order matters: a zero-step instruction with extra bytes still returns
`Trailing bytes after Jupiter route`, not `Jupiter route has no steps`.

Runtime enum dispatch uses a floor-midpoint tree after the unknown-tag guard.
The functional semantics use a ceiling-midpoint partition with explicit exact
ordinal guards at every leaf. Both derive the ordinals from the canonical
schema. A bounded integer tag reaches its exact existing constructor;
comparison changes introduce no reads or node increments. This reduces proof
path depth without changing the schema's meaning.

## Proof integrity and compiler configuration

The successful command used `lsc check --backend=dafny --time-limit=30` with
`--extra-flags="--isolate-assertions --progress=Batch"` and no symbol filters.
Its process wall limit was 3,600 seconds; each obligation kept the 30-second
limit. An earlier identical-source run reached its 1,200-second wall limit
with 12,101 successful batches and no reported errors, before all helpers had
finished. That incomplete run is retained and does not count as proof closure.
The complete result requires a source-specific wall-budget exception to the
repository checker's usual 180 seconds; other modules keep their existing limit.

The semantics are defined functions and predicates, not axioms. Large helpers
are opaque to keep their definitions out of unrelated solver queries. Every
body remains verified; explicit local reveal/assert blocks prove the required
result equalities. The integrity checker accepts only defined opaque functions
and predicates, retains exact generated headers and executable bodies, and
continues to reject assumptions, bodyless helpers, verifier attributes,
duplicate declarations, opaque methods and opaque lemmas. Its adversarial
regression suite passes 12 tests and 29 assertions.

A nested strict TypeScript configuration is captured with the production
source. This matters because `lsc` reads the nearest literal `tsconfig.json`;
the root references-only solution file does not inherit strict options from its
referenced projects. At the baseline, all 59 selected functions in 14 modules
generated identically with strict mode enabled. Nullable-record false-contract
probes produced failed emission or rejected proofs, not an accepted false
proof. The limitation is recorded accurately rather than attributed to the
existing suite.

Run from the repository root with the pinned tools:

```sh
bun scripts/generate-jupiter-decoder.mjs --write
node node_modules/lemmascript/tools/dist/lsc.js gen --backend=dafny workers/fee-converter/verified-jupiter-wire.ts
bun scripts/generate-jupiter-decoder.mjs --sync-proof
bun scripts/generate-jupiter-decoder.mjs --check
```

The final command compares exact formatted generated source, native adapter and
proof additions. It also checks the canonical schema digest. Unsupported new
argument shapes fail for review instead of silently omitting native conversion.
The proof builder checks that exactly one recursive step assertion is inserted
for each collection reader, including the pinned compiler's lifted temporary
form.

## Validation and measured costs

The saved public-decoder differential runs the actual old and new functions.
The final corpus has 275,748 exact comparisons derived from 2,848 structured
fixtures and 20,000 deterministic random-input cases. It covers all four layouts and all 239 enum
constructors, complete primitive extrema, truncations, invalid tags, trailing
bytes, competing refusal conditions, and vectors of length 0, 2 and 256.
256-step V2 plans and 256 `CandidateSwapWithBps` entries exceed the existing
1232-byte cap and retain that refusal. No cap was added to make a test pass.

It also decodes views beginning 61 bytes into larger buffers and checks native
view class, shared ArrayBuffer identity, exact absolute and relative offsets,
length and content, including zero-length byte vectors. The corpus found no
mismatch. The three existing `solana-route-prepare.test.ts` workflows pass with
79 assertions against the balanced implementation. These are controlled RPC
fixtures with real local signing and D1 execution, not live conversion evidence.
The parser/adapter TypeScript checks and Biome checks pass.

Freshness tests pass unchanged copies and reject changed generated runtime,
canonical schema, proof, compiler-emission shape and an unsupported top-level
byte field. The formatting dependency requires both `biome.json` and
`.gitignore` to be included in the isolated gate's hashed source snapshot.

An independent peer corpus also compared every constructor in every layout:
7,648 comparisons, including 1,912 accepted cases, matched output values,
refusals, account-array reference identity and offset byte views.

The balanced-parser benchmark uses seven interleaved process pairs. Each case
has 10,000 warmup calls and 50,000 timed calls at one fixed call site. Median
microseconds per public decoder call were:

| Case | Bytes | Original | Generated |
| --- | ---: | ---: | ---: |
| Saber | 35 | 6.28 | 2.69 |
| HumidiFiRouterV3 | 116 | 39.06 | 14.34 |
| JupiterRfqV2 | 296 | 13.69 | 5.86 |
| DynamicV2 | 54 | 17.63 | 7.95 |

The host was busy, including with verification. Absolute timings varied
substantially; one Saber pair was worse for the generated decoder. All paired
measurements are retained. These are parser-only observations, not stable
latency guarantees or live conversion measurements. Earlier flat-dispatch
timings are retained separately and are not the final implementation's result.

The actual Worker dry-run bundle at this baseline grows from 1,151,122 to
1,309,038 JavaScript bytes, an increase of 157,916 bytes. Deterministic gzip at
level 9 grows from 249,635 to 258,352 bytes, an increase of 8,717 bytes. Wrangler's
own upload estimates are retained separately. This is a measured build cost;
no Worker was deployed.

## Boundaries and receipts

The generator/schema-to-reader mapping is reviewed and tested, not formally
proved. Dafny checks the generated imperative readers against the defined
recursive semantics. The generator, TypeScript translation, Dafny and solver
remain trusted tools. Freshness checks and all-variant differentials help this
boundary but are not a theorem about the generator itself.

The native adapter constructs `subarray` views only after descriptor validation.
Its host method semantics and reference identity are outside the Dafny sequence
model. Differential evidence covers them. Input bytes are read synchronously
without mutation; concurrent shared-buffer writes or prototype replacement are
outside the contract. No cryptographic, RPC, signing or deployed-program premise
is imported as an axiom.

Ignored receipts, exact source snapshots, tool versions, failed experiments,
full proof logs, differential drivers, benchmark samples and bundle files are
retained under `evidence/jupiter-research/`. Interrupted, failed, filtered and
datatype-only experiments do not count as full parser verification. Merge,
hosted CI, deployment and live-conversion status remain separate gates.
