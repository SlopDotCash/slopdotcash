# Payment evidence and vault counter contracts

This cohort starts at `11e8cf06992c594f8f847e936fed17950a11fb2a` in an
isolated worktree. The approved payment requirement is that a paid record
agrees with finalized evidence and its immutable obligation. The finalized
vault cache must retain its asset and must not decrease cumulative counters.
See PRD section 9 and `backend/payments/README.md`, including the finalized
ledger and vault-cache requirements. This change adds formal assurance to
those existing decisions. It does not claim a new production defect.

## Production contracts

`backend/payments/verified-evidence.ts` contains six checked functions. The
production callers use their results directly to return or refuse a record.
The inputs include the actual record fields, not an authorization Boolean.

| Function | Complete contract | Production use |
| --- | --- | --- |
| `paymentEvidenceMatches` | True exactly when all fifteen encoded event facts agree. These are kind, transaction, event index, block, obligation, project, network, chain, vault, actor, gross, net, fee, source digest and destination. | The existing-event branch in `indexPaymentEvent`. |
| `paymentAssetMatches` | A legacy record without an asset address is accepted. A bound record must agree on both address and decimals. An incompatible record is refused. | The same branch, after event-fact comparison. |
| `obligationIdentityMatches` | True exactly when all nine immutable obligation fields agree: project, network, vault, asset, decimals, actor, gross, fee and source digest. | The internal comparison in `paymentObligationDecision`. |
| `paymentObligationDecision` | An identity conflict takes precedence. Otherwise a paid event needs an existing obligation; an already-paid obligation needs the same recorded transaction. All other inputs return ready. Each of the three results has an if-and-only-if postcondition. | `indexPaymentEvent`, before destination authorization and prior-event comparison. |
| `vaultCounterHeader` | An older block returns older. At the same or a later block, a changed asset or decimals returns asset-changed. Exactly the remaining inputs may compare counters. | The existing-snapshot branch in `storeVaultSnapshot`. |
| `firstDecreasedCounter` | Returns the first index whose new value is smaller, or -1 exactly when every new value is at least its prior value. | All five cumulative counters, in the existing `CUMULATIVE` order. |

The counter loop proves every preceding element is monotone. It covers
arbitrary equal-length BigInt sequences, including empty sequences. The
actual caller constructs both arrays in one five-element loop, so their
lengths are equal and all loop indices are exact JavaScript integers. This
is a complete vector decision, not an assumed counter-validity flag.

## Serialization and caller obligations

The previous event comparison serialized an array of the fifteen facts.
The adapter now serializes each fact as a one-element array and passes the
fifteen resulting strings to the checked comparison. Array-slot encoding
preserves the previous treatment of a missing property, `undefined`, null,
non-finite numbers, nested JSON, and primitive type differences. Destination
still uses `value.destination ?? null`. Nothing is converted to an ID by
`String(value)`, and no new validation rejects old evidence JSON.

The source boundary is plain records read with `JSON.parse` and typed
primitive fields from a chain adapter. JSON parsing, serialization and the
absence of custom getters, proxies or `toJSON` methods remain outside the
proof. The theorem does not assert arbitrary JavaScript object equivalence.
Tests retain syntax errors, a null top-level value, arrays and primitive
legacy values, together with their existing refusal or acceptance behavior.
An absent asset address remains distinct from an explicitly null address.
Absent address still ignores a stray legacy decimals field.

The obligation row comes from the real D1 schema. Its identity fields are
strings and its decimals are an integer from 0 through 36. A nullable paid
transaction is represented explicitly as missing or recorded. This avoids
widened nullable fields under this target's nearest TypeScript configuration;
it is not a claim that strict TypeScript configurations cannot retain null.
No relation between actor identity, ownership and wallet authority is
assumed or established by this comparison.

The original incoming totals validation remains before the snapshot read.
Migration `0021_multi_asset_vault_snapshots.sql` constrains stored block and
cumulative fields to nonempty decimal text; the incoming checks do the same.
Their BigInt conversions are therefore total in the actual caller domain.
The adapter parses the five pairs in the existing order. It parses the full
vector before comparing it; arbitrary fabricated rows with a later invalid
BigInt are outside that schema domain. The old block early return and asset
refusal still precede counter parsing. Number-valued asset decimals are exact
small integers. No monetary value is converted through floating point.

