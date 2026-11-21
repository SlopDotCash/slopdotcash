# October 2026 payout proposal import

The owner approved five gross October pools and the ordinary 2% fee, rounded up per recipient. This one-time preparation serves PRD sections 6 and 7. The adjusted October amounts live in the private October proposal base. The normal monthly scheduler still starts in November, and the original registry revisions retain their historical cap overrides.

## Prepare and review

Use the raw owner-approved terms bytes pinned by `scripts/october-reward-review.ts`. The trusted runner supplies a reviewed source packet and the verified SHA-256 of its exact bytes. The packet binds the complete eligible October acceptance window for each selected project, resolved replacement attribution, duplicate credit, reviewed work and penalties, protected financial history, and eligibility. Record the actual producer and reviewer identities. Its Points digest must name the authoritative corrected D1 checkpoint. Evidence digests attest to reviewed records. They do not reconstruct or authenticate those records by themselves. Do not substitute the public rolling leaderboard or legacy payment weights for the reconciled source packet.

Pass a current production registry capture that matches the reviewed revision, exact manifest bytes and digest. Record `enforcementGeneration` in both the reviewed packet and the current registry capture, using the protected runner’s verified `SELECT COALESCE(MAX(rowid),0) FROM project_enforcements` result. Capture current registry and enforcement state together. Each selected project requires a verified current authority, active receipts, and exactly one registered vault on its approved network and asset. Review accounts by immutable GitHub identity. Omitted projects remain omitted and are named in the preview. Preserve the full immutable manifest, including any historical review budget. An existing committed review budget effective in October requires separate reconciliation. The imported October amount lives in `cap_base`; existing finalization uses that amount and checks the manifest’s escrow policy and exact vault binding.

Run from the reviewed checkout, with private inputs and output paths.

```sh
bun --no-env-file scripts/prepare-october-rewards.ts preview \
  OWNER_TERMS REVIEWED_PACKET REVIEWER_SHA256 CURRENT_REGISTRY NEW_PRIVATE_REVIEW
```

The compiler also supports `guarded-sql` to generate a single private SQL file from the same original inputs. Review the preview and the SQL digest in the protected production environment. The compiler opens no network connections and writes new files with mode `0600`. Keep the input packet and output private. No scheduler, public endpoint, workflow artifact transfer, or unattended application is part of this change.

## Apply through the reviewed D1 operation

Use the protected `slop-production` operation from the reviewed `main` release, the same production database and Wrangler D1 file-import mechanism as `monthly-rewards.yml`. A verified input handoff to that protected runner is required. The consistent review window starts from the approved exact source packet and current immutable project revisions. A later registry, enforcement or Points change requires a refreshed review before a new proposal can be written.

Apply the guarded SQL file as one `wrangler d1 execute slop-private --remote --config workers/identity/wrangler.toml --file ...` operation. Use the D1 file import, which rolls back a failed file. Submitting lines individually or through a generic SQL console loses that guarantee. The file triggers a real SQL constraint error on a stale Points batch, a changed registry or enforcement binding, protected financial history, a newly banned selected recipient, a conflicting or partial retained proposal, or an exact-row readback mismatch. It reuses the normal proposal writer between these guards. A fully exact replay admits no new rows, even after owner finalization. Preserve any partial or different stored proposal for operator reconciliation.

Record the reviewed plan digest, completed D1 import bookmark and a separate authenticated readback of every selected base header and recipient row. An uncertain import response requires exact reconciliation before retry. The proposal creates no obligations. Existing owner finalization, full-funding checks, reservation, wallet consent, and finalized-payment reconciliation remain the normal execution path. The automatic scheduler skips October. The SQL does not set or change an automatic monthly setting.

## Verification

Use the monthly release workflow’s pinned Node and Bun versions. Run `bun test --timeout 60000 scripts/prepare-october-rewards.test.ts`. This exercises the emitted SQL against the repository migrations in SQLite and verifies a late guard rollback through the local native D1 binding. `formal/models/rewards/october_proposal_import.qnt` covers parent and child conflicts, protected input, replay and atomic refusal in a bounded state model. Neither check provides a hosted D1 import receipt or qualifies a mainnet financial action.

## ASI November closeout

PRD section 6 authorizes ASI's November earning window through 18 November UTC.
The independently reviewed packet binds ASI, November 2026, the exclusive
19 November cutoff at 00:00 UTC, and a gross 150 USDG cap to the original
collector snapshot bytes. The snapshot must verify the entire approved window.
When the verified source extends beyond the cutoff, calculate only from
accepted-work events and debits before the cutoff. Preserve the original
bytes, timestamps and digest. Dispatch the protected ASI closeout workflow on
current `main` with `mode: inspect` before preparing the packet.
It validates the published source against the cutoff and the exact matching
coverage in the current canonical Points batch. Its output gives the source
and batch digests, verified registry manifest digest, revision and enforcement
generation. It does not require the packet or write to D1. Verify the corrected accepted work and
protected settlement history before recording the producer and independent
reviewer's numeric GitHub IDs and reviewed packet digest. Preserve the packet
and exact ASI manifest privately.

The packet uses `schemaVersion: "1"` and
`kind: "reviewed-asi-november-closeout"`. Record `projectId: "asi"`,
`period: "2026-11"`, `cutoff: "2026-11-19T00:00:00.000Z"` and
`grossBase: "150000000"`. Bind `snapshotSha256`, `pointsBatch`,
`manifestSha256`, the numeric registry `revision` and
`enforcementGeneration`, and the exact UTC `reviewedAt`. Record
`producerGithubId` and `reviewerGithubId` as decimal GitHub IDs.

Use the same exact registry capture shape as the October operation with only
the ASI project. Its manifest must identify the recorded ordinary Robinhood
Chain vault and the approved USDG asset. The ASI compiler accepts the reviewed
packet, its independently confirmed SHA-256, the current registry capture,
the exact collector snapshot, and a new private output file. Run:

```sh
bun --no-env-file scripts/prepare-asi-november-closeout.ts preview \
  REVIEW_PACKET REVIEW_SHA256 CURRENT_REGISTRY SNAPSHOT NEW_PRIVATE_REVIEW
```

The `guarded-sql` mode emits a single candidate import file and does not apply
it. Review the exact output before any separately approved protected main
operation. The import atomically checks the current registry, restrictions,
Points coverage with the exact source digest, and duplicate or protected
history. It stores the approved earning cutoff in the immutable proposal.
The trusted `asi-november-closeout.yml` dispatch uses the shared
`slop-production` lock and environment. Set the private reviewed packet as
`ASI_CLOSEOUT_REVIEWED_PACKET` in that environment and dispatch the current
`main` with the packet SHA-256 and `mode: preview`. The runner downloads the
exact published collector snapshot, checks the current reviewer’s GitHub
owner authority and evaluates the SQL import guards with read-only queries.
It reports only the reviewed digest, deterministic preview digest and recipient
count. Review that preview and dispatch `mode: apply` with both digests. The
same current registry and source checks, atomic database guards and full
header/recipient readback confirm an import or exact replay.

After confirmation, the owner can open **Monthly awards** on ASI’s funding page,
review the fixed November proposal, finalize it and reserve eligible awards
with the existing owner wallet flow. The on-chain automatic commitment window
keeps its ordinary calendar.
