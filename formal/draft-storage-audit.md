# Project draft ownership and frontend completion review

This review starts at `b073742d347fe2a82d7b07ef9ca3524ce63346ed` and follows
the earlier frontend audit. It does not replace its stated refinement limits.

## Confirmed loss

The real built owner form used one localStorage key per project. Tab A sent
a project revision and waited for its response. Tab B then saved a newer
draft. When A's successful response cleared its own form, its storage effect
deleted the shared key. B still displayed its edit, but reloading B replaced
it with A's published text. The before run failed that exact reload assertion
with no unexpected browser diagnostics. Its video, trace and screenshots are
retained under `evidence/formal/draft-storage/before/` in this isolated
worktree (also preserved in the earlier hash-review worktree).

## Ownership and recovery

`project-draft-store.ts` gives each live editor an exclusively locked local
slot. A sessionStorage pointer is a reload hint, not permission to write.
If another live document owns the hinted slot, the new document copies its
saved value into a different slot. A closed document releases its browser
lock, so a reload or a later new tab can reuse the saved slot. Publication
and discard remove only the caller's slot. A cached handle keeps ownership
across SPA unmounts and pending saves.

A separate, short project lock serializes slot selection and writes. Each
write receives a revision above every retained revision, so the newest
retained draft does not depend on the system clock. Slots are updated in
place; keystrokes do not create an append-only storage history. New-project
fields, wizard step and referral context use one payload. Owner settings
keep their existing draft/base-revision payload and server revision guard.
The form says when an asynchronous backup is still saving. The new save hook
resets its acknowledgement during the render of a different payload, before
passive effects run. A return from A to B to A still requires acknowledgement
of the latest A. An older success or failure cannot acknowledge the new view;
null/discard uses the same rule. A regression caught the wizard's backup
message being hidden until Review. The same message now appears on each step.

All proposal and owner-draft writes, successful-publication clears, discard,
referral changes and wizard-step persistence use the owned payload. A search
of the frontend found no other code clearing these project keys and no
sign-out handler deleting them. Sign-out changes access and unmounts the
owner form; the document keeps its store handle and queued write ownership.
The backend still decides publication authority.

Legacy local keys are read during import and remain untouched. The import
marker is written after a successful slot write; subsequent discard does
not resurrect that legacy draft. A partial write can retain more data than
the caller's success message establishes. Lock or storage failure leaves
the form usable in memory and shows the existing unsaved warning. It never
falls back to an unlocked shared write.

