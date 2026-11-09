# Local authority after remote membership

This source-only correction follows `3e48400e6`. No tests, parser, verifier,
simulation, application, browser or provider service was run. The three added
consumer regression cases and nine model scenarios are authored and
unexecuted. Earlier lease-expiry evidence in `value-precall-audit.md` describes
its historical sources; it does not validate this correction.

The post-reservation `mayCall` callback in `value-consumer.ts` checked each
source's current registry capability and local installation state, then awaited
the GitHub installation repository listing. Its final observations checked only
request and source leases. A pause, quarantine or installation suspension could
commit while that remote response was pending. If the response described the
earlier membership and leases remained live, `runStructuredRoute` could start
the first provider request despite that local revocation. The publication
fence would refuse a later journal append, but could not prevent its cost.

The callback now rereads source registration and installation state after the
remote membership response, before the existing final lease checks. A false
registry capability returns the existing `authority` block. An inactive
installation raises the existing error and the consumer retains the existing
transient `retry` outcome. Database failures still propagate; no fallback
authorizes a provider call. Reservations remain immutable and conservative.

`value-pipeline.test.ts` adds three cases to its existing real consumer,
migrated SQLite and local transport workflow. Each holds the installation
membership response after the first reservation, commits a paused revision,
an append-only quarantine, or a local suspension, verifies the processing lease
is still live, and releases the previously successful membership response. Each
requires zero provider calls, cost rows, retained results and published journal
rows. The reservation remains recorded; the request waits with `authority` for
pause/quarantine and `retry` for suspension. These cases do not invoke the
existing generated lease-expiry trace, and are not presented as executed
conformance evidence.

`bot_value_precall_authority` bounds one reserved inference, one project
capability, one installation, a request/source lease pair and at most one call.
It separates the remote wait from each local observation. Nine scenarios cover
active admission, project and installation revocation during membership,
membership failure, both lease expiries, owner expiry between the two lease
reads, and the limits of later revocation. The source-lease query also checks
the owner lease, so it refuses that intervening expiry.
Pause and quarantine share the capability-false transition; their actual SQL
paths remain distinct regression cases. The older `bot_value_pipeline` continues
to describe lease handover, retained inference and fenced journal publication.

This change does not make multiple local reads or the external send atomic.
Revocation after a successful observation may still precede the provider send;
the model explicitly permits that trace. It does not cancel a call already in
flight, erase its usage, qualify provider behavior or prove implementation
refinement. The separate terminal-attempt/free-receipt composition is not
changed by this patch.
