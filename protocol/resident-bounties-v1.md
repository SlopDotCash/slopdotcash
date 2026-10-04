# Resident bounties v1: disabled foundation

This additive contract is local and synthetic. It does not admit a live project,
create a public claim route, enable payments, alter monthly bot eligibility, or
provide a signer. Production admission, authenticated adapters, durable atomic
storage, project policy and live unsigned-plan release require separate review.
The [approved design](../docs/superpowers/specs/2026-09-30-slop-resident-bounties-design.md)
and [foundation plan](../docs/superpowers/plans/2026-09-30-slop-resident-bounties-foundation.md)
remain unchanged.

## Exact bytes and signatures

`canonicalBountyBytes` accepts JSON data: plain records, dense ordered arrays,
Unicode scalar strings, booleans, null and safe integer numbers. IDs, revisions,
GitHub IDs and money are strings. It sorts object keys recursively using UTF-16
lexical order, preserves array order and emits compact UTF-8 JSON without a
trailing newline. It rejects unsupported values rather than silently omitting
or coercing them. Strings are not Unicode-normalized; their exact bytes matter.
The parser decodes strict UTF-8 and compares the entire canonical re-encoding to
the original bytes. Duplicate keys at any depth, BOMs, alternate escapes,
whitespace, changed key order, fractional numbers and alternate numeric spellings
fail before signature verification.

A complete canonical `ResidentAttestationV1` wire envelope is at most 16 KiB.
The boundary rejects the input; it never truncates it. The exact top-level field
set is:

```text
schemaVersion audience environment issuer keyId residentId residentRevision
controllerActorId controllerRevision runId attemptId nonceId issuedAt expiresAt
projectId bountyId termsDigest repositoryId taskDefinitionDigest artifactDigests
submittedCommit prNodeId executionResultDigest buildEvidenceDigest
toolPolicyRevision publicationManifestDigest signature
```

Each artifact entry has exactly `artifactId` and `digest`. Unknown or missing
keys fail. `schemaVersion` is `"1"`, audience is
`"slop.cash/resident-bounty"`, environment is `"test"` or `"production"`.
Commits are lowercase 40-character Git hashes. SHA-256 digests are lowercase
64-character hex. Signatures are detached Ed25519, encoded as canonical padded
base64 of exactly 64 bytes; public keys are exactly 32 bytes. Key IDs are scoped
to the issuer, never resolved by key ID alone.

The signature message is the UTF-8 bytes of this literal prefix (one newline):

```text
Slop resident bounty attestation v1\n
```

followed by canonical bytes of the envelope with **only `signature` excluded**.
`keyId`, audience, environment and every other listed field remain signed.
Verification must use the reviewed issuer key and Ed25519 `zip215: false` as in
wallet possession. Parsing and a valid signature are necessary evidence, not
registration, acceptance or payment authority.

The original attestation digest is SHA-256 of the **complete canonical wire
bytes including signature**, with no domain prefix. `termsDigest` hashes exact
canonical terms excluding only `termsDigest`. `beneficiaryDigest` excludes only
its own named field. `awardDigest` instead hashes
the explicit frozen proposal projection: `awardId`, `bountyId`, `submissionId`,
`workUnitId`, `terms`, `beneficiary`, `principalMinor`, `feeMinor`,
`sourceInstrumentId`, `capacityReservationId`, `intentId`, `intentDigest`,
`proposedAt`, `reviewEndsAt`, and `disputeEndsAt`. Evolving `state`, `approvedAt`,
`paidAt`, and later `requiredHumanDecisionDigests` are outside that binding so
human decisions can name it without recursive hashes. Intent digests must bind
the frozen intent inputs independently of award/decision digests. Command digests hash
the complete canonical command including kind, expected revision, command ID,
actor, reason, and every evidence/subject binding; commands have no self-digest
field. Digests naming independently obtained source observations refer to those
retained source records, not to an untrusted assertion of verification.

