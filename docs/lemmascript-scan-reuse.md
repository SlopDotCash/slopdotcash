# Original clean scan reuse

This isolated follow-up starts from `cc54e73b9d44e4b607ffa2c16a9695157b5706f1`.
It implements the clean-scan reuse candidate in the backend research report.
The approved requirement is PRD section 8: reuse retained original clean
evidence only for the same inspected content and policy; a reused scan must
not lift a contributor-flag pause or bypass required freshness checks.
This is an assurance improvement. No runtime defect correction is claimed.

## Actual production boundary

`backend/vetting/reuse.ts:reusableCleanScan` is shared by signed private reuse
lookup and result intake. Lookup still checks the requested input inventory,
flag coverage, result consistency and retained evidence in their existing
order. Intake still verifies the queued assessment, project repository and
assigned commit/template before reuse, then checks retained evidence. The
existing API refusal codes and provider error handling do not change.

The implementation uses four proved functions in
`backend/vetting/verified-reuse.ts`:

| Function | Exact contract |
| --- | --- |
| `reusableAssessmentHeader` | Requires the observed active-flag coverage, proposed clean disposition, present cached assessment, exact cited assessment/project, and cached clean state. Rejects a current quarantine whose latest restriction came from contributor flags. Ignores restriction history for a clear project. Otherwise, an original request must be strictly later than a vetting-service restriction, or at least as late as a restriction from any other actor. |
| `originalScanHeader` | The retained result has the same project, a clean disposition, and no reused assessment ID. |
| `reusableSourceInventory` | A present explicit source digest wins. With no explicit digest, only no execution and zero artifacts permit the final input digest as a legacy source identity. Every other legacy case returns null. |
| `sameScanEvidence` | Requires equal normalized repository, final input digest, nonnull source inventory, source digest, template, policy, run ID and report digest. The theorem includes the complete conjunction, not only consequences of a true result. |

All four functions have no input precondition. The domains include arbitrary
strings, absent or present cited IDs, absent or present cached headers,
explicit restriction states, any finite artifact array, and both execution
presence values. Only artifact length matters; artifact contents are opaque.
The proved timestamp comparisons retain JavaScript UTF-16 lexical ordering,
including the original behavior on noncanonical strings. No Date parsing,
new timestamp validation, or authority decision is introduced.

## Staging and representation

The existing selection of the latest restriction is unchanged: the last
quarantine or ban in the supplied record order, not the largest timestamp.
The shared restriction fold orders these records upstream. The adapter passes
its actual actor role and creation string, not a computed authorization flag.

The wrapper keeps cached-header refusal before retained-result schema checks,
and keeps schema/project/clean/original checks before repository normalization.
`isScanResult` remains the existing schema-tag check. The evidence adapter
keeps the original nested objects and artifact array by reference; the proved
kernel reads them in the original comparison order. It does not eagerly read
the later scan or artifact fields when an earlier mismatch must refuse.
`scanSourceInventory` itself now calls the same proved inventory function.

Native `toLowerCase` stays in the wrapper. The current LemmaScript lowercase
helper models ASCII folding, while JavaScript also folds Unicode; substituting
it would create a false claim for this parser's accepted strings. The adapter
calls native lowercase on the original repository strings in the same order
and passes the results to the proved comparison. No ASCII precondition is
assumed. The string model is the pinned `javascript-utf16` profile.

The only projected boolean is `hasExecution = result.execution !== null`,
which records one actual nullable field. It is not an eligibility decision.
The existing `assessmentCoversActiveFlags` SQL result is still an explicit
external observation. Its query, timing and flag-set completeness are not
proved by this module. Missing coverage still refuses reuse.

An initial experiment under the nearest references-only TypeScript config
emitted an execution record without its nullable wrapper. A later explicit
strict-config experiment retained nullable records correctly; no false proof
acceptance was observed. This implementation projects only that field's
presence and retains all compared strings, nested records and artifact
length. The current selected artifacts are unchanged under strict mode. No
imported axiom, assumed authorization or bodyless function is used.

## Limits

These proofs establish the pure policy stages over the supplied records.
They do not prove database integrity, history ordering, schema validation,
flag coverage, signatures, SHA-256 collision resistance, retained bytes,
GitHub identity, permission, provider availability or concurrent publication.
They also do not prove JavaScript getters/proxies or resource exhaustion.
Production records are plain parsed JSON/D1 records.

The existing code does not independently compare the retained result's own
`assessmentId` to the cached row ID or revalidate all its scan findings here.
Those remain intake/persistence obligations. Reuse intentionally permits a
different commit, revision and manifest when its inspected inventory and
required evidence match. This change does not invent equality requirements
for those fields or claim to establish them.

## Verification

The pinned tools are Bun 1.3.14, Node 24.15.0, LemmaScript 0.6.6 and
Dafny 4.11.0. The runtime dependency link is read-only; no install was run.
The strict command is:

```sh
lsc check --backend=dafny --time-limit=30 \
  --extra-flags=--isolate-assertions backend/vetting/verified-reuse.ts
```

It passes **64 strict obligations, 0 errors**, covering four runtime
functions. The default grouping separately passes seven verifier results.
Generated and checked proof files are identical; the existing
`requireProofIntegrity` and `requireProofObligations` checks pass.

The saved baseline comparison matches **2,608 complete reuse decisions**,
including 493 accepts, plus **32 source-inventory decisions**. Cases cover
all guard fields, current-versus-clear restrictions, service and moderator
time boundaries, record-order selection, Unicode repository folding,
explicit/legacy native evidence, changed commits and absent records. Cases
with malformed retained JSON also preserve early refusal and the observed
exception names and messages; these examples do not broaden the theorem's
typed-record domain.

An independent read-only peer review found no substantive issue in the
restriction/time rules, schema staging, lazy reads, Unicode normalization or
the intentional allowance for changed revisions and commits.

The real API/SQLite/service workflows are checked with:

```sh
bun test --timeout 30000 ./scripts/vetting-scan-flags.test.ts \
  ./scripts/vetting-scan-service.test.ts ./scripts/vetting-api.test.ts
bun test --timeout 30000 --test-name-pattern 'reuse|cached|original' \
  ./scripts/vetting-scan-flags.test.ts ./scripts/vetting-scan-service.test.ts \
  ./scripts/vetting-api.test.ts
bun run typecheck
```

The surrounding workflow run completed **109 tests and 1,304 assertions with
zero failures**; one existing real disposable-sandbox test was skipped. The
final-source focused workflow pass completed **34 tests and 417 assertions
with zero failures**. Full type checking also passed.
Final results and exact source hashes are recorded in the ignored
`evidence/scan-reuse/receipt.json`. Captured logs and comparison code live
alongside it. The existing workflows use real migrations, signed API
requests, persisted assessments/restrictions, retained evidence and scanner
dispatch. Their GitHub/provider/sandbox inputs are controlled; they do not
establish production provider availability or malware detection completeness.
There is no UI, signing, deployment, merge or push in this isolated change.
