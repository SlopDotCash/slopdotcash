# Native liability and retained expiry evidence

This cohort starts at `54be5f519e1565abc74da0f43c05f0571aa0c9c3` in an
isolated worktree. It addresses the native-gas and retained expiry candidates
from the backend report. PRD sections 6 and 9 and the approved native-fee
policy in `workers/fee-converter/README.md` require fixed transaction and
daily limits, continued reservation for unknown sends, one largest liability
per replacement nonce, and retained evidence before expiry release. This is
a formal assurance improvement; no existing production defect is claimed.

## Complete accounting kernel

`NativeGasJournal.reserve` now calls `nativeDailyLiability` from
`workers/fee-converter/verified-native-liability.ts`. The kernel computes:

```text
sum(recorded actual costs whose settlement day is today)
  + sum over wallet/nonce buckets(max(0, every unresolved maximum in bucket))
```

The proposed reservation is appended as another unresolved entry before the
call. It therefore raises the bucket only when its maximum is larger. Three
replacement attempts do not become three liabilities. An unresolved attempt
continues to count after UTC midnight. Abandoned rows contribute nothing;
actual costs from other settlement days contribute nothing. All wallets in
the selected network remain in the daily calculation.

The exact theorem states equality with `RecordedSpend + PendingTotal` and
nonnegativity. `PendingMaximum` is a terminating definition with separately
checked guarantees: it is nonnegative, bounds every unresolved amount in
that bucket, and is either zero or attained by an input entry. This proves
the maximum, not merely an upper bound or a restatement of the budget check.
The production algorithm is linear: initialize bucket maxima, scan entries,
then sum the maxima. No native Map or sort is assumed inside the theorem.

The input uses complete accounting cases: abandoned, recorded actual with
dated/undated settlement, and unresolved with its bucket and maximum. The
preconditions are nonnegative count and amounts, plus an in-range bucket for
each unresolved entry. `nativeInteger` supplies nonnegative BigInt amounts.
The dense-index adapter creates every bucket index from `Map.size`, so its
values are in range and exact native array indexes.

The adapter retains the original validation order. It skips abandoned rows
without parsing their amounts. For a recorded actual, it parses actual and
maximum and refuses an overrun before looking at the settlement day. It
still checks old-day overruns. Unresolved maxima are parsed in row order.
The proposal is validated before those rows. The original cap refusal, clock
read, nonce/replacement checks, SQL revision fence and insert order remain.

The key is still exactly `` `${feeWallet}:${nonce}` ``. Configured wallets
pass the existing EVM hexadecimal or Solana base58 validator, neither of
which permits a colon. Existing callers and D1 provide the numeric nonce;
Solana's sequence allocator separately checks safe integer range. The proof
does not establish those external identity facts. It preserves the old
string-key equivalence, including any malformed legacy-key collision,
rather than adding a new wallet or nonce restriction. It does not merge old
and new fee wallets merely because their nonces match.

The explicit dated/undated representation also preserves a null settlement
day without relying on its database constraint. This target's nearest
TypeScript configuration produced a widened nullable field in an initial
generation experiment. The selected discriminated representation avoids
that configuration issue. This is not a claim that the compiler cannot
represent nullable fields under a strict TypeScript configuration.

## Retained Solana history comparison

`matchingCompletedCoverage` now calls `matchingExpiryCoverage` in
`workers/fee-converter/verified-expiry.ts`. The full predicate requires two
present completed records, a positive block count, and equality of transaction
ID, signed anchor hash and slot, finalized horizon slot and hash, block count,
and cumulative digest. It preserves the original Boolean coercion and field
comparison order.

This is used by both `proveSolanaExpiry` and
`NativeGasJournal.resolveSolanaExpiry`. It does not compare provider operator,
cursor, expected hash or revision, which may legitimately differ between
independent traversals. The existing callers separately require independent
operators, check the signed reservation and retained records, and require
complete positive history. None of those checks is replaced by an assumed
authorization Boolean.

The proof domain is typed plain records with Boolean completion and integer
numeric fields. The wrapper preserves missing records explicitly and passes
the original record by reference. The differential also checks malformed
values, but that does not enlarge the theorem's domain. Getters/proxies,
provider honesty, finalized chain membership, completeness of RPC history,
hash collision resistance and database atomicity remain outside this proof.

## Validation and cost

Pinned tools: Bun 1.3.14, Node 24.15.0, LemmaScript 0.6.6 and Dafny 4.11.0.
Dependencies are reused through a read-only link. No package install or
shared-worktree edit was made.

```sh
lsc check --backend=dafny --time-limit=30 --extra-flags=--isolate-assertions \
  workers/fee-converter/verified-native-liability.ts
lsc check --backend=dafny --time-limit=30 --extra-flags=--isolate-assertions \
  workers/fee-converter/verified-expiry.ts
bun test --timeout 30000 ./workers/fee-converter/native-gas.test.ts \
  ./workers/fee-converter/fee-converter.test.ts \
  ./workers/fee-converter/solana-route-prepare.test.ts
bun run typecheck
```

The accounting kernel passes **150 strict obligations** (five default-grouped
verifier results). Its checked proof
contains only added mathematical definitions/contracts and assertion proofs;
the generated runtime body and headers are unchanged. The expiry predicate
passes **43 strict obligations** (three default-grouped results) with its generated proof unchanged. Both
pass the repository integrity and obligation checks, with no axioms, externs,
assumptions or unchecked body edits.

