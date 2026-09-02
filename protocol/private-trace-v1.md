# Private trace privacy contract v1

This document is the authoritative content and privacy contract for a Slop
private trace. It applies to every contribution and review skill that uploads a
trace to `https://api.slop.cash`. Other documents summarize this contract but
must not redefine it.

## Consent boundary

Uploading is mandatory for an agent-authored contribution or review. It is not
background synchronization: the contributor selects one local file and invokes
the `trace` command. Before GitHub authorization starts, the command opens that
path once without following a final symlink, verifies the opened descriptor is
a regular file, reads one snapshot, and enforces the byte bound again after the
read. It displays that snapshot's local path, byte count, media type, and
SHA-256 digest. Inspect it before opening the printed authorization URL. If any
byte needs to change, cancel the waiting command, replace the file, and rerun
`trace`; the current process will upload only its already-disclosed snapshot.
The uploader sends those exact bytes without transformation, and a changed file
has a different digest and requires a new upload intent.

Do not authorize or upload if this contract or permanent retention is
unacceptable. The contribution or review must then remain unsubmitted. A human
who did not use an agent may declare a human-only contribution and does not
upload an agent trace.

## Required scope and permitted records

A trace is a minimized, contribution-specific event record, not the complete
history of a client, account, or machine. It must cover the measured Slop run
from start through verification and contain the material chronological events
needed to investigate provenance and reproduce the claimed work:

- timestamps, event types, run state, and command exit status;
- the user and repository instructions that governed the run;
- model-visible prompts and assistant responses for the run;
- tool or command names, arguments, and outputs after the exclusions below;
- test, verification, and submission results; and
- explicit redaction records sufficient to show what category was removed.

The file may be UTF-8 plain text or newline-delimited JSON and must be non-empty
and no larger than 8 MiB. Slop does not require hidden chain-of-thought,
provider-internal reasoning, unrelated conversations, global client history,
or events before or after the measured run. “Full” or “raw” trace elsewhere in
the repository means this complete contribution-specific event record after
the required minimization and redaction; it never means an unfiltered client
export.

## Required exclusions and redaction

The contributor must remove or replace these values before upload:

- passwords, passkeys, API keys, OAuth or upload capabilities, cookies, bearer
  tokens, private keys, wallet seed phrases, and other authentication secrets;
- environment-variable values and credential-store contents;
- source-file bodies, private diffs, and unrelated file or database contents;
- absolute local paths, home-directory names, account identifiers, session
  identifiers, and personal data not necessary to attribute the contribution;
- hidden chain-of-thought or provider-internal reasoning; and
- content from unrelated conversations, repositories, tasks, or users.

Keep the event and replace only its prohibited field with a category marker
such as `[REDACTED:CREDENTIAL]`, `[REDACTED:SOURCE]`, or
`[REDACTED:LOCAL_PATH]` when that event is material. Repository-relative paths,
public GitHub identifiers, public patch content already intended for the
contribution, aggregate usage values, and ordinary non-secret tool output are
permitted.

Neither the receipt CLI nor the trace API automatically redacts or scans the
file. There is no best-effort or guaranteed server-side secret removal: the
selected bytes are the retained bytes. The contributor or exporting client is
responsible for applying the exclusions and inspecting the final file before
authorization. An exporter may provide additional local redaction, but it must
disclose its rules and must not claim that pattern matching guarantees removal
of every secret.

## Storage, access, and retention

The trace body is stored as one immutable, content-addressed object in a
private R2 bucket. D1 stores its digest, size, media type, actor and run joins,
upload progress, and access-audit metadata, but not the body. Public GitHub and
Slop artifacts contain only safe run metadata, the digest, and immutable upload
identity; they never contain the trace body.

Retention is permanent: there is no expiry, contributor download, update,
correction, or voluntary deletion route. Contributors and project owners
cannot read trace bodies, including their own, after upload. Only a designated
Slop operator may retrieve a body through a single-use grant that expires after
60 seconds, is bound to that operator and digest, requires a recorded reason,
and appends grant and read audit events. Cloudflare account access is separately
limited to designated operators.

For a privacy, security, or data-subject request, use the repository's enabled
private GitHub security-advisory intake at
<https://github.com/SlopDotCash/slopdotcash/security/advisories/new>. It accepts a
private report from a signed-in GitHub user without publishing the report as an
issue. Do not put private data, trace contents, or request details in a public
issue.

The protected quality and deploy jobs query GitHub's public
private-vulnerability-reporting status endpoint. The tested Pages bundle carries
their bounded revision-bound attestation, and Slop's server-authoritative
preflight accepts it for at most 49 hours. Trace upload and production
activation fail closed if the attestation is missing, stale, malformed, or does
not report exactly `enabled: true`; the preflight reports only safe state and
never becomes an enabled result. The advisory URL alone is not evidence that
intake is usable.
Operators must authenticate the requester and handle any action required by
applicable law outside the contributor API with an audit record. This channel
does not create a voluntary deletion or contributor-read right that conflicts
with the permanent, write-only product contract.

## Integrity requirements

Minimization and redaction do not weaken the fail-closed receipt join. The API
accepts only the exact declared byte count, media type, and SHA-256 digest;
upload capabilities are short-lived and one-use; object creation is immutable;
and finalization fails unless the object is attached. Contribution and review
submission remains blocked if export, upload, finalization, or the public
receipt join fails.
