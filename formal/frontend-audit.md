# Current-development frontend state audit

Authoritative source base: `e3d7dea64` on `codex/quint-state-review`, with the
current working-tree corrections. This audit does not describe the older dirty
checkout at `/Users/shawwalters/slopdotcash`.

## Scope and traceability

`frontend-review.json` lists every current `src/*.tsx` file and the client
hooks/transport/identity/draft entry points: 113 source paths, including the follow-up scoring/projection and parser reviews. The current frontend model set has 37 modules and 148 named scenarios. Each row names its
Quint model or explains its reviewed stateless behavior.
`frontend-stateless.json` supplies the reviewed pure-rendering exclusions.
Each model's `@source` lines bind it to actual implementation paths.

These are **bounded behavioral abstractions**, not a line-by-line proof of
JavaScript refinement. A source appearing in the index means its state sources,
user actions, asynchronous boundaries and consumers were reviewed. It does not
mean every field, input value, DOM event interleaving, or dependency was proved.
The models are deliberately grouped around shared state contracts rather than
copying every React state variable as a separate toy machine.

| Model | Reviewed behavior and important boundaries |
| --- | --- |
| `ui_boot` | Registry load, published fallback, explicit stale/unavailable state, lazy app import, fatal render failure. Missing registry leaves account routes available. |
| `ui_session` | Cookie/session reads, malformed response refusal, identity start/poll/join/cancel, account recheck generations and departed callbacks. Actual cookie expiry is checked by APIs; the UI receives no session expiry timestamp. |
| `ui_transport` | Request deadline through response-body read, parse/schema failure versus authenticated result. |
| `ui_resources` | Initial load, validated complete publication, refresh retention, authoritative refusal, timeout/error, canceled callback, freshness transition. Shared cache contains only validated public records. |
| `ui_project_setup` | Three setup steps, editable fields, committed revision, authority/App/scan gates, explicit scan exemption, and stale revision conflict. Funding remains separate from activation. |
| `ui_admin_review` | Human-authorized preview, immutable revision/sequence comparison, confirmation, competing update, and access loss. No model action grants platform or payment authority. |
| `ui_private_intake` | Review, retained exact payload/idempotency key, uncertain send and retry, accepted cleanup, terminal account change, definitive validation refusal. |
| `ui_inbox` | Actor checks before/after private reads, paginated selection, read acknowledgement, reset on account change, removal on lost access. |
| `ui_email` | Actor-bound preference control, enrollment token, verification, availability gate, unsubscribe and replacement account. Token parsing and server delivery remain API contracts. |
| `ui_wallet_choice` | Passive provider discovery, UUID/provider conflict retention, chosen provider, and trusted-provider check before request. Discovery sends no connect request. |
| `ui_payout_consent` | Selected address/network, reconstructed EVM typed message or exact Solana transaction, wallet signature, stored consent, and explicit separation from payment. |
| `ui_transaction` | Wallet review, current intent check, durable marker before send, known hash, uncertain outcome, rejected request, pending reconciliation, failed/finalized evidence, approval-versus-transfer, retry after a proved failure. |
| `ui_navigation` | Route/history changes, bounded pagination and filter reset, native disclosures, copy success/failure/expiry. |
| `ui_artifacts` | Source-keyed async generation, stale completion refusal, private read grants, image/preview/evidence error state. |
| `ui_contributor_allocation` | Sender-recorded token transfer, on-time wallet registration, deadline, final batch, and unclaimed state. A sender record is not chain proof. |
| `ui_record_display` | Projected/reserved/submitted/verified records remain distinct; read failure cannot fabricate an empty success. Contributor allocation `Sent` is the S.P.'s recorded transfer, not claimed chain verification. |
| `ui_risk_flag` | Own-flag read, evidence submission, withdrawal, and observed pause. **This retained component has no importer in the current app, so it has no live browser entry point.** It is not counted as an exercised user flow. |

Finite domains use two actors/projects/request epochs, three setup steps, two
pages, and one transaction attempt plus explicit retry/reconciliation states.
Amounts, cryptographic checks, chain finality and API state transitions are
abstracted as predicates whose owning financial/backend models are separate.
The UI models do not prove EVM/Solana contracts or grant authority to execute a
transaction.

