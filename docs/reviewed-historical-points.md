# Reviewed historical project Points

PRD section 7 permits September–October corrections after the selected project's complete source, assessment, duplicate-credit and funded-history checks. Unassessed and held sources keep their earlier Points. Projects can complete independently.

The manual `reviewed-historical-points.yml` workflow publishes one owner-reviewed project packet. Keep the gzip/base64 packet private in `HISTORICAL_POINTS_PACKET_1` through `_4`, split in order at 48,000 characters. Supply the SHA-256 of the decompressed exact UTF-8 JSON as the workflow input. The initial run uses `apply=false`. The trusted main workflow checks the current project revision, current owner permission, complete immutable GitHub census, published assessment record digests, and private financial protection.

The same trusted workflow supports a read-only `audit-assessments` operation.
Supply the registered project ID, the current canonical Points SHA-256, and
the SHA-256 of the independently verified source audit. The canonical audit
uses compact JSON with source rows in pull request number order. The runner
reconstructs that census on GitHub and captures both protected assessment
journal heads in one read. Its receipt contains only the verification status,
scope digests, and counts. A scope with relevant assessments requires value
replay before the owner reviews a correction packet. The audit receipt binds
the captured journal heads. Publication uses a current owner-reviewed packet
and the trusted financial and source checks.

The read-only `replay-assessments` operation takes the same scope and digest
inputs. It replays the canonical scorer against the frozen assessment catalog
and the complete GitHub census for the selected repository. It rechecks the
assessment heads, Points checkpoint, registry and enforcement state after
collection. The receipt records only counts and digests. The replay shares
the normal main collector's concurrency group and leaves the production
publication lock available. It emits a qualification digest for a replay that
matches the exact merged scope and satisfies the assessment checks. The digest
binds the value changes and their provenance independently of collector timing.
Extra closed-unmerged outcomes require their own reviewed source coverage.

Use `operation=replay-assessments`, `apply=false`, and
`stage_review_handoff=true` to prepare the exact replay inputs for owner review.
The workflow saves the complete source audit, value snapshot, and selected award
keys as an unsigned bundle through the existing encrypted private packet
transport. It verifies a complete readback and rechecks the live checkpoints
before it writes `receipt.json`. The Actions artifact contains the sanitized
receipt with transport sizes and digests. The bundle stays in encrypted storage.

An authorized operator downloads `receipt.json` from the exact successful
canonical main replay run and attempt. With the existing private packet account
credentials and encryption key provisioned in the environment, use
`bun --no-env-file scripts/historical-replay-review.ts RECEIPT.json OUTPUT.json`
to retrieve the exact unsigned bundle into a new private file. The reviewing
owner uses those inputs with the current correction and eligibility evidence to
review the separate canonical project packet and its SHA-256.

An applying packet records `replayQualification` with the exact GitHub
Actions run ID, attempt, artifact ID and qualification SHA-256. The reviewer
approves these fields as part of the packet digest. The publisher reads the
successful replay receipt from the canonical main workflow at the same source
commit. It reads both private journals at the receipt's recorded cutoffs and
rebuilds the packet's value projection. A newer unrelated project record can
coexist with the qualified scope. A relevant assessment change, a changed
Points checkpoint or a changed enforcement state requires a fresh review.
Packets without a replay qualification can still run a read-only preview.

The packet contains the complete reviewed source audit, the exact optional value snapshot and every selected value-award key, and the complete canonical implementation-correction manifest. It also pins the full public baseline and expected candidate digests. The packet is an explicit owner-approved historical award correction. Public assessment records establish its provenance. The runner does not perform a new valuation or infer amounts from a record ID. It reconstructs the candidate with `applyPointsSnapshot`, `appendPointAwards`, and `applyPointsImplementationCorrections`. The full immutable prefix remains intact. Changes are limited to that project and the closed September 27–November 1 window. Every newly assessed snapshot change must be selected. Source-backed correction validation retains held components.

The normal rolling scoring boundary stays unchanged. This workflow uses the existing Points SQL writer and D1 batch triggers. It checks the current registry and enforcement state. It captures both assessment journal heads before checking the selected value records. The final batch insert requires the exact prior Points checkpoint and refuses any intervening assessment for this project or repository. Existing SQL financial guards reject protected award changes. A lost import response is reconciled through the existing batch and public-checkpoint readback. A repeat of the same published candidate reports success without rebuilding it.

Each project needs a freshly reviewed packet when its public baseline or registry revision advances. The packet's producer and reviewer are recorded identities, and the reviewer must currently hold owner authority. The private packet is not uploaded as an Actions artifact. Logs publish only the project ID, revision counts, candidate digest and execution mode.

Importing an assessment does not itself publish historical Points. Complete that journal import first, then construct the packet using the actual deployed record digests and current full Points checkpoint. The October allocation workflow runs after the corrected checkpoint is verified publicly and privately.