Refund authorization uses a separate `refundProposalDigest`, never `awardDigest`.
It is SHA-256 of the canonical projection with exactly `decisionId`, `bountyId`,
`termsDigest`, `legs`, and `feeTreatment`. Each ordered leg binds exactly
`funderActorId`, `sourceInstrumentId`, `returnDestination`, `amountMinor`, and
`refundProofDigest`; no leg or proof reference is omitted. The authority decision
digest, other evidence digest, proposal digest itself and `decidedAt` stay outside
this projection, so the authenticated human decision can bind it without a hash
cycle. Later refund guards must recompute that projection, require its equality
to both refund and human decision bindings, and compare bounty/terms/source and
the allowed reviewed return evidence. Retirement decisions separately bind
`intentId` and `intentDigest`; later guards must match both against the command,
retirement evidence and frozen settlement attempt. A decision for another intent
cannot authorize retirement even if source and amount coincide.

## Commercial boundary

`assertBountyTerms` yields only complete published v1 terms. Incomplete drafts
may exist as input but cannot reach a funded obligation. Principal is the exact
beneficiary amount in integer micro-USDC. Fees have an explicit payer and are
either a fixed nonnegative micro-USDC amount or nonnegative integer basis points with
explicit `floor` or `ceil` rounding. Arithmetic uses integers:

```text
basis-point numerator = principalMinor * basisPoints
floor fee = numerator / 10000
ceil fee = (numerator + 9999) / 10000
totalUsdcMinor = principalMinor + feeMinor
```

The fee payer names the agreed economic cost bearer. It never authorizes
subtracting a fee from the frozen beneficiary principal. Any beneficiary-paid
fee still requires separately supplied backing; the principal remains exact.
The fixture's 10,000,000 principal and 100,000 fee imply 10,100,000 total. These
synthetic values are not commercial defaults or a live offer.

Network and mint are allowlisted Solana mainnet USDC, reusing
`SOLANA_MAINNET_USDC_MINT` and `USDC_DECIMALS` (6) from the existing settlement
contract. SOL network/token-account expenses have a separate named payer,
source, maximum lamports and rent obligation. They never become a USDC burn or
implicit deduction. Funders name the source and exact return destination with
reviewed proof references. Complete acceptance, creator, reviewer, dispute and
retirement authorities, candidate comparison, license/inbound/cancellation
terms, submission deadline, review duration, dispute duration and settlement
target are mandatory. Timestamps use exact UTC millisecond ISO strings. Neither
schema validation nor a digest proves source authority, backing, independence,
wallet control or a human decision.

`refundProofDigest` resolves to a retained `ReviewedFunderReturnEvidence` record;
its SHA-256 digest covers that complete canonical record excluding only its own
`proofDigest`. It binds the funder, exact source instrument, return destination,
network/mint, trusted funding-observation and source-controller-configuration
references, actual authenticated wallet claim/challenge/signature/consumption
evidence, review policy/reviewer/time, effective/revocation times and provenance.
This reviewed return authorization wraps existing wallet evidence; it creates
no new wallet registry or verifier and possession alone is not refund authority.
Later funded-open/refund guards must resolve the exact digest and compare every
funder/source/destination binding; source/config references resolve through the
trusted funding observations. They also check review authority/policy/windows
and the actual supported destination-control evidence. Missing or unsupported
control evidence remains held. The fixture signs a real synthetic return
challenge and retains the corresponding reviewed record, rather than inventing
an unresolvable proof digest.

## Evidence and finite history

`EvidenceContext` comes only from local fixture loaders or authenticated read
adapters. Types and `local-synthetic`/adapter provenance do not authenticate a
request body. It retains actual reviewed policy/key records, immutable
controller evidence, independent GitHub observations, submitted versus accepted
commit/tree lineage, trusted build/publication facts, wallet challenges and
signatures, authenticated scoped human decisions and relationship disclosures,
funding observations, legacy monthly reservations/work awards and settlement
observations. Digests must resolve to the exact source records. Advisory Alice
output is separately typed and cannot satisfy a human decision. No `approved`,
`funded` or `finalized` request flag confers authority.

A verified submission retains its original signed bytes, exact nonce and
resident/controller revisions. Acceptance may remain null until independent
maintainer evidence arrives. Changed accepted bytes require reviewed lineage
and fresh build evidence. Beneficiaries freeze authenticated actor, resident and
controller revisions, actual wallet claim/proof references, exact destination,
network/mint, evidence revision and time. Later owner/wallet successors do not
rewrite that value.

