# Commit and registry authority for skill bytes

PRD section 4 and CLAUDE.md "Installer and attribution" govern trust in a
downloaded skill. The trust root of a generated project skill is the pair
(immutable canonical template commit, approved D1 revision digest). This unit
follows the exact authority adapter in
`skills/project-contributor-template/scripts/skill-authority.mjs`,
`scripts/skill-source-matches-commit.mjs`, the provenance checks of
`src/lib/install-command.ts` and the legacy `skill_source_authority` model at
`6b3b9d0b979f0608d87941f1146056a98513ffcf`.
[Installation](./installation.md) consumes this component's admitted read
before it stages and activates a version. This authority state represents one
verified payload and one bounded object download at a time. It holds no token,
client secret, local paths, private text, or source bytes.

The shell parser accepts a template commit only as the full 40-character
lowercase hexadecimal SHA resolved through the fixed canonical repository API,
and a registry digest only as 64 lowercase hexadecimal characters; this
machine compares the parsed values. The public checksum detects corruption
only and is not an input here.

## Story: Resolve every immutable object with its own bounded retry

### Only the exact GitHub API authority receives the optional credential

The canonical GitHub API resolves the full commit. Artifact, registry and
raw-file requests carry no GitHub API token. Cross-origin redirects are
rejected before the new request is built, including authenticated redirects.
This machine is the production authority: a request to an injected `file://`
fixture or any other origin is refused before it is sent, and the read ends
refused, so no event can admit fixture bytes. Deterministic `file://`
fixtures exist only behind the generator's test option, a separate test
configuration whose isolation from production builds is a shell conformance
obligation (CLAUDE.md "Installer and attribution"). Canonical lookup
refuses mutable redirects, incomplete trees, unsafe entries, oversized
bodies, unverified blob identities and file or digest mismatch. Credential
handling and hashing need shell conformance.

```quint
type Authority = CanonicalApi | Registry | RawFiles | Archive | InjectedFixture | OtherOrigin
type Role = StaticSkill | ContributorSkill | ReviewerSkill
type Transport = NewObject | Reading | Retry | Downloaded | Refused | Admitted
type Issue = Timeout | ConnectionReset | AbruptTlsEnd | ServerError | InvalidAuthority | InvalidBytes | SizeExceeded | RateLimited
type Provenance = Committed | WorkingTree | MissingProvenance
type Selection = { role: Role, project: int, commit: str, registryRevision: int, registryDigest: str }
type ByteCheck = { commit: str, provenance: Provenance, completeFiles: bool, matchingBlobs: bool, renderedDigest: str }
type SkillRead = { selection: Selection, transport: Transport, attempts: int, source: Authority,
  checked: ByteCheck, projectOpen: bool, projectFresh: bool, refusal: Issue }
pure val unchecked: ByteCheck = { commit: "", provenance: MissingProvenance, completeFiles: false, matchingBlobs: false, renderedDigest: "" }
pure val noSelection: Selection = { role: ContributorSkill, project: 0, commit: "", registryRevision: 0, registryDigest: "" }
pure val initial: SkillRead = { selection: noSelection, transport: NewObject,
  attempts: 0, source: OtherOrigin, checked: unchecked, projectOpen: false, projectFresh: false,
  refusal: InvalidAuthority }
pure def productionAuthority(authority: Authority): bool =
  authority == CanonicalApi or authority == Registry or authority == RawFiles or authority == Archive
pure def transportAllowed(authority: Authority, sameAuthority: bool): bool = sameAuthority and productionAuthority(authority)
pure def sendCredential(authority: Authority, sameAuthority: bool, credentialPresent: bool): bool =
  authority == CanonicalApi and sameAuthority and credentialPresent
pure def lawCredentialStaysOnApi(authority: Authority, sameAuthority: bool, credentialPresent: bool): bool =
  sendCredential(authority, sameAuthority, credentialPresent) implies authority == CanonicalApi and sameAuthority
pure def lawFixtureNeverAllowed(sameAuthority: bool): bool = not(transportAllowed(InjectedFixture, sameAuthority))
pure def validSelection(selection: Selection): bool = selection.commit != "" and
  (if (selection.role == StaticSkill) selection.registryDigest == "" and selection.registryRevision == 0 and selection.project == 0
   else selection.registryDigest != "" and selection.registryRevision > 0 and selection.project > 0)
pure def canSelectRole(s: SkillRead, selection: Selection): bool = s.transport == NewObject and s.attempts == 0 and validSelection(selection)
pure def selectRole(s: SkillRead, selection: Selection): SkillRead = { ...s, selection: selection }
```

