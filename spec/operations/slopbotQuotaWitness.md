# Slopbot App quota witness

Development reads the production Slopbot GitHub App's installation quota for
one registered repository before a historical value intake is planned
(`.github/workflows/value-intake-quota.yml` and
`scripts/inspect-slopbot-app-quota.ts`, commits bb992afe0 and 3bff4e0a7;
development's model `formal/models/release/slopbot_app_quota_witness.qnt`,
8e7f8af29). PRD section 9 requires background jobs, not page views, to read
GitHub, and CLAUDE.md "Never print secrets" bounds what the receipt may hold.
This machine is one witness run. GitHub owns the temporary token and its
expiry: a lost mint response or a cancelled run can leave a scoped token live
until it expires, and only an observed 204 revocation permits a receipt.
Provider correctness, time units and hosted environment permissions are not
modeled.

## Story: Witness the installation quota with a temporary metadata-only grant

### Only a manual main run in the protected environment, bound to the exact registry revision, may mint

The workflow runs only on manual dispatch from `main`, in the
`slop-production` environment. The run must name an active project whose
public registry revision has the given manifest SHA-256 (also the SHA-256 of
the project JSON), a primary repository with a permanent numeric and node
ID, and the SHA-256 of the reviewed local plan. Any other request ends the
run before a credential is used, with no grant.

```quint
type WitnessPhase = Queued | Minting | Reading | Cleaning | Writing | WitnessDone
type Grant = NoGrant | ScopedGrant | WrongGrant | RevokedGrant | UnknownGrant | ExpiredGrant
type MintOutcome = MintScoped | MintWrongGrant | MintRefused | MintLost
type WitnessRequest = { onMain: bool, manual: bool, exactRevision: bool, protectedEnvironment: bool, boundPlan: bool }
type QuotaWitness = { phase: WitnessPhase, authorized: bool, grant: Grant, metadataOnly: bool, verified: bool,
  revoked204: bool, receipt: bool }
pure val initial: QuotaWitness = { phase: Queued, authorized: false, grant: NoGrant, metadataOnly: false,
  verified: false, revoked204: false, receipt: false }
pure def admissible(r: WitnessRequest): bool =
  r.onMain and r.manual and r.exactRevision and r.protectedEnvironment and r.boundPlan
pure def canBegin(w: QuotaWitness, r: WitnessRequest): bool = w.phase == Queued
pure def begin(w: QuotaWitness, r: WitnessRequest): QuotaWitness =
  { ...w, authorized: admissible(r), phase: if (admissible(r)) Minting else WitnessDone }
pure def alwaysNoGrantWithoutAdmission(w: QuotaWitness): bool = not(w.authorized) implies w.grant == NoGrant
pure def sometimesNonMainRefused(w: QuotaWitness): bool = w.phase == WitnessDone and not(w.authorized)
pure val admitted: WitnessRequest = { onMain: true, manual: true, exactRevision: true, protectedEnvironment: true, boundPlan: true }
pure val rValues = Set(admitted, { ...admitted, onMain: false }, { ...admitted, manual: false },
  { ...admitted, exactRevision: false }, { ...admitted, protectedEnvironment: false }, { ...admitted, boundPlan: false })
```

### The token is minted for the one repository with metadata read only, and any other grant is revoked unused

The App JWT finds the repository's installation, which must belong to the
configured App ID, and mints a token for that repository's ID with
`metadata: read` alone. A grant with any other permission set, or one that
expires within a minute, is revoked without a quota read. A refused mint
leaves no grant; a mint whose response is lost leaves an unknown grant that
only expiry ends.

```quint
pure def canIssue(w: QuotaWitness, outcome: MintOutcome): bool = w.phase == Minting
pure def issue(w: QuotaWitness, outcome: MintOutcome): QuotaWitness =
  if (outcome == MintScoped) { ...w, grant: ScopedGrant, metadataOnly: true, phase: Reading }
  else if (outcome == MintWrongGrant) { ...w, grant: WrongGrant, phase: Cleaning }
  else if (outcome == MintLost) { ...w, grant: UnknownGrant, phase: WitnessDone }
  else { ...w, phase: WitnessDone }
pure def alwaysReadOnlyWithMetadataGrant(w: QuotaWitness): bool =
  (w.verified implies w.authorized and w.metadataOnly) and (w.phase == Reading implies w.grant == ScopedGrant)
pure def sometimesWrongGrantRevoked(w: QuotaWitness): bool = w.revoked204 and not(w.metadataOnly)
```

### A quota reading is valid only when two windows agree on one public repository

With the token, the run reads `/rate_limit`, the first installation
repository page, the repository itself and a GraphQL query. Page one must
hold exactly one repository, matching the permanent ID, node ID and name and
public. The repository read must report the `core` resource. Its limit must
equal the snapshot's, its reset must be within one second of it, it must
have used at least two more requests, and used and remaining must move by
the same amount. Both windows' resets and GraphQL's must lie in the future,
and GraphQL must name the same public node without errors.

