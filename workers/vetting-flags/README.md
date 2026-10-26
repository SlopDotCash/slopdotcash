# Two-flag pause qualification

PRD sections 4, 8 and 11; issue #911. The owner accepts deployed staging
fixtures in place of two real contributor accounts. This entry proves the
flag and scan rules with harmless data. It does not change those rules.

The existing `vetting-recovery-qualification.yml` workflow has a `flags`
scope. Its default `plan` mode makes no remote request. After review, an
`execute` run on the exact `development` commit uses the existing
`slop-staging` credentials. It creates one disposable D1 database with every
real migration, one private R2 bucket, a work/failure queue pair and one
queue-only Worker. It verifies the deployed version, exact private bindings
and queue consumer. It removes only resources owned by that run. No
application database, evidence bucket or service secret is bound.

The entry calls both complete Pages factories. Synthetic sessions pass
through the real D1 session lookup. A closed `globalThis.fetch` replacement
exists only in this disposable entry: it serves fixed GitHub account,
accepted-PR responses. It rejects every other outbound request;
it never calls the network. A fixed Slopbot binding supplies repository
permission and branch facts. Branch reads must use that binding; an ordinary
GitHub branch fallback fails the fixture. Unexpected service requests also
fail, even if an application fallback catches them. Production origin controls
and authentication are unchanged.
The asset binding serves the exact repository template files and hashes.

The fixture starts from explicit seeded project state; it does not claim
project-creation acceptance. It proves:

- Two distinct eligible flags pause once, including concurrent submissions.
- A duplicate flag cannot count twice. A warmed skill returns HTTP 410.
- A reporter sees only their own evidence. Withdrawal leaves the pause.
- The pause queues a fresh scan. A signed clean result with exact retained
  R2 evidence restores a flag-only pause. Resolved flags no longer count.
- A pre-pause scan, newer flag or confirmed malicious restriction prevents
  reinstatement. A later scan that covers all flags can restore the project.
- Missing retained evidence and a mismatched source pin cannot clear a scan.
- A moderator receives one notice for a pause. Notifications stay in the
  disposable D1 database; no message is delivered.

The generated signing key exists only inside the fixture. Its policy and
scan reports are explicitly synthetic. They do not attest operational
controls or prove real scanner/model behavior. A partial command cannot run
again over its partial state; it records failure and requires a new isolated
run. Replayed completed commands preserve the original result and data.

Wrangler may deploy the Worker before queue-consumer setup fails. Recovery
verifies the exact tagged version and complete private binding set before it
claims that partial deployment for cleanup. A missing consumer does not prevent
removal of the owned Worker and its producer-bound queue. A changed source or
binding remains unresolved. The result keeps the original failure, fixed stage,
process status and numeric provider codes; it never stores raw process output.

Run locally before review:

```sh
bun --no-env-file scripts/qualify-vetting-controls.ts --flags
bun run test:vetting:flags
```

The second command uses actual Workerd, D1, R2 and queue delivery. It checks
that no request reaches the external transport, the HTTP entry returns 404,
command replay leaves counts unchanged and owned fixture objects are removed.
The same test runs in `verify:code`. Do not run `--execute` locally; it is
restricted to the existing protected workflow.

Hosted reports contain source/Worker identity, migration hashes, outcomes,
safe counts and cleanup. They contain no session token, signing key or private
evidence body. Local results identify a dirty working tree until the code is
committed. This qualification does not prove the public HTTP edge, browser
interaction, OAuth, live GitHub eligibility, real scanner/provider operation,
production Pages bindings, moderator appeals or funded settlement after a ban.
Those remain separate acceptance evidence.
