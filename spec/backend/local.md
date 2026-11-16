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
  sessionStore: Store, writes: List[Store], mails: List[MailProvider], signatures: List[SignerKind] }
pure val initial: Handoff = { phase: NotIssued, actor: 0, originPort: 0, nonce: 0, expiresAt: 0, clock: 0, localSession: false,
  sessionStore: LocalStore, writes: List(), mails: List(), signatures: List() }
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
pure def canDeliverMail(h: Handoff, provider: MailProvider): bool = h.localSession and provider == LocalSink
pure def deliverMail(h: Handoff, provider: MailProvider): Handoff = { ...h, mails: h.mails.append(provider) }
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
```
