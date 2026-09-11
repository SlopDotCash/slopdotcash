# Historical review correction previews

The preparation source and wallet observations are immutable inputs to a payout review. A later historical recovery must not silently change that preparation, claim to be a newly observed GitHub snapshot, or make old quality decisions apply to different evidence.

`prepare-source-correction.ts` produces a review preview from exact predecessor preparation, original snapshot, original audit, recovered archive, accepted-review history, and quality evidence bytes. An explicit request lists the recovered IDs, input digests, project/month and public reason. Every selected event must match the archive, carry archive continuity provenance from accepted history, be an in-month base-credit review, belong to an existing contributor, and not duplicate an original event or canonical review source. The full original quality projection is reconciled with the source ledger before comparison.

The output retains every original actor and wallet observation. It adds only three score-thirds and 30,000 weight per recovered review, reproduces all integer allocations, and can recalculate existing quality scenarios with the recovered reviews included in unresolved work. Scenario decisions and deductions are retained explicitly; imported amounts and approval assertions are never authoritative. The correction digest binds all six input files, the selected IDs and the reason.

Run from the repository root:

```text
bun scripts/prepare-source-correction.ts PREPARATION SNAPSHOT AUDIT ARCHIVE HISTORY QUALITY REQUEST OUTPUT [QUALITY_PROPOSAL ...]
```

The request has exactly these fields: `schemaVersion` (`1`), `kind` (`historical-review-correction-request`), `projectId`, `cycleId`, `predecessorPreparationSha256`, `archiveSha256`, `historySha256`, `eventIds`, and `reason`. Output creation refuses overwrite. A published cycle is rejected: revising a proposal or settled cycle needs its own approved revision contract.

The preview is deliberately not a `FundingPreparation`, a newly observed snapshot, or an importable ordinary quality proposal. Its `historical-review-correction-preview` and `correction-bound-quality-preview` kinds keep it outside existing activation and payment routes. It records `approval: pending`, `paymentAuthorized: false`, and `activePreparationChanged: false`. Merging this implementation cannot adopt a correction or approve allocations.

## Adoption still requires review

The source correction, authority for adopting it, and a versioned successor preparation contract require independent review before use in a funded proposal. That successor must bind the predecessor and correction digests, preserve source and wallet history, reconcile the independent merge census, invalidate stale quality/funding reviews and reset the applicable review period. New contributors, other score categories, inferred evidence bonuses and revisions of published cycles are outside this preview's scope. Do not copy preview rows into the canonical preparation to bypass those requirements.

For August, the known recovery selects seven accepted reviews for two existing contributors. The expected transition is 7,061 to 7,068 events, 108 unchanged actors and +21 score-thirds. The cap stays 10,000 USDC. These fixture expectations are independently checked in the evidence bundle rather than hardcoded into this generic implementation.
