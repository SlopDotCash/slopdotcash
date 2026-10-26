# Trusted objective defect evidence

PRD BOT-05, BOT-06, BOT-12; MVP-05a. The owner approved the three criteria in
[the amendment](../../docs/slopbot-quality-closure-proposal.md).

Production closure stays disabled. This change checks signed evidence and
records shadow proposals. It does not supply a production verification host.
The existing vetting VM emits `incomplete` results; those results cannot satisfy
this contract. Do not sign them as verified.

## Trust boundary

The Worker never runs project code. A separate operator-approved verifier must
acquire exact baseline and candidate source, run the approved checks in the
BOT-05/VET-02 environment, retain private evidence, and sign only safe metadata.
The signer stays outside the guest, model process and contributor workflow.
The collector must establish the facts below independently of guest claims.
A contributor's successful CI check or artifact signature is not this authority.

Configure `SLOPBOT_QUALITY_VERIFIER_KEY` with the standard-base64 raw Ed25519
public key and `SLOPBOT_QUALITY_PROFILE_SHA256` with the independently reviewed
verifier profile digest. The profile binds implementation, hardware VM host,
collector, command/runtime, isolation, artifact handling and retention. A new
key or profile starts new qualification. Never derive approval from current
file hashes alone. Keep signing keys and private outputs outside this Worker.
Neither setting is supplied by a repository or a pull request.

Reuse the installed App's existing comment and contents read permissions. The
verifier publishes a comment whose entire body is the marker below, a newline,
and a JSON envelope with `payload` and `signature` string fields:

```text
<!-- slopbot:quality-evidence:v1 -->
```

`payload` is the exact JSON string. Sign UTF-8 bytes of marker + newline +
payload, with Ed25519. `signature` is standard base64. The defect ID is SHA-256
of the payload bytes. No canonicalization or unsigned sibling fields affect
verification. Comment authors do not grant trust. Invalid or unavailable
receipts are ignored. A receipt comment queues its immutable comment ID and
triggers a new review after signature checks. The review key binds the item
text, verified receipt IDs and current verifier key. Duplicate or forged
comments cannot manufacture new model calls for an already reviewed subject.
Ordinary intake reads at most 100 comments; omitted receipts can only cause
advisory handling, never closure.

The payload has `version: 1`, `status: "verified"`, `isolation: "approved-vm"`,
empty `visibilityGaps`, `profileSha256`, immutable numeric `repositoryId`,
`nodeId`, exact `headSha`, PR `baseSha`, `policyDigest`, and `itemDigest`.
`itemDigest` covers the exact review text including title, body and diff.
`verifiedAt` and `expiresAt` are UTC ISO timestamps with milliseconds. The
validity window cannot exceed 24 hours. An expired receipt cannot close.

It also has `kind`, `rule: {source, quote}`, `evidence`, `repair`, and `proof`.
The rule quote must exist verbatim in the trusted repository guidance. Evidence
must exist verbatim in the item. Both independent model verdicts must cite this
same rule, evidence and defect ID, with no limitations and sufficient confidence.
A valid signature alone does not prove a defect: the Worker checks the following
predicates as well as all subject bindings.

## Three supported checks

- `removed_behavior`: proof contains `path`, `requiredBehavior`, `removedLines`,
  `baselineSha256`, `candidateSha256` (null for a deleted file),
  `scopeChangeApproved: false`, and `behaviorAbsent: true`. The Worker reads
  baseline and candidate bytes at the exact commits. Quality verification
  currently requires the PR baseline to match the trusted default-branch tip. It checks hashes and the
  removal of the specified source. The trusted verifier must also establish
  that equivalent behavior was not moved or replaced elsewhere and that no
  approved scope change permits removal. Text absence alone is insufficient.
- `reproduced_regression`: proof contains `command`, `environmentSha256`,
  `harnessSha256`, `workflowUnchanged: true`, `patchCaused: true`,
  `externalFailure: false`, and `baseline`/`candidate`. Each result contains
  `sourceSha`, `exitCode`, `reportSha256`, `environmentSha256`, and
  `harnessSha256`. The immutable harness and environment must match. Baseline
  must pass; candidate must fail (exit 1–125). Their report hashes must differ.
  The outside collector must verify results, rule out unrelated failures, and
  establish causality. Contributor stdout cannot supply those facts. The
  Worker authenticates the collector's result; it does not rerun the command.
- `contradicted_claim`: proof contains `claim`, `path`, `commit`, `sha256`,
  `pointer` (JSON Pointer), `claimed`, and `observed`. Values are JSON scalars.
  The claim equals the quoted evidence. The item must cite the exact GitHub
  blob permalink for that commit and path in the same repository. The Worker
  reads and hashes the artifact and checks the observed field differs from
  the claimed value. The trusted verifier establishes that the claim actually
  refers to this field and run. Mutable URLs, other artifact formats and
  external repositories remain advisory until separately supported.

Missing evidence, preferred style, diff size or model identity cannot satisfy
any check. The signer must reject incomplete isolation or collector visibility.
Receipts contain safe metadata only: no private source, stdout, prompts,
responses, tokens or credentials. The close/advisory comment links the source,
identifies the revision and defect, gives the repair, and provides the appeal.

## Shadow and activation

Migration `0040_slopbot_quality_shadow.sql` stores confirmed proposals after
live source, policy, registry, installation, exemption and appeal rechecks.
Only independently grounded pairs are recorded. Repeated revisions do not
represent independent cases. Nothing in this table grants closure or penalties.

Qualification uses reviewed real cases and counterexamples under the current
verifier key and profile. The owner replaced the fixed 14-day and 50-item
threshold on 25 October 2026. Inspect proposed closures and record agreement,
counterexamples and the exact verifier evidence in the production activation
record. A different key or profile requires its own reviewed evidence; old
results do not qualify it. Synthetic controls are useful tests but do not prove
real model qualification. Activation remains separate.

Owner decision, 26 October 2026: this verifier is not part of launch acceptance
(PRD section 11). No verifier host exists, so objective-quality closure stays
unavailable.

Keep `SLOPBOT_QUALITY_QUALIFIED_PROFILE_SHA256` unset until that review passes.
Only the protected production release may set it to the qualified profile.
This setting represents the separate maintainer qualification, not verifier
self-approval. The global `SLOPBOT_CLOSURE_ENABLED` must also be true, the
repository must explicitly allow `low_quality: close`, and the effective time
must have passed. The daily cap, reopen breaker, exemptions and appeal checks
still apply. Recheck immediately before the close request after comment/label
writes. GitHub offers no atomic conditional close across all these resources;
a concurrent maintainer change after the last check remains a race and is
covered by the appeal/reopen path, not an exactly-once claim.

Do not enable either production setting as part of this PR. Quality closure
records always have `penaltyEligible: false`; this amendment grants no penalty.

## Acceptance status

`bun run test:slopbot` checks receipt authentication, source/artifact bytes,
all three predicate branches, independent-defect agreement, and counterexamples.
These deterministic tests use test signatures and fabricated collector metadata;
they are trust-boundary regression tests, not VM, provider or hosted acceptance.

Before merge readiness is claimed, run the full GitHub → verifier → two real
provider calls → shadow record → comment flow with an approved isolated service
and staging App/provider credentials. Include useful counterexamples, changed
head/body/policy, expired evidence, provider failure, unavailable verification,
exemptions, appeals and reopen. Retain private evidence and publish only safe
exact-head results. No current local test substitutes for that acceptance.
