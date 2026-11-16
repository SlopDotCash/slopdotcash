# Pull request evidence artifact transport

PRD sections 4 and 12. Pull request evidence artifacts are fetched only from
approved HTTPS origins (`scripts/pr-evidence-artifacts.mjs`,
`scripts/pr-evidence-policy.mjs`, legacy `artifact_transport`). This is a
transport and control contract, not a media-parser proof. The GitHub API
credential is sent only to the GitHub authority and never follows a CDN
redirect. A transient failure retries from the original authority, with at
most two attempts and four trusted redirects. Partial media has no full
digest, and an incomplete document is refused.

## Story: Fetch evidence without leaking the credential or accepting partial documents

### Each request carries a credential only at the GitHub authority

```quint
type Origin = GitHubAuthority | TrustedCdn
type TransportPhase = ArtifactReady | ArtifactWaiting | ArtifactRetry | ArtifactDone | ArtifactFailed
type Call = { origin: Origin, token: bool }
type FailureCause = NoFailure | UntrustedRedirect | RedirectLimit | AttemptsExhausted | TerminalResponse
type Artifact = { origin: Origin, phase: TransportPhase, attempts: int, redirects: int, calls: List[Call], accepted: bool,
  fullDigest: bool, failure: FailureCause }
pure val maxAttempts = 2
pure val maxRedirects = 4
pure val initial: Artifact = { origin: GitHubAuthority, phase: ArtifactReady, attempts: 0, redirects: 0, calls: List(),
  accepted: false, fullDigest: false, failure: NoFailure }
pure def carriesCredential(origin: Origin): bool = origin == GitHubAuthority
pure def canRequest(a: Artifact): bool = a.phase == ArtifactReady and (a.origin == TrustedCdn or a.attempts < maxAttempts)
pure def request(a: Artifact): Artifact = { ...a, phase: ArtifactWaiting,
  attempts: if (a.origin == GitHubAuthority) a.attempts + 1 else a.attempts,
  calls: a.calls.append({ origin: a.origin, token: carriesCredential(a.origin) }) }
pure def canRedirect(a: Artifact, trusted: bool): bool = a.phase == ArtifactWaiting
pure def redirect(a: Artifact, trusted: bool): Artifact =
  if (trusted and a.redirects < maxRedirects) { ...a, origin: TrustedCdn, phase: ArtifactReady, redirects: a.redirects + 1 }
  else { ...a, phase: ArtifactFailed, failure: if (trusted) RedirectLimit else UntrustedRedirect }
pure def canTransientFailure(a: Artifact): bool = a.phase == ArtifactWaiting
pure def transientFailure(a: Artifact): Artifact =
  if (a.attempts < maxAttempts) { ...a, phase: ArtifactRetry } else { ...a, phase: ArtifactFailed, failure: AttemptsExhausted }
pure def canRetry(a: Artifact): bool = a.phase == ArtifactRetry
pure def retry(a: Artifact): Artifact = { ...a, origin: GitHubAuthority, redirects: 0, phase: ArtifactReady }
pure def canTerminalFailure(a: Artifact): bool = a.phase == ArtifactWaiting
pure def terminalFailure(a: Artifact): Artifact = { ...a, phase: ArtifactFailed, failure: TerminalResponse }
pure def canAccept(a: Artifact, valid: bool, complete: bool, document: bool): bool =
  a.phase == ArtifactWaiting and valid and (not(document) or complete)
pure def accept(a: Artifact, valid: bool, complete: bool, document: bool): Artifact =
  { ...a, phase: ArtifactDone, accepted: true, fullDigest: complete }
pure def alwaysTokenOnlyAtAuthority(a: Artifact): bool = a.calls.every(c => c.token iff c.origin == GitHubAuthority)
  and ((a.phase == ArtifactFailed) iff (a.failure != NoFailure))
pure def alwaysBounded(a: Artifact): bool = 0 <= a.attempts and a.attempts <= maxAttempts and 0 <= a.redirects and a.redirects <= maxRedirects
pure def alwaysDigestNeedsAcceptance(a: Artifact): bool = (a.fullDigest implies a.accepted) and (a.accepted iff a.phase == ArtifactDone)
pure def stepTerminal(before: Artifact, after: Artifact): bool =
  (before.phase == ArtifactDone or before.phase == ArtifactFailed) implies after == before
pure def sometimesRetriedFromAuthority(a: Artifact): bool = a.accepted and a.attempts == 2
  and a.calls.some(c => c.origin == TrustedCdn and not(c.token)) and a.calls.some(c => c.token)
pure def sometimesPartialMedia(a: Artifact): bool = a.accepted and not(a.fullDigest)
pure def sometimesUntrustedRedirectRefused(a: Artifact): bool = a.failure == UntrustedRedirect and a.attempts == 1
pure def sometimesRedirectLimit(a: Artifact): bool = a.failure == RedirectLimit