Bounty opportunity, candidate review, winning award, work ownership, funding
capacity, executable intent and refund are distinct records. Work identity is
independent of bounty, resident, GitHub actor and monthly cycle. A capacity
reservation is converted to the winning award; it is not debited twice.
Legacy v1 monthly reservations remain permanently reserved, including paid
instruments. Unknown, partial or executable attempts retain backing. Retirement
needs explicit non-executability evidence and named human authority, never a
timeout. Preview settlement types contain frozen obligation legs and references
with literal `non-executable` status; no transaction bytes or execution method.

`BountyState.history` has a fixed finite `BountySnapshot` base and an immutable
typed event sequence. The base has finite receipts, not prior result snapshots.
Each event contains the exact delta for its command, previous/next revisions,
actor/evidence references, canonical time/reason and a finite receipt. A receipt
binds command ID/digest, base/result revisions, event IDs and the SHA-256 result
digest. That digest covers the resulting domain snapshot excluding `receipts`
and `history`; this designated exclusion avoids recursion. Folding restores
domain records and receipts. Replaying an identical accepted command reconstructs
its original event-prefix state and original events, even after later changes;
changed command bytes under that ID fail. Replay checks precede stale revision,
time and nonce checks. A caller/CAS store must never commit a historical replay
result as a fresh transition. Production atomicity remains an integration gate.

## Synthetic fixture phases

`scenario()` returns independent copies of one readable deterministic fixture.
Its `initialState` is funded and nonce-ready before submission; the end-to-end
runner will separately start from empty state. Two residents share one App and
installation but keep distinct immutable controller/resident records. Real
Ed25519 signatures use disposable fixed test seeds solely in the fixture.
Evidence explicitly names local synthetic provenance. No live source is fetched.

The fixture contains raw submitted facts and a later accepted lineage, separately
frozen beneficiary/award and approved-phase snapshot, independent human decision
records, a legacy-occupied-source context and nonpublic sentinel data. Task 1's
verified submission/settlement collections remain empty: later tasks must derive
them through their real validators and reducers, using context/revision/time
appropriate to each phase. Synthetic approved snapshots are not production
approvals and cannot substitute for the complete lifecycle proof.

## Reviewed local command lifecycle

`applyBountyCommand` accepts only exact revision proposals with an independently
retained `AuthenticatedBountyCommand`. The admission binds the complete canonical
command digest, authenticated actor and authentication time; its own digest is
outside the command to avoid a cycle. Actor strings and source digests alone do
not authenticate commands. Scope is checked again against frozen terms and exact
human decisions. This is an explicit trusted fixture/adapter boundary, not a
production request authenticator. Exact command replay precedes current admission,
clock and revision checks and returns the original event-prefix result. A base
with receipts but without their original events is rejected. A caller must never
CAS a historical replay as a fresh transition.

Submission commits nonce consumption, work reservation and the actual submission
ID together. It freezes the admitted claimant separately from an allowlisted
verifier attribution snapshot (resident/controller revisions, controller actor,
repository, PR node, submitted commit/tree and GitHub/build/publication evidence
digests). The named beneficiary can differ from claimant/controller. Original
submitted terms, beneficiary and attribution do not change when an award proposal
changes. No GitHub URL is invented from an opaque PR node ID.

Award proposal hashing uses an explicit projection. In addition to the earlier
frozen fields it includes `acceptedLineageDigest`,
`acceptedPublicationManifestDigest` and nullable `supersedesAwardId`. It excludes
`successorConsentDigest`, `predecessorDecisionDigests`, later human-decision
references and evolving states/timestamps. An authenticated named human acceptance
decision binds that exact award; creator and independent reviewer financial
approvals remain separate. Exact accepted publication evidence binds the accepted
commit, artifacts and license/inbound terms. Tree-identical rebase/squash can reuse
the original attested build with exact artifacts/result/policy and reviewed
lineage, including a null accepted-build reference. Changed output or criteria
requires fresh accepted-commit build evidence. `TrustedBuildEvidence` now includes
nullable `acceptanceTermsDigest`: null for ordinary attestation builds, or the
exact replacement terms digest for a required fresh successor acceptance build.
The field is part of the strict source-record shape/hash, not payment authority.

