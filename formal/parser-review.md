# Remaining client parser review

The following were read after the initial frontend review. Each mapping is an
abstraction of the stated contract, not a claim that every string parser or
nested schema branch is formally proved.

| Source | Finding and scope |
| --- | --- |
| `project-policy.mjs` | Immutable project/repository identity, append-only funding route rotation, unchanged closed history, current terms revision and receipt binding. `ui_project_policy` models the prefix, successor and authority/receipt gates. Escrow and security-bounty transitions call their owning domain validators. |
| `project-schema.mjs` | Complete source reviewed: exact project keys, bounded contribution text, skills and registry uniqueness, legal/receipt states, reward and asset consistency, restricted/retired state, private/public vault separation. `ui_project_policy` covers the lifecycle subset. Full regex, every nested legal field and numeric range are not encoded in that model. |
| `project-revision-changes.ts` | Read-only classification of presentation, executable, financial and restricted fields; fixed identity/repository/skill fields stay outside owner self-service. Executable digest excludes presentation and retains all skill inputs. |
| `project-proposal.ts` | Pure URL/repository/slug/amount transforms plus deadline-bound lookup requests. Custom-token precision is deferred to server verification and zero is not misreported as committed funding. Caller cancellation is covered by `ui_project_setup`; transport failure by `ui_transport`. |
| `project-image.mjs` | Pure bounded data URL/type signature check. Browser decoding and re-encoding belongs to `ProjectImageField`; it does not upload the original bytes. |
| `repositories.mjs` | Current active projects alone become collection targets; historical rows remain available for immutable lookup; primary position follows active order. Authority is deliberately independent of collection status. |
| `funding-reminders.ts` | Pure reminder predicate over validated lifecycle/time/amount inputs. It never promotes a cycle record into verified funding. |
| `notifications.ts` | Pure shape and recipient/cursor validation, known event kind/label mappings, distinct read/acknowledged/email delivery fields. Browser actor checks remain in Inbox and SecurityInbox. Same-site action path validation is a minimal lexical check; all current writers construct internal paths. Full arbitrary-path normalization is not proved. |
| `incomplete-assessments.ts` | Pure bounded private queue parsing; identity matching is enforced by notification/Inbox consumers. No detail body or authority mutation. |

A verified-project schema can syntactically name a proof policy revision apart
from the current terms. The actual initial creation path starts unverified and
subsequent authority changes use `assertProjectPolicyTransition`, which rejects
that mismatch. No admitted current API bypass was found. Direct historical
verified-import equivalence remains a pending refinement, not a confirmed
production defect.


## Final helper sweep

Reviewed the remaining assigned browser helpers: deployment/browser origins;
commit-author eligibility; static contribution labels; external URL/archive
canonicalization; GitHub actor/work identity; home project filters; historical
versus runtime registry construction; record primitives; security draft copying;
and vetting type declarations. `frontend-review.json` now explicitly records
each of those files. Pure functions/types have stateless reasons. Registry
construction and the one-time local-origin initialization link to `ui_boot`.

The payout exclusion validator used node IDs as its overlap key, while the
payment lookup used numeric actor IDs. GitHub's legacy and modern encodings of
one actor could therefore enter overlapping, contradictory exclusion rows.
The real owner and admin revision APIs accepted that payload. The validator now
keys overlap checks by the already-validated numeric actor ID. A real API
regression and the monthly allocation workflow pass (31 tests, 618 assertions).
`ui_exclusion_identity` covers alias collision, adjacent intervals and distinct
actors. This does not rewrite any historical entry or alter public Points.