Current balances are separate from cumulative counters: null remains
unreported and zero remains reported zero. `total_service_fees`, the legacy
column retained by the existing write, is unchanged.

## Preserved effects and refusal order

The deployment-scoped replay fast path is unchanged, including its early
return without another chain call. Otherwise the chain adapter runs first,
then existing input/fee checks, the vault asset lookup and policy authorization,
then obligation agreement. Destination authorization for a paid event remains
before the prior-event query. Event facts are compared before the optional
stored asset. The same errors remain at each branch.

The immutable event insert, obligation write, wallet-authorization SQL,
notifications and D1 transaction batch are unchanged. Snapshot SQL still
checks asset, chain, block, observation time and cumulative monotonicity at
write time. Those SQL guards remain necessary when two refreshes race; this
pure theorem does not replace them or prove their concurrency behavior.

The proof does not establish chain finality, honest providers, registry or
wallet authority, transaction uniqueness in storage, notification delivery,
SQL atomicity, live balances, signing, or settlement availability. Those are
effectful workflow boundaries and remain separate from these contracts.

## Evidence

Pinned tools are Bun 1.3.14, Node 24.15.0, LemmaScript 0.6.6 and Dafny 4.11.0.
Dependencies were reused through a read-only link, without an install.
The exact commands use the pinned binaries on `PATH`:

```sh
lsc check --backend=dafny --time-limit=30 --extra-flags=--isolate-assertions \
  backend/payments/verified-evidence.ts
lsc check --backend=dafny --time-limit=30 backend/payments/verified-evidence.ts
bun test --timeout 30000 ./backend/payments/vault-snapshots.test.ts \
  ./backend/payments/dispatch.test.ts ./backend/notifications/notifications.test.ts \
  ./workers/payment-executor/wallet-rotation.test.ts \
  ./workers/payments/refused-broadcast.test.ts
bun run typecheck
```

All six functions pass **58 isolated obligations**, or **11 default-grouped
verifier results**, with zero errors. The checked proof is byte-identical to
`.dfy.gen`. The repository integrity and obligation checks pass. There are
no added axioms, assumptions, extern functions, skipped obligations or
handwritten executable proof bodies.

The existing real SQLite and Worker workflows pass **42 tests and 354
assertions**. They cover vault refreshes and stale writes, payment dispatch,
wallet rotation, rejected or ambiguous broadcast, late recovery and private
notification delivery. Type checking also passes. These controlled provider
workflows do not prove live chain availability.

The saved comparison runs exact baseline function bodies from the base
commit against the new production functions. **19,389 comparisons match**:
14,862 event-fact cases, 56 obligation decisions, 4,036 counter/header cases,
300 migrated SQLite ledger executions and 135 migrated SQLite snapshot
executions. The SQLite checks compare the complete result or error,
verification/authorization call order, event and obligation rows, and full
vault rows. They include replay fast paths, malformed or legacy JSON,
identity conflicts, paid-reference conflicts, old/equal/new blocks, changed
assets and decimals, maximum-length amounts and null-versus-zero balances.
The pure generated cases supplement these actual workflows; they are not
used as a substitute for the workflows or the proof.

The adapter adds fifteen short slot encodings per record in this replay
comparison. A seven-sample local benchmark measured a median 1.98 microseconds
for the old two-record comparison and 5.63 microseconds for the new one, with
100,000 comparisons per sample. This is a measured local cost, not a speedup
claim or a bound on the database/provider workflow. The comparison occurs
after those asynchronous checks; the unchanged deployment fast path avoids
it for already-indexed scoped events. The counter adapter adds two arrays of
five BigInts. Both changes have fixed size in these callers.

Ignored `evidence/payment-evidence/` retains the exact old sources, comparison
driver and results, proof logs, tool versions, workflow/typecheck logs, source
hashes and a commit receipt. Captured evidence is not committed. This report
and the five production/proof files are the only cohort changes. Root-owned
inventories, state models, merge and push remain outside this isolated commit.
