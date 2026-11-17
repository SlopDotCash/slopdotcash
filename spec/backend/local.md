# Isolated local identity and private storage

PRD section 9 permits the existing GitHub App to issue a single-use,
loopback-bound handoff for local development. It requires separate local data,
real authorization and no implicit production signer or real email delivery.

## Story: Sign into local development without creating production authority

### A handoff binds one actor, exact loopback origin and environment

```quint
type HandoffPhase = NotIssued | Issued | Consumed | Expired
type Store = LocalStore | ProductionStore
type MailProvider = LocalSink | RealProvider
type SignerKind = NoSigner | LocalTestSigner | ProductionSigner
type Handoff = { phase: HandoffPhase, actor: int, originPort: int, nonce: int, expiresAt: int, clock: int, localSession: bool,
  sessionStore: Store, writes: List[Store], mails: List[MailProvider], signatures: List[SignerKind],
  mailRecipients: List[int], mailViews: List[MailView] }
pure val initial: Handoff = { phase: NotIssued, actor: 0, originPort: 0, nonce: 0, expiresAt: 0, clock: 0, localSession: false,
  sessionStore: LocalStore, writes: List(), mails: List(), signatures: List(), mailRecipients: List(), mailViews: List() }
pure def canIssue(h: Handoff, actor: int, originPort: int, nonce: int, expiresAt: int): bool = h.phase == NotIssued and actor > 0 and originPort > 0 and originPort <= 65535 and nonce > 0 and expiresAt > h.clock
pure def issue(h: Handoff, actor: int, originPort: int, nonce: int, expiresAt: int): Handoff = { ...h, phase: Issued, actor: actor, originPort: originPort, nonce: nonce, expiresAt: expiresAt }
type Origin = { scheme: str, host: str, port: int }
pure def loopbackOrigin(origin: Origin): bool = origin.scheme == "http"
  and (origin.host == "127.0.0.1" or origin.host == "localhost" or origin.host == "[::1]") and origin.port > 0 and origin.port <= 65535
pure def canConsume(h: Handoff, actor: int, origin: Origin, nonce: int, targetStore: Store): bool = h.phase == Issued and h.clock < h.expiresAt and actor == h.actor and origin.port == h.originPort and nonce == h.nonce and loopbackOrigin(origin) and targetStore == LocalStore
pure def consume(h: Handoff, actor: int, origin: Origin, nonce: int, targetStore: Store): Handoff = { ...h, phase: Consumed, localSession: true, sessionStore: targetStore }
pure def canAdvanceTime(h: Handoff, time: int): bool = time >= h.clock
pure def advanceTime(h: Handoff, time: int): Handoff = { ...h, clock: time, phase: if (h.phase == Issued and time >= h.expiresAt) Expired else h.phase }
pure def canWrite(h: Handoff, targetStore: Store): bool = h.localSession and targetStore == h.sessionStore
pure def write(h: Handoff, targetStore: Store): Handoff = { ...h, writes: h.writes.append(targetStore) }
pure def canDeliverMail(h: Handoff, provider: MailProvider, recipient: int): bool = h.localSession and provider == LocalSink and recipient > 0
pure def deliverMail(h: Handoff, provider: MailProvider, recipient: int): Handoff =
  { ...h, mails: h.mails.append(provider), mailRecipients: h.mailRecipients.append(recipient) }
pure def canSign(h: Handoff, signer: SignerKind): bool = h.localSession and signer == LocalTestSigner
pure def sign(h: Handoff, signer: SignerKind): Handoff = { ...h, signatures: h.signatures.append(signer) }
pure def alwaysLocalOnly(h: Handoff): bool = h.sessionStore == LocalStore and h.writes.every(w => w == LocalStore)
  and h.mails.every(m => m == LocalSink) and h.signatures.every(s => s == LocalTestSigner)
pure def sometimesLocalWork(h: Handoff): bool = h.writes.length() > 0 and h.mails.length() > 0 and h.signatures.length() > 0
pure def alwaysSingleUse(h: Handoff): bool = h.localSession implies h.phase == Consumed
pure def sometimesLocalSession(h: Handoff): bool = h.localSession
pure def sometimesExpired(h: Handoff): bool = h.phase == Expired
```

