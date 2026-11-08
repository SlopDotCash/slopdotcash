# Public X profile link

This source-only addition starts from `438a20e47`. It models the existing public
X link; it adds no connection, disconnect, visibility, or account controls.
No test, parser, checker, simulator, prover, browser, or application was run.
All eighteen named scenarios in `ui_public_x_profile.qnt` are unexecuted.

## Source and transition mapping

| Source | Reviewed transition |
| --- | --- |
| `src/Points.tsx`, `PublicXLink` | Start a public read when `actorId` changes; reset account/error in the effect; suppress the read outside the product origin; accept null or validated identity; show the existing unavailable text on a non-aborted failure; abort on effect cleanup. |
| `src/Points.tsx`, `xAccount` and `XAccountLink` | Reject an invalid ID, username, or date; render a numeric X user-ID URL and visible username only for an account; open a separate tab with `noreferrer`. The same pure link renderer is also used by People. |
| `src/Points.tsx`, `ProfilePoints` | Supply the actor from the matching Points member, accepted membership identity, or recorded contributor. The model starts with this resolved actor; it does not invent identity from a typed login. |
| `src/ProfilePage.tsx` | Both profile layouts key `ProfilePoints` by the normalized login and pass the resolved actor ID. Unresolved or unavailable contributor states do not render this public link subtree. |
| `src/App.tsx` | Key `ProfilePage` by `route.login.toLowerCase()`. A different normalized profile key creates a different component lifetime; a case-only change does not imply that replacement. |
| `backend/points/x.ts`, GET `/api/v1/points/x/profile` | Validate the requested actor shape, then observe the joined link/member row only when both public flags are 1. Missing rows and either nonpublic row produce the null result. This read does not require or infer the viewer's session. |

The model separates a database observation from delivery of its result.
`publication` represents an external change to the rows read by that SELECT;
it does not authorize that write or duplicate the OAuth lifecycle modeled in
`api_x_connection.qnt`. A link or membership hidden after the observation does
not revoke the already observed response. A displayed public link also has no
visibility subscription or timer. The next actual query can observe the new
state; changing the viewer account alone does not trigger this effect.

Loading, a missing public link, and a query suppressed outside the product
origin all render no X element. They remain distinct model states. Failure
renders `X link unavailable`; there is no dedicated retry button. Remounting
or changing the actor prop can cause another read. Successful account data
has render priority over the `failed` flag, exactly as in the component.

## Callback and lifetime boundaries

The success handler is `.then((v) => setAccount(v ? xAccount(v) : null))`.
It has no abort, actor, or mounted check. The failure handler checks the
effect's abort signal before setting `failed`. The model preserves that
asymmetry rather than borrowing the guards from other public-resource hooks.

An aborted transport can reject without publishing an error. If successful
fetch/JSON completion is already queued when cleanup happens, the success
callback can still target its original state setter. A departed instance's
state is separate from the replacement instance and cannot set its account.
The model represents that old setter write as state on the detached instance;
it does not claim React commits that state or renders a departed component.

If an actor prop changes within one component lifetime, its passive effect
first schedules cleanup and a reset. An old success callback can then overwrite
that same instance, including with null after the new actor has loaded. The
model deliberately admits these orders. Ordinary navigation to a different
normalized profile key remounts the outer subtree; that route alone does not
establish the same-instance order. This source pass did not establish a new
runtime defect or authorize a production change. It makes no invariant claim
that every displayed account must equal the latest actor prop.

## Bounds and evidence

There are two actor representatives, two component lifetimes, two reads, one
product/preview-origin choice, and five publication classes: public, missing
link, missing member, private link, and private member. The viewer can be
signed out or one of two accounts but does not authorize the public SELECT.
The model records whether each non-null result was public at its query
observation. It does not assert instantaneous erasure after a later privacy
change. The two reads bound the explored history, not application retries.

Transport errors, HTTP refusals, bounded JSON failures, and timeouts share the
request-error control outcome. Malformed account validation has a separate
queued-success-then-error transition. The exact 15-second deadline, byte
limits, actor/username regular expressions, timestamp parsing, browser event
scheduling, and X destination behavior are external predicates or runtime
boundaries. The synthetic actor integer stands for the immutable numeric X
ID returned for that queried actor, not its username. The string formatter,
`encodeURIComponent`, title date slice, and `noreferrer` attributes are source
reviewed here, not theorem-proved.

The model does not replace the People pagination/member validation models,
the contributor identity resolver, the broader profile loading model, or
`api_x_connection`'s consent, callback, and retained-claim lifecycle. Source
annotations identify these exact slices, not complete coverage of those files.

`tests/e2e/points-social.spec.ts` already defines a built-page workflow with
explicit provider/member doubles. It checks the People and profile X link,
historical participation Points, and absence of private X control requests.
That definition is useful existing UI conformance coverage, not real provider
or database evidence, and was not run here. It does not test delayed null or
success callbacks, same-instance actor replacement, or a privacy change after
the SQL observation. Those eighteen modeled scenarios have no new runtime
acceptance claim in this addition.
