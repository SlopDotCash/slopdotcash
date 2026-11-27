# Slopbot App quota witness

Development reads the production Slopbot GitHub App's installation quota for
one registered repository before a historical value intake is planned
(`.github/workflows/value-intake-quota.yml` and
`scripts/inspect-slopbot-app-quota.ts`, commits bb992afe0 and 3bff4e0a7;
development's model `formal/models/release/slopbot_app_quota_witness.qnt`,
8e7f8af29; the optional reviewed commit read, c98069180, merged at 7345ad05e). PRD section 9 requires background jobs, not page views, to read
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
ID, and the SHA-256 of the reviewed local plan. It may also name one reviewed
commit (`slop360` or `slop367`, each a fixed full SHA) to read with the same
token; that is allowed only when the primary repository is the workflow's own
repository by GitHub's runner ID and name. Any other request ends the run
before a credential is used, with no grant.

```quint
type WitnessPhase = Queued | Minting | Reading | Cleaning | Writing | WitnessDone
type Grant = NoGrant | ScopedGrant | WrongGrant | RevokedGrant | UnknownGrant | ExpiredGrant
type Scope = NoScope | MetadataRead | MetadataContentsRead
type MintOutcome = MintMetadata | MintMetadataContents | MintWrongGrant | MintRefused | MintLost
type WitnessRequest = { onMain: bool, manual: bool, exactRevision: bool, protectedEnvironment: bool, boundPlan: bool,
  commitRequested: bool, workflowRepository: bool }
type QuotaWitness = { phase: WitnessPhase, authorized: bool, commitRequested: bool, grant: Grant, scope: Scope,
  commitVerified: bool, verified: bool, revoked204: bool, receipt: bool }
pure val initial: QuotaWitness = { phase: Queued, authorized: false, commitRequested: false, grant: NoGrant,
  scope: NoScope, commitVerified: false, verified: false, revoked204: false, receipt: false }
pure def admissible(r: WitnessRequest): bool =
  r.onMain and r.manual and r.exactRevision and r.protectedEnvironment and r.boundPlan
    and (not(r.commitRequested) or r.workflowRepository)
pure def requiredScope(w: QuotaWitness): Scope = if (w.commitRequested) MetadataContentsRead else MetadataRead
pure def canBegin(w: QuotaWitness, r: WitnessRequest): bool = w.phase == Queued
pure def begin(w: QuotaWitness, r: WitnessRequest): QuotaWitness =
  { ...w, authorized: admissible(r), commitRequested: r.commitRequested,
    phase: if (admissible(r)) Minting else WitnessDone }
pure def alwaysNoGrantWithoutAdmission(w: QuotaWitness): bool = not(w.authorized) implies w.grant == NoGrant
pure def sometimesNonMainRefused(w: QuotaWitness): bool = w.phase == WitnessDone and not(w.authorized)
pure def sometimesForeignCommitRefused(w: QuotaWitness): bool =
  w.phase == WitnessDone and not(w.authorized) and w.commitRequested
pure val admitted: WitnessRequest = { onMain: true, manual: true, exactRevision: true, protectedEnvironment: true,
  boundPlan: true, commitRequested: false, workflowRepository: false }
pure val rValues = Set(admitted, { ...admitted, onMain: false }, { ...admitted, manual: false },
  { ...admitted, exactRevision: false }, { ...admitted, protectedEnvironment: false }, { ...admitted, boundPlan: false },
  { ...admitted, commitRequested: true, workflowRepository: true }, { ...admitted, commitRequested: true })
```

### The token is minted for the one repository with exactly the mode's read grant, and any other grant is revoked unused

The App JWT finds the repository's installation, which must belong to the
configured App ID, and mints a token for that repository's ID with
`metadata: read` alone, or with `metadata: read` and `contents: read` when a
reviewed commit is named. A grant whose permission set differs from the
mode's, or one that expires within a minute, is revoked without a quota read. A refused mint
leaves no grant; a mint whose response is lost leaves an unknown grant that
only expiry ends.

```quint
pure def canIssue(w: QuotaWitness, answer: MintOutcome): bool = w.phase == Minting
pure def mintedScope(answer: MintOutcome): Scope =
  if (answer == MintMetadata) MetadataRead else if (answer == MintMetadataContents) MetadataContentsRead else NoScope
pure def issue(w: QuotaWitness, answer: MintOutcome): QuotaWitness =
  if (mintedScope(answer) == requiredScope(w)) { ...w, grant: ScopedGrant, scope: requiredScope(w), phase: Reading }
  else if (mintedScope(answer) != NoScope or answer == MintWrongGrant) { ...w, grant: WrongGrant, phase: Cleaning }
  else if (answer == MintLost) { ...w, grant: UnknownGrant, phase: WitnessDone }
  else { ...w, phase: WitnessDone }
pure def alwaysReadOnlyWithTheModeGrant(w: QuotaWitness): bool =
  (w.verified implies w.authorized and w.scope == requiredScope(w))
    and (w.phase == Reading implies w.grant == ScopedGrant)
    and (w.scope == MetadataContentsRead implies w.commitRequested)
pure def sometimesWrongGrantRevoked(w: QuotaWitness): bool = w.revoked204 and w.scope == NoScope
```

