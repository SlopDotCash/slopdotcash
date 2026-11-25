## Private trace privacy contract

This section defines the content and privacy contract for a Slop private trace
under PRD sections 4 and 8. It applies to every contribution and review skill
that uploads a trace to `https://api.slop.cash`.

### Consent boundary

Uploading is optional for every contribution and review. It is not
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
unacceptable. Submit the contribution or review without private-trace evidence. A human
who did not use an agent may declare a human-only contribution and does not
upload an agent trace.

### Required scope and permitted records

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

### Required exclusions and redaction

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

### Storage, access, and retention

The trace body is stored as one immutable, content-addressed object in a
private R2 bucket. D1 stores its digest, size, media type, actor and run joins,
upload progress, and access-audit metadata, but not the body. Public GitHub and
Slop artifacts contain only safe run metadata, the digest, and immutable upload
identity; they never contain the trace body.

Retention is permanent: there is no expiry, contributor download, update,
correction, or voluntary deletion route. Contributors and project owners
cannot read trace bodies, including their own, after upload. No website or API
route returns a trace body. Cloudflare account access is separately limited to
designated operators.

For a privacy, security, or data-subject request, use the authenticated private
Slop reporting page at <https://slop.cash/projects/slopdotcash/security> and
follow its status in Inbox. Slop retains the report privately and handles any
authorized private GitHub forwarding. Do not include a contributor trace body
in a report, or put private data or request details in a public issue.

An independent hourly Actions job authenticates to GitHub and records the
private-reporting status in D1. Trace intake reads that status with a 24-hour
maximum age. Missing, stale, malformed, or disabled status blocks only optional
trace collection. Website deployments and GitHub contributions continue.
The advisory URL alone is not evidence that intake is usable.
Operators must authenticate the requester and handle any action required by
applicable law outside the contributor API with an audit record. This channel
does not create a voluntary deletion or contributor-read right that conflicts
with the permanent, write-only product contract.

### Integrity requirements

Minimization and redaction do not weaken the fail-closed receipt join. The API
accepts only the exact declared byte count, media type, and SHA-256 digest;
upload capabilities are short-lived and one-use; object creation is immutable;
and finalization fails unless the object is attached. Failed export, upload, finalization, or receipt joins do not block GitHub
submission. They never qualify as finalized evidence or earn a trace bonus.

## Private trace privacy contract v2

This section is version 2 of the content and privacy contract for a Slop
private trace (operator decision, 22 November 2026). It adds upload by default
and paid licensing that each contributor turns on separately. Version 1 above
stays published unchanged at `/protocol/private-trace-v1.md` and keeps
governing every trace uploaded under it. A trace is governed by the version its
uploading client showed.

### Status

Licensing is not available yet. No account can turn it on, and no trace is
licensed, exported or sold. The skills still offer upload under version 1.
This section takes effect for a trace only when a client shows it before
upload, and licensing takes effect only when the account setting described
below exists and the contributor turns it on.

### Consent and default upload

Uploading stays optional and never blocks, delays or lowers a contribution or
review. A client may prepare and upload the run's trace by default. Before
GitHub authorization starts it shows the file's local path, byte count, media
type and SHA-256 digest, says that the trace will be uploaded, and gives a
one-line way to decline. Declining sends nothing. The uploader sends the
shown bytes without transformation; a changed file has a different digest and
needs a new upload. Upload alone never licenses a trace.

A human who did not use an agent may declare a human-only contribution and
does not upload an agent trace.

### Licensing for pay

Licensing is a separate yes. A contributor turns it on in their Slop account
setting and can turn it off at any time. It covers each trace the contributor
uploads under this version while the setting is on. A trace uploaded under version 1
is licensed only when the contributor opts that trace in explicitly, one by
one. Turning the setting off stops every future sale of that contributor's
traces; copies already sold stay sold.

Only a trace joined to a merged or closed pull request whose outcome Slop has
recorded may be offered. Slop licenses traces to AI model developers and to
data vendors that supply them, under a written licence that forbids
re-identifying the contributor and reselling a trace on its own.

The contributor receives 50% of what the buyer pays for a sale, split evenly
across the traces in that sale, paid in the sale's stablecoin to the
contributor's registered payout wallet. Slop keeps the other 50%. A sale is
paid only after the buyer's payment is received; until then nothing is due.

By turning licensing on, the contributor confirms that the terms of the model
provider used in each run allow them to license that run's output.

