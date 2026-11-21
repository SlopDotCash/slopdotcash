// @source backend/projects/appended-repositories.ts
// @source backend/projects/handler.ts
// @source src/lib/project-policy.mjs
// @source src/lib/project-schema.mjs
// @evidence scripts/project-self-service.test.ts
// @evidence scripts/project-add-repository.test.ts
// Owner append of repositories to an existing project (PRD section 4, setup
// requirements, 12 November 2026). Two projects, each with its original
// repository (identities 1 and 2), and candidate identities 3 and 4. Identity
// 4 stands for any repository GitHub refuses (a fork, archived, private, or
// GitHub facts that differ from the entry). One integer stands for the
// numeric id and node id together; a mismatch of either is the same refusal.
//
// An owner submits a whole repository list. The decision follows
// publishOwnerRevision: a permanent identity that any project already lists
// (this project included) is a registry conflict before schema validation;
// a list that is not the stored list plus a suffix fails the policy
// transition (`invalid_manifest`); an unchanged list is `no_change`; then
// verifyAppendedRepositories checks the start month, the GitHub facts and
// the owner's write/maintain/admin authority through Slopbot on that
// repository, in that order. Only an accepted append changes the list. It
// pauses the project and leaves the repository unscanned until its own scan
// or exemption clears it (vetting_repository_clearance models that); the
// project reactivates once every repository clears (a clean result reruns
// the setup check), and never while a listed repository is unscanned.
//
// Bounds: three entries per project, months 0 to 2, one appended entry per
// submission (the multi-entry submission repeats the same checks per entry,
// with earlier entries of the submission counted as listed). `addedAt` and
// `authorized` are ghost fields recording the server clock and the owner's
// authority at the accepted write.
module project_repository_append {
  type Entry = { gh: int, start: int, addedAt: int, authorized: bool }
  type S = { lists: int -> List[Entry], origin: int -> List[Entry], status: int -> str,
    now: int, authority: int -> Set[int], unscanned: Set[int], result: str }
  pure val projects = Set(1, 2)
  pure val identities = Set(1, 2, 3, 4)
  // Identities GitHub reports as public, not a fork and not archived.
  pure val publicSource = Set(1, 2, 3)
  pure val maxEntries = 3
  pure val lastMonth = 2
  var s: S

  pure def ghs(l: List[Entry]): Set[int] = l.foldl(Set(), (acc, e) => acc.union(Set(e.gh)))
  pure def isPrefix(old: List[Entry], cand: List[Entry]): bool =
    if (cand.length() < old.length()) false
    else old.indices().forall(i => old[i] == cand[i])
  def listedAll(x: S): Set[int] = projects.fold(Set(), (acc, p) => acc.union(ghs(x.lists.get(p))))
  // The work of an entry counts in a UTC month from its start month on.
  pure def counts(e: Entry, month: int): bool = e.start <= month

  def decide(x: S, p: int, cand: List[Entry]): str = {
    val old = x.lists.get(p)
    val added = if (cand.length() > old.length()) ghs(cand.slice(old.length(), cand.length())) else Set()
    if (added.exists(g => listedAll(x).contains(g))) "registry_conflict"
    else if (not(isPrefix(old, cand))) "invalid_manifest"
    else if (cand == old) "no_change"
    else {
      val e = cand[cand.length() - 1]
      if (e.start != x.now + 1) "invalid_repository_start"
      else if (not(publicSource.contains(e.gh))) "invalid_repository"
      else if (not(x.authority.get(p).contains(e.gh))) "authority_required"
      else "accepted"
    }
  }

