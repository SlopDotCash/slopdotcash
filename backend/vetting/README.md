# Community project security vetting

PRD section 8, VET-01 to VET-08 and MVP-12; issues #909 and #911. Slop serves
no generated skill, lists no project in `/.well-known/slop/projects.json`, and
activates no revision unless a malicious-code scan cleared that exact revision
content at the live pin. The scanner and its model reviews are an external
service ([worker](../../workers/vetting/README.md)). This module stores their
signed results, queues scans automatically, records contributor flags and
enforces the gate. It fails closed when the service is absent. [Private
evidence storage and inspection](EVIDENCE.md) use a separate R2 binding and
fixed evidence terms in source.

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

Projects registered before the gate are grandfathered.
`migrations/0075_vetting_grandfathered_projects.sql` records every project
that existed when it ran in the immutable `vetting_grandfathered_projects`
table. A grandfathered project is `cleared` with no assessment, so it serves
skills, lists for discovery and activates without a scan. A confirmed
malicious finding still bans it, and reinstatement still needs a fresh clean
scan. The exemption covers future executable changes, but it does not override
flag pauses or account restrictions. Flag-only reinstatement still requires a
fresh clean scan. Projects created later follow the rules below. The owner
approved this permanent exception in canonical PRD section 8 on 24 October 2026.

For projects without the exemption, merging to the integration branch pauses
skills and discovery until a scan of the new head lands clean. The signed service's
`POST /api/v1/vetting/refresh` queues that scan automatically; a scan whose
executable inventory is unchanged reuses the cached clean result. Slop keeps each branch head in the edge cache for 30 seconds. Dynamic
skills, discovery and public clearance responses use no-store. Each request
checks current private evidence; an old cache cannot bypass access expiry.