## Confirmed corrections

1. `currentProjectSession()` returned `undefined` from a successful `{}` body.
   Its hook labeled that value signed-in; Admin then dereferenced it and the
   render boundary replaced the app. The client now checks the session shape
   and returns a typed, recoverable error. Older responses that omit `admin`
   remain non-admin; a non-boolean role flag is rejected.
2. Snapshot freshness was computed from `Date.now()` only during render.
   An untouched open tab never crossed into its eight-hour stale state. The
   snapshot hook now schedules that render, clears the timer on replacement
   and unmount, and shares the exact threshold with the displayed warning.
3. Contributor allocation used the same render-only clock pattern. A recipient
   left Payouts open could keep seeing "Awaiting wallet" after registration
   closed. A shared `useTimeBoundary` hook now drives both the snapshot and
   allocation deadlines, including browser timer-range handling.
4. Project standings passed a loaded score state to `ContributorStandings`,
   which suppresses its default data notice when a parent supplies state.
   The project parent displayed no replacement warning. It now explicitly
   enables the existing data notice; layout and ordinary fresh-state copy are
   unchanged.

`tests/e2e/ui-state-boundaries.spec.ts` drives the real built application and
records video on desktop and 320px mobile. It controls the malformed HTTP reply
and browser clock. Those controls test frontend behavior; they do not establish
live GitHub authentication, backend authorization, or provider availability.
The unmodified existing sign-in and project-access suites remain relevant
regression coverage. The exact browser evidence is copied under ignored
`evidence/formal/ui/`, with relevant source hashes and no credentials.

5. The cycle index admitted a settlement-planned record with settlement evidence.
   The cycle page then mixed payment-ready and paid labels. Settlement artifacts
   now require the paid lifecycle state. The malformed index fails visibly.
6. Automatic owner allocations evaluated their cutoff only while rendering.
   The shared timer now disables unsaved editing at the cutoff without refresh;
   manual finalization remains independent. The API already enforced the cutoff.

The final pre-Lemma browser matrix passes 20 cases: ten correction scenarios
and ten existing owner-awards workflows on desktop and mobile. It includes
keyboard, accessibility and enlarged-text checks from the owner workflow.
Subsequent proof-helper integration changes the caller file hashes; these
captures are explicitly before that integration, not exact-head proof of it.

7. Follow-up testing found that a passive effect starting after its deadline
   returned without scheduling the needed render. The hook now executes one
   immediate tick for an already-crossed boundary. Its unchanged dependency
   prevents an effect loop. A real DOM-commit/clock browser regression and
   `ui_time_boundary` cover the delayed-effect path.
8. Two GitHub node-ID encodings of the same numeric actor could pass overlapping
   payout-exclusion validation. The real owner and admin revision APIs now
   reject both aliases together; numeric actor identity owns interval overlap.
   The public Points amount remains unchanged.

The combined proof-helper source run passes all 12 focused browser cases on
desktop and mobile. Its per-file SHA-256 record and videos/screenshots are in
`evidence/formal/ui/combined`. The pre-Lemma 20-case owner matrix remains
separate. The exclusion fix has its own real API/payment workflow evidence.

## Findings that were not converted into speculative changes

- The private-case resource hook can retain a prior record after a failed
  refresh. The enclosing `SecurityInbox.privateRequest` verifies the actor
  before/after each read, removes its child tree on 401/403/404/410 access
  changes, and retains only after an unchanged-account check. No access-loss
  bypass was established.
- The shared `useAction` hook models busy/error UI, but its callers supply the
  actual disabled controls and persistent transaction guards. It is not itself
  a global lock or a rollback mechanism. Wallet send safety is in the durable
  before-send marker and adapter checks, not the button's disabled state.
- Account-controlled private drafts are distinct from public owner proposal
  drafts. Private drafts clear on confirmed account change/sign-out; a session
  outage retains them for recovery. Owner proposals retain edits typed during
  publication and flag stale base revisions.
- Generated previews compare source keys and reject stale digest completions.
  Wallet provider conflicts remain blocked for the page lifetime. Successful
  wallet submission remains uncertain until appropriate finalized evidence.

