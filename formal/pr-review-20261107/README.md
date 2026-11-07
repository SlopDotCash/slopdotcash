# Scoped PR state review

The four `pr_review_*` models in `formal/models/` describe the state changes accepted in the 7 November 2026
PR review. They do not model the whole application. The email re-verification
candidate is excluded: its native concurrency test restored withdrawn consent,
so it was not accepted in this batch.

Run from the repository root with the lockfile-pinned Quint 0.33.1:

```sh
bun run formal:check
bun run formal:verify
```

`formal:check` checks types and effects, named scenarios, and 500 traces of up to
60 transitions for each model. The simulation seed is 20261107. `formal:verify`
uses the TLC backend to explore the complete finite model. It needs Java 21 or
later on PATH; Quint downloads its checker support when needed. The shared runner records hashes, commands and results under ignored
`evidence/formal/` and checks these models with the application-wide suite.
Use `--model=pr_review_<name>` with `scripts/check-formal.mjs` for one model.

## Source mapping and implementation checks

| Model | Changed source and actions | Required implementation evidence |
| --- | --- | --- |
| `../models/pr_review_signin.qnt` | `workers/identity/handler.ts`, `oauthCallback`: claim, decrypt or exchange failure, completion and expiry | `workers/identity/failed-callback.test.ts`: a consumed verifier that cannot decrypt produces a failed flow and poll status 410; it cannot complete later. |
| `../models/pr_review_identities.qnt` | `backend/points/handler.ts`, join and reopen; `backend/payments/wallet-registration.ts`, `registerPaymentWallet` | `backend/points/membership-identity.test.ts`: a new node spelling keeps the stored actor, closed state and explicit reopen requirement. `backend/payments/wallet-replacement.test.ts`: login changes keep the same claim and do not add a successor. |
| `../models/pr_review_recovery.qnt` | `scripts/generate-leaderboard.ts`, `executeNodeBatch` in retained-source availability collection | `scripts/leaderboard-source-recovery.test.ts`: a recoverable oversized batch splits without losing source IDs; unrelated provider failure is not evidence of source deletion. |
| `../models/pr_review_retry.qnt` | `workers/vetting/review-plan.ts`, `withEarlierAttempts` | `workers/vetting/review-plan.test.ts`: a final receipt-less retry keeps the known earlier usage and cost; the failed outcome remains failed. |

Run the implementation regressions, separately from the models:

```sh
bun test --timeout 30000 workers/identity/failed-callback.test.ts backend/points/membership-identity.test.ts backend/payments/wallet-replacement.test.ts scripts/leaderboard-source-recovery.test.ts workers/vetting/review-plan.test.ts
```

## Bounds and assumptions

| Model | Finite scope | Named scenarios | Reviewed TLC distinct states |
| --- | --- | ---: | ---: |
| Sign-in | One flow, time 0–3, nondeterministic success/failure | 3 | 17 |
| Identity | One numeric GitHub identity, two node IDs, logins and addresses, at most three wallet claims | 3 | 57 |
| Recovery | Four immutable source IDs, two-item batches, binary splitting, at most three limit failures | 2 | 72 |
| Retry | Three sequential attempts, known/missing usage and cost, unit receipt amounts | 2 | 43 |

The identity service is assumed to attest the numeric actor correctly. Database
batches are atomic. Cryptography, live GitHub/provider responses, provider cost
truth and Cloudflare durability are external boundaries. Retry amounts abstract
nonnegative receipts; they do not prove machine-number bounds or billing totals.
The recovery model omits transport payloads but preserves every source identity.

TLC disables deadlock checks. Named scenarios show reachable useful results,
not fairness or liveness. The observed state counts apply to these model bytes;
they are not application coverage counts. Passing models and regressions do not
prove source refinement or the absence of all application errors.

Other accepted changes preserve state behavior: lookup indexing, timestamp
parsing reuse, field-set comparison, retained-journal reuse and monthly-view reuse
need output-equivalence checks; Inbox query batching needs native database and
authority-change checks. Mission-ready selection and flag-evidence character
count changes retain their existing eligibility and write gates. Their focused
implementation regressions remain required. They are not covered by the four
transition models. Broader STATE-01 through STATE-05 coverage remains separate
work and is not claimed complete here.