Before any trace leaves Slop, Slop scans it for credentials and holds back
every trace that matches. The scan is not a guarantee. The contributor's own
exclusions below still apply and remain the primary protection.

Slop may publish counts and rates computed from traces uploaded under this
version, and from version 1 traces their contributor opted in, when they
identify no person and no trace.

### Required scope and permitted records

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
or events before or after the measured run.

### Required exclusions and redaction

The contributor or the client must remove or replace these values before
upload:

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
permitted. A client that redacts automatically must disclose its rules and must
not claim that pattern matching removes every secret.

### Storage, access, and retention

The trace body is stored as one immutable, content-addressed object in a
private R2 bucket. D1 stores its digest, size, media type, actor and run
joins, upload progress, and access-audit metadata, but not the body. It will
also store the terms version once consent records ship.
Public GitHub and Slop artifacts contain only safe run metadata, the digest,
and immutable upload identity.

Retention is permanent: there is no expiry, contributor download, update,
correction, or voluntary deletion route. No website or API route returns a
trace body to anyone, including its contributor and project owners.
Designated operators may export the body of a licensed trace only to fulfil a
sale, with an audit record; no export route exists yet.

For a privacy, security, or data-subject request, use the authenticated private
Slop reporting page at <https://slop.cash/projects/slopdotcash/security> and
follow its status in Inbox. Do not include a trace body in a report or put
private data in a public issue. Operators handle any action required by
applicable law with an audit record.

### Integrity requirements

The API accepts only the exact declared byte count, media type, and SHA-256
digest; upload capabilities are short-lived and one-use; object creation is
immutable; and finalization fails unless the object is attached. Failed
export, upload, finalization, or receipt joins do not block GitHub submission.
Usage and traces never change Points, rank, share, or the payment of a
contribution.


## Private trace privacy contract v3

This section is version 3 of the content and privacy contract for a Slop private trace (operator decision, 23 November 2026). It adds session export and the rule that repository file contents are kept only for openly licensed repositories. Version 2 above stays published unchanged at /protocol/private-trace-v2.md and keeps governing every trace uploaded under it. Version 1 stays published unchanged at /protocol/private-trace-v1.md and keeps governing every trace uploaded under it. A trace is governed by the version its uploading client showed.

### Status

Licensing under this version follows the same setting as version 2, with one change: a setting confirmed under version 2 does not cover a trace uploaded under version 3. Upload licence and opt-in refuse with `confirm_again` until the contributor confirms again under version 3, and the account page asks to confirm again. A banned account cannot confirm under version 3. The skills still offer upload under version 1 and version 2. This section takes effect for a trace only when a client shows it before upload, and licensing takes effect only when the account setting described below exists, the contributor turns it on, and the contributor has confirmed again under version 3.

### Consent and default upload

Version 3 keeps the consent and default upload rules of version 2. The client shows the terms version with the file's digest before sending it, and the same client that produced the trace is the one that has the trace. The content is uploaded by default, as soon as the client has the trace, and the contributor may opt out before or after the content is collected. The same consent requirement also applies to session export: the exporter cleans the session locally, the contributor reviews the cleaned file, and only the cleaned file is uploaded.

### Session export

The contributor skill exports a cleaned agent session under this version. It finds the session file by the `slop-run:<id>` marker, cleans it locally with cleaner `slop-session-cleaner-1`, and writes the cleaned file for the contributor to review before upload. Repository file contents are kept only when the repository licence is an OSI licence. A read result leaves the machine only when the repository is openly licensed and the file is inside the repository and tracked, or when a name-only command names only paths inside the repository. An event naming a path outside the repository is replaced whole. Any other outcome is a redaction marker. The cleaned file is tagged with terms version `private-trace-v3`, and the run records that version in D1.

### Licensing for pay

Version 3 keeps the licensing for pay rules of version 2, with the confirm-again rule of the Status section above. Only a trace joined to a merged or closed pull request whose outcome Slop has recorded may be offered under a paid licence. A trace that is not joined to a merged or closed pull request cannot be licensed or sold. If a trace is ever licensed, its written licence will forbid re-identifying any person from the trace, building a personal profile from it, and reselling it on its own. Any buyer will buy one trace only, and the contributor whose work it is receives 50% of what the buyer pays for a sale, split evenly across the traces in the sale. By turning licensing on, the contributor confirms that the terms of the model provider used in each trace allow that trace to be licensed on those terms, and the contributor confirms again under version 3 for every trace uploaded under version 3. Before any trace leaves Slop, Slop scans it for credentials and holds back every trace that matches. Slop may publish counts and rates computed from traces uploaded under this version, and from versions 1 and 2.

