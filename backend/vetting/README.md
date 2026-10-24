# Community project security vetting

PRD VET-01 to VET-08 and MVP-12. Slop serves no generated skill, lists no
project in `/.well-known/slop/projects.json`, and activates no revision unless
a secure-VM scan cleared that exact revision content. The VM, its collectors
and the two model scanners are external services. This module stores their
signed results and enforces the gate. It fails closed when the service is
absent. [Private evidence storage and inspection](EVIDENCE.md) use a separate
R2 binding and an explicit operator-attested policy with inactive defaults.

## Tables

`migrations/0025_community_security_vetting.sql` creates:

- `vetting_assessments`: one scan of one exact project revision (project id,
  revision, manifest SHA-256, content SHA-256) at one exact integration-branch
  commit and skill template input digest, which the queue assigns. States are `pending`,
  `incomplete`, `clean` and `malicious`. A trigger allows exactly one update,
  from `pending` to a result. Rows are never deleted.
- `vetting_artifacts`: the artifact quarantine records of a result (VET-04):
  content hash, parent hash, origin, path, type, quarantine state, analysis
  and requested execution. Rows are immutable. A row is `released` only with
  a clean analysis.

## Clearance

The content SHA-256 is the key-sorted canonical JSON of the manifest's
executable fields (`id`, `repositories`, `skill`, `reviewSkill`,
`contribution`; `src/lib/project-revision-changes.ts`). Status, listing,
presentation and financial edits keep it. A clearance binds three things (VET-07):

- the content SHA-256 of the unbroken run of revisions with the same content;
- the integration-branch head commit that the queue assigned to the scan;
- the skill template input digest that the queue assigned to the scan.

The template input digest is `templateSha256` in the deployed
`/skill-templates/index.json`: the SHA-256 of the canonical JSON of the
contributor and reviewer template files and their digests, the renderer
sources (`renderer.sources`) and the accepted revisions. These inputs decide
the generated skill bytes, apart from the provenance commit label. A clearance
does not bind the site commit, so a site deploy that does not change these
inputs keeps every clearance, and staging and production share it.

Every check reads the live pin: the current head of the manifest's
`integrationBranch` on GitHub and the `templateSha256` of the deployed
template index. Only scans of the same content and of that exact pin count,
and the newest finished one decides. So an activation revision that changes
only the status of a cleared revision keeps its clearance. A new commit on the
integration branch, a change to a template input, or a change to an executable
field needs a new scan before Slop serves the skill.

A scan covers one repository at one commit. A manifest that names more than
one repository has no live pin, so its state is `unverified`, an admin cannot
queue a scan, and Slop serves no skill for it.

| State | Meaning | Skills, discovery, activation |
|---|---|---|
| `unscanned` | No scan of this content | Blocked |
| `unverified` | Slop could not read the live pin, the manifest names more than one repository, or the retained evidence is missing, changed, expired or outside current policy | Blocked; skill routes return HTTP 503 |
| `stale` | Scans of this content exist, but none of the live branch head and template | Blocked |
| `queued` | A scan of the live pin waits for a result | Blocked |
| `quarantined` | The newest finished scan of the live pin is `incomplete` | Blocked |
| `cleared` | The newest finished scan of the live pin is `clean` and its required retained objects pass verification | Allowed |
| `banned` | A malicious scan has no independent reinstatement decision covering it | Blocked; a new scan or commit alone cannot lift it |

Merging to the integration branch therefore pauses skills and discovery for
the project until an admin queues a scan of the new head and its clean result
lands. Slop keeps each branch head in the edge cache for 30 seconds. Dynamic
skills, discovery and public clearance responses use no-store. Each request
checks current private evidence; an old cache cannot bypass access expiry.