The lock assumptions follow the [Web Locks specification](https://www.w3.org/TR/web-locks/):
exclusive ownership, conditional acquisition, and release on document
termination. Same-origin code that deliberately steals locks or modifies
the storage protocol is outside this model. Storage capacity and browser
availability remain external limits. Independent closed-tab drafts remain
stored until their owner resumes, publishes or discards them; this adds no
draft merging interface.

## Model refinement and independent review

`ui_draft_slots` covers two documents, two slots, two nonempty payload values
and three nonzero logical revision labels. It includes a cloned pointer,
independent writes, serialized commits, failure after writing a record,
a fork whose copy persists before pointer failure, close/reopen, and legacy
import/discard. The synchronous project-lock callback is one transition.
`ui_draft_save_progress` separately models three rendered payload epochs,
FIFO writes, old success/failure, A to B to A, discard acknowledgement and
failure after bytes were persisted. Its failure with no mutation also models
unavailable storage/locks at the form acknowledgement boundary. These are
composed abstractions, not one exhaustive browser/React/storage product model.
The older `ui_project_draft` remains a one-editor revision/completed-save
abstraction; it does not establish ownership, pending SPA retention or the
opening-failure lifetime covered by this follow-up. Logical labels abstract the
ordering of retained records, not exact unbounded revision arithmetic or
the JSON grammar. Exclusive Web Locks and distinct generated identifiers
are explicit platform assumptions.

Three gaps in the earlier coarse models also receive separate models:

- `ui_repository_lookup`: replacement/invalid repository input, delayed
  facts, branch reset, and preservation of user-edited description text.
- `ui_email_actions`: replacement tokens, old success/error completion,
  actor change, discard and departure. The existing real browser tests
  already exercise old successful and failed email actions.
- `ui_snapshot_cache`: shared pending consumers, delayed release, a new
  consumer before cancellation, cached reads, and an old result completing
  after a forced refresh. Per-consumer bindings also fence obsolete effects,
  including old cleanup after a newer read. Snapshot grammar/scoring remains separate.

The notification review found no further confirmed defect. Inbox reads and
actions check recipient/generation around their asynchronous boundaries;
Points dispute views remount on query/actor changes; email editor changes
reset their idempotency key. These findings do not prove arbitrary event
interleavings. Native BFCache availability, all browser engines, real
identity providers and full application refinement remain outside the
bounded evidence below.


## Cross-project enumeration question

An independent review asked whether a different project's write could shift
origin-wide `Storage.key()` enumeration during the synchronous scan. An
isolated Chromium probe paused the actual native key read for two seconds and
performed a foreign-project deletion from another page during that interval.
The writer finished 4 ms after the reader's pause began. The reader retained
a coherent view and restored the newest draft; no wrong selection occurred.
A prior attempt failed to create the intended concurrent visibility and is
not counted as a defect reproduction or a pass of that condition.

This result agrees with Chromium's [Storage module description](https://chromium.googlesource.com/chromium/src/third_party/+show/refs/heads/main/blink/renderer/modules/storage/README.md)
and its [cached storage observer interface](https://chromium.googlesource.com/experimental/chromium/src/+/HEAD/third_party/blink/renderer/modules/storage/cached_storage_area.h).
The model assumes coherent synchronous localStorage visibility while the
project lock excludes same-project writers. The experiment does not prove
that assumption for every browser or arbitrary origin code. No production
change was made for this unconfirmed hypothesis. Its timing, diagnostics,
screenshot and videos are in `evidence/formal/draft-storage/enumeration-timed/`.

## Evidence boundaries

Real browser tests use the built local app and controlled API responses; they
exercise actual localStorage, sessionStorage, Web Locks, React rendering,
reloads and page closure. They do not prove live identity, D1 publication,
production deployment or arbitrary hardware/engine behavior. Desktop and
mobile viewport tests run in Chromium and Firefox. Chromium natively copied
the popup session pointer in this setup; Firefox did not. For Firefox the
clone test explicitly installs the same copied pointer and checks that
exclusive ownership still forks it. The test attaches the observed native
clone behavior. Native history tests attach `pageshow.persisted`; they are
not called BFCache evidence unless that value is true.

The initial monolithic draft model exceeded the 180-second verifier bound
(two attempts, neither a pass). The final decomposition keeps the real
synchronous storage callback atomic and verifies the asynchronous
acknowledgement separately. Logs for unsuccessful attempts remain with the
final receipts. Mapping, scenarios and finite TLC checks do not establish
implementation refinement or absence of all application state errors.

## Final model checks for this follow-up

Pinned Bun 1.3.14, Node 24.15.0 and Quint 0.33.1 were used. All five modules
passed type checking, their 28 named scenarios, and 500 seeded simulation
traces of 60 steps. Final TLC receipts report unchanged model/source inputs:

| Model | Distinct states | Generated states | Finite bound |
| --- | ---: | ---: | --- |
| `ui_draft_slots` | 66,555 | 895,777 | 2 documents, 2 retained slots, 2 nonempty payloads, 3 revision labels |
| `ui_draft_save_progress` | 98 | 291 | 3 payload epochs, FIFO queue, success/failure/partial persistence |
| `ui_repository_lookup` | 128 | 637 | 2 repositories/request epochs and 1 editable description |
| `ui_email_actions` | 68 | 289 | 2 replacement links/actors and pending completion |
| `ui_snapshot_cache` | 1,932 | 12,243 | 2 reads/consumers, current effect binding and delayed release |

The receipts and `model-summary.json` are retained in
`evidence/formal/draft-storage/`. TLC's backend disables deadlock checking;
progress claims here are limited to the named reachable scenarios. An early
TLC-only invalid map-index guard in the new fork-failure action was corrected
before the final pass; the failed receipt is retained separately.

## Browser and source validation

The final runtime source passed **60/60** selected proposal, owner-save and
draft-storage cases in 5.3 minutes. The capture/metadata-failure extension then
passed **16/16** in 58.6 seconds (12 repeated combinations plus four additional
metadata-failure combinations). Both runs used the standard Chromium desktop,
Chromium mobile viewport, Firefox desktop and Firefox mobile viewport projects;
existing project matching rules select which non-draft specs run. There were
no skipped or flaky cases and no unexpected browser diagnostics in either
run. The new draft spec is included in the standard Firefox matching rules.

The extension checks an actual localStorage write that succeeds before the
import-marker write fails, verifies the unsaved warning, and reloads to recover
the retained payload. It also captures the held-write A to B to A transition
before and after acknowledgement. Accessibility checks run on the restored
owner and warning pages; the warning is also checked at 200% text size and
320px/desktop widths. Text enlargement is not native browser zoom or physical
device acceptance.

`typecheck`, `lint:check`, `format:check` and the isolated Vite build passed.
Lint retained the repository's existing warnings; no new draft-path warning
was reported. The earlier 28-case passes predate the final acknowledgement
change and are not counted as its final evidence. The earlier 6-case run had
one failure because the wizard hid its save status on the Project step; the
correction is covered by the final runs. Canceled runs are not passes.

Raw screenshots, videos, traces when retained by Playwright, diagnostics,
source hashes and all run logs are under `evidence/formal/draft-storage/`.
`final-60/`, `capture-16/`, `before/`, and `progress-before-step-note/` keep the
runs separate. `project-draft-walkthrough.mp4` is an annotated walkthrough made
from these captured frames and recordings. The runtime files in the test
fixture match the hashes in `source-hashes-final-60.json` and
`source-hashes-capture-16.json`. The global inventory must be regenerated on
the combined integration revision; this local evidence is not a hosted-CI,
merge or deployment result.

Reproduce the central flow with two tabs on the same project settings page:
edit and submit in A while holding its response; edit and save a newer value
in B; release A's response; reload B. B must retain its newer value and show
the stale server-revision review gate. For closed-tab recovery, save, close,
move the wall clock backward, reopen and save a newer value, then close and
reopen again. The newer value must win. For the failure flow, make only the
import-marker write throw after the slot write; the form must report failure
while a subsequent reload still recovers the stored value.
