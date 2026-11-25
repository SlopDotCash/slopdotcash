// @source migrations/0154_security_read_keys.sql
// @source backend/security/read-key.ts
// @source src/lib/security-read-key.ts
// @source src/SecurityReadKey.tsx
// One account and its personal read-only security key. At most one key is in
// use; a new key or a revoke stops the old one at once; a key is accepted
// only on a read of the security lists or one record, never on a write or
// another API, and never for a closed account.
module api_security_read_key {
  // inUse: the key in use, 0 for none. made: keys created so far.
  // closed: the account is closed. writes: writes a key was accepted for.
  var s: { inUse: int, made: int, closed: bool, writes: int }
  action init = s' = {inUse: 0, made: 0, closed: false, writes: 0}
  // Only the website session creates or revokes; a key cannot.
  action create = all { s.made < 3, not(s.closed),
    s' = s.with("made", s.made + 1).with("inUse", s.made + 1) }
  action revoke = all { s.inUse > 0, s' = s.with("inUse", 0) }
  action close = all { not(s.closed), s' = s.with("closed", true) }
  // read: a GET of a list or one record. Anything else is never accepted.
  def accepted(key: int, read: bool): bool =
    read and key > 0 and key == s.inUse and not(s.closed)
  action request(key: int, read: bool): bool =
    s' = (if (accepted(key, read) and not(read)) s.with("writes", s.writes + 1)
      else s)
  action step = { nondet key = Set(0, 1, 2, 3).oneOf()
    nondet read = Set(true, false).oneOf()
    any { create, revoke, close, request(key, read) } }
  val invariant = all { s.writes == 0, s.inUse <= s.made,
    Set(1, 2, 3).forall(key => not(accepted(key, false))),
    Set(1, 2, 3).filter(key => accepted(key, true)).size() <= 1 }
  run createdKeyReadsTest = init.then(create)
    .expect(accepted(1, true) and not(accepted(1, false)))
  run replacedKeyStopsTest = init.then(create).then(create)
    .expect(not(accepted(1, true)) and accepted(2, true))
  run revokedKeyStopsTest = init.then(create).then(revoke)
    .expect(not(accepted(1, true)))
  run closedAccountReadsNothingTest = init.then(create).then(close)
    .expect(not(accepted(1, true)))
}