The expanded current-source browser run passes all eight initial correction scenarios
on desktop and mobile. The private Inbox suites pass 26 scenarios, including
401/403/404/410 revocation, unchanged-account outage retention, A-to-B-to-A
binding, and duplicate mark-read clicks. No production change was needed for
these private-read hypotheses. The separate real local-service departed-action
run and the scoring library scope are tracked separately below.

See `scoring-projection-audit.md` for the additional source review, cycle-index
correction and exact model limits.

The deadline correction uses one scheduled boundary rather than an interval.
The hook clears replacement/unmounted timers and splits waits beyond the browser
timer range. This keeps a dormant tab correct without ongoing polling. Backend
authorization remains authoritative when the device clock differs.

`parser-review.md` records the later project schema/policy and notification
parser review, including the direct-import boundary that remains unproved.

## Remaining limits

There is no generated Quint-to-browser replay adapter. Two generated trace
adapters exercise production model-outcome projection and profile census
admission (`scripts/quint-projections.test.ts`); these establish bounded
conformance only. Other model scenarios and browser scenarios have a reviewed
correspondence, and runtime regressions
exercise the corrected session, freshness, allocation deadline and cycle-state contracts, but arbitrary source refinement is
unproven. Synthetic actor/clock/network inputs are not live-service evidence.
The full visual/accessibility matrix and all existing end-to-end suites are
separate acceptance work. Image decoders, OS clipboard permissions, browser
storage failure implementations, wallet extensions, signature algorithms,
remote token contracts and network availability remain external dependencies.
This audit does not justify claiming that the entire application has no state
issues. The inventory should stay fail-closed about pending source outside
this frontend scope and about these verification boundaries.

## Additional transition models and execution evidence

- `ui_time_boundary` checks a deadline crossing before a passive effect starts,
  ordinary timer delivery and a single re-render tick. Its progress property
  assumes weakly fair effect/timer execution and a monotonic modeled clock.
- `ui_owner_awards` binds the automatic cutoff, unsaved versus persisted amounts,
  competing allocation revisions and a final snapshot. Its finality property is
  for one contribution month; navigating to a different month is a new view.
- `ui_project_policy` checks immutable identity, receipt/terms binding, collection
  without payment authority and append-only predecessor/successor rules.
- `ui_exclusion_identity` checks that numeric actor identity owns interval overlap
  even when the node-ID encoding changes. Adjacent ranges remain permissible.

The final combined-source browser suite passes 12 cases, with each correction
also reproduced on the earlier source in the same browser fixture. Two generated
trace adapters pass 2 tests with 2,960 assertions. The payout alias refusal passes
31 real API and allocation workflow tests with 618 assertions. No test signs or
broadcasts a payment. The real local-service Inbox departure result is recorded
separately after its run completes; failed setup/diagnostic runs are not counted
as completed evidence.


The real local-service Inbox departure test now passes on both desktop and
mobile (2 passed, 0 skipped, 0 unexpected). It uses fresh local D1 migrations,
Pages Functions, the local Slopbot/notification/GitHub services, real SPA
navigation, an account switch, a newly persisted private draft and a delayed
old session response. No late request erased the new draft. Evidence and
source hashes are under `evidence/formal/ui/registry-inbox`. The captured
`intake-drafts.ts` predates its subsequent pure-helper extraction; Inbox,
SecurityInbox and action-guard source are the reviewed versions. This is local
service evidence, not live GitHub or provider evidence. The test explicitly
allows cancellation of Home's public Points root/summary/shards on navigation;
all other diagnostic failures remain errors.

## Additional calendar, draft and navigation transitions

The follow-up review found and corrected more render-only clocks. Cycle pages
now update the review-deadline label, the owner cutoff and the seven-day funding
reminder while open. An uncertain private report now replaces its future-retry
message when `reconcileAfter` passes. Points totals and profile activity charts
advance at UTC midnight; cached journals are reprojected for the new month.
Owner award month navigation also advances without changing the month selected
by the owner. The desktop/mobile clock regressions passed eight cases across
these initial four displayed boundaries. All use controlled time in the actual
built app, not live provider evidence.

