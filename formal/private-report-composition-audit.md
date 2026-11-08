# Private report projection and controls

Two focused models fill a composition gap in the original private-intake
models. `ui_private_report_projection` represents the displayed Slop screening,
owner routing and GitHub receipt independently. Pending owner notification
has precedence over a completed screening label, human clearance makes no
award claim, and an uncertain GitHub receipt can still require attention after
screening succeeds. Its finite input classes describe a pure projection;
backend models determine which combinations can actually be produced.

`ui_submission_controls` represents the existing SubmissionCard controls:
legacy drafts, saved reports and directly linked reports; explicit and legacy
authorization visibility; grant-required recovery; intake versus submission
revisions; request failure; and redirect lifetime. A grant redirect keeps the
controls busy until a new document is constructed. `useAction` itself is not
a programmatic mutex; disabled UI controls are the serialized caller assumed
by this model. A saved draft before redirect is distinct from a submitted or
verified GitHub report. The backend still authorizes every request.

Quint 0.33.1 checked 18 named scenarios and 500 seeded traces of at most 60
steps per model. TLC explored 25,088 projection states (depth 13) and 71,896
control states (depth 18), with empty final queues and unchanged source hashes.
The earlier control model used the reserved name `enabled` and failed type
checking; the corrected model uses `controlsReady`. No application change was
needed for that specification error.

`tests/e2e/private-report-composition.spec.ts` drives the actual built Inbox,
the report card and browser storage. It supplies controlled API responses for
independent screening/routing/GitHub outcomes, explicit authorization versus
legacy role fallback, storage refusal before redirect, grant navigation and
receipt reconciliation. The initial probe incorrectly used HTTP 403 for a
missing grant; the real handler uses HTTP 409. Its 403 correctly removed private
access, so that failed probe is not an application defect. The corrected fixture
uses the actual status. Existing private-intake browser and real-handler tests
provide separate backend/authorization evidence. No controlled response proves
live GitHub delivery, model screening quality or a payment.

Focused browser and final combined results are kept under ignored
`evidence/formal/private-report-composition/`. These are bounded models and
entry-point checks, not proof of mechanical implementation refinement.
