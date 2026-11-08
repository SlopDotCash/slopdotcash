# Reproduced discrepancies

This index lists implementation defects corrected by the current-development
review. The area audits give the bounds, before/after evidence and model links.
The tests below use application entry points, real local databases or browser
flows as appropriate. A local provider fixture does not establish live service
availability. The full combined validation is still in progress; this is not a
claim that all application state errors have been eliminated.

| Boundary | Incorrect transition | Corrected behavior / regression |
| --- | --- | --- |
| Account closure | Retained closed membership still authorized member-only bot behavior | Require active membership while retaining history; `workers/slopbot/closure-eligibility.test.ts` |
| Identity expiry | Delayed OAuth completion or persistence outlived its authorization | Check expiry at completion and persistence; `workers/identity/expiry-boundary.test.ts` |
| Local migrations | Schema commit could survive without its migration marker | Schema, foreign-key check and marker commit together; `scripts/dev-migrations.test.ts` |
| Independent API configuration | Malformed payment configuration broke unrelated account requests | Parse payment configuration at the payment boundary; `scripts/api-config-isolation.test.ts` |
| Bot source context | Review context could use content inconsistent with its claimed Git blob | Verify content before inclusion; `workers/slopbot/value-context-integrity.test.ts` |
| Usage uncertainty | A later known cost erased an earlier unknown cost | Preserve unknown aggregate cost; `workers/vetting/review-plan.test.ts` |
| Publication authority | A pause or quarantine could occur after the last read but before insertion | Check current policy in the insert transaction; `workers/slopbot/value-publication-fence.test.ts` |
| Publication lease | A worker could publish after losing its processing or source lease | Check token and lease at database execution time; `workers/slopbot/value-pipeline.test.ts` |
| Stream completion | Cancellation during a pending completion write recorded two terminal outcomes | Record one terminal outcome; `scripts/vetting-api.test.ts` |
| Stream authority | Sign-out during an object read could still release the bytes | Recheck live session and actor before each part and before enqueue; `scripts/vetting-api.test.ts` |
| Evidence registration | Competing identical registrations could turn a successful write into an internal error | Read back the atomic winner, accepting identity and refusing conflict; `scripts/vetting-api.test.ts` |
| Private report revision | A decision based on an old report could succeed after the report changed | Advance case and report revisions together; `backend/security/report-intake.test.ts` |
| Session response | An incomplete session object was accepted as authenticated | Validate the identity fields; `tests/e2e/ui-state-boundaries.spec.ts` |
| Session return | Admin or owner controls retained an earlier tab's authority | Revalidate on focus, visible return and page restore, fencing older replies; `tests/e2e/ui-session-focus.spec.ts` |
| Passive deadlines | Freshness, wallet registration and award review could remain open without user input | Refresh at the deadline, including a late passive effect; `tests/e2e/ui-state-boundaries.spec.ts` |
| Calendar transitions | Review, recovery and monthly views could retain earlier time labels | Refresh the relevant deadline or UTC calendar boundary; `tests/e2e/ui-clock-transitions.spec.ts` |
| Discarded image | A late bitmap could restore and persist a discarded draft | Invalidate the departed decode and close its bitmap; `tests/e2e/project-save.spec.ts` |
| Published cycle | An unpaid state could display a paid timestamp and settlement file | Refuse the contradictory public record; `tests/e2e/ui-state-boundaries.spec.ts` |
| Payout exclusion identity | Two node-ID encodings for one actor could overlap inconsistently | Compare the validated numeric actor identity; `scripts/project-self-service.test.ts` |
| Token metadata network | A wrong-network Solana RPC could admit mainnet-labeled metadata | Verify genesis before mint metadata; `scripts/project-registry-api.test.ts` |
| Readiness evidence | Empty EVM finality data or invalid Solana slots could look ready | Require the actual finalized shape and safe integer slot; `scripts/payout-readiness-proof.test.ts` |
| Payment successor | A stale failure update reopened a newly submitted successor | Refuse reopening while any active attempt remains; `workers/payments/reconcile.integration.ts` |
| Gas cost parsing | Scientific notation could understate gas and admit an uneconomic quote | Parse supported decimal notation exactly; `workers/fee-converter/fee-converter.test.ts` |
| Fee-wallet handoff | An old wallet's valid conversion could be finalized with zero output | Keep the retained wallet binding and hold incompatible configuration; `workers/fee-converter/native-gas.test.ts` |
| Missing receipt | An advanced nonce alone could permanently fail a successful conversion | Hold until canonical receipt evidence identifies the outcome; `workers/fee-converter/native-gas.test.ts` |
| GitHub pagination | A repeated cursor could spend requests without making progress | Refuse the repeated cursor; `scripts/leaderboard-search-slices.test.ts` |
| Development shutdown | A delayed health failure could spawn a child after server closure | Fence child startup after shutdown; `scripts/dev-backend-lifecycle.test.ts` |
| Main branch CI | An empty PR file list could select only smoke checks on a main push | Require full checks for that release path; `scripts/ci-scope.test.ts` |
| Formal evidence | An unchanged model could pass while its mapped source changed | Bind and recheck source hashes; `scripts/formal-source-binding.test.ts` |
| Historical Points | A later explicit zero could be undone by retained-history recovery | Record the maintainer's zero as an explicit provenance decision; `scripts/points-import.test.ts` |
| Forwarded report | A reporter could erase a maintainer's forward decision by revising a held report | Close that revision window until an authorized request for information; `backend/security/report-intake.test.ts` |
| Payout presentation | Attempt uncertainty hid a held queue and suggested progress without a wallet or owner commitment | Preserve queue precedence and show the required next action; `backend/security/handler.test.ts` |
| Payout hold recovery | A cron pre-step could reopen a hold while an old wallet attempt was still active | Keep the hold until the prior attempt is retired; `backend/security/handler.test.ts` |
| Attempt history | Equal timestamps could select a retired attempt, and a new attempt without a hash could hide an earlier submitted transaction | Use append order to break ties and retain the most recent known transaction; `backend/security/handler.test.ts` |

The forwarded-report and payout corrections reuse
[PR 2252](https://github.com/SlopDotCash/slopdotcash/pull/2252) and
[PR 2313](https://github.com/SlopDotCash/slopdotcash/pull/2313), including their
original commits and authors. Their regressions were reproduced against the
combined application before integration. The later integration also preserves
the account, recovery and calculation changes merged by
[PR 2403](https://github.com/SlopDotCash/slopdotcash/pull/2403).

Additional local-tool fixes keep Wrangler's update request from hanging test
setup, serve deterministic local avatar fixtures, and exclude generated native
validator/dependency trees from the proof source walk while still refusing
symbolic links in actual source. See `docs/lemmascript-validation.md`.

The source inventory and area audits also include reviewed transitions that
needed no implementation change. They remain bounded abstractions unless an
audit explicitly supplies stronger conformance evidence.
