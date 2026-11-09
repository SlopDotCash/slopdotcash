// @source backend/trace/handler.ts
// @source backend/trace/cloudflare-persistence.ts
// @source backend/payments/wallet-registration.ts
// @source backend/notifications/events.ts
// @source migrations/0003_wallet_claim_registry.sql
// @source migrations/0010_wallet_claim_chain.sql
// @source migrations/0017_robinhood_chain.sql
// @source migrations/0021_multi_asset_vault_snapshots.sql
// @evidence scripts/wallet-legacy-claim-confirm.test.ts
// @evidence backend/notifications/notifications.test.ts
// Two actors, all four chain labels (1 Solana, 2 Base, 3 Robinhood, 4 Ethereum),
// two address classes and two concurrent request slots, each with one retry.
// At most two historical roots and four fresh candidate IDs give six rows.
// Clock/observation ranks are 0..2; no physical-time or eventual-success claim.
// A request keeps its actor/mode/chain on retry but may refresh its predecessor.
// Addresses/body validation, hashes and generated IDs are predicates/classes;
// hashes are collision-free over represented canonical fields and IDs fresh.
// material represents source-body/issue fields in the record digest. Login
// classes 1/2 differ only by case, while 3 is a different lowercase login.
// sameDigest is exact canonical-record equality except ID/createdAt, matching
// lookup by record_sha256. The shared insert checks it before predecessor
// validation; the contributor handler's earlier current-tip check still runs.
// The head map is the derived unsuperseded-leaf query, not another stored table.
// Effective one-root/one-successor/owner/chain constraints and immutable history
// are the migrated schema contract, including later four-chain migrations.
// Contributor CAS/no-op models createContributorWalletClaim: the requested
// predecessor must match before a same-address registry/login-case no-op.
// Operator recovery always writes Solana and may replay an older digest without
// a current-tip precheck. Its authority and source/time validation are explicit.
// registerPaymentWallet's different login-insensitive no-op and winner reread
// are excluded; sharing insertWalletClaim does not make those callers identical.
// Claim/audit/notice share one atomic D1 batch. Error or bad/missing metadata
// can follow commit; catch rereads digest, then a competing root/successor.
// Old seed rows may predate these side effects. Notice delivery/email is not
// modeled. wallet_observations (0015) are separate evidence and never claims.
// No claim or possession observation authorizes payment or changes obligations.
// Existing tests cover historical confirmation and one-time wallet notices;
// they are partial evidence, not execution of all races below. This model and
// its scenarios were authored and reviewed without running a parser/checker.
// The finite step uses reviewed reductions (see the comment at step and
// formal/README.md); direct actions and named scenarios keep full behavior.
module wallet_claim_publication {
  val actors = Set(1, 2)
  val chains = Set(1, 2, 3, 4)
  val rows = Set(1, 2, 3, 4, 5, 6)
  val lineages = 1.to(8)
  val slots = Set(1, 2)
  val sources = Set("registry", "historical")
  type Claim = { exists: bool, id: int, actor: int, chain: int, address: int,
    login: int, source: str, observed: int, created: int, predecessor: int, material: int }
  type Request = { phase: str, attempt: int, mode: str, claim: Claim, tip: int,
    outcome: str, returned: int, disposition: str, desired: str, response: str }
  val absent: Claim = { exists: false, id: 0, actor: 1, chain: 1, address: 0,
    login: 0, source: "none", observed: -1, created: -1, predecessor: 0, material: 0 }
  val idle: Request = { phase: "unused", attempt: 0, mode: "contributor", claim: absent,
    tip: 0, outcome: "none", returned: 0, disposition: "none", desired: "none", response: "none" }
  var s: { configured: bool, now: int, history: int -> Claim, heads: int -> int,
    audits: Set[int], notices: Set[int], requests: int -> Request,
    reads: int, observedCurrent: int }
  action init = s' = { configured: false, now: 0, history: rows.mapBy(_ => absent),
    heads: lineages.mapBy(_ => 0), audits: Set(), notices: Set(),
    requests: slots.mapBy(_ => idle), reads: 0, observedCurrent: 0 }
  def lineage(actor: int, chain: int): int = (actor - 1) * 4 + chain
  def claimAt(id: int): Claim = if (id == 0) absent else s.history.get(id)
  def loginFold(login: int): int = if (login == 2) 1 else login
  def sameDigest(a: Claim, b: Claim): bool = a.actor == b.actor and a.chain == b.chain
    and a.address == b.address and a.login == b.login and a.source == b.source
    and a.observed == b.observed and a.predecessor == b.predecessor and a.material == b.material
  def matches(id: int, claim: Claim): bool = s.history.get(id).exists and sameDigest(s.history.get(id), claim)
  def digestRow(claim: Claim): int = if (matches(1, claim)) 1 else if (matches(2, claim)) 2
    else if (matches(3, claim)) 3 else if (matches(4, claim)) 4 else if (matches(5, claim)) 5
    else if (matches(6, claim)) 6 else 0
  def ending(request: Request, status: str): Request = request.with("phase", "reply").with("desired", status)
  // Projection used only by step (project=true). begin reads a done request's
  // attempt, mode, actor and chain. The invariant also reads its returned row,
  // whether desired is "201", whether outcome is "committed" and, in those two
  // cases, its claim ID. No other reader exists, so every other field is
  // written as a fixed representative. The reply phase is read only by
  // respond, whose projected successor depends on nothing else, and the
  // invariant has the same value there as in that successor; a projected
  // reply therefore moves directly to that done state.
  def finished(request: Request): Request = {
    val keepsId = request.desired == "201" or request.outcome == "committed"
    idle.with("phase", "done").with("attempt", request.attempt).with("mode", request.mode)
      .with("claim", absent.with("actor", request.claim.actor).with("chain", request.claim.chain)
        .with("id", if (keepsId) request.claim.id else 0))
      .with("returned", request.returned)
      .with("desired", if (request.desired == "201") "201" else "other")
      .with("outcome", if (request.outcome == "committed") "committed" else "none")
  }
  def replied(request: Request, project: bool): Request =
    if (project and request.phase == "reply") finished(request) else request
  def existing(request: Request, id: int): Request = ending(request, "200")
    .with("returned", id).with("disposition", "existing")
  def seed(id: int, actor: int, chain: int, source: str): Claim = { exists: true, id: id,
    actor: actor, chain: chain, address: 1, login: 1, source: source,
    observed: 0, created: 0, predecessor: 0, material: 1 }
  action configure(kind: str): bool = {
    val first = kind != "none"
    val second = Set("two-chains", "two-actors").contains(kind)
    val one = seed(1, 1, 1, if (kind == "registry") "registry" else "historical")
    val two = seed(2, if (kind == "two-actors") 2 else 1, if (kind == "two-chains") 2 else 1, "historical")
    all { not(s.configured), Set("none", "legacy", "registry", "two-chains", "two-actors").contains(kind),
      s' = s.with("configured", true)
        .with("history", s.history.set(1, if (first) one else absent).set(2, if (second) two else absent))
        .with("heads", if (second) s.heads.set(lineage(one.actor, one.chain), 1).set(lineage(two.actor, two.chain), 2)
          else if (first) s.heads.set(lineage(one.actor, one.chain), 1) else s.heads) }
  }
  action tick = all { s.configured, s.now < 2, s' = s.with("now", s.now + 1) }
  action begin(slot: int, mode: str, actor: int, chain: int, address: int, login: int,
    predecessor: int, source: str, observed: int, material: int): bool = {
    val prior = s.requests.get(slot)
    val effectiveChain = if (mode == "operator") 1 else chain
    val claim = absent.with("actor", actor).with("chain", effectiveChain).with("address", address)
      .with("login", login).with("predecessor", predecessor).with("source", if (mode == "contributor") "registry" else source)
      .with("observed", observed).with("material", material)
    all { s.configured, slots.contains(slot), Set("contributor", "operator").contains(mode), actors.contains(actor),
      chains.contains(chain), Set(1, 2).contains(address), Set(1, 2, 3).contains(login), 0.to(6).contains(predecessor),
      sources.contains(source), 0.to(2).contains(observed), Set(1, 2).contains(material),
      Set("unused", "done").contains(prior.phase), prior.attempt < 2,
      prior.attempt > 0 implies mode == prior.mode and actor == prior.claim.actor and effectiveChain == prior.claim.chain,
      s' = s.with("requests", s.requests.set(slot, idle.with("phase", "authority").with("attempt", prior.attempt + 1)
        .with("mode", mode).with("claim", claim))) }
  }
  action authority(slot: int, permitted: bool): bool = authorityWith(slot, permitted, false)
  action authorityWith(slot: int, permitted: bool, project: bool): bool = {
    val request = s.requests.get(slot)
    all { request.phase == "authority", s' = s.with("requests", s.requests.set(slot,
      replied(if (permitted) request.with("phase", "body") else ending(request, "403"), project))) }
  }
  action body(slot: int, valid: bool): bool = bodyWith(slot, valid, false)
  action bodyWith(slot: int, valid: bool, project: bool): bool = {
    val request = s.requests.get(slot)
    val accepted = valid and (request.mode != "operator" or request.claim.observed <= s.now)
    all { request.phase == "body", s' = s.with("requests", s.requests.set(slot,
      replied(if (accepted) request.with("phase", if (request.mode == "contributor") "tip" else "capture")
        .with("claim", if (request.mode == "operator") request.claim.with("created", s.now) else request.claim)
      else ending(request, "400"), project))) }
  }
  action readTip(slot: int, ok: bool): bool = readTipWith(slot, ok, false)
  action readTipWith(slot: int, ok: bool, project: bool): bool = {
    val request = s.requests.get(slot)
    val claim = request.claim
    val tip = s.heads.get(lineage(claim.actor, claim.chain))
    val current = claimAt(tip)
    val same = current.exists and current.source == "registry" and current.address == claim.address
      and loginFold(current.login) == loginFold(claim.login)
    val nextValue = if (not(ok)) ending(request, "500") else if (tip != claim.predecessor) ending(request, "409")
      else if (same) existing(request, tip) else request.with("phase", "capture")
    all { request.phase == "tip", s' = s.with("requests", s.requests.set(slot, replied(nextValue.with("tip", tip), project))) }
  }
  action capture(slot: int): bool = {
    val request = s.requests.get(slot)
    val claim = request.claim.with("id", 2 + (slot - 1) * 2 + request.attempt)
      .with("created", if (request.mode == "contributor") s.now else request.claim.created)
      .with("observed", if (request.mode == "contributor") s.now else request.claim.observed)
      .with("material", if (request.mode == "contributor") 1 else request.claim.material)
    all { request.phase == "capture", s' = s.with("requests", s.requests.set(slot,
      request.with("phase", "hash").with("claim", claim))) }
  }
  action prepare(slot: int, ok: bool): bool = prepareWith(slot, ok, false)
  action prepareWith(slot: int, ok: bool, project: bool): bool = {
    val request = s.requests.get(slot)
    all { request.phase == "hash", s' = s.with("requests", s.requests.set(slot,
      replied(if (ok) request.with("phase", "digest-read") else ending(request, "500"), project))) }
  }
  action readDigest(slot: int, ok: bool): bool = readDigestWith(slot, ok, false)
  action readDigestWith(slot: int, ok: bool, project: bool): bool = {
    val request = s.requests.get(slot)
    val found = digestRow(request.claim)
    all { request.phase == "digest-read", s' = s.with("requests", s.requests.set(slot,
      replied(if (not(ok)) ending(request, "500") else if (found != 0) existing(request, found)
      else request.with("phase", if (request.claim.predecessor == 0) "batch" else "predecessor"), project))) }
  }
  action readPredecessor(slot: int, ok: bool): bool = readPredecessorWith(slot, ok, false)
  action readPredecessorWith(slot: int, ok: bool, project: bool): bool = {
    val request = s.requests.get(slot)
    val claim = request.claim
    val previous = claimAt(claim.predecessor)
    val matches = previous.exists and previous.actor == claim.actor and previous.chain == claim.chain
    all { request.phase == "predecessor", s' = s.with("requests", s.requests.set(slot,
      replied(if (not(ok)) ending(request, "500") else if (matches) request.with("phase", "batch") else ending(request, "409"), project))) }
  }
  action batch(slot: int, succeeds: bool): bool = {
    val request = s.requests.get(slot)
    val claim = request.claim
    val readHead = s.heads.get(lineage(claim.actor, claim.chain))
    val allowed = readHead == claim.predecessor and digestRow(claim) == 0
    val commit = succeeds and allowed
    all { request.phase == "batch", s' = s
      .with("history", if (commit) s.history.set(claim.id, claim.with("exists", true)) else s.history)
      .with("heads", if (commit) s.heads.set(lineage(claim.actor, claim.chain), claim.id) else s.heads)
      .with("audits", if (commit) s.audits.union(Set(claim.id)) else s.audits)
      .with("notices", if (commit) s.notices.union(Set(claim.id)) else s.notices)
      .with("requests", s.requests.set(slot, request.with("phase", "batch-result")
        .with("outcome", if (commit) "committed" else if (allowed) "rolled-back" else "constraint"))) }
  }
  action batchResult(slot: int, received: bool, metadataValid: bool): bool = batchResultWith(slot, received, metadataValid, false)
  action batchResultWith(slot: int, received: bool, metadataValid: bool, project: bool): bool = {
    val request = s.requests.get(slot)
    val success = request.outcome == "committed" and received and metadataValid
    all { request.phase == "batch-result", s' = s.with("requests", s.requests.set(slot,
      replied(if (success) ending(request, "201").with("returned", request.claim.id).with("disposition", "created")
      else request.with("phase", "recovery-digest"), project))) }
  }
  action recoverDigest(slot: int, ok: bool): bool = recoverDigestWith(slot, ok, false)
  action recoverDigestWith(slot: int, ok: bool, project: bool): bool = {
    val request = s.requests.get(slot)
    val found = digestRow(request.claim)
    all { request.phase == "recovery-digest", s' = s.with("requests", s.requests.set(slot,
      replied(if (not(ok)) ending(request, "500") else if (found != 0) existing(request, found)
      else request.with("phase", "competing"), project))) }
  }
  action readCompeting(slot: int, ok: bool): bool = readCompetingWith(slot, ok, false)
  action readCompetingWith(slot: int, ok: bool, project: bool): bool = {
    val request = s.requests.get(slot)
    val claim = request.claim
    val readHead = s.heads.get(lineage(claim.actor, claim.chain))
    val competitor = if (claim.predecessor == 0) readHead != 0 else readHead != claim.predecessor
    all { request.phase == "competing", s' = s.with("requests", s.requests.set(slot,
      replied(ending(request, if (ok and competitor) "409" else "500"), project))) }
  }
  action respond(slot: int, delivered: bool): bool = {
    val request = s.requests.get(slot)
    all { request.phase == "reply", s' = s.with("requests", s.requests.set(slot,
      request.with("phase", "done").with("response", if (delivered) request.desired else "lost"))) }
  }
  action readCurrent(actor: int, chain: int): bool = all { s.configured, actors.contains(actor), chains.contains(chain), s.reads < 2,
    s' = s.with("reads", s.reads + 1).with("observedCurrent", s.heads.get(lineage(actor, chain))) }
  // Finite step reductions (direct actions and scenarios are unchanged):
  // - Small shared choices stay hoisted; the request inputs are bound only by
  //   begin, after its own guards. The transition relation is the same, but
  //   TLC no longer evaluates every action for every hoisted combination, and
  //   the simulator does not retry them while begin is disabled.
  // - An operator request always uses lineage chain 1, so every chain choice
  //   yields the same successor; step offers chain 1 only.
  // - A contributor request forces source "registry", and capture overwrites
  //   its observed and material values before any guard, update or invariant
  //   reads them; step uses the representatives 0 and 1 that capture keeps
  //   for material and replaces for observed.
  // - readCurrent changes only reads and observedCurrent. No other guard,
  //   update or invariant reads either field, so step omits it; scenarios
  //   still exercise it. Every full-model state therefore agrees with a
  //   reduced reachable state on all fields the invariant reads.
  // - Replies are written through the projection at finished, so step does
  //   not use respond.
  // - now is read only by body and capture; the invariant checks its range.
  //   Once no slot can begin again (attempt 2) or still reach those reads,
  //   a tick is unobservable, so step offers tick only while one can.
  // - Local actions first. begin, authority, prepare and batchResult, body for
  //   a contributor and capture for an operator read only their own slot (and
  //   the fixed configured flag) and write only that slot. They commute with
  //   every action of the other slot and of the environment, and no other
  //   action can disable them. A tick they make unobservable changes only now,
  //   which nothing reads afterwards. The shared conjuncts of the invariant
  //   read only history, heads, audits and notices, which local actions do not
  //   change; a slot's own conjunct reads its own fields and rows and audits,
  //   which are only ever added and never changed. When some slot has a local
  //   action, step therefore takes only the local actions of the lowest such
  //   slot (an ample set). Non-local actions keep their order, so every shared
  //   state is still reached, and each slot reaches each of its own states with
  //   no more rows than in the full model, where its conjunct can only be
  //   harder to satisfy.
  val clockLive = slots.exists(slot => s.requests.get(slot).attempt < 2
    or Set("authority", "body", "tip", "capture").contains(s.requests.get(slot).phase))
  // - Value symmetry. Actor, address and EVM chain (2, 3, 4) values are
  //   compared only for equality (actor and chain also select a lineage, over
  //   which the invariant quantifies), and login values only through
  //   loginFold, whose classes {1, 2} and {3} a swap of 1 and 2 preserves.
  //   Only the seeded rows and the operator's chain 1 name constants. A
  //   permutation that fixes every value already present in a row or a
  //   started request therefore maps reachable states to reachable states and
  //   preserves the invariant. When begin chooses a value not yet present, it
  //   uses the smallest such value (login 3 forms its own class). Including
  //   extra values in the present set only adds choices.
  val started = slots.filter(slot => s.requests.get(slot).phase != "unused")
  val presentRows = rows.filter(id => s.history.get(id).exists)
  val presentClaims = presentRows.map(id => s.history.get(id)).union(started.map(slot => s.requests.get(slot).claim))
  val presentActors = presentClaims.map(c => c.actor)
  val presentAddresses = presentClaims.map(c => c.address)
  val presentLogins = presentClaims.map(c => c.login)
  val presentChains = presentClaims.map(c => c.chain)
  // The values already present plus the smallest value that is not.
  def canonical(domain: Set[int], present: Set[int]): Set[int] =
    domain.filter(v => present.contains(v) or domain.forall(w => w >= v or present.contains(w)))
  def localReady(slot: int): bool = {
    val r = s.requests.get(slot)
    (s.configured and Set("unused", "done").contains(r.phase) and r.attempt < 2)
      or Set("authority", "hash", "batch-result").contains(r.phase)
      or (r.phase == "body" and r.mode == "contributor") or (r.phase == "capture" and r.mode == "operator")
  }
  val focus = if (localReady(1)) 1 else if (localReady(2)) 2 else 0
  action step = {
    nondet slot = slots.oneOf()
    nondet yes = Set(false, true).oneOf()
    nondet other = Set(false, true).oneOf()
    any {
      all { not(s.configured), {
        nondet seedKind = Set("none", "legacy", "registry", "two-chains", "two-actors").oneOf()
        configure(seedKind) } },
      all { focus == 0, clockLive, tick },
      all { focus == 0 or focus == slot, local(slot, yes, other) },
      all { focus == 0, any { readTipWith(slot, yes, true), readDigestWith(slot, yes, true),
        readPredecessorWith(slot, yes, true), batch(slot, yes), recoverDigestWith(slot, yes, true),
        readCompetingWith(slot, yes, true) } },
      s' = s }
  }
  // The actions of one slot that read and write only that slot.
  action local(slot: int, yes: bool, other: bool): bool = {
    val prior = s.requests.get(slot)
    any {
      all { s.configured, Set("unused", "done").contains(prior.phase), prior.attempt < 2, {
        // A retry must keep the first attempt's mode, actor and chain, so it
        // binds them from that attempt instead of choosing them again.
        val retry = prior.attempt > 0
        nondet fresh = canonical(actors, presentActors).oneOf()
        val actor = if (retry) prior.claim.actor else fresh
        nondet address = canonical(Set(1, 2), presentAddresses).oneOf()
        nondet login = canonical(Set(1, 2), presentLogins).union(Set(3)).oneOf()
        nondet predecessor = 0.to(6).oneOf()
        any {
          all { not(retry and prior.mode != "contributor"), {
            nondet chosen = Set(1).union(canonical(Set(2, 3, 4), presentChains)).oneOf()
            val chain = if (retry) prior.claim.chain else chosen
            begin(slot, "contributor", actor, chain, address, login, predecessor, "registry", 0, 1) } },
          all { not(retry and prior.mode != "operator"), {
            nondet source = sources.oneOf() nondet observed = 0.to(2).oneOf() nondet material = Set(1, 2).oneOf()
            begin(slot, "operator", actor, 1, address, login, predecessor, source, observed, material) } } } } },
      authorityWith(slot, yes, true), bodyWith(slot, yes, true), capture(slot), prepareWith(slot, yes, true),
      batchResultWith(slot, yes, other, true) }
  }
  val newRows = rows.filter(id => id > 2 and s.history.get(id).exists)
  val invariant = all {
    s.now >= 0, s.now <= 2, s.audits == newRows, s.notices == newRows,
    rows.forall(id => {
      val row = s.history.get(id)
      not(row.exists) or (row.id == id and actors.contains(row.actor) and chains.contains(row.chain)
        and (row.predecessor == 0 or (claimAt(row.predecessor).exists
          and claimAt(row.predecessor).actor == row.actor and claimAt(row.predecessor).chain == row.chain)))
    }),
    rows.forall(a => rows.forall(b => a == b or not(s.history.get(a).exists and s.history.get(b).exists)
      or (not(sameDigest(s.history.get(a), s.history.get(b)))
        and (s.history.get(a).predecessor == 0 or s.history.get(a).predecessor != s.history.get(b).predecessor)
        and (s.history.get(a).predecessor != 0 or s.history.get(b).predecessor != 0
          or s.history.get(a).actor != s.history.get(b).actor or s.history.get(a).chain != s.history.get(b).chain)))),
    lineages.forall(key => {
      val readHead = s.heads.get(key)
      readHead == 0 or (claimAt(readHead).exists and lineage(claimAt(readHead).actor, claimAt(readHead).chain) == key
        and rows.forall(id => not(s.history.get(id).exists) or s.history.get(id).predecessor != readHead))
    }),
    slots.forall(slot => {
      val request = s.requests.get(slot)
      all { request.attempt >= 0, request.attempt <= 2,
        request.returned != 0 implies claimAt(request.returned).exists
          and claimAt(request.returned).actor == request.claim.actor and claimAt(request.returned).chain == request.claim.chain,
        request.desired == "201" implies request.outcome == "committed" and request.returned == request.claim.id,
        request.outcome == "committed" implies claimAt(request.claim.id).exists and s.audits.contains(request.claim.id) }
    }) }

  action contributor(slot: int, actor: int, chain: int, address: int, login: int, predecessor: int): bool =
    begin(slot, "contributor", actor, chain, address, login, predecessor, "registry", 0, 1)
      .then(authority(slot, true)).then(body(slot, true)).then(readTip(slot, true))
  action operator(slot: int, actor: int, address: int, predecessor: int, observed: int, material: int): bool =
    begin(slot, "operator", actor, 1, address, 1, predecessor, "registry", observed, material)
      .then(authority(slot, true)).then(body(slot, true))
  action candidate(slot: int): bool = capture(slot).then(prepare(slot, true)).then(readDigest(slot, true))
  action stored(slot: int): bool = batch(slot, true).then(batchResult(slot, true, true)).then(respond(slot, true))
  action rootClaim(slot: int, actor: int, chain: int, address: int): bool = contributor(slot, actor, chain, address, 1, 0)
    .then(candidate(slot)).then(stored(slot))
  action successor(slot: int, predecessor: int, address: int): bool = contributor(slot, 1, 1, address, 1, predecessor)
    .then(candidate(slot)).then(readPredecessor(slot, true)).then(stored(slot))

  run emptyLineageReadsAsMissingTest = init.then(configure("none")).then(readCurrent(1, 1))
    .expect(s.observedCurrent == 0 and invariant)
  run contributorCreatesRootWithAtomicSideEffectsTest = init.then(configure("none")).then(rootClaim(1, 1, 1, 1))
    .expect(s.requests.get(1).response == "201" and s.audits == Set(3) and s.notices == Set(3) and invariant)
  run missingAuthorityPreventsClaimTest = init.then(configure("none"))
    .then(begin(1, "operator", 1, 1, 1, 1, 0, "registry", 0, 1)).then(authority(1, false)).then(respond(1, true))
    .expect(s.requests.get(1).response == "403" and s.audits == Set() and invariant)
  run invalidBodyPreventsClaimTest = init.then(configure("none"))
    .then(begin(1, "contributor", 1, 1, 1, 1, 0, "registry", 0, 1)).then(authority(1, true)).then(body(1, false)).then(respond(1, true))
    .expect(s.requests.get(1).response == "400" and invariant)
  run futureOperatorObservationRefusesTest = init.then(configure("none"))
    .then(begin(1, "operator", 1, 1, 1, 1, 0, "registry", 1, 1)).then(authority(1, true)).then(body(1, true)).then(respond(1, true))
    .expect(s.requests.get(1).response == "400" and invariant)
  run sameAddressRegistryClaimIsNoopTest = init.then(configure("registry")).then(contributor(1, 1, 1, 1, 1, 1)).then(respond(1, true))
    .expect(s.requests.get(1).response == "200" and s.requests.get(1).returned == 1 and s.audits == Set() and invariant)
  run caseOnlyLoginDifferenceIsNoopTest = init.then(configure("registry")).then(contributor(1, 1, 1, 1, 2, 1)).then(respond(1, true))
    .expect(s.requests.get(1).returned == 1 and s.history.get(1).login == 1 and s.notices == Set() and invariant)
  run changedLoginAppendsRegistryClaimTest = init.then(configure("registry")).then(contributor(1, 1, 1, 1, 3, 1))
    .then(candidate(1)).then(readPredecessor(1, true)).then(stored(1)).expect(s.heads.get(1) == 3 and invariant)
  run predecessorMismatchRefusesBeforeNoopTest = init.then(configure("registry")).then(contributor(1, 1, 1, 1, 1, 0)).then(respond(1, true))
    .expect(s.requests.get(1).response == "409" and s.audits == Set() and invariant)
  run historicalSameAddressNeedsRegistrySuccessorTest = init.then(configure("legacy")).then(successor(1, 1, 1))
    .expect(s.history.get(1).source == "historical" and s.history.get(3).source == "registry" and s.heads.get(1) == 3 and invariant)
  run independentChainsKeepIndependentHeadsTest = init.then(configure("none")).then(rootClaim(1, 1, 2, 1)).then(rootClaim(2, 1, 4, 2))
    .expect(s.heads.get(2) == 3 and s.heads.get(4) == 5 and invariant)
  run separateActorsKeepIndependentRootsTest = init.then(configure("none")).then(rootClaim(1, 1, 1, 1)).then(rootClaim(2, 2, 1, 1))
    .expect(s.heads.get(1) == 3 and s.heads.get(5) == 5 and invariant)
  run anotherActorsPredecessorRefusesTest = init.then(configure("two-actors"))
    .then(operator(1, 1, 2, 2, 0, 1)).then(candidate(1)).then(readPredecessor(1, true)).then(respond(1, true))
    .expect(s.requests.get(1).response == "409" and s.audits == Set() and invariant)
  run anotherChainsPredecessorRefusesTest = init.then(configure("two-chains"))
    .then(operator(1, 1, 2, 2, 0, 1)).then(candidate(1)).then(readPredecessor(1, true)).then(respond(1, true))
    .expect(s.requests.get(1).response == "409" and invariant)
  run missingPredecessorRefusesTest = init.then(configure("none")).then(operator(1, 1, 1, 2, 0, 1))
    .then(candidate(1)).then(readPredecessor(1, true)).then(respond(1, true)).expect(s.requests.get(1).response == "409" and invariant)
  run identicalConcurrentRootsRecoverOneDigestTest = init.then(configure("none"))
    .then(contributor(1, 1, 1, 1, 1, 0)).then(candidate(1)).then(contributor(2, 1, 1, 1, 1, 0)).then(candidate(2))
    .then(stored(1)).then(batch(2, true)).then(batchResult(2, true, true)).then(recoverDigest(2, true)).then(respond(2, true))
    .expect(s.requests.get(2).response == "200" and s.requests.get(2).returned == 3 and s.audits == Set(3) and invariant)
  run differentConcurrentRootsConflictTest = init.then(configure("none"))
    .then(contributor(1, 1, 1, 1, 1, 0)).then(candidate(1)).then(contributor(2, 1, 1, 2, 1, 0)).then(candidate(2))
    .then(stored(1)).then(batch(2, true)).then(batchResult(2, true, true)).then(recoverDigest(2, true)).then(readCompeting(2, true)).then(respond(2, true))
    .expect(s.requests.get(2).response == "409" and s.heads.get(1) == 3 and s.notices == Set(3) and invariant)
  run concurrentSuccessorsCannotForkTest = init.then(configure("legacy"))
    .then(contributor(1, 1, 1, 1, 1, 1)).then(candidate(1)).then(readPredecessor(1, true))
    .then(contributor(2, 1, 1, 2, 1, 1)).then(candidate(2)).then(readPredecessor(2, true))
    .then(stored(1)).then(batch(2, true)).then(batchResult(2, true, true)).then(recoverDigest(2, true)).then(readCompeting(2, true)).then(respond(2, true))
    .expect(s.requests.get(2).response == "409" and not(s.history.get(5).exists) and invariant)
  run timestampDifferencePreventsLogicalDuplicateDigestReplayTest = init.then(configure("none"))
    .then(contributor(1, 1, 1, 1, 1, 0)).then(candidate(1)).then(contributor(2, 1, 1, 1, 1, 0)).then(tick).then(candidate(2))
    .then(stored(1)).then(batch(2, true)).then(batchResult(2, true, true)).then(recoverDigest(2, true)).then(readCompeting(2, true)).then(respond(2, true))
    .expect(s.requests.get(2).response == "409" and invariant)
  run batchFailureRollsBackClaimAuditAndNoticeTest = init.then(configure("none")).then(contributor(1, 1, 1, 1, 1, 0)).then(candidate(1))
    .then(batch(1, false)).then(batchResult(1, true, true)).then(recoverDigest(1, true)).then(readCompeting(1, true)).then(respond(1, true))
    .expect(s.requests.get(1).response == "500" and not(s.history.get(3).exists) and s.audits == Set() and s.notices == Set() and invariant)
  run committedBatchLostReplyRecoversExistingTest = init.then(configure("none")).then(contributor(1, 1, 1, 1, 1, 0)).then(candidate(1))
    .then(batch(1, true)).then(batchResult(1, false, true)).then(recoverDigest(1, true)).then(respond(1, true))
    .expect(s.requests.get(1).response == "200" and s.audits == Set(3) and s.notices == Set(3) and invariant)
  run badMetadataDoesNotUndoAtomicPublicationTest = init.then(configure("none")).then(contributor(1, 1, 1, 1, 1, 0)).then(candidate(1))
    .then(batch(1, true)).then(batchResult(1, true, false)).then(recoverDigest(1, true)).then(respond(1, true))
    .expect(s.requests.get(1).response == "200" and s.heads.get(1) == 3 and invariant)
  run recoveryReadFailureKeepsCommittedRowsTest = init.then(configure("none")).then(contributor(1, 1, 1, 1, 1, 0)).then(candidate(1))
    .then(batch(1, true)).then(batchResult(1, false, true)).then(recoverDigest(1, false)).then(respond(1, true))
    .expect(s.requests.get(1).response == "500" and s.history.get(3).exists and s.notices == Set(3) and invariant)
  run lostContributorResponseNeedsRefreshedPredecessorTest = init.then(configure("none"))
    .then(contributor(1, 1, 1, 1, 1, 0)).then(candidate(1)).then(batch(1, true)).then(batchResult(1, true, true)).then(respond(1, false))
    .then(contributor(1, 1, 1, 1, 1, 0)).then(respond(1, true))
    .expect(s.requests.get(1).response == "409" and s.audits == Set(3) and invariant)
  run refreshedContributorRetryReturnsNoopTest = init.then(configure("none"))
    .then(contributor(1, 1, 1, 1, 1, 0)).then(candidate(1)).then(batch(1, true)).then(batchResult(1, true, true)).then(respond(1, false))
    .then(contributor(1, 1, 1, 1, 1, 3)).then(respond(1, true))
    .expect(s.requests.get(1).response == "200" and s.requests.get(1).returned == 3 and s.audits == Set(3) and invariant)
  run operatorAlwaysUsesSolanaLineageTest = init.then(configure("none"))
    .then(begin(1, "operator", 1, 4, 1, 1, 0, "registry", 0, 1)).then(authority(1, true)).then(body(1, true))
    .then(candidate(1)).then(stored(1)).expect(s.heads.get(1) == 3 and s.heads.get(4) == 0 and invariant)
  run historicalDigestReplayCanReturnNoncurrentRecordTest = init.then(configure("registry"))
    .then(successor(1, 1, 2)).then(operator(2, 1, 1, 0, 0, 1)).then(candidate(2)).then(respond(2, true))
    .expect(s.requests.get(2).returned == 1 and s.heads.get(1) == 3 and s.audits == Set(3) and invariant)
  run operatorCannotAppendToAnOldPredecessorTest = init.then(configure("legacy")).then(successor(1, 1, 2))
    .then(operator(2, 1, 1, 1, 0, 2)).then(candidate(2)).then(readPredecessor(2, true))
    .then(batch(2, true)).then(batchResult(2, true, true)).then(recoverDigest(2, true)).then(readCompeting(2, true)).then(respond(2, true))
    .expect(s.requests.get(2).response == "409" and s.heads.get(1) == 3 and invariant)
  run returnedCreatedRecordMayAlreadyHaveSuccessorTest = init.then(configure("legacy"))
    .then(contributor(1, 1, 1, 2, 1, 1)).then(candidate(1)).then(readPredecessor(1, true)).then(batch(1, true)).then(batchResult(1, true, true))
    .then(successor(2, 3, 1)).then(respond(1, true))
    .expect(s.requests.get(1).returned == 3 and s.heads.get(1) == 5 and s.audits == Set(3, 5) and invariant)
  run currentReadIsAnObservationNotLiveHeadTest = init.then(configure("legacy")).then(readCurrent(1, 1)).then(successor(1, 1, 2))
    .expect(s.observedCurrent == 1 and s.heads.get(1) == 3 and invariant)
  run noopResponseCanFollowAnotherReplacementTest = init.then(configure("registry"))
    .then(contributor(1, 1, 1, 1, 1, 1)).then(successor(2, 1, 2)).then(respond(1, true))
    .expect(s.requests.get(1).returned == 1 and s.heads.get(1) == 5 and s.notices == Set(5) and invariant)
  run olderObservationCanBeTheNewestLineageLeafTest = init.then(configure("legacy")).then(tick).then(tick)
    .then(successor(1, 1, 2)).then(operator(2, 1, 1, 3, 0, 2)).then(candidate(2)).then(readPredecessor(2, true)).then(stored(2))
    .then(readCurrent(1, 1)).expect(s.observedCurrent == 5 and s.history.get(5).observed < s.history.get(3).observed and invariant)
  run operatorKeepsClockCapturedBeforeHashingTest = init.then(configure("none"))
    .then(operator(1, 1, 1, 0, 0, 1)).then(tick).then(candidate(1)).then(stored(1))
    .expect(s.history.get(3).created == 0 and s.now == 1 and invariant)
  run pendingHashDoesNotPublishClaimTest = init.then(configure("none")).then(contributor(1, 1, 1, 1, 1, 0)).then(capture(1))
    .expect(s.requests.get(1).phase == "hash" and not(s.history.get(3).exists) and s.audits == Set() and invariant)
}