### Required scope and permitted records

Version 3 keeps the scope and permitted records of version 2, with one addition: the terms version of the trace is a permitted record, stored on the run in D1, so that a trace is always governed by the version its uploading client showed. A session export carries the same scope: it keeps only what the export cleaner allows out, and the cleaned file the contributor reviewed is the record that is uploaded.

### Required exclusions and redaction

Version 3 keeps the exclusions and redaction rules of version 2, with one change: any other source code is kept only when the repository licence is an OSI licence. The contributor or the client must remove or replace these values before upload: passwords, passkeys, API keys, OAuth or upload capabilities, cookies, bearer tokens, private keys, wallet seed phrases, and other authentication secrets; environment-variable values and credential-store contents; source-file bodies, private diffs, and unrelated file or database contents; absolute local paths, home-directory names, account identifiers, session identifiers, and personal data not necessary to attribute the contribution; hidden chain-of-thought or provider-internal reasoning; and content from unrelated conversations, repositories, tasks, or users. Keep the event and replace only its prohibited field with a category marker such as `[REDACTED:CREDENTIAL]`, `[REDACTED:SOURCE]`, or `[REDACTED:LOCAL_PATH]` when that event is material. Repository-relative paths, public GitHub identifiers, public patch content already intended for the contribution, aggregate usage values, and ordinary non-secret tool output are permitted. A client that redacts automatically must disclose its rules and must not claim that pattern matching removes every secret. The session export cleaner does the same locally before the cleaned file is written.

### Storage, access, and retention

Version 3 keeps the storage, access and retention rules of version 2. The trace body is stored as one immutable, content-addressed object in a private R2 bucket. D1 stores its digest, size, media type, actor and run joins, upload progress, and access-audit metadata, but not the body. D1 also stores the terms version on the run, so that a trace is always governed by the version its uploading client showed. Public GitHub and Slop artifacts contain only safe run metadata, the digest, and immutable upload identity. Retention is permanent: there is no expiry, contributor download, update, correction, or voluntary deletion route. No website or API route returns a trace body to anyone, including its contributor and project owners. Designated operators may export the body of a licensed trace only to fulfil a sale, with an audit record; no export route exists yet. For a privacy, security, or data-subject request, use the authenticated private Slop reporting page at https://slop.cash/projects/slopdotcash/security and follow its status in Inbox. Do not include a trace body in a report or put private data in a public issue. Operators handle any action required by applicable law with an audit record.

### Integrity requirements

Version 3 keeps the integrity requirements of version 2. Minimization and redaction do not weaken the fail-closed receipt join. The API accepts only the exact declared byte count, media type, and SHA-256 digest; upload capabilities are short-lived and one-use; object creation is immutable; and finalization fails unless the object is attached. Failed export, upload, finalization, or receipt joins do not block GitHub submission. Usage and traces never change Points, rank, share, or the payment of a contribution. A session export keeps the same integrity: the cleaned file is the record that is uploaded, and its digest is the digest the client shows before upload.

## Session export

The contributor skill exports a cleaned agent session under trace terms `private-trace-v3`. It finds the session file by the `slop-run:<id>` marker, where `<id>` is the run id, cleans it locally with cleaner `slop-session-cleaner-1`, and writes the cleaned file for the contributor to review before upload. The raw session file never leaves the machine.

### Cleaning rules

A read result leaves the machine only when the repository is openly licensed and the file is inside the repository and tracked, or when a name-only command names only paths inside the repository. A name-only command is `ls`, `tree`, `git status`, `git log` without a patch, `git diff` names, `git branch`, or `find` without actions. Its output of names is kept when every path it names is inside the repository, even when the names include untracked files. An event naming a path outside the repository is replaced whole. Any other outcome is a redaction marker. Repository file contents are kept only when the repository licence is one of the OSI licences listed in `spec/contributor/sessionExport.md`.

### Review and upload

The contributor reviews the cleaned file before it is sent, and the cleaned file is tagged with terms version `private-trace-v3`. The run records that version in D1 through migration `0151_trace_terms_v3.sql`. Redaction is pattern matching, never a guarantee: the exporter discloses its rules and the contributor inspects the cleaned file before authorizing the upload.
