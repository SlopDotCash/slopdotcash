// @source scripts/prepare-site.mjs
// @evidence tests/e2e/site.spec.ts
// Three global roles and one build. Hash and single-file source validation are
// input predicates, not cryptographic proofs. This covers the newly generated
// skill set; old public files can remain if validation fails before cleanup.
// index and manifest denote this generation only: a failed build can retain
// an older manifest alongside incomplete files and is not an atomic release.
// A later filesystem failure may leave partial build outputs. It cannot reach
// completed metadata or qualify the build for release_publication.
module global_skill_publication {
  val roles = Set(1, 2, 3)
  var s: { stage: str, validated: Set[int], canonical: Set[int],
    aliases: Set[int], index: bool, manifest: bool, oldFiles: bool }
  action init = s' = {stage: "validate", validated: Set(), canonical: Set(),
    aliases: Set(), index: false, manifest: false, oldFiles: true}
  action validate(role: int, valid: bool): bool = all {
    s.stage == "validate", roles.contains(role), not(s.validated.contains(role)),
    s' = if (valid) s.with("validated", s.validated.union(Set(role)))
      else s.with("stage", "failed")
  }
  action clean = all {s.stage == "validate", s.validated == roles,
    s' = s.with("stage", "write").with("oldFiles", false)}
  action writeCanonical(role: int): bool = all {s.stage == "write",
    roles.contains(role), not(s.canonical.contains(role)),
    s' = s.with("canonical", s.canonical.union(Set(role)))}
  action writeAlias(role: int): bool = all {s.stage == "write",
    s.canonical.contains(role), not(s.aliases.contains(role)),
    s' = s.with("aliases", s.aliases.union(Set(role)))}
  action writeIndex = all {s.stage == "write", s.canonical == roles,
    s.aliases == roles, s' = s.with("index", true).with("stage", "metadata")}
  action writeManifest = all {s.stage == "metadata", s.index,
    s' = s.with("manifest", true).with("stage", "complete")}
  action filesystemFailure = all {Set("write", "metadata").contains(s.stage),
    s' = s.with("stage", "failed")}
  action step = any {
    {nondet role = roles.oneOf(); nondet valid = Set(false, true).oneOf();
      validate(role, valid)},
    clean,
    {nondet role = roles.oneOf(); writeCanonical(role)},
    {nondet role = roles.oneOf(); writeAlias(role)},
    writeIndex, writeManifest, filesystemFailure, s' = s
  }
  val invariant = all {
    s.aliases.subseteq(s.canonical),
    s.index implies (s.canonical == roles and s.aliases == roles),
    s.manifest implies s.index,
    not(s.oldFiles) implies s.validated == roles,
    s.stage == "complete" implies (s.index and s.manifest)
  }
  run completeSetTest = init.then(validate(1, true)).then(validate(2, true))
    .then(validate(3, true)).then(clean)
    .then(writeCanonical(1)).then(writeAlias(1))
    .then(writeCanonical(2)).then(writeAlias(2))
    .then(writeCanonical(3)).then(writeAlias(3))
    .then(writeIndex).then(writeManifest).expect(s.stage == "complete")
  run invalidSourceDoesNotReplaceTest = init.then(validate(1, true))
    .then(validate(2, false)).expect(s.oldFiles and not(s.index))
  run interruptedWriteIsIncompleteTest = init.then(validate(1, true))
    .then(validate(2, true)).then(validate(3, true)).then(clean)
    .then(writeCanonical(1)).then(filesystemFailure)
    .expect(s.stage == "failed" and not(s.index) and not(s.manifest))
  run missingRoleCannotPublishIndexTest = init.then(validate(1, true))
    .then(validate(2, true)).then(validate(3, true)).then(clean)
    .then(writeCanonical(1)).then(writeAlias(1)).then(writeIndex.fail())
}