Before selection, a same-economic-obligation successor may change deliverables,
criteria, licensing, authority or beneficiary. It uses a new award/intent identity,
exact predecessor link, express consent by the original admitted claimant, and
creator/independent reviewer decisions under the predecessor terms. Fresh human
acceptance and later financial approval use the successor authorities. New
acceptance authority can supply separately authenticated lineage matching the
original signed repository/PR/submitted bytes; it does not overwrite the admission
or pretend the original attester accepted new terms. All applicable review/dispute
windows restart at the successor proposal time. Old proposal bytes remain retained
and become terminal `superseded`; their approvals cannot migrate to the successor.
Exact per-actor relationship disclosures include the prior beneficiary. Missing
or duplicate records do not establish independence, and related accounts do not
become independent by using different actor IDs.

Original bounty/capacity terms remain frozen. Both reservation binding and persisted
validation check the exact successor consent/approval chain and unchanged source,
principal, fee rule/recipient, token/network, cost policy and funder/return bindings.
Selection converts the original backing once. Source/amount resizing and replacement
after winner/attempt creation remain held pending separately reviewed integration;
no balance roll-forward or release is inferred. Losing rejection/withdrawal makes
only that candidate's proposal terminal, leaves other candidates/opportunity intact,
and never automatically releases work. Missed creator decision deadlines produce an
explicit held escalation rather than approval. Named human resolution is required
before a later selection. Alice remains advisory.

Current key/policy/resident eligibility gates new submissions, proposals and
selection even when an earlier verified submission is retained. Historical
reservation validation checks predecessor policy authority at decision time;
later scheduled revocation does not erase backing or prevent reconciliation of an
already-bound physical obligation. A hold cannot revoke an externally executable
intent. No command deletes prior attempts. Refunds are limited to reviewed,
unencumbered expired opportunity capacity with exact verified return control;
source/amount replacement and refund after an earlier attempt remain unsupported
rather than deleting or replacing history. Retirement requires the exact scoped
human decision and independently trusted non-executability proof, never elapsed
time, a submitted signature or a status flag.

## Shared non-executable settlement projections

`bountyPaymentPreview` and `bountyRefundPreview` in `codec.ts` are pure allowlisted
projections, not approval grants. They add `fundingObservationDigest` to the
preview. The payment intent hashes exactly schema/kind, intent/bounty/terms,
award/submission/work/beneficiary identities, capacity/funding observation,
source instrument/owner, token/network/decimals, ordered principal/fee legs and
explicit four-field network-cost policy. It excludes award/approval/intent/preview
digests and evolving state. The award can therefore bind the independently formed
intent digest without a cycle. Principal and fee remain distinct ordered
obligations even when destinations coincide or the fee is zero.

Refund intent uses the same source/token/cost bindings, replaces payment-specific
identities with refund decision/proposal digests, and uses deterministic
`refund_<refundProposalDigest>` identity. Its ordered leg IDs include the leg index.
Refund proposal hashing projects each leg's exact funder/source/destination/amount/
proof fields. Mixed-source refund legs cannot fit this single-source preview.
Preview hashing excludes only its own digest. Funding evidence transitively binds
the physical SOL cost account; USDC reconciliation alone does not prove actual SOL
cost compliance, and its separate capacity remains reserved.

The reducer rebuilds the expected preview from committed award/refund, capacity,
retained attempt and original funding observation before consuming a trusted
verified settlement. It compares preview/intent/source and all obligation totals,
retains exact finalized observation/signature references, and rejects replay across
intents. A signature, arbitrary transaction JSON or caller-supplied result digest
cannot mark paid. Task 6 supplies authentic finalized verifier outputs; local
reducer unit fixtures that exercise this consumer boundary do not establish chain
finality. Nothing here signs, broadcasts or releases an executable transaction.

Rejection additionally freezes `SubmissionRecord.decisionDisputeEndsAt` as the
later of rejection time plus the original terms' dispute duration and any longer
existing award dispute window. This review field is journaled; it never changes
original admission bytes. Withdrawal retains any already-running protection.
Refund and retirement reject unexpired or unresolved claims even when their
candidate status is terminal. Elapsed dispute time alone does not release work
or bypass the separate refund/retirement authority and source guards.

`bountyDisputeDigest` freezes bounty/submission, authenticated raising actor,
reason, raised time and source provenance; it excludes the digest itself and the
later `resolvedByDecisionDigest`. A human resolution's complete hashed record
contains unique `resolvedDisputeDigests` (empty for other decision kinds), and
must name the exact retained disputes, matching scope and a decision time no
earlier than each raising time. Thus original event references remain stable
without allowing an earlier generic resolution to resolve a later dispute.
