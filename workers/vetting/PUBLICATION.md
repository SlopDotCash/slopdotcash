# Trusted result reconciliation and publication

PRD VET-05 to VET-07 and MVP-12 require a policy service outside the guest
and model context. `publication.ts` reuses the intake result parser and
disposition rules. `publishResult` publishes either a bounded scan result
(`slop-vetting-result-v2`, composed by `bounded-scan.ts`) or a historical
secure-VM result. `service.ts` signs the exact request bytes. Neither module
starts a VM, acquires evidence, chooses a provider or runs automatically.

The trusted scheduler supplies the actual collector observation, exact private
inventory and trace bytes, and the two independent scanner records. The
inventory's `visibilityGaps` must include acquisition, template, dependency,
artifact and runtime gaps. The reconciler checks the inventory and trace
digests. It retains the inventory, collector and scanner gaps, and replaces any
proposed disposition and confirmation in the observation.

A model finding or disagreement requires independent review and produces an
incomplete result. A model label cannot supply confirmation. A separate trusted
reviewer may supply `confirmedEvidence`, with the reviewer identity, exact
inventory and trace digests, standing rule and independently checked evidence.
This is an operator trust boundary: a string or digest cannot itself prove
that the reviewer performed the investigation. Do not accept this object from
repository content, guest output or a model response.

The existing strict intake contract decides whether complete observations can
support a clean result. Missing telemetry, unreleased artifacts, tampering,
canary access and unresolved findings prevent clearance. This module cannot
prove that a compromised collector reported honestly; independent host and
proxy evidence and the approved runtime profile remain required.

Preparation returns the exact result bytes and digest without sending them.
An authorized caller explicitly passes the approved digest to `publishResult`.
Keep the signer and journal outside guest mounts and model tools. Use a reviewed
HTTPS service origin and an existing operator-private journal directory.
Publication reserves one directory per assessment atomically, writes the intent
before the request, and records the outcome with owner-only permissions.
It sends one request and checks the returned assessment identity and state.

A lost or malformed response remains `unknown`, even if the service committed
the result. A subsequent call for the same assessment refuses to send.
Use the restricted admin assessment record and its result digest to reconcile
the attempt. Never delete the journal to retry an uncertain submission.
A rejected attempt also remains recorded; an operator must inspect the cause.
The journal records safe result identity and status, not keys or raw traces.
Retain the exact private result, model records, confirmation and trace in the
separate operator evidence store under its approved retention policy.
The signed intake checks the retained evidence for the same assessment and run.
Register the exact inventory and trace digests and upload the actual required
objects before publication. A local journal is not a replacement for this store.

Readiness failure is not an incomplete scan. The scheduler must not call the
publisher when the runtime, collector, provider access or evidence store is
unavailable. An incomplete result is submitted only for an actual authorized
run with its retained evidence and an explicit publication decision.

## Evidence

The existing signed API workflow uses an actual local HTTP server, the real
intake handler, SQLite migrations, local workerd R2 storage and an ephemeral
Ed25519 key. It registers and uploads the exact publisher evidence through the
signed storage routes, and checks that the evidence is incomplete before those
uploads and remains incomplete afterward without an authorized canonical
assembly. An incomplete result can record the gap; it cannot clear the project.
It proves
inventory-gap retention, model-disagreement quarantine, digest mismatch
refusal, signed result acceptance and no second submission after a lost
response. These fixtures verify publication mechanics. They do not establish
real VM coverage, provider review, operator authorization or live admission.
Full clean/incomplete/malicious acceptance with the approved services remains
required before activation.
