# Feed deadline and publication state

The hosted ban, penalty and value-history feeds have three different outcomes:
validated data can proceed to publication, unavailable data retains the last
published snapshot, and malformed complete data stops publication as an
integrity failure. `generate-leaderboard.ts` handles an unavailable feed with
exit status 75. It does not publish an empty substitute.

The full check found that Bun 1.3.14 can fulfill `Response.text()` with the
received prefix when the request deadline aborts an unfinished HTTP body. The
old reader passed that prefix to `JSON.parse`, which raised `SyntaxError`.
That made a temporary feed outage take the integrity-failure path. The same
deadline needs to cover both response headers and the complete body.

The fix retains each request's `AbortSignal` and checks it after headers and
after the body read, before parsing. The bounded history stream applies the
same check after EOF. A response that arrives after its own deadline remains
unavailable even if the transport fulfills the read. Malformed data received
before the deadline remains an integrity error.

## Evidence

A local HTTP server sent the JSON prefix `{"schemaVersion":` and left the body
open. The caller-owned deadline was shortened to 5 or 50 milliseconds for this
test; the transport passed the production request options through unchanged.
With the unmodified reader at `8bf252e58`, 14 of 200 requests raised
`SyntaxError` and 186 reported unavailable. With the corrected reader, all 200
reported unavailable. This uses native Bun HTTP requests, not a replacement
body implementation. The production deadline remains 30 seconds.

The existing local HTTP interruption and timeout checks still pass. Four
additional regressions return a response after the supplied deadline for each
public feed entry point: bans, penalties, single value history and joint work
unit history. Complete malformed JSON remains covered separately. These
regressions fix the observed late-fulfillment schedule independently of native
transport timing; they do not replace the native HTTP evidence.

`models/value_feed_deadline.qnt` models request, body, completed read,
classification and publication. Its six named scenarios and seeded simulation
pass. TLC exhausts its 14 reachable states (65 generated) without violating the
invariant: expired or malformed reads cannot replace the published snapshot.
The model abstracts payload validation to a Boolean and publication to a
revision number. It does not prove the transport implementation or every
validation rule. Exact commands, hashes and native probe output are retained
under ignored `evidence/formal/`.
