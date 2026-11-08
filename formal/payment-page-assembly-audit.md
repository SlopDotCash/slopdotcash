# Frontend payment page assembly

This source-only addition models the existing public payment loaders for the
PRD section 11 public vault-payment record and STATE-02/STATE-03. It changes
no loader, payment rule, route or UI. No parser, test, typecheck, model run,
simulation, prover, browser or application was executed. All twenty-four
named scenarios in `ui_payment_page_assembly` are unexecuted.

## Reviewed source and model actions

| Source slice | Model relation |
| --- | --- |
| `src/lib/use-direct-transfers.ts`, `loadDirectTransfers` origin check and fetch/body reads | `originRefusal`, `requestPage`, `transportFailure`; host policy and bounded transport are abstract observations. |
| Direct-transfer row checks and paged envelope checks | `receivePage`; row schema and number parsing are predicates, while pinned `through`, pinned `total`, cursor progression, direct-page sum and final count are explicit. |
| Direct-transfer duplicate loop | `appendRow`; record identity represents the actual `network:transactionId` key. A duplicate can occur after an internal prefix was appended, but that prefix is not published. |
| Direct-transfer legacy first response | `receiveLegacy`; only the complete absence of `through`, `next` and `total` selects this branch. Partial pagination fields are an invalid paged envelope, not a fallback. |
| `src/lib/use-vault-payments.ts`, loader | Same paged actions in vault mode; identity represents the payment `id`. The source has no direct-page `totalMicro` property or check, and the model adds none. |
| Both loaders' final count and return | `finishPage`; every continued page remains private assembly. Only a null cursor with an exact total publishes a paged result. |
| Both loader hooks' retry | `retry` starts a fresh invocation with empty local collections and no retained pagination boundary. Generic hook result ownership is modeled separately. |
| `src/lib/payments/contracts.ts` | Direct/vault envelope distinction and integer asset amounts. This does not model token transfer or settlement authority. |

The two loaders share the same essential paged protocol: the first accepted
page establishes `through` and `total`; later pages must repeat both. A
non-null next cursor requires a nonempty page, must increase beyond `after`,
and cannot exceed `through`. Rows cannot repeat within or across pages. The
accumulated count may not exceed the declared total, and continuation after
already reaching that total fails. A final page with a short count also
fails. An HTTP/body/validation failure never converts a collected prefix
into an empty or complete successful list.

Direct paged responses additionally require a canonical unsigned decimal
`totalMicro` and equality with that page's summed amounts. It is a per-page
sum, not the total for the complete history. The model assigns representative
integer amounts one, two and three to its three record identities.

The legacy direct response intentionally keeps its actual weaker contract.
After valid row shapes and a canonical unsigned `totalMicro`, the source
returns the array without comparing that total with its rows, deduplicating
the array, enforcing the paged 100-row limit, or applying the paged final
sort. The model's legacy-success scenario includes a duplicate to make this
boundary explicit. This is not a newly established production defect: the
current backend's legacy response is a complete database projection and
performs its own sum. No compatibility policy is changed by this model.

## Finite scope and external boundaries

The model has direct and vault modes, three record identities, representative
lists of at most three rows, at most three pages per invocation, and one
retry. Cursor/boundary/count representatives are zero through three, with
minus one standing for null/unset; direct page sums range from zero through
six. `headersValid` represents safe integer/canonical field parsing and the
actual 100-row cap, rather than changing the implementation cap to three.
`rowsValid` represents each source validator's exact record-shape checks.

The model exposes the sequential row append loop so a duplicate after an
accepted prefix remains distinct from an envelope refusal. That loop is
synchronous source code, so cancellation is represented only while waiting
for fetch/body I/O. A normal aborted fetch/body rejects the loader; a late
result cannot be interpreted as a published partial list. Generic hook
timeout settlement, mounted ownership, loader replacement and providers
that ignore abort are outside this module and remain the parent resource
model's responsibility.

`through` and row IDs are opaque protocol values to the browser. The model
does not invent a check that record IDs are numerically at most `through`:
the frontend cannot infer a database row sequence from either identity key.
The server's stable append boundary, private-record exclusions, database
reads and public projection remain in `payment_history` and the backend
models. Final direct ordering by block time/transaction ID and vault array
reversal are pure display transforms outside the assembly invariant. Actor
or project scope, route remounts, monetary aggregation and live chain truth
also remain separate concerns.

## Existing conformance references

`tests/e2e/public-vault-payments.spec.ts` exercises the public vault history
through the actual pages, and `tests/e2e/project-payment-navigation.spec.ts`
exercises project-scoped direct history. The native-D1
`backend/payments/direct-history.workflow.mjs` covers a multi-page append
boundary and the complete legacy response. They are evidence references,
not new results: this task did not execute them or claim that they cover
every new refusal scenario. Browser/schema/transport conformance for all
twenty-four named scenarios remains unexecuted.
