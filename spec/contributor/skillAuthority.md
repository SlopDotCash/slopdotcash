# Commit and registry authority for skill bytes

PRD section 4 and Slop AGENTS govern trust in a downloaded skill. This unit
follows the exact authority adapter in
`skills/project-contributor-template/scripts/skill-authority.mjs`,
`scripts/skill-source-matches-commit.mjs` and its legacy `skill_source_authority`
model at `6b3b9d0b979f0608d87941f1146056a98513ffcf`.
[Installation](./installation.md) consumes this component's admissible bytes
before it stages and activates a version. This authority state represents one
verified payload and one bounded object download at a time. It holds no token,
client secret, local paths, private text, or source bytes.

## Story: Resolve every immutable object with its own bounded retry

### Only the exact GitHub API authority receives the optional credential

The canonical GitHub API resolves the full 40-character commit. Actual commit
syntax, authority and response validation happen in the adapter. Artifact,
registry and raw-file requests carry no GitHub API token. Reject cross-origin
redirects before building the new request, including authenticated redirects.
Tests may inject only deterministic `file://` fixtures rooted under their
configured path and without a credential. Canonical lookup refuses mutable
redirects, incomplete trees, unsafe entries, oversized bodies, unverified blob
identities and file or digest mismatch. Credential handling and hashing need
shell conformance.

```quint
type Authority = CanonicalApi | Registry | RawFiles | Archive | InjectedFixture | OtherOrigin
type Role = StaticSkill | ContributorSkill | ReviewerSkill
type Transport = NewObject | Reading | Retry | Downloaded | Refused | Admitted
type Issue = Timeout | ConnectionReset | AbruptTlsEnd | ServerError | InvalidAuthority | InvalidBytes | SizeExceeded | RateLimited
type Selection = { role: Role, binding: bool, commit: str }
type ByteCheck = { exactCommit: bool, completeFiles: bool, matchingBlobs: bool, approvedManifest: bool, exactRendering: bool }
type SkillRead = { selection: Selection, transport: Transport, attempts: int, checked: ByteCheck, projectOpen: bool }
pure val unchecked: ByteCheck = { exactCommit: false, completeFiles: false, matchingBlobs: false, approvedManifest: false, exactRendering: false }
pure val initial: SkillRead = { selection: { role: ContributorSkill, binding: true, commit: "" }, transport: NewObject,
  attempts: 0, checked: unchecked, projectOpen: false }
pure def transportAllowed(authority: Authority, sameAuthority: bool, fixtureEnabled: bool): bool = sameAuthority and
  authority != OtherOrigin and (authority != InjectedFixture or fixtureEnabled)
pure def sendCredential(authority: Authority, sameAuthority: bool, credentialPresent: bool): bool =
  authority == CanonicalApi and sameAuthority and credentialPresent
pure def lawCredentialStaysOnApi(authority: Authority, sameAuthority: bool, credentialPresent: bool): bool =
  sendCredential(authority, sameAuthority, credentialPresent) implies authority == CanonicalApi and sameAuthority
pure def canSelectRole(s: SkillRead): bool = s.transport == NewObject and s.attempts == 0
pure def selectRole(s: SkillRead, role: Role, binding: bool, commit: str): SkillRead =
  { ...s, selection: { role: role, binding: binding, commit: commit } }
```

### Retry transient transport failures up to three attempts

Each object read has at most three attempts. Delays after the first two
transient failures are two and four seconds. TLS certificate failures are
integrity failures. HTTP rate-limit responses retain the diagnostic and fail
the read. A digest, authority, certificate or size failure never authorizes a
retry of that object. Once all downloaded objects complete, their verified
checks can proceed to payload admission. The adapter must establish that all
required objects ran their own independently bounded read.

