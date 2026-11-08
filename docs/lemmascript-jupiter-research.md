# Jupiter signed-route decoder research

This is a follow-up to the original parser candidate in
[`lemmascript-tooling-research.md`](lemmascript-tooling-research.md). The source
examined is commit `54be5f519e1565abc74da0f43c05f0571aa0c9c3`. The research uses
LemmaScript 0.6.6, Node 24.15.0, Bun 1.3.14 and Dafny 4.11.0. It adds **zero
verified production functions**. No runtime, schema, proof manifest or shared
inventory changed.

The complete decoder is not a small annotation-only target in this compiler.
It remains a high-value, unfinished candidate. A schema-derived typed decoder
is technically plausible; the datatype experiment below confirms that the
schema's size and union shapes alone are not a compiler blocker. This report
defines the work needed to complete that candidate instead of substituting a
scalar amount check for a parser proof.

## Actual production path

[`jupiter-wire.ts`](../workers/fee-converter/jupiter-wire.ts) interprets the
canonical [`jupiter-route-schema.ts`](../workers/fee-converter/jupiter-route-schema.ts).
[`jupiter-route.ts`](../workers/fee-converter/jupiter-route.ts) calls the decoder
after account-proof and native-wrap checks. The same route assertion runs in:

- `reviewSolanaRouteAccounts`, before preparing a signed conversion;
- `D1ConversionStore`, when checking retained route evidence;
- `finalizedRouteCredit`, when checking the finalized signed transaction.

The parser therefore protects real preparation, retained-send and receipt
paths. This is PRD section 6's reviewed Solana conversion and same-wallet output
boundary. The account proof, ATA derivation, signature verification, native
wrapping, simulation, RPC finality and balance reconciliation are separate
parts of those paths; a byte-parser theorem would not prove them.

The existing schema contains four exact-in instruction layouts, 12 named types
(five structs and seven enums), 239 enum variants, 167 variant fields, 13 struct
fields and 24 top-level argument fields. `Swap` has 203 variants. The named-type
graph has no cycle. Its maximum `read` depth is 10 when field, option, vector and
defined-type steps are counted as the current interpreter counts them. There
are 29 distinct field-type shapes, including ten vector, option or fixed-array
shapes. Fixed arrays have lengths 5, 16 and 32. Primitive shapes are `u8`, `u16`,
`u32`, `u64`, `u128`, `bool` and `bytes`.

The four layouts must stay distinct. The first two put the route vector before
the amount fields. The V2 layouts put it after the amount, slippage and fee
fields. The shared-account layouts add the leading account-id byte. A fixed
trailer reader would therefore be incorrect, including for instructions with
appended bytes.

There is no encoded `minimumOut` field in these four layouts. The route
assertion binds decoded `in_amount`, `quoted_out_amount` and `slippage_bps` to
the reviewed expectation, requires zero platform/positive-slippage fees, and
requires positive input, quote and minimum values. It checks
`floor(quotedOut * (10000 - slippageBps) / 10000) >= minimumOut`. The expectation
requires integer slippage from 0 through 10000. `signedMinimumOutput` in
`solana.ts` deliberately permits the API's display threshold to be one unit
above the encoded fields' conservative floor. A future proof must preserve
this distinction rather than invent a minimum field in the signed bytes.

## Exact unsuccessful experiments

The logs and source copies are retained, uncommitted, under
`evidence/jupiter-research/` in the research worktree. `summary.json` records the
source and pinned-compiler hashes. These are compiler experiments, not passing
application tests or parser proofs.

1. Adding only `//@ verify` and `//@ type data number[]` to the actual production
   decoder fails generation: `object spread merge { ...a, ...b } needs a known
   record type for both operands (base: unknown, override: __type)`.
2. A type-only experiment gives `read` a recursive `WireValue` union and `fields`
   a `Record<string, WireValue>` result. It still fails at the spread, with
   `base: unknown, override: map<string, unknown>`. These type-only changes do
   not provide a faithful typed construction for the heterogeneous interpreter.
   Both generation failures recur with a strict TypeScript configuration.
