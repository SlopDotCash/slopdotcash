# Owner award and bounty-funds identity

This source-only correction starts from `a20a62ac654887608dd4077706d844ad3496ffd2`.
It changes private response ownership in `OwnerAwards.tsx` and
`OwnerBountyVault.tsx`; existing money, cutoff, revision, sequence and wallet
recovery rules remain unchanged. No tests, parsers, checks, simulations,
provers, browsers or applications were run. All seventeen new named scenarios
and five new browser regression orders are unexecuted.

## Source findings and correction

OwnerAwards cleared drafts on a 401/403 response but retained the loaded
proposal, final awards and selected private controls after a mutation failed.
An already displayed A view could remain after its next request ran under a
different or expired session. Successful responses also lacked a final actor
observation. OwnerBountyVault relied on its parent's actor key; this covered
an observed parent identity change, but not a successful response accepted for
A that arrived after a silent cookie change to B.

Both request paths now observe the actor before the private request, send the
existing expected-actor header, and observe the actor again after either
success or failure. The existing backend request guard enforces that header;
an address or button does not provide authority. OwnerAwards mutations bind
to the actor that supplied their displayed view. A read for a new actor clears
old draft values before loading that actor's data. Known access refusals clear
API-derived private state before the final session observation. Missing or
unavailable identity also clears rather than lending a cached view to a new
account.

OwnerAwards uses a mounted/request-generation guard for response, error, busy,
draft and notice updates. The read effect retains its abort controller. Its
accepted write can remain in the backend after departure; its old callback
cannot repopulate another route or instance. OwnerBountyVault retains its
effect-local active flag and tags ready data with its actor. A transient
same-actor balance failure keeps the existing child and stale balance with
deposits disabled. A missing/changed/unreadable actor does not qualify for that
retention. Ordinary same-actor balance refreshes do not unmount wallet recovery.
Stored commitment/release records are not deleted by either correction.

## Model relation and limits

`ui_owner_private_requests` separates preflight actor observation, the captured
cookie/header at dispatch, backend admission, HTTP/body completion, known
refusal, final actor observation, and publication. A cookie change before
dispatch can make the captured cookie fail the expected-actor guard. A change
after dispatch does not rewrite A's already-sent request; it may still be
accepted, while the response-time check prevents display under B. It has
two actor representatives plus sign-out, two requests, two component lifetimes,
and award/funds modes. It includes accepted writes whose owner view departed,
rejected writes after actor change, malformed body versus transient failure,
same-actor draft retention, and same-actor stale-funds retention. It does not
claim the browser detects a cookie change before a request/observation occurs.

The existing `ui_owner_awards` retains the allocation/cutoff model, and
`ui_owner_bounty_funds` retains balance/child/revision composition. Their
successful-response abstractions now require this request-identity boundary;
their older receipts do not validate the changed source. Backend monthly
models retain SQL sequence, cutoff and project-version guards; this addition
does not replace those. HTTP payload validation, real authority providers,
arbitrary actor IDs, exact amounts and native wallet behavior remain separate
conformance boundaries.

Four added orders in `tests/e2e/owner-awards.spec.ts` cover a held successful
or refused allocation reply after actor change, a same-actor outage with a
retained draft, and an accepted write whose page departed. The existing owner
fixtures now provide a signed-in project session when their private API
returns successful owner data; signed-out/refused cases remain explicit.
One added order in the existing native bounty-vault browser definition in
`tests/e2e/vault-actions.spec.ts` holds a real successful funds response and
changes the following UI session observation without navigation/focus. It
requires removal of private funds and the child. Its changed session is an
explicit presentation double, not a live identity-provider claim. Existing
same-actor transient recovery and finalized feedback assertions remain.
