// @source workers/vetting/acquire.ts
// @source workers/vetting/queue.ts
// @source workers/vetting/run.ts
// @source workers/vetting/assembly-manifest.ts
// @source workers/vetting/review-plan.ts
// Pinned manifest/source/template integrity and complete batch review. Three
// batches represent an arbitrary finite partition, not a repository size cap.
module vetting_acquisition {
  var s: { phase: str, queued: bool, manifest: bool, source: bool, templates: bool,
    reviewed: Set[int], gaps: bool, modelCompleted: bool, published: bool }
  action init = s' = { phase: "queued", queued: true, manifest: false,
    source: false, templates: false, reviewed: Set(), gaps: false,
    modelCompleted: false, published: false }
  action rereadQueue = all { s.queued, s.phase == "queued", s' = s.with("phase", "acquiring") }
  action pinManifest = all { s.phase == "acquiring", s' = s.with("manifest", true) }
  action pinSource = all { s.phase == "acquiring", s.manifest, s' = s.with("source", true) }
  action pinTemplates = all { s.phase == "acquiring", s.manifest, s' = s.with("templates", true) }
  action reviewBatch(batch) = all { s.phase == "acquiring", s.source, s.templates, batch.in(Set(1, 2, 3)),
    s' = s.with("reviewed", s.reviewed.union(Set(batch))) }
  action missingCoverage = all { not(s.published), s' = s.with("gaps", true) }
  action synthesize = all { s.phase == "acquiring", s.reviewed == Set(1, 2, 3), s' = s.with("modelCompleted", true) }
  action publishClean = all {
    s.phase == "acquiring", s.manifest, s.source, s.templates, s.modelCompleted, not(s.gaps),
    s' = s.with("phase", "complete").with("published", true),
  }
  action refuse = all { not(s.published), s' = s.with("phase", "refused") }
  action step = {
    nondet batch = Set(1, 2, 3).oneOf()
    any { rereadQueue, pinManifest, pinSource, pinTemplates, reviewBatch(batch), missingCoverage, synthesize, publishClean, refuse }
  }
  val invariant = all {
    s.published implies all { s.manifest, s.source, s.templates, s.modelCompleted,
      s.reviewed == Set(1, 2, 3), not(s.gaps) },
    s.queued,
  }
  run completePinnedAcquisitionTest = init.then(rereadQueue).then(pinManifest).then(pinSource)
    .then(pinTemplates).then(reviewBatch(1)).then(reviewBatch(2)).then(reviewBatch(3))
    .then(synthesize).then(publishClean).expect(s.published)
  run acquisitionFailureDoesNotConsumeQueueTest = init.then(rereadQueue).then(pinManifest).then(refuse)
    .expect(s.queued and not(s.published))
  run partialBatchCannotClearTest = init.then(rereadQueue).then(pinManifest).then(pinSource)
    .then(pinTemplates).then(reviewBatch(1)).then(missingCoverage)
    .expect(not(s.modelCompleted) and not(s.published))
}
