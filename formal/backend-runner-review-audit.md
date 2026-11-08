# Backend and runner model review

Review of the model changes based on `d6323d9f` found invalid scenario chains
in the mail, binding-veto, cancellation and integration models. In Quint,
`action.fail()` checks refusal but does not assign the next state. A later
transition therefore failed with `Variable s not set`. The repaired scenarios
end at the refused action. Separate scenarios exercise the subsequent valid
recovery or completion path. No refusal guard was removed.

The integration model also records the first nonzero result. An ordinary
failure followed by a signal remains a failure, as in the shared cancellation
helper. A signal that arrives first remains the result while cleanup drains.
This is a source-conformance model; the model run does not execute processes.

On 2026-11-08, Quint 0.33.1 passed type checks, all 66 named scenarios and
simulation for these six models. Each simulation used seed `20261107`, 500
traces and at most 60 transitions per trace. Scenario sampling used a maximum
of 100 samples. Local Apalache 0.62.4 and Java 21 then passed exhaustive finite
TLC checks of each `invariant`:

| Model | Generated states | Distinct states |
| --- | ---: | ---: |
| `api_mail_delivery` | 6,953 | 1,338 |
| `api_private_authorization` | 26,924 | 3,878 |
| `api_trace` | 661 | 126 |
| `binding_veto_policy` | 19,588,457 | 4,229,348 |
| `runner_cancellation` | 21,875 | 1,500 |
| `integration_pipeline` | 116 | 43 |

Every TLC queue was empty at completion. The check runner recorded unchanged
inputs for each invocation. The finite domains include one mail item and five
attempts; two authorization identities with clock ticks 0 through 6; the
abstract trace lifecycle; eight binding versions, two awards and ticks 0
through 3; three cancellation jobs with at most two active; and three sequential
integration drivers. These checks do not cover arbitrary domain sizes.

TLC disables deadlock checking. The named scenarios cover explicit refusal and
completion paths, but they do not prove liveness, source refinement, real
provider delivery, or operating-system cleanup. No application end-to-end or
native acceptance result is claimed by this model-only review. The combined
branch must refresh its source inventory and run the required checks against
its final source hashes.