The image review reproduced a separate race through the real local project API
and D1 fixture: discard a stale owner draft while `createImageBitmap` is pending;
the old decode previously restored the discarded image and wrote a new saved
draft. Explicit resets now remount the image field, and departed work closes its
bitmap without writing to the new draft. Desktop and mobile both reproduced the
failure and passed the correction. `ui_image_decode` replaces the earlier
incorrect assumption that `ui_artifacts` already described image cancellation.
The browser still owns decoding/encoding; format admission is a separate strict
schema contract.

The new models make previously coarse families explicit:

- `ui_calendar_views`: current-month projection, immutable all-time totals,
  independent chart update, chosen period and UTC rollover.
- `ui_record_deadlines`: local labels change without approving a cycle or
  declaring an uncertain report confirmed; eventual updates require fair timer
  delivery.
- `ui_project_draft`: initial/restored draft, storage write refusal, local edits,
  remote revision, explicit stale-draft confirmation/discard, optimistic publish
  conflict, and edits preserved during a successful publish. Two headline
  values and revisions 1–3 are the finite cutoff.
- `ui_hash_navigation`: delayed target arrival, bounded observer lifetime,
  reader takeover, trusted history restoration and cleanup. Actual pixels,
  layout shifts and DOM target parsing remain browser-test boundaries.
- `ui_image_decode`: pending decode, explicit draft reset, departed completion,
  bitmap closure, valid/invalid encoding and removal. One pending upload per
  mounted field matches the disabled file input.

Local owner drafts are read on mount and saved on edit. The application does
not merge `storage` events from another open editor. Optimistic remote revision
checks prevent silent overwrites of the server revision; they do not provide a
multi-tab merge of unsaved drafts. That absent merge is a documented behavior,
not an assertion that concurrent editing is fully solved. Private report drafts
use per-tab `sessionStorage`, and private data must still pass actor checks.
Cross-tab cookie changes are detected on focus rather than through a cookie
subscription. Browser tab suspension, BFCache restoration, permanently blocked
storage, and actual wallet extension interactions are not proved by the finite
models. Additional explicit browser outcomes are recorded below when run.


A final additional UTC case reproduced the owner settings page retaining the
previous financial effective-month copy after midnight. The create-project
manifest also memoized its clock-derived reward/escrow dates without a calendar
dependency. Both forms now subscribe to the same UTC-day boundary. The owner
settings regression passed desktop and mobile after reproducing the old label.
The create memo now recomputes with the day; arbitrary input/date combinations
are still abstracted, not an independent new-project API proof.

`ui_tab_scope` explicitly admits two independent wallet prompts for one intent.
Session-storage markers and in-memory send guards protect their own tab; they
are not a cross-tab lock. Nonce/award uniqueness and finality remain external
predicates covered by the financial/contract work. Redundant wallet prompts or
gas from concurrent tabs are not ruled out, and no cross-tab payment guarantee
is claimed. The private-account focus browser test is separate from that wallet
boundary.


The independent shared-session peer check found that Admin and owner settings
kept the previous account's controls on tab return. The hook previously checked
only on mount or a caller revision change. `useProjectSession` now hides stale
authority while rechecking on focus, return to visible state and restored
BFCache history. A local request generation prevents an older success from
restoring controls after a newer sign-out or refusal. The backend always
remained authoritative; this corrects stale UI authority, not an API bypass.
All six pre-fix browser cases reproduced the missing focus revalidation on
desktop and mobile. `ui_focus_session` covers return, checking, refusal,
out-of-order completion and unmount for three request generations.

The final pinned UI run passed **72/72** cases with Bun 1.3.14 and Node
24.15.0. It includes all six shared-session regressions, the new calendar and
image cases, owner award editing/recovery, private account revocation and hash
history. The two real local-service cross-tab cases also passed. In those two
cases a second tab changes the actual shared session cookie, and the test
explicitly delivers the focus signal. Native tab focus is not established:
this environment's Chromium reported both tabs focused even in headed mode.
That limitation is retained rather than misreported as an application defect.

Screenshots, videos, console/network diagnostics and per-source SHA-256 records
are under ignored `evidence/formal/ui/pinned-72`, `pinned-cross-tab`, and
`pinned-source-hashes.json`. The hashes identify the tested frontend source. The later display-only
`report-revised` history label is covered by the full-suite run rather than
these earlier captures. The desktop Admin and mobile owner signed-out views
were visually inspected. Earlier failed fixture runs are not counted as passes.
