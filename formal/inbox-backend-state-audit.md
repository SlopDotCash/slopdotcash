# Inbox publication, queries and read marking

This is a source-only refinement of the existing Inbox state requirements in
PRD section 12 and notification behavior in section 9. No runtime defect was
confirmed in the reviewed paths, so application code and executable tests are
unchanged. No test, parser, model checker, formatter, application or service ran
for this work. The scenarios below are authored and unexecuted. Source-metadata
generation, when authorized, is separate from behavioral validation.

## Corrected abstraction

The prior `api_inbox` model had one notice, an unconditional email outbox and
an acknowledgment action. Its moderator flag did not constrain an operation.
That omitted the actual recipient and role filters, source replay, keyset
boundary, independent queries and atomic read update.

The replacement keeps the original `independentReadTest` and `replayTest`
names, but no longer claims that every notice queues email. The notification
migration enqueues ordinary mail only for enabled preferences or an essential
wallet notice; private security mail has separate rules. Acknowledgment is a
security-case API operation, not an effect of `/notifications/read`. Existing
delivery, escalation and security models retain those responsibilities.

`api_inbox` now describes source/notice publication, replay and the small
review-link access boundary. `inbox_queries` describes the two SELECT results.
`inbox_mark_read` describes the one UPDATE and its response. These are separate
finite models, not a mechanically composed whole-system proof.

## Source map

| Source | Modeled boundary |
| --- | --- |
| [`events.ts`](../backend/notifications/events.ts), `INSERT`, `ONCE` and source-specific SELECTs | Source-linked eligible audience, atomic publication assumption and deduplication by event/recipient |
| [`0079_slopbot_scam_review_notifications.sql`](../migrations/0079_slopbot_scam_review_notifications.sql), notification key/read/no-delete rules | Stable row identity and payload; only the first read transition changes a retained notice |
| [`handler.ts`](../backend/notifications/handler.ts), `handleNotificationsApi` route/method/origin checks and `requireActor` call | Rejected admission produces no notification query or update; successful requests capture actor and moderator status |
| Review-link branches | Captured moderator role, own notice, joined source/independence predicate and validated GitHub target before redirect; database/stored-target failures remain errors |
| Listing branch `Promise.all` | Independent page and global-unread observations; a failed SELECT cannot produce a successful partial response |
| Page SELECT and `nextCursor` construction | Raw text order `source_at DESC, event_key ASC`, strict continuation predicate, limit plus one, last returned row as next boundary |
| Page/count/mark visibility predicates | Own rows; moderator-only appeal/scam rows; exception for a Points-dispute appellant's own notice |
| Read-time appeal-kind CASE | Resolved display kind sampled by the page query; stored kind still controls visibility |
| Read UPDATE and `meta.changes` check | One atomic filtered update, first read timestamp, exact newly changed count and possible failure after commit |
| [`notifications.ts`](../src/lib/notifications.ts), `notificationCursor`, `parseNotificationsResponse` | Cursor and envelope validation are input predicates; no requirement equates a page's unread rows with the independent global count |

Cloudflare documents [`batch`](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
as a transactional sequence with rollback on statement failure. The publication
model relies on writers keeping their notice statement in the source change's
batch; it does not re-prove every source-specific SQL eligibility predicate.
The list handler uses two plain queries rather than a batch or `withSession`.
The [D1 replication documentation](https://developers.cloudflare.com/d1/best-practices/read-replication/)
states that plain queries use the primary unless the Sessions API is used.
This model allows intervening writes between the SELECT observations; it does
not invent replica lag or an atomic snapshot for the pair.

## Query and authority distinctions

The page selects at most 100 rows after one extra lookahead row. Its continuation
uses the immutable last returned `(source_at, event_key)` pair. A new row above
that boundary does not shift the continuation page. A later inserted row below
the boundary can appear there: this is keyset pagination, not a frozen inbox
snapshot. A valid cursor need not identify a currently stored row, and it never
grants access to a different recipient's rows.

Timestamp ranks in the finite model stand for SQL text ordering. The actual
cursor parser accepts `Date.parse`-able strings, not only canonical UTC ISO
strings. The model does not prove lexical/chronological equivalence for every
accepted encoding, parser completeness, collation behavior or arbitrary text.

Page and count may observe different read/insert states. A page can show a row
as unread while the later count is zero; the count can also precede a mark that
the page observes. An empty older page, or an empty page observed before an
insert, can accompany a nonzero global unread count. None of these results
alone means the whole inbox is empty, and none is modeled as a runtime defect.
The existing UI copy and API snapshot behavior are unchanged.

The actor and moderator flag are captured for each request. Revocation affects
a subsequent request; it does not retroactively replace the captured role in
an in-flight SELECT or UPDATE. A Points-dispute appellant's own receipt remains
visible and markable without the moderator flag. A resolved display kind does
not turn a hidden stored review row into an ordinary visible row. Backend
commit authority remains separate from browser generation/session observations.

The read UPDATE matches recipient, allowed kind, requested event key and
`read_at IS NULL` together. Competing marks cannot replace the first timestamp.
A successful replay reports zero new changes. A failed statement leaves no
partial multi-row mark; a committed update followed by lost response or missing
change metadata is different. It remains read, and retry may report zero. The
model never treats the failed response as proof that the update did not occur.

## Bounds and existing evidence

| Model | Finite bound | Named scenarios |
| --- | --- | ---: |
| [`api_inbox`](models/api_inbox.qnt) | Two source events, two recipients/four row identities, three publication attempts, one review-link request | 13 |
| [`inbox_queries`](models/inbox_queries.qnt) | Five rows, two actors, three text ranks with tie keys, two sequential list requests, page limit two plus lookahead | 18 |
| [`inbox_mark_read`](models/inbox_mark_read.qnt) | Four rows including a shared event key across two recipients, two actors, two mark attempts and distinct timestamp markers | 17 |

The query model permits one list in flight, with inserts, resolution and marks
between its independent observations. A failed peer query can still complete
internally, but cannot revive the response. For bounded retries, both earlier
query branches are drained before a new list starts; overlapping list requests
belong to the separate UI request-ownership models. Selected page membership
and its last-row cursor are explicit; the returned array representation is not.
The mark model abstracts
the production 100-key maximum with two keys and an explicit three-key refusal.
Malformed JSON, duplicate keys, method, origin and expected-actor rejection
are classified inputs, not a proof of their parsers. Review-link source and
target predicates abstract the distinct appeal/scam joins and path validation;
the model does not claim every malformed stored target has the same HTTP code.

Existing [`notifications.test.ts`](../backend/notifications/notifications.test.ts)
definitions cover migrated source-event replay, immutable/read-once/no-delete
rules, tied-time pagination with later arrivals, recipient identity, read replay,
expected-actor refusal and moderator revocation on list/open/mark. Existing
[`exception-events.test.ts`](../backend/notifications/exception-events.test.ts)
definitions cover other source-specific event eligibility. The existing
[`mark-read.workflow.mjs`](../backend/notifications/mark-read.workflow.mjs)
definition uses the real handler and migrated native D1 boundary for 100 keys,
replay, hidden/foreign notices, duplicate keys and over-limit refusal. These
are source references, not new executions or claims of a passing current run.

Mail consent, destinations, send attempts, security acknowledgment, incomplete
assessments, private report bodies, UI publication and cancellation stay in
their existing models. No liveness, arbitrary-size database, provider delivery,
native D1 execution or full backend-to-browser refinement theorem is claimed.