### Retry transient transport failures up to three attempts

Each object read has at most three attempts. Delays after the first two
transient failures are two and four seconds. TLS certificate failures are
integrity failures. HTTP rate-limit responses retain the diagnostic and fail
the read. A digest, authority, certificate or size failure never authorizes a
retry of that object. A retry starts again at the original authority. Once
all downloaded objects complete, their verified checks can proceed to payload
admission. The adapter must establish that all required objects ran their own
independently bounded read.

```quint
pure def transient(issue: Issue): bool = issue == Timeout or issue == ConnectionReset or issue == AbruptTlsEnd or issue == ServerError
pure def nextDelay(attempts: int): int = if (attempts == 1) 2 else if (attempts == 2) 4 else 0
pure def canFetch(s: SkillRead, authority: Authority, sameAuthority: bool): bool =
  (s.transport == NewObject or s.transport == Retry) and s.attempts < 3 and validSelection(s.selection)
pure def fetch(s: SkillRead, authority: Authority, sameAuthority: bool): SkillRead =
  if (transportAllowed(authority, sameAuthority)) { ...s, transport: Reading, attempts: s.attempts + 1, source: authority }
  else { ...s, transport: Refused, source: authority, refusal: InvalidAuthority }
pure def canRejectRead(s: SkillRead): bool = s.transport == Reading
pure def rejectRead(s: SkillRead, issue: Issue): SkillRead =
  if (transient(issue) and s.attempts < 3) { ...s, transport: Retry }
  else { ...s, transport: Refused, refusal: issue }
pure def canDownloadComplete(s: SkillRead): bool = s.transport == Reading
pure def downloadComplete(s: SkillRead): SkillRead = { ...s, transport: Downloaded, projectFresh: false }
```

## Story: Admit the exact role and rendered payload

### A contributor also needs a fresh installable observation of the exact project

A static committed skill has no registry binding and still requires the exact
complete canonical tree and bytes. Generated contributor and reviewer roles
both require that the rendering of the commit and the approved D1 revision
equal the approved registry digest. Working-tree provenance and missing
provenance are refused. A contributor additionally requires an observation,
made after the download completed, that the exact project is installable:
listed, not paused, flagged or quarantined, cleared, and with published skill
fields (`frontend/projections.md` `installable`). Reviewer read admission
does not impose the contributor-only open-project rule. It confers no right
to contribute or moderate, and generated roles keep separate output. These
checks prove source identity, not maintainer approval.

