# Evidence transport settlement

This source-only follow-up covers TLS observation, preview fingerprint reads
and production-response disposal in the evidence recorder. No application,
browser, socket, server, test, parser or model checker ran for this change.
Only the source metadata inventories are regenerated. Documentation was read;
no production endpoint was probed. The model and native regression definitions
are unexecuted.

## Confirmed gaps and correction

The old `inspectTls` called certificate getters and `assertTlsSession` inside
the `secureConnect` callback without catching their exceptions. A rejection
could escape that event callback instead of settling the owning promise.
The old function had no early `end`/`close` settlement and resolved after calling
`socket.end`, before observing closure. Its socket inactivity timer also did not
establish a total observation deadline.

`probeProductionTls` now owns the fixed `slop.cash:443` connection, its event
handlers and one absolute timer. Getter, validation and socket errors retain
the first failure. Early end/close refuses an unverified handshake. A validated
session requests end/destruction but returns success only on observed close.
The deadline settles failure even if closure remains unconfirmed; it is not
evidence that the socket closed. A destruction failure remains an explicit
failure, with the prior error retained as cause. The guarded error listener
remains after settlement so a queued late error cannot become an unhandled
event exception or settle the promise again.

Node distinguishes the [TLS handshake event](https://nodejs.org/api/tls.html#event-secureconnect)
from certificate authorization, and its [socket timeout](https://nodejs.org/api/net.html#socketsettimeouttimeout-callback)
is an inactivity notification that does not itself close the connection.
The helper preserves the existing TLS policy checks rather than treating
either event as sufficient success.

Production redirect, HTTPS and asset-cache responses previously disposed their
bodies only on some successful paths. Header/status failures could skip
disposal, and the redirect body had no disposal path. Early Content-Length
failure similarly bypassed the reader. Oversize-body cancellation could replace
the original size error.

`withEvidenceResponse` now uses `withEvidenceCleanup` to await body cancellation
after either operation outcome. `readEvidenceResponseBytes` separately owns
the reader lock and releases it after either outcome; its caller retains body
ownership. The exact-artifact wrapper still checks declared/actual size and
digest. Reader release occurs before body disposal, and cleanup errors cannot
erase the original rejection. Node documents [cancellation as a promise](https://nodejs.org/api/webstreams.html#readablestreamcancelreason)
and [reader-lock release](https://nodejs.org/api/webstreams.html#readablestreamdefaultreaderreleaselock)
as separate operations.

## Source map

| Source | Modeled boundary |
| --- | --- |
| `evidence-contract.mjs` `probeProductionTls` | Connection creation, secure-event validation, early end/close, socket error, destruction request/error, absolute deadline, observed closure and one settlement |
| `evidence-contract.mjs` `withEvidenceResponse` | Response ownership survives validation failure; cancellation is independently awaited and may fail |
| `evidence-contract.mjs` `readEvidenceResponseBytes` | Bounded chunks, EOF/read failure, separate lock release and caller-owned cancellation |
| `evidence-contract.mjs` `readExactResponseBytes`, `verifyRemoteArtifacts` | Status/type/declared-size refusal before reads; actual-size/digest refusal after reads; no result before response cleanup |
| `record-evidence.mjs` `waitForServer` | The preview fingerprint uses the same bounded reader and response disposal; its existing fetch retry and fingerprint check remain |
| `record-evidence.mjs` `inspectProductionNetwork` | Fixed TLS probe followed by independently disposed redirect, HTTPS and asset observations |

`evidence_capture` retains the outer validated-capture/publication contract.
The new model describes the previously abstract transport inputs, not a full
mechanical composition proof for the recorder or its browser session.

## Bounds and authored evidence

`evidence_transport` has 21 named scenarios, one TLS observation, one HTTP
response, a two-unit body bound and at most three chunks. TLS failure may settle
before physical closure; success requires both valid metadata and observed
closure. The clock has one deadline crossing and incoming activity cannot reset
it. The response model distinguishes header-only, bounded and exact readers,
body/lock ownership, primary rejection, cleanup errors and the final outcome.
It keeps reader-cleanup failure separate from exact-length validation that
would not execute after that failure.

`scripts/evidence-transport.test.ts` has 25 native definitions. TLS tests use an
in-process `EventEmitter` fixture, with close explicitly held for the positive
case; no real connector runs. They cover the fixed destination, getter/policy
errors, early end/close, transport errors, absolute deadline under activity,
unconfirmed closure, destruction failure and the first failure surviving the
deadline. Response tests use native `Response`/`ReadableStream` objects and
injected fetch results. They cover disposal on success/rejection, cancellation
errors, reader release before cancellation, bounded/short/oversize/read-error
paths, missing bodies and actual artifact status/type/length verification.

The absolute deadline covers the TLS probe only, not DNS resolution or the
entire recorder. These fixtures do not prove native TLS handshake/certificate behavior, real
network timeout scheduling, DNS completion, host identity, or production
availability. The finite model has no temporal liveness theorem. Arbitrary
injected read/cancel promises can remain pending; the response helpers await
them and do not add another deadline to those promises. The actual recorder
retains its existing fetch abort signals. HTTP parser/crypto correctness,
all native stream failure variants and the complete preview retry loop are
outside this model. Those limits do not permit a failed or unsettled transport
operation to publish successful evidence.