A queued rescan keeps the last finished decision until its result lands.
The service queue returns only the newest assessment for each project. A
changed commit, template, revision or active flag set can queue a replacement
while an older scan is pending. Repeating the current pending request does
not add a row. Superseded assessments remain unchanged in the audit history;
they do not establish clearance or prevent the current scan from running.
Reinstatement after a ban uses the ADM-06 path and the exact reviewed scan
records described in [Independent reinstatement](#independent-reinstatement).

## Routes

| Route                                    | Access         | Purpose                                                                                                                                                                      |
| ---------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/admin/vetting`              | admin          | Service state, clearance of every project, full results                                                                                                                      |
| `POST /api/v1/admin/vetting/assessments` | admin          | Queues a scan of the current revision (`projectId`, `revision`, `reason`) at the live branch head and template digest; HTTP 503 `pin_unavailable` when either cannot be read |
| `GET /api/v1/vetting/requests`           | signed service | Queued scans with the assigned `commitSha` and `templateSha256`, the revision URL and the template index URL                                                                 |
| `POST /api/v1/vetting/results`           | signed service | Records one `slop-vetting-result-v2` scan result, or a historical `slop-vetting-result-v1` result                                                                            |
| `POST /api/v1/vetting/refresh`           | signed service | Body `{}`. Queues automatic scans, for the project steward, of changed or unscanned content and of flag-only pauses. Completes a flag-only reinstatement that a fresh clean scan at the current live pin could not write when it landed. Returns the queued and reinstated assessment ids                                    |
| `GET /api/v1/project-flags/:id`          | member         | The member's own active flag and the project's restriction state                                                                                                              |
| `POST /api/v1/project-flags/:id`         | member         | Files one flag (`category`, `evidence`, optional GitHub `evidenceUrl`); the second distinct active reporter pauses the project                                              |
| `POST /api/v1/project-flags/:id/withdraw`| member         | Withdraws the member's active flag; a pause already placed stays until a clean scan                                                                                           |
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

New results use the bounded scan contract `slop-vetting-result-v2`
(`scan-result.ts`). The parser refuses unknown, missing or malformed fields.
A result binds the assessment, project, revision, manifest SHA-256 and
repository of the queued scan, the assessed commit and template digest (which
must equal the queue assignment, or HTTP 422 `commit_mismatch`), the
executable inventory digest, dependency lock digests, the scan run and its
private report digest, surface coverage, threat checks, visibility gaps, any
isolated execution, an optional reused assessment, the primary review, an
optional specialist review, artifacts, findings and an optional confirmation.

The API never upgrades a result:

- `clean` needs all six surfaces (`source`, `manifests`, `dependencies`,
  `installScripts`, `downloads`, `agentInstructions`) read completely, no
  visibility gap, no check `not-run`, a completed primary review of the
  assessed inventory without suspected malice, every artifact released after a
  clean analysis, and no high or critical finding. An ambiguous or high-risk
  result (a non-low primary review, a flagged check, a medium or worse finding
  or an unreleased artifact) also needs a completed specialist review of the
  same inventory with no findings and low risk. An ordinary clean project
  needs no second review.
- Isolated execution is recorded only when it was needed, and the contract
  requires `secretsProvided: false` and default-deny egress.
- A clean result needs its retained report, inventory, dependency locks and
  artifacts in the evidence store (`evidence_incomplete` otherwise). A reused
  result must cite an original clean, non-reused scan of the same repository,
  inventory, template, policy, run and report (`reuse_mismatch` otherwise);
  the original's retained evidence stands in.
- `malicious` needs a `confirmation` with basis `reproducible-behavior` or
  `verified-source-evidence`, a rule id and evidence references. A model label
  alone is refused (VET-06).
- `incomplete` records anything else, without a confirmation.

Historical `slop-vetting-result-v1` results keep their secure-VM rules in
`result.ts`: eleven telemetry channels, two model reviews and a complete
canonical assembly. No recorded incomplete result is reinterpreted as clean.

## Scanner service dependency

The scan service pass is `workers/vetting/run.ts`. A community project is
cleared only by that deployed service with its Ed25519 key, the public key in
`VETTING_RESULT_PUBLIC_KEYS`, the Surplus key, the pinned primary and
specialist profiles, the evidence store policy and an accepted isolated runner
for risky artifacts, after staging acceptance. Without them, no community
project can be cleared, so no project skill is served for it. The earlier
secure-VM components stay available for advanced detonation; they are no
longer a prerequisite for an ordinary clean result.

## Two-contributor flags

`flags.ts` and migration 0060 implement PRD sections 4 and 8. A signed-in
member may file one active flag per project with a threat category and 20 to
4,000 characters of evidence. Owner decision D3 sets who may flag, and
`flagger-standing.ts` reads it from GitHub at filing time:

- the GitHub account is at least 30 days old (`GET /user/:id`);
- the member has at least 1 accepted contribution: a merged pull request in a
  registered project repository, counted under the member's immutable node ID
  in the published profile census (`/data/profiles.json`);
- the member is not the project steward, and GitHub does not mark the member
  as owner, member or collaborator of a project repository or list the member
  as a public member of the organization that owns it.

A failed GitHub or census read refuses the flag with
`flagger_standing_unavailable`; it never admits one. In the same D1
transaction as the second distinct active reporter's flag, Slop appends a
`quarantine` enforcement record whose issuer is `contributor-flags` with the
flag ids, a standing rule and no GitHub actor. It notifies each configured
administrator and project moderator once (`/admin`) and the applicant and
steward (`/projects/:id`) through the inbox and its email outbox, purges cached
skills and discovery, and queues a fresh scan. A database trigger refuses a
flag pause without two distinct active reporters. No moderator approves a flag
before it counts. A restricted project only records further flags.

A flag stops counting when it closes:

- the reporter withdraws it;
- a clean scan requested after the flag was filed resolves it;
- any reinstatement of the project resolves the flags it found;
- 90 days pass after filing (`FLAG_ACTIVE_LIFETIME_MS = 7776000000`, owner
  decision D3). The next flag on the project closes the old flag as `expired`,
  and a database trigger refuses a pause that counts an older flag.

A single flag stays private and does not change the project.

A clean fresh scan requested at or after a pause that flags alone placed
appends a signed `vetting-service` reinstatement (rule
`clean-fresh-scan-after-flags`) with the result, in one transaction. It
appends no revision, because the pause never changed the manifest. A
confirmed malicious result instead bans the project through the path below,
and a moderator decides. Flag evidence is visible only to its reporter and to
administrators in `GET /api/v1/admin/vetting`; public routes show only the
restriction.

## Independent reinstatement

A confirmed malicious signed result atomically records the result, a repository-bound
Ban and the owner inbox event. The issuer is the signing-key digest, assessment,
policy version and confirmation rule. A model label alone cannot create this record.
The record immediately closes cached lists, direct skills and repository aliases.
If the manifest is not already paused and retired, the record says `revision_pending`;
an admin must append that canonical revision before reinstatement. No GitHub actor
or revision author is invented for the service.

A clean scan alone does not clear a confirmed malicious finding. A moderator
decides every confirmed malicious Ban, with or without an appeal: ban the
project and the responsible accounts selected from the evidence, or reinstate
it (see `backend/projects/README.md`).
An owner or moderator files an appeal to start reinstatement. An independent human moderator may decide it only after
a fresh complete scan of the restricted revision. Migration 0031 stores the exact
clean scan and reviewed malicious assessment IDs with that append-only decision.
Every later malicious assessment remains a new ban; no old decision covers it.
The changed listing revision still needs clearance before its skills can publish.
Migration 0032 preserves human enforcement history and admits the signed service
issuer only for standing-rule Ban records.

Confirmed-malicious bans notify the configured administrators and project moderators, the applicant and steward, and known affected contributors. Contributor recipients come from current positive contribution records resolved through immutable membership IDs, plus project payment obligations and imported transfers. Reversed awards and unrelated projects do not select recipients. People without a resolvable inbox identity cannot receive a direct notice. The private inbox notice contains no security reason, trace, or evidence reference. The result, ban, and notices commit together; a repeated signed result cannot duplicate them.

A scan records the active flag IDs when it is queued. Its clean result resolves
only those flags. New flags keep the project paused and cause the next automatic
refresh to queue another scan. Equal timestamps do not make a newer flag part
of an older scan. The database checks this boundary when it records reinstatement.