3. An isolated copy of the guarded native byte-view operation fails with
   `Unsupported Dafny method call: .subarray() on array`. Mapping a native
   `Uint8Array` to a sequence supports length and index reads; it does not add
   unsupported methods. Replacing views with full-array copies is not an
   acceptable implicit fix.
4. An isolated copy of the shared-cursor closure fails with
   `Unsupported: multi-statement lambda in Dafny`. The production `take`,
   `unsigned`, `count`, `read` and `fields` closures share cursor/node state;
   annotating their calls cannot make that state an explicit verified result.
5. The pinned extractor drops the expression and message from each `throw`
   (`tools/dist/extract.js`, throw-statement handling). The transformer emits
   `assert false` (`tools/dist/transform.js`, `case "throw"`). A size-refusal
   probe consequently fails verification with `1 verified, 1 error`, at that
   assertion. Preconditions excluding malformed data could prove only a
   successful-input slice; they could not prove exact refusal conditions or
   the existing error ordering for arbitrary bytes.

The first four issues are independent. Resolving the unknown return type alone
does not fix the mutable closures or native view; resolving those does not
recover the exception information erased by extraction. No opaque extern,
assumption, axiom, verifier suppression or generated-body replacement was used.

## Tested datatype feasibility

A separate, deterministic experiment derives TypeScript declarations directly
from the existing schema: all 12 named types, every enum variant, the four
instruction argument records, and a tagged success/error result. It uses the
existing `variant` field as the union discriminant and a sequence model for
`WireBytes`. There is no second manually maintained variant list.

With a local `strict: true` TypeScript configuration, the pinned generator and
Dafny accept all declarations. A datatype-only identity has one verified
obligation and zero errors under `--isolate-assertions`; the repository's
`requireProofIntegrity` and `requireProofObligations` checks also accept it.
This establishes representation feasibility only. It contains no decoder,
valid-input completeness theorem, malformed-input theorem or production call.
Its one obligation is excluded from production proof totals.

The strict configuration matters. The repository root `tsconfig.json` is a
references-only solution file. `lsc` loads that nearest file, not the compiler
options in its referenced projects. In an initial non-strict shape experiment,
nullable variant fields lost their `null` arm in generated declarations.
The strict rerun retains `Option<RemainingAccountsInfo>` and `Option<int>`.
A future parser module must have a deliberately selected strict configuration
and generated-nullability checks. The non-strict experiment is retained as
negative evidence, not accepted as proof of the full output domain.

This is not evidence of a false proof in the current selected suite. A
generation-only comparison of all 14 manifest modules, covering the current 59
selected functions, produced byte-identical artifacts after adding only root
`compilerOptions: { strict: true }`. The original files were restored. Minimal
nullable-record functions with intentionally false postconditions were also
tried: loose generation either failed lowering/emission or produced unresolved
`None` references which Dafny refused; strict generation represented the null
case and refused the false postcondition. No false acceptance was observed.
At this revision, the repository gate already snapshots and hashes the three
root `tsconfig*.json` files; configuration recording and effective strictness
are different issues. A future configuration change should require effective
strictness for the nearest config and retain every config in its `extends`
chain as an input. The full comparison and negative probes are retained under
`evidence/jupiter-research/strict-config/` and `nullability/`.

## Concrete path to complete coverage

The following is implementation work for a separate cohort, not completed work.

1. Use `JUPITER_ROUTE_SCHEMA` as the sole schema authority. A deterministic
   generator can emit approximately 34 reader entry points: the 29 distinct
   field-type shapes, four instruction argument readers and one discriminator
   dispatcher. Common cursor, budget, integer and error support is additional.
   It must emit the 239 cases and their typed records from schema data, check
   regenerated bytes in CI, and bind the generated module to the schema digest.
   Do not hand-copy a second 203-case swap list or silently drop new variants.