  action init = {
    val lists = Map(1 -> List({ gh: 1, start: 0, addedAt: 0, authorized: true }),
      2 -> List({ gh: 2, start: 0, addedAt: 0, authorized: true }))
    s' = { lists: lists, origin: lists, status: Map(1 -> "active", 2 -> "active"), now: 0,
      authority: Map(1 -> Set(1), 2 -> Set(2)), unscanned: Set(), result: "none" }
  }
  action submit(p: int, cand: List[Entry]): bool = {
    val r = decide(s, p, cand)
    s' = if (r == "accepted")
      s.with("lists", s.lists.set(p, cand)).with("status", s.status.set(p, "paused"))
        .with("unscanned", s.unscanned.union(Set(cand[cand.length() - 1].gh))).with("result", r)
    else s.with("result", r)
  }
  action submitAppend(p: int, gh: int, start: int): bool = all {
    s.lists.get(p).length() < maxEntries,
    submit(p, s.lists.get(p).append({ gh: gh, start: start, addedAt: s.now,
      authorized: s.authority.get(p).contains(gh) })),
  }
  action submitRemove(p: int): bool = {
    val l = s.lists.get(p)
    all { l.length() >= 2, submit(p, l.slice(0, l.length() - 1)) }
  }
  action submitReorder(p: int): bool = {
    val l = s.lists.get(p)
    all { l.length() >= 2, submit(p, List(l[1], l[0]).concat(l.slice(2, l.length()))) }
  }
  action submitRename(p: int, gh: int): bool = {
    val l = s.lists.get(p)
    all { l.length() >= 2, gh != l[l.length() - 1].gh,
      submit(p, l.slice(0, l.length() - 1).append(l[l.length() - 1].with("gh", gh))) }
  }
  action submitUnchanged(p: int): bool = submit(p, s.lists.get(p))
  action grant(p: int, gh: int): bool =
    s' = s.with("authority", s.authority.set(p, s.authority.get(p).union(Set(gh)))).with("result", "none")
  action revoke(p: int, gh: int): bool =
    s' = s.with("authority", s.authority.set(p, s.authority.get(p).exclude(Set(gh)))).with("result", "none")
  // The repository's own admission scan or exemption clears it.
  action clearRepository(gh: int): bool = all { s.unscanned.contains(gh),
    s' = s.with("unscanned", s.unscanned.exclude(Set(gh))).with("result", "none") }
  action reactivate(p: int): bool = all { s.status.get(p) == "paused",
    ghs(s.lists.get(p)).forall(g => not(s.unscanned.contains(g))),
    s' = s.with("status", s.status.set(p, "active")).with("result", "none") }
  action advanceMonth = all { s.now < lastMonth, s' = s.with("now", s.now + 1).with("result", "none") }

  action step = any {
    { nondet p = projects.oneOf() nondet gh = identities.oneOf() nondet start = 0.to(lastMonth + 1).oneOf()
      submitAppend(p, gh, start) },
    { nondet p = projects.oneOf() submitRemove(p) },
    { nondet p = projects.oneOf() submitReorder(p) },
    { nondet p = projects.oneOf() nondet gh = identities.oneOf() submitRename(p, gh) },
    { nondet p = projects.oneOf() submitUnchanged(p) },
    { nondet p = projects.oneOf() nondet gh = identities.oneOf() grant(p, gh) },
    { nondet p = projects.oneOf() nondet gh = identities.oneOf() revoke(p, gh) },
    { nondet gh = identities.oneOf() clearRepository(gh) },
    { nondet p = projects.oneOf() reactivate(p) },
    advanceMonth,
  }

  val invariant = all {
    // No permanent identity is listed twice, in one project or across projects.
    projects.fold(0, (n, p) => n + s.lists.get(p).length()) == listedAll(s).size(),
    // Append only: the original list stays a prefix; nothing is removed,
    // reordered or replaced.
    projects.forall(p => isPrefix(s.origin.get(p), s.lists.get(p))),
    projects.forall(p => s.lists.get(p)[0] == s.origin.get(p)[0]),
    // Every appended entry was public, authorized at its write and counts
    // from the month after it was added, never in its own month.
    projects.forall(p => s.lists.get(p).indices().forall(i => i == 0 or all {
      publicSource.contains(s.lists.get(p)[i].gh),
      s.lists.get(p)[i].authorized,
      s.lists.get(p)[i].start == s.lists.get(p)[i].addedAt + 1,
      not(counts(s.lists.get(p)[i], s.lists.get(p)[i].addedAt)),
    })),
    // An active project has no listed repository waiting on its own clearance.
    projects.forall(p => s.status.get(p) == "active" implies
      ghs(s.lists.get(p)).forall(g => not(s.unscanned.contains(g)))),
  }

  run appendCountsFromNextMonthTest = init.then(grant(1, 3)).then(submitAppend(1, 3, 1))
    .expect(s.result == "accepted" and s.status.get(1) == "paused" and s.unscanned == Set(3)
      and not(counts(s.lists.get(1)[1], 0)) and counts(s.lists.get(1)[1], 1))
  run laterMonthAppendTest = init.then(advanceMonth).then(grant(2, 3)).then(submitAppend(2, 3, 1))
    .expect(s.result == "invalid_repository_start").then(submitAppend(2, 3, 2))
    .expect(s.result == "accepted" and s.lists.get(2)[1].start == 2)
  run wrongStartMonthRefusedTest = init.then(grant(1, 3)).then(submitAppend(1, 3, 0))
    .expect(s.result == "invalid_repository_start" and s.lists.get(1).length() == 1)
    .then(submitAppend(1, 3, 2)).expect(s.result == "invalid_repository_start")
  run identityReuseRefusedTest = init.then(grant(1, 2)).then(submitAppend(1, 2, 1))
    .expect(s.result == "registry_conflict").then(submitAppend(1, 1, 1))
    .expect(s.result == "registry_conflict" and s.lists.get(1).length() == 1)
  run appendedIdentityReservedTest = init.then(grant(1, 3)).then(submitAppend(1, 3, 1))
    .then(grant(2, 3)).then(submitAppend(2, 3, 1))
    .expect(s.result == "registry_conflict" and s.lists.get(2).length() == 1)
  run refusedSourceTest = init.then(grant(1, 4)).then(submitAppend(1, 4, 1))
    .expect(s.result == "invalid_repository" and s.status.get(1) == "active")
  run authorityRequiredTest = init.then(submitAppend(1, 3, 1))
    .expect(s.result == "authority_required" and s.lists.get(1).length() == 1)
  run removeReorderRenameRefusedTest = init.then(grant(1, 3)).then(submitAppend(1, 3, 1))
    .then(submitRemove(1)).expect(s.result == "invalid_manifest")
    .then(submitReorder(1)).expect(s.result == "invalid_manifest")
    .then(submitRename(1, 4)).expect(s.result == "invalid_manifest" and s.lists.get(1).length() == 2)
    .then(submitUnchanged(1)).expect(s.result == "no_change")
  run lostAuthorityKeepsRepositoryTest = init.then(grant(1, 3)).then(submitAppend(1, 3, 1))
    .then(revoke(1, 3)).expect(ghs(s.lists.get(1)) == Set(1, 3))
  run reactivationRefusedWhileUnscannedTest = init.then(grant(1, 3)).then(submitAppend(1, 3, 1))
    .then(reactivate(1).fail())
  run reactivationAfterClearanceTest = init.then(grant(1, 3)).then(submitAppend(1, 3, 1))
    .then(clearRepository(3)).then(reactivate(1)).expect(s.status.get(1) == "active")
}