```quint
pure def transient(issue: Issue): bool = issue == Timeout or issue == ConnectionReset or issue == AbruptTlsEnd or issue == ServerError
pure def nextDelay(attempts: int): int = if (attempts == 1) 2 else if (attempts == 2) 4 else 0
pure def canFetch(s: SkillRead, authority: Authority, sameAuthority: bool, fixtureEnabled: bool): bool =
  (s.transport == NewObject or s.transport == Retry) and s.attempts < 3 and s.selection.commit != ""
    and transportAllowed(authority, sameAuthority, fixtureEnabled)
pure def fetch(s: SkillRead, authority: Authority, sameAuthority: bool, fixtureEnabled: bool): SkillRead =
  { ...s, transport: Reading, attempts: s.attempts + 1 }
pure def canRejectRead(s: SkillRead): bool = s.transport == Reading
pure def rejectRead(s: SkillRead, issue: Issue): SkillRead =
  { ...s, transport: if (transient(issue) and s.attempts < 3) Retry else Refused }
pure def canDownloadComplete(s: SkillRead): bool = s.transport == Reading
pure def downloadComplete(s: SkillRead): SkillRead = { ...s, transport: Downloaded }
```

## Story: Admit the exact role and rendered payload

### A contributor also needs current clearance for the exact project

A static committed skill has no registry binding and still requires the exact
complete canonical tree and bytes. Generated contributor and reviewer roles
both require the approved immutable D1 digest and exactly rendered files.
Contributors additionally require the current active project, published skill
and repository admission, with a matching project identity. Reviewer read
admission does not impose the contributor-only open-project rule. It confers
no right to contribute or moderate, and generated roles keep separate output.
The approved digest and complete tree are both identity evidence.

```quint
pure def canCompare(s: SkillRead): bool = s.transport == Downloaded
pure def compare(s: SkillRead, facts: ByteCheck): SkillRead = { ...s, checked: facts }
pure def canObserveProject(s: SkillRead): bool = s.transport != Admitted and s.transport != Refused
pure def observeProject(s: SkillRead, active: bool, exactProject: bool, published: bool): SkillRead =
  { ...s, projectOpen: active and exactProject and published }
pure def bytesAdmitted(s: SkillRead): bool = s.selection.commit != "" and s.checked.exactCommit and s.checked.completeFiles and s.checked.matchingBlobs
  and (if (s.selection.role == StaticSkill) not(s.selection.binding)
    else s.selection.binding and s.checked.approvedManifest and s.checked.exactRendering and
      (s.selection.role != ContributorSkill or s.projectOpen))
pure def canAdmit(s: SkillRead): bool = s.transport == Downloaded and bytesAdmitted(s)
pure def admit(s: SkillRead): SkillRead = { ...s, transport: Admitted }
pure def alwaysAttemptLimit(s: SkillRead): bool = 0 <= s.attempts and s.attempts <= 3
  and (s.transport == Retry implies 0 < s.attempts and s.attempts < 3)
  and ((s.transport == Reading or s.transport == Downloaded or s.transport == Admitted) implies s.attempts > 0)
pure def alwaysAdmittedBytes(s: SkillRead): bool = s.transport == Admitted implies bytesAdmitted(s)
pure def stepTerminal(before: SkillRead, after: SkillRead): bool = (before.transport == Admitted or before.transport == Refused) implies after == before
pure def sometimesRetry(s: SkillRead): bool = s.transport == Retry
pure def sometimesExhausted(s: SkillRead): bool = s.transport == Refused and s.attempts == 3
pure def sometimesAdmitted(s: SkillRead): bool = s.transport == Admitted
pure def sometimesReviewerClosed(s: SkillRead): bool = s.transport == Admitted and s.selection.role == ReviewerSkill and not(s.projectOpen)
pure val commitValues = Set("", "0123456789abcdef0123456789abcdef01234567")
pure val exactBytes: ByteCheck = { exactCommit: true, completeFiles: true, matchingBlobs: true, approvedManifest: true, exactRendering: true }
pure val factsValues = Set(exactBytes, { ...exactBytes, completeFiles: false }, { ...exactBytes, matchingBlobs: false },
  { ...exactBytes, approvedManifest: false }, { ...exactBytes, exactRendering: false })
pure val weight_selectRole = 4
pure val weight_fetch = 6
pure val weight_compare = 5
pure val weight_admit = 6
```
