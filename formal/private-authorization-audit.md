# Private authorization model review

Source-only update at `120c7a22` corrects the callback and expiry projection.
`completeAuthorization` can accept a callback without the SameSite=Strict site
cookie, but binds the new encrypted grant to the original flow session. A
present callback account and the provider identity must still match the
original actor. `readGrant` independently checks the current session, actor,
submission and the newly issued grant lifetime. The flow and grant have
separate expiry windows; reading a grant does not consume it. These revisions
were **not checked or tested**, following the user instruction to skip checks
and focus on pushing. The evidence below applies only to the earlier model
revision and must not be read as validation of this update. See
[the source-only review](backend-source-review.md).

The prior `api_private_authorization` invariant required only a grant to exist
when it was used. Removing its session-binding guard still passed. The model
now records the session, actor, submission and time at each successful use,
then checks those recorded values against the grant binding. A later session
change does not invalidate an earlier authorized use. Four refusal scenarios
exercise a new session for the same actor, a changed actor, another submission
and expiry. These identity classes and a three-tick expiry are finite
abstractions of `readGrant`; they do not model cryptography or live OAuth.

`api_private_case_roles` complements the existing case lifecycle model. It
models the role projection and selected guarded actions from `caseRoles`,
`readCase` and `allowedActions`. Its six actor classes are a stranger, reporter,
program maintainer, financial approver, moderator and assigned triager. It
checks reporter precedence over program roles, financial visibility after an
award, moderator visibility only during review, revocation, decision authority,
related-party review and payment preparation. It does not replace the lifecycle
model's detailed award, receipt, disclosure or payment conditions. A read records
the roles and conditions at the time of that read; later revocation cannot
retroactively change an earlier access result.

On the reviewed model bytes, Quint 0.33.1 passed all 21 named scenarios and
500 seeded traces of at most 60 steps per model (`seed=20261107`). TLC explored
634 distinct grant states at depth 11 and 944 distinct case-role states at
depth 9, both with an empty final queue. The pinned local translator and Java 21
were used. TLC deadlock checking remains disabled by the upstream backend.

Eight targeted mutations failed their named scenarios: removal of each grant
session, actor, submission or expiry guard; removal of the private-case read
boundary or maintainer decision boundary; and premature finance or moderator
access. The actual submission-handler regression for missing, tampered, expired
and rebound grants also passed. These checks show that the stated boundaries
are exercised; they are not a proof of complete model-to-source refinement.
The role-handler matrix in `backend/security/handler.test.ts` supplies separate
implementation evidence for case access and action authority.

Receipts, mutation outputs and command logs are kept outside the source tree.
They are local checks, not live GitHub, deployment or chain acceptance evidence.