Local report writes, background assessment and private reads use the local
store and the same authorization rules. In a local session every write
targets the session's local store, mail goes only to the local sink and the
only signer is a local test signer; the notification and signer specs must
take this environment as their delivery and signer input (a composition
obligation). The identity adapter parses the
request's complete origin into its scheme, host and port; this model accepts
only an `http` loopback host with the issued port. Handoff expiry and consumption are atomic database checks. Retired
isolated test identity stacks and the v1 secure-VM pipeline stay inactive.

### Captured local mail is served only by the local development program and only to the signed-in account

The local sink writes each message as its own file, mode 600, in a mode-700
directory of the local data directory, named by its recipient's numeric
GitHub ID; a recipient that is not a positive numeric ID is refused. Only the
local development program (`scripts/dev-backend.ts`, the operations
`local serve` program) answers `GET /__dev/mail`, never a Worker bundle. It
needs a signed-in local session (401 without one), refuses other methods
(405) and shows, newest first, at most 100 messages whose recipient is that
session's account, as a private, uncached, unindexed page whose only links
open the local `/inbox`. Nothing it shows is sent anywhere.

```quint
type MailProgram = LocalDevelopmentProgram | DeployedWorker
type MailView = { viewer: int, program: MailProgram, shown: List[int] }
pure def canViewMail(h: Handoff, viewer: int, program: MailProgram): bool =
  program == LocalDevelopmentProgram and h.localSession and viewer > 0 and viewer == h.actor
pure def viewMail(h: Handoff, viewer: int, program: MailProgram): Handoff =
  { ...h, mailViews: h.mailViews.append({ viewer: viewer, program: program, shown: h.mailRecipients.select(r => r == viewer) }) }
pure def alwaysMailShownOnlyLocallyToItsRecipient(h: Handoff): bool =
  h.mailRecipients.length() == h.mails.length() and h.mailRecipients.every(r => r > 0) and
  (h.mailViews.length() > 0 implies h.localSession) and
  h.mailViews.every(v => v.program == LocalDevelopmentProgram and v.viewer == h.actor and v.shown.every(r => r == v.viewer))
pure def stepMailViewsRetained(before: Handoff, after: Handoff): bool =
  before.mailViews.every(v => after.mailViews.includes(v)) and before.mailRecipients.every(r => after.mailRecipients.includes(r))
pure def sometimesOwnMailShown(h: Handoff): bool = h.mailViews.some(v => v.shown.length() > 0)
pure def sometimesOtherRecipientWithheld(h: Handoff): bool =
  h.mailViews.length() > 0 and h.mailRecipients.some(r => r != h.actor)
```

### Simulation samples exercise missing, matching and conflicting evidence

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules.

```quint
pure val actorValues = Set(0, 1, 2)
pure val expiresAtValues = Set(1, 3)
pure val nonceValues = Set(0, 1, 2)
pure val originPortValues = Set(3000, 3001)
pure val timeValues = Set(0, 1, 4)
pure val originValues = Set({ scheme: "http", host: "127.0.0.1", port: 3000 }, { scheme: "http", host: "localhost", port: 3001 },
  { scheme: "https", host: "127.0.0.1", port: 3000 }, { scheme: "http", host: "slop.cash", port: 3000 })
pure val targetStoreValues = Set(LocalStore, ProductionStore)
pure val providerValues = Set(LocalSink, RealProvider)
pure val signerValues = Set(NoSigner, LocalTestSigner, ProductionSigner)
pure val recipientValues = Set(0, 1, 2)
pure val viewerValues = Set(0, 1, 2)
pure val programValues = Set(LocalDevelopmentProgram, DeployedWorker)
```