```quint
import projections as F from "../frontend/projections"
pure def canCompare(s: SkillRead): bool = s.transport == Downloaded
pure def compare(s: SkillRead, facts: ByteCheck): SkillRead = { ...s, checked: facts }
pure def canObserveProject(s: SkillRead): bool = s.transport == Downloaded
pure def observeProject(s: SkillRead, view: F::ProjectView, project: int): SkillRead =
  { ...s, projectOpen: F::installable(view) and project == s.selection.project and project > 0, projectFresh: true }
pure def bytesAdmitted(s: SkillRead): bool = validSelection(s.selection) and s.checked.commit == s.selection.commit
  and s.checked.provenance == Committed and s.checked.completeFiles and s.checked.matchingBlobs
  and productionAuthority(s.source)
  and (s.selection.role == StaticSkill or s.checked.renderedDigest == s.selection.registryDigest)
  and (s.selection.role != ContributorSkill or (s.projectOpen and s.projectFresh))
pure def canAdmit(s: SkillRead): bool = s.transport == Downloaded and bytesAdmitted(s)
pure def admit(s: SkillRead): SkillRead = { ...s, transport: Admitted }
pure def canRefuseBytes(s: SkillRead): bool = s.transport == Downloaded and not(bytesAdmitted(s))
pure def refuseBytes(s: SkillRead): SkillRead = { ...s, transport: Refused, refusal: InvalidBytes }
pure def alwaysAttemptLimit(s: SkillRead): bool = 0 <= s.attempts and s.attempts <= 3
  and (s.transport == Retry implies 0 < s.attempts and s.attempts < 3)
  and ((s.transport == Reading or s.transport == Downloaded or s.transport == Admitted) implies s.attempts > 0)
pure def alwaysAdmittedBytes(s: SkillRead): bool = s.transport == Admitted implies bytesAdmitted(s)
pure def alwaysProductionAuthority(s: SkillRead): bool =
  (s.transport == Reading or s.transport == Downloaded or s.transport == Admitted) implies productionAuthority(s.source)
pure def consistentRead(s: SkillRead): bool = alwaysAttemptLimit(s) and alwaysAdmittedBytes(s) and alwaysProductionAuthority(s)
pure def stepTerminal(before: SkillRead, after: SkillRead): bool = (before.transport == Admitted or before.transport == Refused) implies after == before
pure def sometimesRetry(s: SkillRead): bool = s.transport == Retry
pure def sometimesExhausted(s: SkillRead): bool = s.transport == Refused and s.attempts == 3
pure def sometimesAdmitted(s: SkillRead): bool = s.transport == Admitted and s.selection.role == ContributorSkill
pure def sometimesReviewerClosed(s: SkillRead): bool = s.transport == Admitted and s.selection.role == ReviewerSkill and not(s.projectOpen)
pure def sometimesWorkingTreeRefused(s: SkillRead): bool = s.transport == Refused and s.checked.provenance == WorkingTree
pure def sometimesFixtureRefused(s: SkillRead): bool = s.transport == Refused and s.source == InjectedFixture
  and s.refusal == InvalidAuthority
pure def sometimesUninstallableRefused(s: SkillRead): bool = s.transport == Refused and s.selection.role == ContributorSkill
  and s.projectFresh and not(s.projectOpen)
```

### Simulation samples cover every role, refused byte checks and closed project views

```quint
pure val sha = "0123456789abcdef0123456789abcdef01234567"
pure val contributorSelection: Selection = { role: ContributorSkill, project: 1, commit: sha, registryRevision: 1, registryDigest: "m1" }
pure val selectionValues = Set(contributorSelection, { ...contributorSelection, role: ReviewerSkill },
  { role: StaticSkill, project: 0, commit: sha, registryRevision: 0, registryDigest: "" }, { ...contributorSelection, commit: "" })
pure val exactBytes: ByteCheck = { commit: sha, provenance: Committed, completeFiles: true, matchingBlobs: true, renderedDigest: "m1" }
pure val factsValues = Set(exactBytes, { ...exactBytes, completeFiles: false }, { ...exactBytes, provenance: WorkingTree },
  { ...exactBytes, renderedDigest: "m2" })
pure val openView: F::ProjectView = { registered: true, retired: false, legacy: false, paused: false, flagged: false,
  quarantined: false, cleared: true, skillFields: true }
pure val viewValues = Set(openView, { ...openView, flagged: true }, { ...openView, paused: true })
pure val projectValues = Set(1, 2)
pure val weight_selectRole = 4
pure val weight_fetch = 6
pure val weight_compare = 5
pure val weight_observeProject = 5
pure val weight_admit = 6
```
