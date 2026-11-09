# State review status

## Assembled follow-up candidate

This branch combines the frozen `a8b0f8226` observation candidate with the
previously separate completion fixes. The preserved source heads are:

| Area | Source head |
| --- | --- |
| Submitted candidate ownership | `d65bee7d8` |
| Browser evidence retention | `7370945cd` |
| X cookie ownership and cleanup | `f6166c425` |
| Checker cancellation | `a9ae7aad6` |
| Points intake, lease and decisions | `918a3756f` |
| Private Points UI | `08a837c84` |

This aligned candidate starts at cleanup-aware development merge `69229342`
and carries the source-only completion checkpoint `fada3d4cc`. The reviewer
completed the earlier merged-source verification and released the hold.
The independent bounded proof-completion batch remains first in PR order;
this candidate must incorporate its final reviewed changes before its own
PR review. All earlier standalone branches remain available. No application,
parser, simulation, verifier or browser checks ran in this lane; regenerated
inventories and source comparisons do not prove this combined candidate works.
Independent evidence below retains its exact source boundary.

The alignment preserves all 32 paths deleted by the development cleanup and
all 13 upstream-only added or modified files byte-for-byte. This includes the
TypeScript brand tokens, identity-handler correction and required restoration
markers. Generated inventories were rebuilt after resolving their conflicts.
The original source-only branch remains at `fada3d4cc`; no shared head was
rewritten.

## Current delivery and acceptance boundary

