# Backend source-only review at 120c7a22

This bounded review followed the instruction to skip checks and focus on
pushing. No tests, formal checkers, browsers or native workflows ran. The
three edited models are **unvalidated source-review revisions**. Earlier
model results do not validate these bytes. There are no application changes.

## Corrected model projections

| Model | Source reasoning | Correction |
| --- | --- | --- |
| `api_trace` | `backend/trace/handler.ts` matches contributor writes, safe wallet metadata and explicit wallet recovery. It has no trace-body or trace-grant route. An unmatched route returns 404 before authorization. `backend/trace/README.md` records removal of the old operator routes; migrations retain historical grant/audit rows. | Remove live grant issuance and body-read actions. Model refused removed-route requests, zero body disclosure and preservation of historical state. The upload/attachment/finalization projection stays as before. |
| `api_private_authorization` | `backend/security/intake-grant.ts::completeAuthorization` validates the encrypted ten-minute flow, state/code and provider account. A cross-site callback can have no site session. Any supplied account must match, but the resulting grant remains bound to the original session. `readGrant` checks that binding and the separate two-hour grant expiry. It does not consume the grant. | Add cookie-less callbacks, present-account refusal, original-session use checks after callback, signout, separate abstract flow/grant clocks and repeated reads. The finite projection uses one authorization, two identities and a six-tick clock; it does not preserve the real duration ratio or model crypto. |
| `api_mail_delivery` | `workers/notify/activity.ts` and `security.ts` resolve recipient authority and consent before awaiting destination persistence and, where applicable, unsubscribe-token creation. `sendEmail` uses that prepared destination. A later revocation does not cancel an already prepared attempt. A thrown send is a provider call with uncertain acceptance. | Add a separate preparation snapshot, preserve suppression when denial is observed before preparation, show the in-flight revocation boundary, and count uncertain sends as calls. No stronger cancellation guarantee is claimed. |

The mail projection describes existing source ordering. This review did not
establish that ordering as a product defect or approve a new cancellation
policy. The model must not imply that a preference update can retract an
external call already being prepared or sent. A stronger boundary needs a
separate specified linearization point and real concurrent-handler evidence.
The model records the consent and authority observed during preparation, so
its invariant can distinguish authorized preparation from later revocation.
The two pre-preparation refusal scenarios and that historical observation
invariant are authored but have not been executed in this source-only review.

## Other boundaries inspected

- Private case reads in `backend/security/handler.ts::readCase` authenticate,
  calculate current roles, persist the read audit, then return the case. The
  list path calculates visibility and persists its read-audit batch before
  returning any cases. `project-access.ts` checks the live repository identity,
  installation and steward/admin role. Existing `api_private_case_roles` models
  the role snapshot, not every async revocation interleaving.
- The intake grant does not itself prove a site session is still active.
  Submission handlers obtain the current authenticated actor before calling
  `readGrant`; its encrypted session binding then prevents a different session
  or submission from using the cookie. The corrected model covers that
  composition at its stated finite boundary.
- `backend/trace/cloudflare-persistence.ts` batches wallet claim insertion,
  audit insertion and notification insertion. Existing notification delivery
  and escalation models separately cover durable retries and reconciliation;
  this review did not rerun their implementation evidence.
- Vetting evidence grants and streaming session revocation are different from
  retired contribution-trace read routes. Their existing
  `vetting_evidence_access` and `vetting_stream_authority` models were not
  merged with the trace model.

This is not a fresh exhaustive backend audit, implementation-refinement proof,
or evidence that all state errors are absent. It corrects three concrete
source/model disagreements and preserves the remaining async authority and
provider boundaries explicitly.