### A quota reading is valid only when its windows agree on one public repository and the named commit

With the token, the run reads `/rate_limit`, the first installation
repository page, the named commit if any, the repository itself and a
GraphQL query. Page one must
hold exactly one repository, matching the permanent ID, node ID and name and
public. The repository read must report the `core` resource. Its limit must
equal the snapshot's, its reset must be within one second of it, it must
have used at least two more requests (three with a commit read), and used
and remaining must move by the same amount. A commit read must answer 200
with the exact SHA and at most 100 files on one page, in a `core` window
with the same limit, a reset within one second of both others, at least two
more requests than the snapshot and fewer than the repository read. Every
window's reset and GraphQL's must lie in the future, and GraphQL must name
the same public node without errors.

```quint
type QuotaReading = { pageCount: int, totalCount: int, matched: bool, coreResource: bool, limitSame: bool,
  resetDelta: int, usedDelta: int, remainingDelta: int, graphqlValid: bool, resetsFuture: bool }
pure def coherent(q: QuotaReading, commit: bool): bool =
  q.pageCount == 1 and q.totalCount == 1 and q.matched and q.coreResource and q.limitSame
    and q.resetDelta >= -1 and q.resetDelta <= 1 and q.usedDelta >= (if (commit) 3 else 2)
    and q.usedDelta == q.remainingDelta and q.graphqlValid and q.resetsFuture
pure def canObserve(w: QuotaWitness, q: QuotaReading, exactCommit: bool): bool =
  w.phase == Reading and w.grant == ScopedGrant
pure def observe(w: QuotaWitness, q: QuotaReading, exactCommit: bool): QuotaWitness =
  { ...w, commitVerified: w.commitRequested and exactCommit,
    verified: coherent(q, w.commitRequested) and (not(w.commitRequested) or exactCommit), phase: Cleaning }
pure def lawUnequalDeltasRefused(q: QuotaReading, commit: bool): bool =
  q.usedDelta != q.remainingDelta implies not(coherent(q, commit))
pure def lawSecondInstallationRepositoryRefused(q: QuotaReading, commit: bool): bool =
  q.totalCount != 1 implies not(coherent(q, commit))
pure def lawCommitReadCountsOneMoreRequest(q: QuotaReading): bool = coherent(q, true) implies coherent(q, false)
pure def alwaysCommitVerifiedOnlyWhenRequested(w: QuotaWitness): bool =
  (w.commitVerified implies w.commitRequested) and ((w.verified and w.commitRequested) implies w.commitVerified)
pure val goodReading: QuotaReading = { pageCount: 1, totalCount: 1, matched: true, coreResource: true, limitSame: true,
  resetDelta: 0, usedDelta: 2, remainingDelta: 2, graphqlValid: true, resetsFuture: true }
pure val goodCommitReading: QuotaReading = { ...goodReading, usedDelta: 3, remainingDelta: 3 }
pure val qValues = Set(goodReading, goodCommitReading, { ...goodReading, totalCount: 2 },
  { ...goodReading, remainingDelta: 3 }, { ...goodReading, resetDelta: 2 }, { ...goodReading, coreResource: false })
```

### Every minted grant is revoked, and only a verified reading with a 204 revocation writes the receipt

Every run that holds a grant deletes it (`DELETE /installation/token`),
whether the reading was valid or not. Only a 204 answer counts as revoked.
The receipt, a seven-day artifact, is written only after a verified reading
and a 204 revocation. It holds identifiers, digests and quota numbers, never
the token, states whether the token was metadata-only, records the commit
read (repository, SHA, installation, HTTP 200 and remaining quota) only in
commit mode, and states that nothing was written to production. A cancelled run
writes nothing, and a grant it held stays unknown until expiry. Each phase
fixes what the run may hold, so the steps occur only in this order.

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
  (w.receipt implies w.authorized and w.scope == requiredScope(w) and w.verified and w.revoked204
    and w.grant == RevokedGrant)
    and (w.revoked204 implies w.grant == RevokedGrant)
pure def alwaysNoGrantLeftHeld(w: QuotaWitness): bool =
  w.phase == WitnessDone implies not(w.grant == ScopedGrant or w.grant == WrongGrant)