A queued rescan keeps the last finished decision until its result lands.
Reinstatement after a ban uses the ADM-06 path and the exact reviewed scan
records described in [Independent reinstatement](#independent-reinstatement).

## Routes

| Route                                    | Access         | Purpose                                                                                                                                                                      |
| ---------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/admin/vetting`              | admin          | Service state, clearance of every project, full results                                                                                                                      |
| `POST /api/v1/admin/vetting/assessments` | admin          | Queues a scan of the current revision (`projectId`, `revision`, `reason`) at the live branch head and template digest; HTTP 503 `pin_unavailable` when either cannot be read |
| `GET /api/v1/vetting/requests`           | signed service | Queued scans with the assigned `commitSha` and `templateSha256`, the revision URL and the template index URL                                                                 |
| `POST /api/v1/vetting/results`           | signed service | Records one `slop-vetting-result-v1` result                                                                                                                                  |
| `GET /api/v1/projects/:id`               | public         | Adds the safe `vetting` summary; `skillsPublished` needs `cleared`                                                                                                           |

## Service signature

Each service request carries:

- `x-slop-vetting-key`: lowercase SHA-256 of the raw 32-byte Ed25519 public key;
- `x-slop-vetting-timestamp`: ISO UTC time within 5 minutes of the server;
- `x-slop-vetting-signature`: base64 Ed25519 signature of the UTF-8 text
  `slop-vetting:v1\n<METHOD>\n<path and query>\n<timestamp>\n<SHA-256 hex of the body>`.

The Pages variable `VETTING_RESULT_PUBLIC_KEYS` lists the accepted public keys
as comma-separated base64. Slop holds only public keys. A malformed list is
treated as absent. Without a key, the service routes and the queue action
return HTTP 503 `vetting_unavailable`, and `/admin` shows the service as
unavailable.

## Result contract

`backend/vetting/result.ts` parses the result exactly. Unknown, missing or
malformed fields refuse it. The result binds the assessment id, project id,
revision, manifest SHA-256 and repository of the queued scan, the assessed
commit and template input digest (which must equal the values the queue assigned,
or the API returns HTTP 422 `commit_mismatch`), input inventory digest, dependency lock digests, VM
provider, isolation, image digest, collector and run ids, the eleven
telemetry channels, visibility gaps, tamper and canary signals, the trace
digest, exactly one Astra and one Opus review with provider, model, prompt
policy, input digest and run id, the artifact quarantine list, findings and
an optional confirmation.

The API never upgrades a result:

- `clean` needs every telemetry channel complete, no visibility gap, no
  tampering, no canary access, both reviews completed on the assessed
  inventory without a malice verdict, every artifact released, and no high or
  critical finding.
- `malicious` needs a `confirmation` with basis `reproducible-behavior` or
  `verified-source-evidence`, a rule id and evidence references. A model
  label alone is refused (VET-06).
- `incomplete` records anything else, without a confirmation.

## Remaining service implementation and operation

The result intake does not implement the external execution service. These
are source and integration requirements, not only missing credentials or
deployment settings. Until the complete service exists and passes acceptance,
no community project can be cleared, so no project skill is served.

The [isolated artifact inventory](../../workers/vetting/README.md) implements
bounded recursive inspection of a supplied file. It keeps every file in
quarantine. It does not intercept guest execution, release artifacts, or
replace the remaining requirements below.

[Source acquisition](../../workers/vetting/ACQUISITION.md) verifies immutable
Git objects without checkout or execution. The [signed queue reader and template
acquisition](../../workers/vetting/QUEUE.md) bind those objects to the assigned
manifest and template inputs. Both retain visibility gaps and leave assessments
pending. Independent provider transports are under review in
[PR #953](https://github.com/SlopDotCash/slopdotcash/pull/953); actual provider
acceptance is still required. These components do not complete execution,
telemetry, artifact release or trusted publication.

1. A hardware-isolated VM or microVM service that meets VET-02 and VET-03:
   fresh disposable guest, no host mounts or credentials, default-deny egress
   through an instrumented proxy, the eleven telemetry channels, canary
   files, and host and proxy evidence collected outside the guest.
2. Recursive artifact quarantine and analysis outside the guest (VET-04).
3. Pinned Astra-class and Opus-class scanner runs with their own provider
   credentials (VET-05).
4. A trusted policy service, outside the guest and model context, that holds
   the Ed25519 private key, decides the disposition, and signs the result.
5. The public key in the Pages variable `VETTING_RESULT_PUBLIC_KEYS` for each
   environment.
6. The [restricted operator console](EVIDENCE.md) now verifies bounded retained
   objects. Full assembly-reference closure and large overlay integration remain
   missing source work. Approved published policy, physical retention, legal holds,
   backup and recovery controls, and live acceptance remain required (VET-03).
7. The VET-08 acceptance run of the harmless fixture classes on that
   infrastructure, with its coverage and blind-spot report.

## Independent reinstatement

A confirmed malicious signed result atomically records the result, a repository-bound
Ban and the owner inbox event. The issuer is the signing-key digest, assessment,
policy version and confirmation rule. A model label alone cannot create this record.
The record immediately closes cached lists, direct skills and repository aliases.
If the manifest is not already paused and retired, the record says `revision_pending`;
an admin must append that canonical revision before reinstatement. No GitHub actor
or revision author is invented for the service.

A clean scan alone does not clear a confirmed malicious finding. An owner or
moderator files an appeal. An independent human moderator may decide it only after
a fresh complete scan of the restricted revision. Migration 0031 stores the exact
clean scan and reviewed malicious assessment IDs with that append-only decision.
Every later malicious assessment remains a new ban; no old decision covers it.
The changed listing revision still needs clearance before its skills can publish.
Migration 0032 preserves human enforcement history and admits the signed service
issuer only for standing-rule Ban records.

Confirmed-malicious bans notify the configured administrators and project moderators, the applicant and steward, and known affected contributors. Contributor recipients come from current positive contribution records resolved through immutable membership IDs, plus project payment obligations and imported transfers. Reversed awards and unrelated projects do not select recipients. People without a resolvable inbox identity cannot receive a direct notice. The private inbox notice contains no security reason, trace, or evidence reference. The result, ban, and notices commit together; a repeated signed result cannot duplicate them.
