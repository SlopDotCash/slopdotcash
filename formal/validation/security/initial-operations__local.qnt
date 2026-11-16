module operations__local { // # Isolated local identity and private storage

// PRD section 9 permits the existing GitHub App to issue a single-use,
// loopback-bound handoff for local development. It requires separate local data,
// real authorization and no implicit production signer or real email delivery.

// ## Story: Sign into local development without creating production authority

// ### A handoff binds one actor, exact loopback origin and environment

// ```quint
type HandoffPhase = NotIssued | Issued | Consumed | Expired
type Handoff = { phase: HandoffPhase, actor: int, originPort: int, nonce: int, expiresAt: int, clock: int, localSession: bool, productionAssertion: bool, localStore: int, productionStore: int }
pure val initial: Handoff = { phase: NotIssued, actor: 0, originPort: 0, nonce: 0, expiresAt: 0, clock: 0, localSession: false, productionAssertion: false, localStore: 1, productionStore: 2 }
pure def canIssue(h: Handoff, actor: int, originPort: int, nonce: int, expiresAt: int): bool = h.phase == NotIssued and actor > 0 and originPort > 0 and originPort <= 65535 and nonce > 0 and expiresAt > h.clock
pure def issue(h: Handoff, actor: int, originPort: int, nonce: int, expiresAt: int): Handoff = { ...h, phase: Issued, actor: actor, originPort: originPort, nonce: nonce, expiresAt: expiresAt }
pure def canConsume(h: Handoff, actor: int, originPort: int, nonce: int, loopback: bool, production: bool): bool = h.phase == Issued and h.clock < h.expiresAt and actor == h.actor and originPort == h.originPort and nonce == h.nonce and loopback and not(production)
pure def consume(h: Handoff, actor: int, originPort: int, nonce: int, loopback: bool, production: bool): Handoff = { ...h, phase: Consumed, localSession: true }
pure def canAdvanceTime(h: Handoff, time: int): bool = time >= h.clock
pure def advanceTime(h: Handoff, time: int): Handoff = { ...h, clock: time, phase: if (h.phase == Issued and time >= h.expiresAt) Expired else h.phase }
pure def alwaysLocalOnly(h: Handoff): bool = not(h.productionAssertion) and h.localStore != h.productionStore
pure def alwaysSingleUse(h: Handoff): bool = h.localSession implies h.phase == Consumed
pure def sometimesLocalSession(h: Handoff): bool = h.localSession
pure def sometimesExpired(h: Handoff): bool = h.phase == Expired
// ```

// Local report writes, background assessment and private reads use the local
// store and the same authorization rules. The identity adapter validates the
// actual loopback host, scheme and complete origin before the port reaches this
// model. Handoff expiry and consumption are atomic database checks. Retired
// isolated test identity stacks and the v1 secure-VM pipeline stay inactive.

// ### Simulation samples exercise missing, matching and conflicting evidence

// These input sets bound simulation only. The generated guards accept every
// value allowed by their declared types and product rules.

// ```quint
pure val actorValues = Set(0, 1, 2)
pure val expiresAtValues = Set(1, 3)
pure val nonceValues = Set(0, 1, 2)
pure val originPortValues = Set(3000, 3001)
pure val timeValues = Set(0, 1, 4)
// ```

}
