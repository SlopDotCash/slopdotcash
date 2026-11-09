// @source backend/points/handler.ts
// @source backend/payments/wallet-registration.ts
// One numeric GitHub identity, two node-id spellings and two logins. The
// authentication service attests the same numeric identity for both spellings.
// Wallet addresses are 0 or 1. Atomic database batches are modeled as one action.
module identities {
  var s: { joined: bool, closed: bool, actor: int, firstActor: int, login: int, session: bool,
    wallet: int, claim: int, history: List[int] }
  action init = s' = {joined: false, closed: false, actor: -1, firstActor: -1, login: 0,
    session: false, wallet: -1, claim: 0, history: List()}
  def joinAllowed(reopen: bool): bool = not(s.closed) or reopen
  action join(node: int, login: int, reopen: bool): bool = all {
    joinAllowed(reopen),
    s' = s.with("joined", true).with("closed", false).with("session", true)
      .with("actor", if(s.joined) s.actor else node)
      .with("firstActor", if(s.joined) s.firstActor else node).with("login", login) }
  action close = all {s.joined, not(s.closed),
    s' = s.with("closed", true).with("session", false)}
  action wallet(address: int): bool = all {s.session,
    s' = if(s.wallet == address) s else s.with("wallet", address)
      .with("claim", s.claim + 1).with("history", s.history.append(address))}
  action step = {
    nondet node = Set(0, 1).oneOf()
    nondet login = Set(0, 1).oneOf()
    nondet reopen = Set(false, true).oneOf()
    nondet address = Set(0, 1).oneOf()
    any {join(node, login, reopen), close,
      all {s.claim < 3, wallet(address)}, s' = s}
  }
  val invariant = all {s.session implies s.joined and not(s.closed),
    s.joined implies Set(0,1).contains(s.actor) and s.actor == s.firstActor, s.claim == s.history.length(),
    s.claim == 0 iff s.wallet == -1}
  run renameTest = init.then(join(0, 0, false)).then(wallet(0))
    .then(join(1, 1, false)).then(wallet(0))
    .expect(s.actor == 0 and s.login == 1 and s.claim == 1)
  run reopenTest = init.then(join(0,0,false)).then(close)
    .then(join(1,1,true)).expect(s.actor == 0 and not(s.closed))
  run noImplicitReopenTest = init.then(join(0,0,false)).then(close)
    .expect(not(joinAllowed(false)))
}
