# Activity notification contract prototype

Base: `b76807343`. This scoped prototype implements the notification-selection
candidate in the backend research report. It serves PRD sections 3 and 9:
optional mail needs consent for the current destination, while essential mail
keeps its existing security-preference and operator-pilot rules.

## Useful result

The real `dispatchActivityMail` path now calls an executable contract for the
decision to retry, suppress, or proceed to preparation. The contract proves both
directions of the accepted-input rule, so it checks required refusals and also
prevents an implementation that simply suppresses every message from passing.
It does not authorize a recipient, send mail, or report provider success.

`workers/notify/verified-delivery.ts` contains three runtime functions:

| Function | Complete input domain | Contract |
| --- | --- | --- |
| `deliveryVersion` | A JavaScript string or null | Null becomes an unpinned version; every string is preserved exactly as a pinned version. |
| `deliveryVersionMatches` | An unpinned version or a pinned string, plus an expected string | True exactly for a pinned, equal string. An absent version cannot match. |
| `activityDeliveryDecision` | Essential/optional notice with its version; unavailable/pilot/registered destination; missing/stored preference with activity state, security state, and preference version | Exact retry and send conditions described below. |

The input carries actual preference and version fields, not an already-computed
authorization boolean. Strings are compared with the configured JavaScript
UTF-16 semantics. No arithmetic or floating-point assumption is needed.

The decision preserves the current rules:

- Retry exactly when an essential notice has an unavailable destination but a
  configured operator pilot. This occurs before preference suppression, as in
  the existing dispatcher.
- Never proceed to delivery with an unavailable destination.
- Optional mail requires enabled activity mail, a preference version equal to
  the destination version, and a queued notice version equal to that version.
- Essential mail to a registered destination requires enabled security mail
  and a queued notice version equal to the destination version.
- Essential mail to an effective pilot permits an absent or unset security
  preference, but an explicit security opt-out suppresses it.

The prototype deliberately retains the existing distinction between registered
destinations and operator pilots. It adds no new consent requirement or default.

## Caller obligations and effect order

The dispatcher still performs live recipient, moderator, project-owner and
appeal checks first. It then reads the registered destination, resolves the
pilot fallback, and reads the preference in their original order. These reads
establish the concrete facts supplied to the kernel.

The existing D1 `essential` column is constrained to integer `0` or `1`; `0`
maps to optional and `1` to essential. Equivalence between the old truthiness
check and `essential !== 0` relies on that database obligation.
The destination version comes from the selected registered or pilot destination.
`enabled === 1` maps to enabled activity mail.
`security_enabled` maps separately to enabled, disabled, or unset. No new
validation, coercive acceptance, or database write is introduced. The dispatcher
retains its availability guard for TypeScript narrowing. An absent preference
record remains distinct from an existing record with unset security consent.

The selected result still runs the existing side effects in order:

1. A retry invokes `retryWithoutProviderCall` and continues the queue.
2. Suppression invokes `recordDelivery` and continues the queue.
3. Preparation stores the destination digest and creates the existing
   unsubscribe token when applicable.
4. The provider send remains separate. Definite retryable rejection retries;
   uncertain failure remains ambiguous; accepted sends record
   `provider-accepted`.

No asynchronous operation moved across a guard. The contract does not prove
that provider acceptance means mailbox delivery. Authority reads, destination
verification, clock freshness, concurrent consent changes, SQL claims and
provider behavior retain their existing boundaries and tests.

## Verification

Toolchain used: Bun 1.3.14, Node 24.15.0, LemmaScript 0.6.6, Dafny 4.11.0.
The existing dependency directory was linked read-only; no package installation,
configuration, shared inventory, or generated project-registry change belongs
to this prototype.

```sh
lsc check --backend=dafny --time-limit=30 workers/notify/verified-delivery.ts
dafny verify --isolate-assertions --verification-time-limit 30 \
  --unicode-char:false --allow-deprecation \
  formal/lemmascript/workers/notify/verified-delivery.dfy
```

Default mode: **8 verified, 0 errors**. Isolated-assertion mode: **41 verified,
0 errors**. These are different verifier counting modes, not application
function counts. The three runtime functions are the only new source targets.
The generated proof and `.dfy.gen` files are byte-identical. No handwritten
proof, axiom, extern, assumption, or verification-disable attribute is used.
The repository's `requireProofIntegrity` and `requireProofObligations` checks
pass for the exact source and proof pair.

An initial experiment using nullable record fields exposed unsupported compiler
output. The final source uses explicit discriminated missing/present states,
and the generated Dafny preserves them. The unsupported experiment is not
included in the prototype.

Existing affected workflows were run with the pinned Bun binary:

```sh
bun test ./backend/notifications/email.test.ts \
  ./backend/notifications/email-enrollment.test.ts \
  ./workers/notify/appeal-mail.test.ts --timeout 30000
bun run typecheck
```

Result: **37 passed, 0 failed, 275 assertions**; typecheck passed. These tests
exercise the real preference API, migrated SQLite state, Worker dispatch,
registered and pilot destinations, opt-out, version changes, missing or future
destinations, retry and ambiguity, and revoked recipients. Their provider
transport is deterministic; live provider delivery is not claimed. No new test
suite or synthetic helper-only test was added.

Local, uncommitted evidence is saved under
`evidence/lemmascript-notification/`. Its `receipt.json` identifies the tested
commit and source hashes; `proof.log`, `workflows.log`, `typecheck.log`, and
`integrity.json` preserve the tool output. These logs are excluded from Git.

## Integration notes

After review, add the new source to `LemmaScript-files.txt` and refresh the
source/proof inventories in the final integration checkout. Those shared files
were deliberately left unchanged here. Rebase against the integration branch,
rerun the exact-head contract and workflow checks, and update the matching
Quint source mapping as needed. This refactor preserves existing state behavior.

Private-intake predicates and clean-scan reuse remain later candidates. Their
current paths combine date parsing, persisted revisions, source identity and
schema validation; this prototype does not turn those boundaries into assumed
booleans or claim they are covered by a notification proof.
