# Private intake and optional GitHub handoff

`ui_intake_handoff` fills the UI transition gap left by the backend reporting
readiness model. It models `IntakeHandoff` in `SecurityBounty.tsx`: initial
checking, first failure and retry, a checked response, retained data during a
recheck, failed recheck with stale data, response expiry, and unmount.

Stored private intake and the optional GitHub link are independent. A checked
stored-intake response keeps its form available when the GitHub observation
expires. Expiry or a failed refresh hides the GitHub link without discarding
the report draft. Form visibility does not itself authorize submission; its
session, consent, backend acceptance and draft lifetimes have their own models.

The model bounds one program mount and three reads. It abstracts backend
response validation and timer duration. The timer follows the actual effect:
checked non-stale state schedules expiry; a state change clears the previous
timer. A fresh ready link has no recheck button, so a user cannot repeatedly
reset its lifetime through that control. Rechecks of a stale observation keep
the link hidden until a fresh reply arrives. Unmount clears the timer; a late
React state update cannot restore a departed view.

Existing real-browser conformance is in `tests/e2e/security-bounty.spec.ts`.
Its readiness step checks the private GitHub URL, advances the browser clock,
checks that expiry removes the link, rechecks readiness, and covers disabled
and stale provider observations. Its private-intake workflow fills an actual
draft, expires readiness, checks that all draft fields remain, and restores
the optional link after a successful check. It also accepts stored reports
when GitHub reporting is unavailable. These use the real local Pages/D1
workflow with controlled GitHub observations; they do not establish live
GitHub availability. Final combined browser results remain required.

No application change was needed for this reviewed boundary. Model passes and
source mapping do not establish mechanical React refinement or all possible
network and browser schedules.

The model has nine named scenarios. Its finite domain explores 225 distinct
states (1,644 generated, depth 7). Type checking, scenarios and 500 seeded
traces of up to 60 steps pass; final combined verification rebinds these checks
to the committed model and application source hashes.