The final workflow run passed **104 tests and 620 assertions** with zero
failures; full type checking also passed. The results, source hashes and commit are recorded in
ignored `evidence/native-liability/receipt.json`. The existing real SQLite
and Worker tests cover same-nonce replacements and takeover, winner-only
receipt accounting, overrun/cap refusal, carried liabilities and changed
wallets, retained two-provider expiry agreement, and reviewed Solana routes.
These controlled provider fixtures do not establish live chain or wallet
availability.

The saved comparison runs the exact old and new accounting segments from
`reserve`: **5,045 results and error outcomes match**, including large values,
zero maxima, abandoned malformed amounts, old-day overruns and row-order
refusals. **328 expiry comparison cases** also match. They include changed
compared fields, deliberately ignored fields, missing records and malformed
completion/numeric fields.

The replacement adds a parsed-entry array and a bucket-maxima array. The
algorithm remains linear but uses additional linear memory. A saved small
synthetic benchmark measures this cost; it is not a performance improvement
claim or a bound on a live RPC/SQLite workflow. A separate seven-sample,
alternating-order benchmark produced median milliseconds per calculation:

| Rows | Before | After |
| --- | ---: | ---: |
| 100 | 0.010 | 0.011 |
| 1,000 | 0.264 | 0.131 |
| 10,000 | 6.56 | 6.32 |

Small timings vary with JIT, collection and other local work; these numbers
do not establish an application speedup. Keep the full benchmark receipt
when comparing future changes.

## Remaining high-priority backend candidates

This is a current-source classification, not an assertion that all backend
functions or workflows have been proved. A complete effectful workflow cannot
be closed by proving a local predicate about precomputed authorization.

| Candidate | Pure work that remains useful | Boundary that remains effectful |
| --- | --- | --- |
| `backend/payments/ledger.ts:evidenceFacts`, `indexPaymentEvent`; `chain-awards.ts:holdsAward` | Full typed event/obligation/asset equality can be proved after retaining absent/legacy fields and exact serializer semantics. Fee arithmetic already has a proof. | Canonical finalized observations, authorized wallet lookup, event replay uniqueness, atomic insert and notifications. |
| `backend/payments/vault-snapshots.ts:storeVaultSnapshot` | A complete parsed counter-vector comparison and identity gate are feasible. | Write-time SQL counter fences, competing refreshes, source-chain finality and deployed asset authority. |
| `workers/fee-converter/store.ts:nativeFeeBalance` | Its separate per-attempt maximum reduction is feasible; it uses Solana reservation IDs and EVM nonces and must preserve those different keys. | Revenue classification from direct credits, canonical receipts and durable accounting. It is not covered by this daily-budget theorem. |
| `workers/fee-converter/jupiter-wire.ts`, route and transaction decoders | Bounded byte-consumption and complete field-binding kernels are useful; the independent tooling lane is researching the decoder. | Lookup-table/account acquisition, signature verification, program authority and receipt finality. No whole-parser completion is claimed here. |
| `workers/fee-converter/solana-expiry.ts:proveSolanaExpiry` | The final complete-history comparison is proved here. Further pure block-link/cursor checks are possible. | Two independent RPC histories, retained page completeness, hash acquisition and atomic release remain provider/DB workflows. |
| Monthly allocation family | The emitted frozen award transformation has a separate proof. Ordered latest-change selection and complete input grouping remain distinct feasible work. | Owner authority, exclusion reads, conditional freeze, reservation and funding. |
| Private intake and scan reuse | Qualification/recovery and original-clean reuse have separate completed pure cohorts. | Schema intake, signed actor authority, current revision, private object access, SQL flag coverage and provider calls. |
| `backend/security/direct-payments.ts`, `security/payments.ts` | Parsed transfer-leg equality, exact amounts and complete recovery-choice records are possible later kernels. | Original-payer lookup, renewed recipient consent, chain expiry/cancellation evidence, immutable paid legs and competing recovery writes. The entire recovery function is inherently effectful. |
| Project admission/access and account bans | Pure policy transitions or parsed identity comparisons can be isolated with full inputs. | GitHub permissions, installation status, registry authority, moderation history and atomic activation cannot be proved by a Boolean extraction. |
| `workers/slopbot/value-work-unit.ts:validateWorkUnitPartition` | Complete coverage, nonempty units, unknown/duplicate refusal and exactly-once claim assignment are a strong next pure cohort. | Which commits GitHub accepted and durable consumption/publication. |
| `workers/slopbot/value-evidence.ts:valueEvidenceMatchesRepository` | Exact captured policy/registry-field equality is feasible with native alias normalization kept explicit. | Independent registry selection and live repository identity. |
| Slopbot publication fences | Small input comparisons alone add little: the operative lease and generation conditions execute in SQL. | Database execution time, source ownership, current head and GitHub publication are already the state/concurrency lane's responsibility. |
| Referral accounting | `totalsOf`/`add` and Merkle structural properties are feasible pure work; scalar accrual caps already have a proof. The referral program is deferred from this active-work cohort. | Current program authority, ordered epoch publication, chain root acceptance and hash collision resistance. |

No migration, lease behavior, publication path, UI, signing, deployment,
shared inventory, merge or push is part of this isolated cohort.
