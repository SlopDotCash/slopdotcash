# PR2252 report revision guard

This integration reuses the focused guard and two regression cases from
[PR2252](https://github.com/SlopDotCash/slopdotcash/pull/2252), authored by
**dd12m54**, source commit
`2b09462c6a2cf0840f887428a9d75095fcb92ae7` on
`dd12m54/slopdotcash:slop-1105-s1i-forward-revise`. GitHub metadata and the exact
patch were read on 7 November 2026. The source PR remains open; no author was
contacted. Preserve the original commit's author when integrating it.

The current-development reproduction confirmed both failures: the reporter's
view retained `canRevise: true` after a maintainer forwarded a spam or
needs-information screen, and POSTing a replacement report returned 200.
Both expected refusal cases failed before the guard.

The reused condition requires no existing human decision before a raw held
screen enables revision. A human request for information, including a case
owner request, still permits revision. The current atomic case/intake CAS,
immutable report-version event and object-store boundary remain in place.
`api_report_forward_revision` models the guard and reopening rules; the
existing case-transaction model and tests cover the atomic write sequence.

The original authored commit was cherry-picked as `eb1b8283e`, after the
reproduction and focused before/after checks. Both regression cases pass, and
the combined report-intake, case, submission and notification suites passed
186 tests. The temporary patch and detailed logs remain local evidence.