2. Replace captured mutation with explicit `(offset, nodes, depth)` parameters
   and tagged success/error returns that carry the resulting cursor and node
   count. Generate sequential field reads in the original order. Preserve
   `++nodes` before the node/depth refusal, depth increments for fields and
   containers, and the current collection limit. A defined-type read, enum tag
   or length word must not accidentally add a node that the original helper
   did not add.
3. Preserve all existing outcomes: input length 8 through 1232, first matching
   discriminator, bounded integer reads, count at most 256, node limit 4096,
   depth limit 32, boolean and option tags restricted to 0/1, admitted enum
   ordinals, exact trailing-byte refusal, then the nonempty route-plan check.
   In particular, a zero-step route with trailing bytes currently reports the
   trailing-byte error first. Preserve primitive result types: up to `u32` is
   a JavaScript number; `u64` and `u128` are bigint. Byte vectors remain native
   views, including zero-length vectors. No extra cap or UTF-8 rule is needed.
4. Resolve the byte-view translation explicitly. One option is a separately
   reviewed, pinned toolchain extension that lowers guarded native `subarray`
   to the corresponding sequence slice. Prove the guards and limit the model
   to read-only contents; alias identity or concurrent external mutation would
   remain outside it. Do not introduce a bodyless trusted view helper. A
   verified offset/length slice descriptor plus a native-view adapter is
   another option: the parser can first prove the exact descriptor range and
   consumed bytes, then the adapter constructs the view. That adapter and its
   content/refinement boundary must still be stated and tested; the descriptor
   theorem is not automatically a proof of the returned native views.
5. Generate defined Borsh semantics and prove each executable reader against
   them: every consumed index is in bounds; success yields the exact canonical
   typed value and final offset; malformed input yields the first applicable
   existing error. The reference relation must describe schema field order,
   discriminants, lengths and byte values independently of a successful
   reader's own assertions. Merely proving a returned offset lies in the
   buffer would not establish completeness or exact decoding.
6. Bind the decoded amount fields in the actual route assertion and prove the
   conservative minimum formula at that call boundary. Keep account/crypto
   checks explicit and preserve the pre-signing, retained-send and finalized
   receipt callers. A stand-alone arithmetic predicate does not prove that
   its arguments came from the signed bytes.
7. Compare the original and generated decoder over all four layouts and every
   enum variant, nested vectors/options, all primitive extrema, truncation at
   each consumed byte, invalid tags, trailing bytes, and competing errors.
   Preserve result shapes and error text/order. Run the real affected
   `solana-route-prepare.test.ts` workflow and the retained-send/finalized
   receipt tests. Add paired benchmarks at the existing 1232-byte limit before
   deciding whether to replace the interpreter. The current tests are not
   evidence that a future generated decoder is correct.

The finite schema graph means this route does not require solving arbitrary
recursive JavaScript object unions. The strict typed-declaration probe is
positive evidence for the generated representation. Executable decoding,
byte-view lowering, error completeness, schema-to-source conformance and
performance remain unimplemented and unverified. This is a substantial parser
verification cohort, not a two-line annotation change.

## Smaller candidate and current disposition

A reusable native-byte unsigned reader could have a complete contract over
widths 1, 2, 4, 8 and 16: exact little-endian value, range below `256^width`,
exact consumed extent and a bound before every indexed read. It could replace
the interpreter's `unsigned` loop without adding a full-input copy. This would
be meaningful primitive verification, but it would leave dispatch, collection
handling, errors, trailing bytes and signed-field binding unproved. It has not
been implemented or counted merely to increase coverage.

The production source was restored byte-for-byte after the annotation-only
probe. No application or full-suite test was run for this documentation-only
result. No signing, broadcasting, RPC mutation, deployment, push or merge took
place. The current integration cohort can proceed independently; complete
Jupiter parser coverage stays explicitly open with the generated-decoder plan
above.
