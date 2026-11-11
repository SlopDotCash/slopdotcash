// @source workers/slopbot/value-patch.ts
// @source workers/slopbot/value-patch-replay.ts
// @source workers/slopbot/value-accepted-range.ts
// @source workers/slopbot/value-manifest-identity.ts
// @source workers/slopbot/git-object.ts
// Two line positions, exact integer line tokens. Match against original parent,
// not progressively changed output; repeated old context is ambiguous.
module bot_patch_replay {
  var s: { parent: List[int], old: int, replacement: int, submitted: List[int],
    accepted: List[int], complete: bool, verified: bool }
  action init = s' = {parent: [1, 2], old: 1, replacement: 3,
    submitted: [3, 2], accepted: [3, 2], complete: true, verified: false}
  val matches = (if (s.parent.nth(0) == s.old) 1 else 0) + (if (s.parent.nth(1) == s.old) 1 else 0)
  val replayed = [if (s.parent.nth(0) == s.old) s.replacement else s.parent.nth(0),
    if (s.parent.nth(1) == s.old) s.replacement else s.parent.nth(1)]
  action ambiguousParent = all { not(s.verified), s' = s.with("parent", [1, 1]) }
  action partialPatch = all { not(s.verified), s' = s.with("complete", false) }
  action acceptedDrift = all { not(s.verified), s' = s.with("accepted", [3, 3]) }
  action verify = all { s.complete, matches == 1, replayed == s.accepted,
    s.submitted == s.accepted, s' = s.with("verified", true) }
  action step = any { ambiguousParent, partialPatch, acceptedDrift, verify, s' = s }
  val invariant = s.verified implies s.complete and matches == 1 and replayed == s.accepted
  run exactReplayTest = init.then(verify).expect(s.verified and invariant)
  run ambiguousContextRefusedTest = init.then(ambiguousParent).expect(matches == 2 and not(s.verified))
  run partialPatchRefusedTest = init.then(partialPatch).expect(not(s.verified))
}
