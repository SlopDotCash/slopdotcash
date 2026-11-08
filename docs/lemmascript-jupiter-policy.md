# Jupiter account and quote policy

PRD section 6 requires reviewed routes, bounded slippage and protection of
the fee wallet's principal. This cohort proves the complete pure account
and amount decisions used by `assertJupiterRoute`. It complements the signed
transaction and Jupiter byte decoders; neither decoder alone proves that a
well-formed transaction matches the intended swap.

## Runtime connection and contracts

Four functions in `verified-jupiter-policy.ts` are used by the real route
checker:

| Function | Complete result |
| --- | --- |
| `invalidRouteRole` | The first account role with a missing key or incorrect signer/writable privileges, or -1 exactly when every role passes. |
| `routeValue` | The last value for an exact role name, preserving the former Map overwrite rule. |
| `routeBindingError` | The exact first refusal message for the complete source/destination/mint/program/fee-account binding policy, or empty on success. |
| `routeAmountsMatch` | Exact input/quoted amount agreement, integer slippage range, zero platform/positive-slippage fees, positive amounts and sufficient slippage-adjusted output. |

The privilege proof covers static signed and unsigned accounts and loaded
writable accounts. An optional role preserves the existing writable
exception; a signer role still requires account index zero. A failure selects
the first role in schema order, so the caller preserves the original error.

The binding proof preserves user-specific source/destination precedence,
optional source mint and token programs, required destination mint, the
shared-route token-program choice, extra destination restrictions, platform
fee sentinel and admitted Token-2022 program choices. Duplicated role names
retain the last record, as the original Map did. It does not sort, truncate
or discard a role.

The caller still verifies the retained account proof and native-wrap policy
first, requires the fee wallet as sole signer, selects exactly one Jupiter
instruction, decodes it, and checks account-list length. All privilege checks
precede role binding. The authority check remains before native ATA derivation.
Native ATA derivation and returned source/destination/route values are unchanged.

## Domain and external boundaries

`verifySolanaAccountProof` checks every resolved key as canonical base58 and
ties its order to the signed message and retained lookup records. These keys
are nonempty. The role lookup therefore uses the empty string exclusively
for absence. The expectation's keys must also be nonempty: the sole-signer
check binds the wallet, route selection binds the program, and native ATA
derivation checks the input/output mint and token-program keys before the
binding kernel runs. Instruction indices and header counts come from the checked
transaction parser; loaded-writable counts come from the retained proof.
Those integer/range and identity boundaries are prerequisites of the pure
privilege contract, not supplied claims that the swap is authorized.

The four admitted decoder layouts produce typed numeric amount/fee fields.
The caller retains `Number.isInteger` for the requested slippage before the
mathematical-integer contract. All monetary operations use BigInt. Native
string prefix selection, cryptographic hashes, signatures, ATA derivation,
RPC/account authenticity and native wrapping remain separately reviewed and
tested. Arbitrary getters, mutation during the synchronous call and malformed
untyped objects are outside the input-equivalence claim.

This proves the stated pure policies over supplied parsed values. It does
not prove program bytecode, price quality, live liquidity, signer custody,
network finality or the truth of retained observations.

## Verification and workflow evidence

Pinned LemmaScript 0.6.6 and Dafny 4.11.0 verify all four functions together:
83 isolated obligations pass with zero errors or warnings.
The proof keeps generated headers and executable bodies unchanged; its only
additions are defined semantic functions/predicates and assertion proof
blocks. There are no axioms, externs, assumptions or omitted obligations.
The complete source/proof integrity gate is checked independently.

The old/new comparison exercises the actual `assertJupiterRoute` functions
through real transaction parsing, canonical-key and message-hash checks,
ATA derivation and all four schema layouts. It covers every role substitution,
truncation, amounts, fees, slippage and writable-header variants. Direct
privilege and amount boundary checks supplement those workflows. In total,
16,404 comparisons pass, including 80 accepted complete route cases. An
independent review adds 577 checks including repeated role names.

The existing converter, signed-route preparation and migrated native-gas
workflows pass 104 tests and 620 assertions. Type checking and scoped style
checks pass. These controlled tests are not live-chain acceptance.

Seven interleaved measurements of 100 complete checks per layout recorded
before/after medians of approximately 0.263/0.253 ms for `route`, 0.284/0.277 ms
for `shared_accounts_route`, 0.257/0.280 ms for `route_v2`, and 0.269/0.261 ms
for `shared_accounts_route_v2`. Native ATA/hash work dominates these local
cases. The result is no stable latency claim; the linear role lookups replace
a small Map for the bounded canonical account lists.

Raw baseline sources, comparison/benchmark drivers, proof and workflow logs
and source hashes live under ignored `evidence/jupiter-policy/`. Final merged
source, complete proof gate, browser and local-chain checks remain distinct
integration evidence.