The goal is active and incomplete. PR
[2414](https://github.com/SlopDotCash/slopdotcash/pull/2414) merged into
`development` at `7f8b920bbc5056416c3f0dd1c7d5c354d44771e4`. This is not a
production deployment or completion of the application-wide state review.
The older dirty `/Users/shawwalters/slopdotcash` checkout is preserved.

The review chat owns the remaining published batch. PR 1873 merged at
`5acc3c47e9a29fc2b55fb756964944eb0a976213`. PR 2427 then merged at
`5d8b2402e070ec6cc6adf069e5e4f68ce41fcd96`, from reviewed head
`1bcf755b0645e05a611d288825bf8c4de0696c0c`. Its unfinished Quint job was
cancelled when the PR closed; the other non-skipped jobs passed. The review
chat owns the replacement exact-source verification. PR 2426 merged at
`25cf670075eb89993f3f83ca3e52d13efecefdfe` into the earlier feature branch,
not into `development`. Its proof changes still require the corrective
integration being prepared by the review chat. These are recorded checkpoints,
not mutable-branch completion claims. Later commits must be assessed against
their own source and model hashes.

The frozen local `codex/quint-observation-fixes` branch retains the earlier
observation checkpoint, and `codex/quint-observation-current-base` retains
the later corrections at `bde5f518`. The prepared
`codex/quint-observation-proof-base` branch rebases those corrections onto
the corrective PR 2429 head `22b0fd511aa8cc8c8e5810fdb979b40a03c5a5f9`.
It preserves the reviewed runner changes, 168 selected proof targets in 33
modules, extracted helpers and all proof-side model source links. The combined
inventories are regenerated. Final alignment with the completed development
merge remains required. Keep this follow-up separate from the held published
head until the corrective integration is complete.

The user resumed the goal after requesting that this chat skip checks and
focus on pushing. That constraint remains in effect: no new checks are run
here. Independently produced evidence is identified as such and is not
reported as a passing run of this combined local branch.

The PRD section 12, CONTRIBUTING and identical AGENTS/CLAUDE instructions
require reviewed Quint models and implementation conformance evidence for
explicit and implicit state transitions. The current global inventory contains
844 production sources, 367 finite models and 2,530 named scenarios, with zero
unmapped sources. The separate lexical catalog lists 237 declared lifecycle
candidates. Neither count establishes complete semantic refinement.

The evidence-transport follow-up adds one model with 21 named scenarios and 25
native regression definitions. TLS callback errors and early closure now settle
the observation; success waits for close and an absolute deadline bounds the
TLS probe. HTTP validation owns body disposal and preserves primary errors
through reader and response cleanup. The scenarios and definitions remain
unexecuted. The refreshed census has 10,024 function bodies in 687 runtime files,
with 168 selected contracts. See `evidence-transport-audit.md` for the source
mapping and separate TLS, DNS, native stream and recorder limits.

The direct-child follow-up adds one model with 23 named scenarios and 22
unexecuted native fixture definitions. The recorder now tracks close separately
from exit and retains signal errors while attempting fallback cleanup. Pinned
Node source ruled out the initial suspicion about ordinary failed-spawn
timeouts; the audit records that correction. This batch provides no native
process-tree, browser or host-level validation. The current census is 10,031
function bodies in 688 runtime files, with 168 selected contracts. See
`evidence-process-audit.md` for the exact source and model boundaries.

The inbox coverage batch adds three models and refines the original API model,
adding 67 named scenarios. Publication, review-link access, independent page and
unread-count observations, keyset continuation, atomic read marking and UI
identity observations now have separate bounded models. An empty page is not
treated as a globally empty inbox, and a failed response does not undo a
committed read mark. The UI model records draft-cleanup intent rather than
claiming unavailable storage was erased. No runtime defect was established in
this pass, so application code and executable tests are unchanged. All new and
revised scenarios remain unexecuted. See `inbox-backend-state-audit.md` and
`inbox-read-state-audit.md`; the function census remains 10,031 bodies in 688
files, with 168 selected contracts.

The identity-admission batch adds one model and refines the counter model,
adding 30 named scenarios. The gate separates edge and exact admission from
later identity validation. The counter keeps captured request time distinct
from SQL/reply order, including cleanup, rollover, denied increments and a
committed count followed by an invalid or missing database result. Existing
clock policy is unchanged. Direct rate-counter and gate execution evidence
was not found; the existing maintenance test covers cleanup wiring only.
All new and revised scenarios are unexecuted. See
`identity-admission-state-audit.md` for the finite bounds and policy limits.

Development has since advanced to `82477b08` with a model-directory and
documentation reorganization. This source-only checkpoint still retains its
`69229342` base and must be aligned with that newer tree before PR review. The
separate completion PR is being reconciled by its owners; its exact-head
validation does not cover this later model batch.

The wallet source-only batch adds four models and 64 unexecuted scenarios.
Earnings now stops departed wallet continuations, binds each wallet action to
its initiating account, and sends that expected actor to the payments API.
Owner vault setup retains only its own pending creation and registration
record. Referral claims serialize cooperating browser views with Web Locks
and compare saved records before replacing or clearing them. The authored
browser and handler regressions have not run. See
`earnings-wallet-lifetime-audit.md`, `earnings-actor-binding-audit.md`,
`owner-vault-setup-audit.md`, and `referral-claim-lifetime-audit.md`.
The next source-only batch adds two models and 46 scenarios across new and
refined models. It binds pending-application and owner private requests to
their actors, clears refused private views, and fences flag eligibility to
the project revision that was checked. The reinstatement model now tracks
immutable flag IDs and separates resolving flags from reinstating a project.
These models and the added browser/handler regressions are unexecuted. See
`pending-application-state-audit.md`, `owner-private-requests-audit.md`, and
`risk-flag-state-audit.md`. The function inventory still selects 168 contracts;
it does not prove the remaining bodies.

The project-publication batch adds five models and 52 scenarios across new
and refined models. Registry responses retain their own committed revision;
initial creation and stored publication also fence the checked enforcement
generation. Editor, maintainer and setup requests bind the initiating actor
and reject late results from a departed or changed view. Existing drafts and
accepted writes remain recoverable. The added model and browser/handler
definitions are unexecuted. See `project-publication-receipt-audit.md`,
`project-publication-lifetime-audit.md`, and
`project-authority-setup-audit.md`. The generated function census has 9,906
bodies in 684 files, with the same 168 selected contracts.

The resource/notification completion batch adds seven models and 80 scenarios
across new and refined models. Resource deadlines settle once; private Admin
retention requires a completed matching identity check. Notification metadata
and backup escalation now use current attempt/acknowledgment predicates.
The new models also make payment-page assembly, link callback and document-head
transitions explicit. All added scenarios and browser/handler definitions are
unexecuted. See `resource-deadline-admin-audit.md`,
`notification-attempt-ownership-audit.md`, `payment-page-assembly-audit.md`,
and `navigation-completion-audit.md`. The refreshed function census contains
9,913 bodies in 684 files; the selected contract count remains 168.

The Admin and assessment batch adds five models and 67 scenarios across new
and refined models. Admin mutations bind their actor and lifetime; enforcement
confirmation uses the exact reviewed request. Vetting reads and mutations stop
departed callbacks, and both vetting admission and assessment pagination preserve
the initiating account boundary. Value-worker completion also requires a lease
that remains live at database execution. These scenarios and added regression
definitions are unexecuted. See `admin-mutation-intent-audit.md`,
`admin-vetting-requests-audit.md`, `incomplete-assessment-access-audit.md` and
`value-finish-clock-audit.md`. The function census now has 9,924 bodies in 685
files and the same 168 selected contracts.

The explicit-signout and inference-reservation batch adds two models and 43
scenarios across new and refined models. Successful local signout invalidates
private views and supersedes earlier responses. The enforcement intent model
now separates preflight, dispatch, acceptance, delivery and callbacks. Inference
admission and reservation share the same counted-attempt predicate, and the
reservation and its refusal receipt use one database transaction. All new
models and regression definitions remain unexecuted. See
`explicit-signout-audit.md`, `inference-attempt-accounting-audit.md` and the
enforcement follow-up in `admin-mutation-intent-audit.md`. The current function
census contains 9,939 bodies in 685 files with 168 selected contracts.

The security-settings, email and worker-recovery batch adds four models and
59 scenarios across new and refined models. Settings permission and publication
retain their initiating actor; confirmed identity changes refresh the parent.
Email continuations check their generation before reads, status handling and
error publication. Workers re-read local authority after remote membership.
An immutable attempt-completion record now distinguishes a completed non-free
attempt from one still awaiting its response or retained result. Unfinished
capacity stays reserved and retryable; terminal exhaustion rechecks retention.
All added scenarios and browser/SQLite definitions remain unexecuted. See
`security-settings-lifetime-audit.md`, `email-preference-requests-audit.md`,
`value-precall-authority-audit.md` and `inference-attempt-accounting-audit.md`.
The aligned function census has 9,960 bodies in 686 files and 168 selected contracts.

The image, escalation and profile batch adds one model and 37 scenarios across
new and refined models. Image decoding uses the latest committed draft callback;
decode failure and retry are now explicit. Backup notification insertion rechecks
current delivery failure or overdue acknowledgment instead of a prepared trigger.
The new profile model captures identity-source conflicts and current-wallet key
ownership. Added regression definitions and all new scenarios are unexecuted.
See `image-parent-callback-audit.md`, `notification-escalation-current-state-audit.md`
and `profile-identity-audit.md`. The current function census has 9,961 bodies in
686 files with the same 168 selected contracts.

The trace, installer and private-report batch adds one model and 51 scenarios
across new and refined models. Trace intent writes and replay reads use current
run-state admission. Private report acceptance is separate from session-bound
navigation and uncertain-payload recovery. Installer diagnostics distinguish a
committed activation from failed readback or cleanup and preserve primary
errors. Skill source authority now distinguishes static, contributor and
reviewer roles. All added scenarios and regression definitions are unexecuted.
See `trace-intent-admission-audit.md`, `private-intake-completion-audit.md`,
`skill-installation-completion-audit.md` and `skill-role-authority-audit.md`.
The current function census contains 9,967 bodies in 686 files and 168 selected
contracts.

The clipboard and contributor-completion batch adds one model and 56 scenarios
across new and refined models. Clipboard feedback now belongs to the current
text, component lifetime and latest attempt. Local run completion validates
before immutable publication; optional policy-cache cleanup and discovery-child
bookkeeping preserve their failure boundaries. Trace upload now models permanent
reservation, storage outcome, atomic attachment and retry separately. The ten
new browser/CLI regression definitions and all changed model scenarios are
unexecuted. See `clipboard-feedback-audit.md`, `contributor-completion-audit.md`
and `trace-upload-lifecycle-audit.md` for source correspondence and limits.
The metadata inventory contains 843 production sources, 358 models and 2,282
named scenarios, with no unmapped source paths. That mapping is not refinement.
The function census contains 9,970 bodies in 687 files, with 168 selected
contracts. It does not prove the other bodies. Abrupt loss of a discovery helper
before its child identity is published remains a separate crash-window review.

The following discovery-startup batch addresses that crash window and the
related helper/acquirer handoff. Startup and request publication now share the
ownership transition guard; uncertain children do not expire into permission
to reclaim a lock. Known child exits retain automatic recovery. The report and
request cleanup paths preserve primary failures, and failed spawn still waits
for its close event. See `contributor-startup-ownership-audit.md` for source,
research, finite assumptions and the remaining post-rename cleanup review.
One new model and the revised lock model add 22 named scenarios. Six native
regression definitions were added; all new and changed models/tests remain
unexecuted. The metadata census now contains 843 sources, 359 models, 2,304
scenarios and 9,980 function bodies in 687 files. The 168 selected contracts
and zero unmapped source paths remain accounting, not full refinement proof.

The lock-publication follow-up adds one model and 20 scenarios, with 11 new
native regression definitions. Candidate cleanup preserves the primary error;
failed stale cleanup revokes an unpublished new owner while the guard is held.
Release records its commit before cleanup, and retry operates only on the
saved private release path. Rollback and guard failures retain explicit
committed/manual-recovery states. See `contributor-lock-publication-audit.md`.
All new scenarios and regression definitions remain unexecuted. The metadata
census now has 843 sources, 360 models and 2,324 scenarios; the function census
contains 9,982 bodies in 687 files and 168 selected contracts. These counts do
not establish implementation refinement or completion of this review.

The cycle and backup follow-up adds one model and 50 scenarios across new and
refined models. Cycle output now stages and publishes its tree/promotion pair
under a writer guard, restores prior outputs on caught activation failure,
and retains recovery state when restoration fails. Eight native regression
definitions are added but unexecuted. Backup publication now distinguishes R2
commit/readback, queue continuation, D1 phase and restore success. Access-log
retention has a separate model for the strict yearly cutoff and statement
rollback; neither refinement changes backup or retention runtime policy.
See `cycle-publication-recovery-audit.md`, `vetting-backup-publication-audit.md`
and `vetting-audit-retention-audit.md`. Current metadata lists 843 sources,
361 models and 2,374 scenarios, with no unmapped source paths; it inventories
9,996 function bodies in 687 files and the same 168 selected contracts. All
new models/tests remain unexecuted. Evidence-bundle publication and the peer's
pending proof/runtime PR retain separate review and acceptance boundaries.

The evidence-publication follow-up refines the existing model from three to
18 scenarios and adds 15 native regression definitions. Committed publication,
failed backup cleanup, restoration requiring operator recovery and failed
finalizers remain distinct. The recorder now attempts every owned finalizer,
includes video setup in its cleanup scope and refuses an unconfirmed preview
shutdown. All new and changed scenarios/tests are unexecuted. See
`evidence-publication-audit.md` for caller validation assumptions and limits.
The metadata census now contains 843 sources, 361 models and 2,389 scenarios;
the function inventory has 10,009 bodies in 687 files with 168 selected
contracts. These counts and source reviews do not establish full refinement
or application-wide absence of state defects.

The reviewer independently confirmed that run `42533925495` attempt 2 passed
against `cbb2b696` / the byte-identical `69229342` merge: 308 finite graphs,
924 normal model stages and 168 selected function proofs in 33 modules. These
results cover that earlier core revision, not the newer source-only batches.
The final receipts are attached to the repository's
[`pr-evidence-2429-cbb2b696` release](https://github.com/SlopDotCash/slopdotcash/releases/tag/pr-evidence-2429-cbb2b696).

## Integrated corrections

Read `FINDINGS.md` and the linked area audits for reproduced defects and their
bounds. The latest integration includes durable close reservations and author
capacity, execution-time reopen-breaker checks, immutable uncertain-close
recovery, per-document draft ownership with closed-tab recovery, accurate
pending-save feedback on every wizard step, private-report reflow, keyboard
scrolling and distinct accessible identities for simultaneous reports.

It also retains the earlier identity, publication, stream, migration, report,
payment, scoring, deadline, ingestion and local-verifier corrections. Original
authored fixes from PRs 2252 and 2313 and upstream PRs 2400, 2401, 2403 and 2404
are preserved. Production settings, keys and activation flags were not changed.

## Observed validation

The following early checkpoints are historical. Newer independent evidence
for the held PR 2426 head is recorded in `docs/lemmascript-validation.md` on
that branch, including all 302 finite models and 168 selected function proofs.
Those results do not certify this branch's additional models or runtime fixes.

- The frozen `0bc96c5aafab7d1e8c23ae798335f5cb2dced706` checkpoint passed all
  262 finite TLC checks through the pinned local parser. Its receipt confirms
  unchanged model/source inputs and no cancellation. This is historical and is not a combined-head pass.
- The final isolated close implementation passed 179 tests and 971 assertions
  on `d1848112b5a468b08997a62580e9a45718c517ae`, with a clean unchanged tree.
- The isolated draft implementation passed 60 selected browser cases plus a
  16-case capture/partial-write run. Twelve cases in the latter repeat earlier
  combinations. Both runs had no skips, flakes or unexpected diagnostics.
  Its five finite models passed separately. Native history used reloads;
  `pageshow.persisted` was false in all four browser variants, so this is not
  native BFCache acceptance.
- Private intake passed 24 selected cases before the two-report label follow-up.
  The two-report desktop/mobile follow-up passed separately, including its
  all-rule accessibility check and removal of both bodies on account change.
  Final combined whole-head checks remain in progress.
- The prior six selected LemmaScript modules passed together: 29 functions and
  855 proof obligations. That checkpoint's census found 9,601 runtime functions;
  unselected functions remain unproved. Broader proof-only research is isolated.
- The earlier Solana run passed two production-delay and 25 lifecycle cases;
  all 17 rebuilt JavaScript bundles matched. Local fixtures and build-tool
  workarounds do not establish mainnet or production deployment acceptance.

Exact commands, source/model hashes, failure logs, videos and receipts remain
under ignored `evidence/`. Earlier interrupted runs, transport timeouts,
incorrect test probes and failed attempts are retained as failures; later
focused passes do not retroactively change them.

## Remaining completion work

Run the full required code, model, database, contract and browser gates against
the final combined revision. Finish the private Anvil/Solana browser lanes,
refresh the PR and exact-head hosted checks, and attach safe walkthrough and
evidence artifacts. Keep the global inventories current after any further
source change. Production deployment, live providers, physical devices and
payment activation remain separate acceptance boundaries.

The `1f0dafd45` combined local runs were interrupted after the Anvil browser
flow reproduced a same-account focus check that unmounted the email editor and
lost its draft. That parent/child correction passed 54 focused cases in isolation.
Hosted `1f0dafd45` checks also exposed omitted Firefox installation, a reload
before draft-save acknowledgement, and a private-intake fixture quota failure.
Keep those failed/interrupted runs separate from corrected validation.

The source inventory is a review index. Finite models, lexical state discovery,
selected function proofs and passing workflows do not prove the absence of
every possible application state error.

## Later integration evidence and open work

The hosted `1f0dafd45` checkpoint completed all 272 Quint models: 816
type/scenario/simulation stages and 272 finite TLC checks, with unchanged
inputs and no cancellation. Its receipts are retained under
`evidence/formal/ci-1f0/quint/`. That result predates the newer models and
corrections and does not certify the current combined head.

The final isolated bounty flows passed two Chromium Solana cases and two
Firefox Anvil cases, including real wallet authorization, recovery, exact
finalized balances, accessibility and 200% text reflow. Later vault-component
checks found editable-recovery evidence and stale fixture-month problems. The
correction is integrated; the full repeated wallet matrix remains in progress.
The native contract lane passed 2 delay and 25 lifecycle cases using its
recorded retained ELF; a newly compiled pinned-image ELF is a different
artifact and still needs its own native evidence. Local Solana acceptance
reached the actual dispatcher path but failed with an invalid RPC response;
its retained failure and cleanup are not a passing acceptance result.

The App view follow-up passed 20 desktop/mobile cases. Expired-message UI
recovery passed six cases. Notification delivery, populated schema upgrades,
and enrollment have their actual SQLite/handler tests and finite models.
Private-report composition adds screening/routing/GitHub and redirect models;
its new browser fixture is still being completed. The release quality gate
now requires both same-commit proof jobs; hosted execution of that new graph
remains required. No production deployment or activation was performed.

## Coordinated push and requested validation stop

The user requested coordination with the concurrent PR review, then asked to
skip further checks and focus on pushing. That review's private authorization
models, prover setup instructions and distinction between recorded participation
and active closure authority are preserved. The latest additions model factory
authority and template changes, binding cancellation budgets, private bounty
funding composition, referral control/history and local acceptance finality.

Voiding a lower referral root could incorrectly lower the retained historical
maximum. A private per-epoch maximum now restores the earlier cap without adding
a full-history scan. Local Solana acceptance now waits for its project commits
to finalize before the finalized deployment read, retaining the resumable run.

Before the requested stop, the combined application test run passed 1,874 tests
and 22,234 assertions, with six explicit skips. The three gated TLC translator
regressions passed separately. The corrected private-report composition suite
passed ten desktop/mobile cases; the corrected bounty workflows passed four.
Both native SOL and JUP fee-conversion workflows passed on local chain clones
with finalized balance/cost evidence and stopped owned validators. These results
predate the final combined commit and do not certify its full validation.

The full 295-model runs and the remaining integration/native runs were stopped
as requested; their partial results remain incomplete. The fresh native escrow
suite passed its first three lifecycle cases before cancellation. The local
acceptance run passed the six-decimal asset and part of the nine-decimal asset,
then stopped with cleanup. Final factory TLC and binding-veto verification also
remain incomplete. The binding model's last added scenario was not rerun.
At that checkpoint, no final whole-head verification, full repeated wallet
matrix, merge, production deployment or activation was claimed. PR 2414 has
since merged as recorded above. The original state-correctness goal remains
open; passing finite models does not prove absence of all application errors.

## Reviewed recovery and runner follow-up

PR 2414 merged as `7f8b920bbc5056416c3f0dd1c7d5c354d44771e4` after its
corrected head passed all required hosted checks. At the reviewed `7faa6399`
follow-up checkpoint, the inventory had 807 production sources, 306 finite
models and 1,395 named scenarios. The later `1bcf755b` dependency is based on
PR 1873's development merge `5acc3c47e9a29fc2b55fb756964944eb0a976213`.
Current integration counts are recorded above. Mapping and finite checks do
not establish implementation refinement.

Independent review reproduced the monthly-setting defect with a real local
Anvil browser workflow: an entered transaction ID became fixed after a pending
lookup and reload. The corrected desktop/mobile cases retain the editor, accept
the valid transaction, preserve the two-send count and exact on-chain cap, and
keep wallet-returned IDs fixed. Keyboard correction and 200 percent text reflow
also passed. The walkthrough uses controlled fixtures, not live funds.

The signal probes exercised the actual integration, security-payment and browser
coordinators. They observed 9, 53 and 22 descendants respectively; after SIGTERM
all returned 143 with no observed live descendants. Review first reproduced a
managed Vite server left after an abrupt Playwright exit. Browser cancellation
and deadline handling now allow Playwright to close its server, with the existing
bounded hard-cleanup fallback. A separate real-process probe confirmed both
abort and deadline paths. Eight existing process lifecycle tests, four preview
cases, two Pages cases and two registry cases passed. A prior command failure
also retained exit one through a later signal. These checks do not prove that
an uncooperative process outside the owned group always stops.

Review repaired invalid model scenario composition and two model type errors.
Scoped type, scenario, simulation and finite checks passed; see
`backend-runner-review-audit.md`, `monthly-setting-recovery-audit.md`,
`runner-cancellation-audit.md` and `direct-payment-composition-audit.md` for exact
bounds. Submitted-payment finite verification uses two invocations, two nonzero
identifier classes and a projection of unobserved stored contents. Its concrete
scenarios and separate uncapped-step simulations keep exact stored values. The
finite result does not prove longer histories or exact stored contents.

Combined final-head verification and hosted checks remain required. The wider
state audit is still open. No production release, provider delivery, live-wallet
authority or settlement availability is claimed.

## Local refinements held for coordinated review

A further source-only review found that `useSecurityData.replace` did not
advance the active read generation. An older GET success or error could
therefore overwrite a newer action result. The local correction invalidates
those older reads before replacing the view. The hook had this behavior on
the development base; it was not introduced by the earlier state-review PR.

The local models also now distinguish captured actor/generation storage slots
from the currently displayed recovery rows. The synchronous storage write loop
is one transition with zero, one or all writes, not interleaved UI edits. The
runner model includes rejected startup and late sibling cleanup.

These changes are committed locally and are being held outside the published
PR heads during the coordinated review batch. No new checks were run. They do
not close the outstanding runtime, browser or model-verification requirements.

The next source pass also corrected three pre-existing completion races locally:
Inbox focus reads no longer supersede an active mutation's final read; direct
recovery completion is fenced to its observed authorized wallet, consent and
generation in the case transaction; and owner commitment/release verification
can clear only the captured pending attempt. Wallet-returned evidence can still
update its owned attempt after unmount, but cannot overwrite a retry. Optional
attempt IDs preserve legacy records. Cleared/replaced late hashes remain in
wallet activity, not a new local history store. Inbox and owner-attempt
corrections still need runtime and model execution evidence. Published PR heads
remain owned by the review chat during the coordinated review batch.

The direct-recovery correction was independently reproduced and validated in
the isolated `slopdotcash-lemma-recovery-fence` worktree. The original API
returned 200 and appended a stale successor after a wallet change during the
chain read; the corrected API returned 409 without changing the case, events
or successors. Its five direct-payment integration scenarios passed. The
initial model bound also failed: a composed history reaches revision 5. The
corrected bound and all nine scenarios passed, with 3,416 distinct and 16,955
generated states at depth 13. The regression and bound correction are now
included locally. See `direct-recovery-completion-audit.md` for scope and
evidence limits. This isolated evidence is not a whole-branch result.

Source review also extended the existing registry publication model to cover
bounded pair retries, first-deployment fallback, a disappearing API, and
partial or complete file bytes left after write failure. Its ten scenarios
and independent finite check passed with 97 distinct states at depth 8. No
registry output or application behavior changed. See
`registry-snapshot-completion-audit.md`; it explicitly excludes concurrent
local writers and does not claim atomic publication.

## Continued source review

The resumed review added these local corrections. They remain outside the
published review batch and have no complete combined-head validation:

- Initial direct-payment preparation now checks captured payer and reporter
  claims and exact consent again in the case transaction. A wallet replacement
  during RPC planning can no longer publish that stale initial intent. See
  `direct-preparation-completion-audit.md`.
- Case-detail responses are ordered against the latest accepted revision,
  including responses arriving before React paints. Equal revisions retain
  the current projection and join or start a fresh GET because wallet and
  payment-ledger state can change without a case revision. Departed callbacks
  cannot start new reads. See `private-action-lifetimes-audit.md`.
- VaultActions and AutomaticMonthlyPayment now use the same owned-attempt
  boundary as the owner commitment and reserve-release flows. All four retain
  the actual stored snapshot separately from an in-memory hash, so a failed
  hash write does not prevent later verification from clearing its own record.
  Departed preflights stop before a new wallet request. See
  `owner-recovery-lifetime-audit.md`.
- Direct-payment journal writes merge one owned nonce into the latest stored
  journal instead of replacing other legs with an old copy. Failed hash
  persistence retains usable local evidence, and an explicitly empty recovery
  input cannot silently resubmit the stored candidate. See
  `direct-bounty-journal-audit.md`.
- Solana candidate writes compare the captured stored record before changing
  it. A late candidate cannot erase a returned signature, and a departed
  preflight cannot start a wallet prompt. Failed signature persistence retains
  its in-memory recovery path. See `solana-payment-pending-audit.md`.
- An Admin editor save clears only its submitted draft bytes. A departed
  completion cannot close a remounted editor, and newer edits stay open with
  accurate saved-versus-unsaved feedback. See `admin-editor-lifetime-audit.md`.
- Monthly allocation and automatic-setting writes require the same registry
  revision and manifest digest that supplied their authority. The SQL checks
  this when the write executes; existing opt-out and paused-project policy is
  retained. See `monthly-owner-completion-audit.md`.

Source review also preserves the parent PR's terminal refusal scenarios in
the startup-rejection model. Independent validation found and corrected the
Inbox model's missing return type; its 13 scenarios and finite TLC exploration
passed in that isolated worktree. The expanded 23-scenario owner model also
passed independent finite checks. The initial-preparation fix subsequently
passed the five isolated API/Anvil asset workflows and 15 concurrent-change
regressions described in its audit. A separate paired browser run now covers
Inbox focus, reserve-release late readback and commitment late decline: all six
controlled pre-fix desktop/mobile cases fail at their intended assertions, and
all six corrected cases pass. See the Inbox and owner-recovery audits for the
fixture and source limits. Newer case-projection and journal models and all
combined runtime behavior still require their exact-source evidence. Keep
original parsing failures and failed runs.

The parent and submitted-payment models preserve the reviewed cleanup and
choice factoring alongside the new captured-slot and replacement transitions.
Their normal checks pass independently. Both earlier 180-second finite checks
remain incomplete; a later unchanged submitted-recovery diagnostic completes
in about 219 seconds with 3,549,900 distinct states and an empty queue. The
runner now has an explicit 600-second verification allowance for that model
and records each stage's effective timeout. The changed runner still needs
its own combined-run evidence. Parent and journal completion remain open;
see the composition and journal audits. This chat has not run checks on the
combined integration branch.

The latest Solana and Admin runtime revisions and the three new finite models
still require their complete evidence. The independent monthly SQLite run
passes 66 tests and 540 assertions on source bytes matching this branch. Its
controlled prior-source comparison reproduces all three queued unauthorized
writes; the unchanged paused-project case passes on both. This is local
SQLite evidence, not deployed D1 or GitHub-provider acceptance. The ignored
runtime acceptance ledger separately records the exact-source limits of
earlier payment, Inbox and owner browser/API evidence.

## Separate submitted-candidate ownership follow-up

This branch follows the frozen observation checkpoint `a8b0f8226`. Its extra
source correction is not part of that earlier candidate: the submitted-payment
fallback now requires its captured storage record to remain present and equal
before saving a candidate. It cannot recreate a nonce removed by a returning
wallet decline or overwrite newer evidence. Successful writes acknowledge
their own bytes for an edited retry. See `submitted-candidate-ownership-audit.md`.
The focused model and extended browser regression are authored but unexecuted;
this branch is separate from the active corrective PR and its validation.

## Separate browser-evidence retention follow-up

This branch follows the frozen `a8b0f8226` observation candidate. The registry
runner now honors an explicit output directory, and the private-intake CI step
selects its own directory. This keeps its report from replacing the earlier
normal registry report. The change and six model scenarios are unexecuted;
see `browser-evidence-output-audit.md` for the observed original artifact loss.

## Separate X connection cleanup and model refinement

This branch follows frozen `a8b0f8226` and refines `api_x_connection`. Source
review also found that failed flow deletion skipped the required temporary
provider-token revocation attempt. A nested `finally` now attempts revocation
while preserving the original storage error. Twenty-nine unexecuted scenarios
represent replay, provider failure, callback expiry, supersession, permanent
claims, disconnect, and cleanup/revocation outcomes. The model preserves the
source's current callback and SQL-bound-time semantics. See `x-connection-lifecycle-audit.md`;
it does not imply runtime conformance or acceptance of the broader identity
flows. This refinement is not part of the active corrective PR.


The X follow-up also replaces the shared start cookie with a per-flow cookie
name, with an expiring legacy fallback. This corrects both delayed callback
cleanup and reversed start-response arrival. Its model now separates the D1
start from cookie delivery. The nineteen added handler/SQLite cases and all
29 X scenarios remain unexecuted in this lane; the active core PR is unchanged.

## Separate LemmaScript cancellation follow-up

This branch follows frozen `a8b0f8226`. The proof checker now forwards parent
signals through the existing process-group supervisor and retains canceled
failure receipts. The missing parent-signal path predates corrective22b.
Independent controlled-command probes reproduce all three orphaned-listener
outcomes on the old caller and pass all three fixed signal cases. They do
not execute a theorem; shared-supervisor and full-caller gates remain
separate. The two model scenarios remain unexecuted here; see
`lemmascript-cancellation-audit.md`. This source is not part of the active
corrective PR.

## Separate Points dispute lease model

This branch follows frozen `a8b0f8226`. `points_dispute_lease` adds sixteen
unexecuted scenarios for two worker claims, expiry and takeover, returned
provider costs, immutable drafts, independent resolution and token-matched
cleanup. The original intake model remains. No application code changed;
`points-dispute-lease-audit.md` records the source mapping, existing runtime
references and outstanding conformance. This model is outside the active
corrective PR.

`points_dispute_intake` separately models two competing creation requests, a
newer Points revision, statement immutability and atomic opened notification.
Its twelve named scenarios are also unexecuted. The two new models complement
the existing API model. `points_dispute_decision` adds sixteen unexecuted
scenarios for private detail reads, independent first-writer decisions, exact
and conflicting retries, and an admitted retry returning after resolution.
Pagination and full runtime conformance remain open.

## Separate Points private-view lifecycle correction

This branch follows frozen `a8b0f8226`. Points requests now recheck the session
on both success and failure. Identity loss, an unavailable session or an
access refusal clears cached private lists, details and input before the
parent refreshes. A departed callback cannot update the replacement parent.
`ui_points_disputes` adds 26 unexecuted scenarios; the extended real-browser
workflow is also unexecuted. See `points-dispute-ui-audit.md`. Exact-source
browser, accessibility and walkthrough evidence remain required.


## Public X profile read model

`ui_public_x_profile` adds18unexecuted scenarios for the existing public
lookup, visibility observation, missing/error outcomes, callback lifetime
and profile-key changes. It adds no connection controls and makes no claim
that the public read represents current provider ownership. See
`public-x-profile-audit.md` for the source semantics and remaining bounds.


## Operator evidence view ownership

The private inventory is now bound to its actor and lookup before rendering.
A successful response also needs a fresh matching session. Reader actions
retain their component/attempt owner, cancel a departed body read and recheck
the actor before a body request or download. Issued server grants and already
consumed grants retain their original backend semantics.
`ui_vetting_inventory` and `ui_vetting_reader` add 32 unexecuted scenarios;
the extended presentation and actual Pages/D1/R2 browser workflows are also
unexecuted. See `vetting-evidence-ui-audit.md` for the precise boundaries.

The same operator workflow now enforces its expected-actor header through the
shared backend guard before grant creation or audit. Reader errors preserve
HTTP refusal status and invalidate the private parent on lost access; other
errors are retained only after another matching actor observation. Six added
backend admission scenarios and the extended SQLite/browser cases remain
unexecuted in this lane.