```quint
type QuotaReading = { pageCount: int, totalCount: int, matched: bool, coreResource: bool, limitSame: bool,
  resetDelta: int, usedDelta: int, remainingDelta: int, graphqlValid: bool, resetsFuture: bool }
pure def coherent(q: QuotaReading): bool =
  q.pageCount == 1 and q.totalCount == 1 and q.matched and q.coreResource and q.limitSame
    and q.resetDelta >= -1 and q.resetDelta <= 1 and q.usedDelta >= 2 and q.usedDelta == q.remainingDelta
    and q.graphqlValid and q.resetsFuture
pure def canObserve(w: QuotaWitness, q: QuotaReading): bool = w.phase == Reading and w.grant == ScopedGrant
pure def observe(w: QuotaWitness, q: QuotaReading): QuotaWitness = { ...w, verified: coherent(q), phase: Cleaning }
pure def lawUnequalDeltasRefused(q: QuotaReading): bool = q.usedDelta != q.remainingDelta implies not(coherent(q))
pure def lawSecondInstallationRepositoryRefused(q: QuotaReading): bool = q.totalCount != 1 implies not(coherent(q))
pure val goodReading: QuotaReading = { pageCount: 1, totalCount: 1, matched: true, coreResource: true, limitSame: true,
  resetDelta: 0, usedDelta: 2, remainingDelta: 2, graphqlValid: true, resetsFuture: true }
pure val qValues = Set(goodReading, { ...goodReading, totalCount: 2 }, { ...goodReading, remainingDelta: 3 },
  { ...goodReading, resetDelta: 2 }, { ...goodReading, coreResource: false })
```

### Every minted grant is revoked, and only a verified reading with a 204 revocation writes the receipt

Every run that holds a grant deletes it (`DELETE /installation/token`),
whether the reading was valid or not. Only a 204 answer counts as revoked.
The receipt, a seven-day artifact, is written only after a verified reading
and a 204 revocation. It holds identifiers, digests and quota numbers, never
the token, and states that nothing was written to production. A cancelled run
writes nothing, and a grant it held stays unknown until expiry.

```quint
pure def canCleanup(w: QuotaWitness, confirmed: bool): bool = w.phase == Cleaning
pure def cleanup(w: QuotaWitness, confirmed: bool): QuotaWitness =
  { ...w, grant: if (confirmed) RevokedGrant else UnknownGrant, revoked204: confirmed,
    phase: if (confirmed and w.verified) Writing else WitnessDone }
pure def canWriteReceipt(w: QuotaWitness): bool = w.phase == Writing
pure def writeReceipt(w: QuotaWitness): QuotaWitness = { ...w, receipt: true, phase: WitnessDone }
pure def canCancel(w: QuotaWitness): bool = w.phase == Minting or w.phase == Reading or w.phase == Cleaning or w.phase == Writing
pure def cancel(w: QuotaWitness): QuotaWitness =
  { ...w, phase: WitnessDone, grant: if (w.phase == Writing) RevokedGrant else UnknownGrant }
pure def canExpire(w: QuotaWitness): bool = w.phase == WitnessDone and w.grant == UnknownGrant
pure def expire(w: QuotaWitness): QuotaWitness = { ...w, grant: ExpiredGrant }
pure def alwaysReceiptNeedsVerifiedRevokedGrant(w: QuotaWitness): bool =
  (w.receipt implies w.authorized and w.metadataOnly and w.verified and w.revoked204 and w.grant == RevokedGrant)
    and (w.revoked204 implies w.grant == RevokedGrant)
pure def alwaysNoGrantLeftHeld(w: QuotaWitness): bool =
  w.phase == WitnessDone implies not(w.grant == ScopedGrant or w.grant == WrongGrant)
pure def stepReceiptOnlyWritten(before: QuotaWitness, via: str, after: QuotaWitness): bool =
  (after.receipt and not(before.receipt)) implies via == "writeReceipt"
pure def sometimesReceiptWritten(w: QuotaWitness): bool = w.receipt
pure def sometimesInvalidQuotaRevokedWithoutReceipt(w: QuotaWitness): bool =
  w.phase == WitnessDone and w.revoked204 and w.metadataOnly and not(w.verified) and not(w.receipt)
pure def sometimesRefusedRevocationExpires(w: QuotaWitness): bool = w.grant == ExpiredGrant and w.verified
pure def sometimesLostMintExpires(w: QuotaWitness): bool = w.grant == ExpiredGrant and not(w.metadataOnly)
pure def sometimesCancelledLeavesGrantUntilExpiry(w: QuotaWitness): bool =
  w.phase == WitnessDone and w.grant == UnknownGrant and w.metadataOnly and not(w.verified) and not(w.revoked204)
```