pure def alwaysPhaseFixesWhatTheRunHolds(w: QuotaWitness): bool =
  val untouched = w.grant == NoGrant and w.scope == NoScope and not(w.verified) and not(w.commitVerified)
    and not(w.revoked204) and not(w.receipt)
  (w.phase == Queued implies untouched and not(w.authorized) and not(w.commitRequested))
    and (w.phase == Minting implies untouched and w.authorized)
    and (w.phase == Reading implies w.authorized and w.grant == ScopedGrant and w.scope == requiredScope(w)
      and not(w.verified) and not(w.commitVerified) and not(w.revoked204) and not(w.receipt))
    and (w.phase == Cleaning implies w.authorized and not(w.revoked204) and not(w.receipt)
      and (w.grant == ScopedGrant or w.grant == WrongGrant)
      and (w.grant == ScopedGrant implies w.scope == requiredScope(w))
      and (w.grant == WrongGrant implies w.scope == NoScope and not(w.verified) and not(w.commitVerified)))
    and (w.phase == Writing implies w.authorized and w.verified and w.revoked204 and w.grant == RevokedGrant
      and w.scope == requiredScope(w) and not(w.receipt))
    and (w.scope != NoScope implies w.scope == requiredScope(w))
    and ((w.grant == UnknownGrant or w.grant == ExpiredGrant) implies not(w.revoked204) and not(w.receipt))
pure def stepReceiptOnlyWritten(before: QuotaWitness, via: str, after: QuotaWitness): bool =
  (after.receipt and not(before.receipt)) implies via == "writeReceipt"
pure def sometimesReceiptWritten(w: QuotaWitness): bool = w.receipt
pure def sometimesCommitReceiptWritten(w: QuotaWitness): bool = w.receipt and w.commitVerified
pure def sometimesMissingCommitRevokedWithoutReceipt(w: QuotaWitness): bool =
  w.phase == WitnessDone and w.revoked204 and w.commitRequested and w.scope == MetadataContentsRead
    and not(w.commitVerified) and not(w.receipt)
pure def sometimesInvalidQuotaRevokedWithoutReceipt(w: QuotaWitness): bool =
  w.phase == WitnessDone and w.revoked204 and w.scope == MetadataRead and not(w.verified) and not(w.receipt)
pure def sometimesRefusedRevocationExpires(w: QuotaWitness): bool = w.grant == ExpiredGrant and w.verified
pure def sometimesLostMintExpires(w: QuotaWitness): bool = w.grant == ExpiredGrant and w.scope == NoScope
pure def sometimesCancelledLeavesGrantUntilExpiry(w: QuotaWitness): bool =
  w.phase == WitnessDone and w.grant == UnknownGrant and w.scope != NoScope and not(w.verified) and not(w.revoked204)
pure val eval_witness_sometimesNonMainRefused = ("begin", { ...admitted, onMain: false })
pure val eval_witness_sometimesForeignCommitRefused = ("begin", { ...admitted, commitRequested: true })
pure val eval_witness_sometimesWrongGrantRevoked = (
  ("begin", admitted),
  ("issue", MintWrongGrant),
  ("cleanup", true))
pure val eval_witness_sometimesReceiptWritten = (
  ("begin", admitted),
  ("issue", MintMetadata),
  ("observe", goodReading, false),
  ("cleanup", true),
  "writeReceipt")
pure val eval_witness_sometimesCommitReceiptWritten = (
  ("begin", { ...admitted, commitRequested: true, workflowRepository: true }),
  ("issue", MintMetadataContents),
  ("observe", goodCommitReading, true),
  ("cleanup", true),
  "writeReceipt")
pure val eval_witness_sometimesMissingCommitRevokedWithoutReceipt = (
  ("begin", { ...admitted, commitRequested: true, workflowRepository: true }),
  ("issue", MintMetadataContents),
  ("observe", goodCommitReading, false),
  ("cleanup", true))
pure val eval_witness_sometimesInvalidQuotaRevokedWithoutReceipt = (
  ("begin", admitted),
  ("issue", MintMetadata),
  ("observe", { ...goodReading, totalCount: 2 }, false),
  ("cleanup", true))
pure val eval_witness_sometimesRefusedRevocationExpires = (
  ("begin", admitted),
  ("issue", MintMetadata),
  ("observe", goodReading, false),
  ("cleanup", false),
  "expire")
pure val eval_witness_sometimesLostMintExpires = (
  ("begin", admitted),
  ("issue", MintLost),
  "expire")
pure val eval_witness_sometimesCancelledLeavesGrantUntilExpiry = (
  ("begin", admitted),
  ("issue", MintMetadata),
  "cancel")
```