An optional `recipientCorrections` entry records an explicit owner-reviewed October recipient exception when the canonical automatic origin proof remains unresolved. It includes the recipients' immutable node and numeric IDs and positive accepted-work line weights, the full private review dossier and its digest, all selected claim IDs, exact current pool predecessors, and every expected output key, amount and occurrence date. The runner preserves the whole recorded implementation pool, allocates it by the reviewed weights through canonical largest remainder, and writes zero successors for former recipients outside the reviewed set. Useful review awards remain unchanged. It records the existing October-original decision marker so a later ordinary snapshot retains that correction. The canonical source proof retains its unresolved status.

An optional `duplicateRetirements` entry removes a reviewed duplicate implementation pool only after complete commit/path coverage proves every ordinary change was accepted and rewarded earlier. A merge must have an empty canonical resolution or exact resolution-path coverage in an earlier rewarded source. It binds the full source, earlier source identities, exact claim coverage, private dossier digest and current pool predecessors. A covering joint award also binds its current published assessment record and claim membership. The runner appends zero successors for that duplicate pool while retaining earlier awards and review credit. An optional owner-reviewed `unchangedPromotion` proof retains the authenticated PR and merge plus the complete required Git commit, tree and parent records. It permits a nonempty conflict resolution only when its resolved tree equals the first parent, the PR head equals its declared base tree, and the final accepted merge equals its actual first-parent tree. Ordinary imported paths still require complete earlier rewarded coverage.

For distinct accepted merges, the publisher checks whether the proposed earlier source's submitted head or accepted merge already contains the merge that would lose credit. Proven carriage or unavailable ancestry leaves the retirement for review unless the owner supplies a verified `survivingCarrier` proof.

A `survivingCarrier` proof is limited to two exact same-base, same-result merges. The earlier-reported carrier must appear on the reported branch's observed live first-parent chain, with the original merge on the carrier submission's first-parent chain. Both complete submitted changes and both native accepted changes must match. The exact original commit's GitHub author must be the original PR author. Both sources must already have the same sole positive ordinary October award for that author. The publisher retains the carrier's existing award and all review credit and applies the existing review, predecessor and financial protections.

An `identicalAcceptedChange` proof may set `emptySquash: true` for a later squash that added no accepted changes. Both complete submitted changes must match the earlier acceptance's full native path, mode and blob delta. The later accepted commit must have one parent with the same tree. That parent must already contain the earlier accepted commit and retain its exact result on every affected path. The earlier ordinary implementation pool must still have positive Points.

Two merged PRs may record one accepted commit. The proof uses that same commit
for both records and verifies the same submitted head, base, complete native
commit range, parents and nonempty accepted delta. The earlier ordinary award
must still be positive. The later source's duplicate implementation pool is
retired without changing the earlier award or the review awards.

Large packets use the private operational R2 bucket `slop-reviewed-payouts`. The main-only `private-payout-packet.yml` workflow creates that bucket when absent and refuses managed or custom public domains. A private manifest records the exact raw JSON length and SHA-256, compressed length and SHA-256, and ordered chunk lengths and digests. An omitted `compression` field selects the retained gzip format. Set `compression` to `br` for Brotli. Keep the manifest in `HISTORICAL_POINTS_OBJECT_MANIFEST`. Each compressed chunk is at most 393,216 bytes. Split its base64 into sixteen secrets named `PRIVATE_PACKET_CHUNK_1` through `_16`, each at most 32,768 characters, then dispatch its zero-based `chunk_index`. Clear unused chunk secrets before each dispatch. The shared production lock serializes staging and publication. Stored exact replay is idempotent and any differing existing bytes refuse.

The publication workflow uses the private object manifest when present. It downloads every ordered chunk, verifies compressed and raw byte identities, then passes the full UTF-8 JSON to the existing reviewed packet validator. Streamed decompression is bounded by the declared exact raw length. This path retains the full source evidence. It does not change historical scoring or protection checks. For a smaller four-secret packet, clear `HISTORICAL_POINTS_OBJECT_MANIFEST` and use the existing gzip/base64 inputs. The bucket has no website, Worker route or public artifact export.


The protected staging and publication workflows now explicitly select
`PRIVATE_PACKET_TRANSPORT=bound-preview`. This transport creates an ephemeral
Cloudflare preview using the existing `slop-vetting-evidence` binding. It has no
production route and can access only the exact manifest's object names under
`reviewed-payouts/v1/<raw digest>/<compressed digest>/`. Scanner records and their
`vetting/` namespace keep their existing contract, backup and retention rules.
The packet namespace is retained until a separately reviewed cleanup is performed.

`PRIVATE_PACKET_ENCRYPTION_KEY` is a separate 32-byte base64url environment
secret. The client encrypts every manifest and chunk with AES-256-GCM before
storage. Its nonce binds the key, manifest, object path and exact plaintext
digest, and its additional authenticated data binds the path and manifest.
The preview receives ciphertext, fixed frame lengths and nonces, plus a fresh
independent request-authentication secret. It receives no encryption key.
Create-only writes and readback refuse changed objects. The client authenticates
and verifies the full plaintext before the existing decoder and publication
checks run. This confidentiality boundary also applies if bucket exposure changes.
No plaintext packet, encryption key or preview credential is logged or exported.

The original `r2-api` transport remains available and keeps its private-bucket
metadata checks. An ephemeral preview grants no authority to import Points,
reserve awards or send payments. Successful staging records storage only.
