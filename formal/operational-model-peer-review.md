# Operational model peer review

This review compared the seven requested root models with their current source
entry points. It changed models, not application behavior.

- `dev_server_lifecycle`: a thrown health request may spawn the owned backend;
  a received health response for another origin logs refusal and does not spawn.
  Added the distinct mismatch path. Closing still fences late transport failure.
  Other fixture protocols remain partial source references.
- `dev_registry_import`: represented the local flow, polling, expiry and failed
  assertion persistence. The bridge deletes a completed remote flow before its
  local assertion write; failure requires a new flow. An in-flight accepted
  remote reply can complete after the local flow expires. Multi-project database
  transaction rollback and full OAuth schema remain outside this model.
- `registry_snapshot_publication`: retained the non-atomic two-file write model.
  Removed the cycle-index source attribution because its directory swap has a
  different failure mode; the new `cycle_snapshot_publication` models that path.
- `cycle_snapshot_publication`: promotion is written before the public tree is
  staged. The old tree is removed before rename, so rename failure can leave no
  public tree. Check-only verifies source/promotion; it does not attest public
  tree presence. This observed contract is represented without claiming atomic
  preservation or changing the source implementation.
- `quality_capture`: added complete empty-census publication. Diff mismatch is
  advisory; head/closure mismatch during discussion capture is a hard refusal.
  Weight is a fixed input carried through annotation, not recomputed from flags.
  Full pagination, raw evidence grammar and source-hash equality are predicates.
- `quality_simulation`: added computation and output-write failure paths, renamed
  a reserved `export` action, and labeled decision arithmetic as an abstraction.
  A calculated proposal remains explicitly unable to authorize payment.
- `static_asset_generation`: social output requires a launched browser, fonts and
  layout; terminal cleanup closes the browser; invalid inputs can fail before
  launching. Added no-output/closed-browser and existing partial-output paths.
- `deployment_probe`: split per-resource limits: one production request, three
  staging transport attempts, six staging-root attempts. Added first-request
  production failure and success on the sixth root request. These remain partial
  per-resource models, not a proof of all headers, body schemas or URL probes.

The source JSON grammars and external-process behavior are not refinement-proved.
No local test here proves live deployment, real GitHub login or a payment.
