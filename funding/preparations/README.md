# Funding preparations

These compact reviewed inputs are preparation artifacts, never canonical cycle
proposals, funding records, approval, wallet-control evidence, or payment authority.
Missing registrations retain their contributor and simulated allocation.
`lookupUnavailable` distinguishes an unavailable lookup from a confirmed missing
registration; imports accept status `lookup-unavailable` with a null wallet.
All August observations have `lookupUnavailable: false`. External
prize shares never become platform payment amounts.

Import an explicitly supplied complete cycle snapshot, independent audit, and
public wallet observations (no implicit rolling snapshot fallback):

```sh
bun scripts/prepare-funding-review.ts --import YYYY-MM /path/snapshot.json /path/audit.json /path/wallet-observations.json
```

Import verifies snapshot structure and completed evidence verification, canonical
project period coverage, audit source equality, every contributor's exact score
and weight, sorted event IDs, merge and contributor census, and explicit wallet
observations. It refuses existing input filenames. The tracked files retain SHA-256
of exact snapshot, audit and wallet-observation bytes, plus per-actor SHA-256 of
`JSON.stringify(sortedEventIds)` and reconciled counts. Original evidence must be
retained separately for independent re-import; a digest binds evidence but does
not make that evidence publicly retrievable or prove the review is approved.

Only allowlisted public identity, score and wallet-proof fields enter these files.
No raw snapshot, issue bodies, prompts, traces, or local source paths are copied.
Git review is the authority for changes to compact inputs; offline sync validates
their shape and internal reconciliation, not the absent original evidence bytes.

```sh
bun scripts/prepare-funding-review.ts
bun scripts/prepare-funding-review.ts --check
```

Default site preparation runs sync from tracked inputs and rederives each period's
cap from the canonical project funding-basis helper. No cap or simulated amount is
stored in inputs. Integer largest remainder uses the project-view actor tie break;
amounts are USDC micro-units and external shares are parts per million. The generated
`public/data/funding-reviews.json` is ignored and validated again by its browser
parser. `generatedAt` is the latest input observation timestamp so builds are
reproducible. Preparation status always sets paymentAuthorized/proposalPublished
false, including when current verified funding is zero. It never writes cycles.

August 2026: 138 project rows, 113 distinct actors, 57 registered destinations and
56 missing registrations. Eliza 108; ASI 26; Heir Elements SDK 3; Delta Star 1.
All counts were reconciled at import, rather than copied from a UI slice.

## Preparing any registered project

Run the trusted `prepare-funding-review.yml` workflow on `develop`. `cycle` selects
a closed UTC month (blank defaults to the previous month); optional `project`
selects one canonical manifest ID. Without a project it prepares every launched
project, including paused projects whose accepted work still needs review. If any
selected preparation already exists, normal ingestion refuses before wallet lookups
or writes. Only the explicit wallet-refresh mode below may update registrations.

The workflow generates the exact cutoff snapshot and runs
`scripts/prepare-monthly-funding.ts`. The command requires explicit `--cycle`,
`--snapshot`, `--evidence-directory`, `--evidence-url`, and `--evidence-artifact`
arguments; `--project` is optional. Wallets are fetched fresh by immutable actor
identity. Successful missing registrations retain their allocations; failed
lookups abort publication rather than presenting missing-wallet success.

These new preparations have `sourceAuditSha256: null`,
`provenance.derivation: "snapshot-derived"`, and `mergedCensus: null`. Their counts
and actor event digests derive from the same snapshot, not an independent census.
Canonical period caps are still resolved during sync, and status remains
`preparation` regardless of funding availability.

The named Actions artifact contains exact `source-snapshot.json`,
`wallet-observations.json`, `preparations.json`, and `SHA256SUMS`. The tracked inputs
bind its run URL, artifact name, and exact source and wallet digests. The PR links
the artifact directly. Downloads may require GitHub sign-in and expire after 90
days; reviewers must retain the source for long-term reproducibility. No raw
private API responses or credentials are retained. The workflow creates only a
scoped preparation PR; it never freezes a cycle, signs, or sends money.


## Refreshing existing preparation wallets

Choose workflow `mode: refresh-wallets` with an explicit `project` and `cycle`, or:

```sh
bun scripts/prepare-monthly-funding.ts --refresh-wallets --project PROJECT --cycle YYYY-MM --evidence-directory /path/new-refresh-evidence
```

Refresh reads only that preparation's existing actor IDs and logins, then performs
fresh registrations lookups. It preserves the original actor order, census counts,
score thirds, weights, event digests, source snapshot hash, audit hash and source
provenance. Only `observedAt`, each row's `wallet`/`lookupUnavailable`, and
`provenance.walletObservationsSha256` change. An unavailable lookup produces a null
wallet with `lookupUnavailable: true`; it never silently becomes missing success.

The workflow skips snapshot generation and opens a draft PR. Its staging guard
allows exactly one modified preparation file and checks immutable fields against
HEAD before pushing. Before/after preparation bytes and fresh wallet observations
are retained in the evidence artifact; GitHub PR history retains the prior version.
No new snapshot may be passed in refresh mode. Normal source ingestion still
refuses existing preparations. Canonical cycle files are never changed, and a
published proposal's locked destination continues to override preparation data.
