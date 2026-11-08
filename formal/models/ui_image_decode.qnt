// @source src/ProjectImageField.tsx
// @source src/ProjectProposalPage.tsx
// One decode per mounted field; explicit reset remounts it. A second field may
// decode while the departed bitmap remains pending. Two generations and jobs.
// Browser byte decoding and canvas format admission are abstract predicates.
module ui_image_decode {
  var s:{generation:int,pending:Set[int],decoded:Set[int],closed:Set[int],phase:str,image:int}
  action init = s'={generation:1,pending:Set(),decoded:Set(),closed:Set(),phase:"idle",image:0}
  action choose = all {s.phase=="idle",not(s.pending.contains(s.generation)),
    s'=s.with("pending",s.pending.union(Set(s.generation))).with("phase","decoding")
      .with("closed",s.closed.exclude(Set(s.generation)))}
  action rejectType = all {s.phase=="idle",s'=s.with("phase","error")}
  action discardDraft = all {s.generation==1,
    s'=s.with("generation",2).with("image",0).with("phase","idle")}
  action decode(job:int):bool = all {s.pending.contains(job),not(s.decoded.contains(job)),
    s'=s.with("decoded",s.decoded.union(Set(job)))}
  action closeJob(job:int):bool = s'=s.with("pending",s.pending.exclude(Set(job)))
    .with("decoded",s.decoded.exclude(Set(job))).with("closed",s.closed.union(Set(job)))
  action encodeCurrent = all {s.decoded.contains(s.generation),
    s'=s.with("image",s.generation).with("phase","idle")
      .with("pending",s.pending.exclude(Set(s.generation)))
      .with("decoded",s.decoded.exclude(Set(s.generation)))
      .with("closed",s.closed.union(Set(s.generation)))}
  action invalidImage = all {s.decoded.contains(s.generation),
    s'=s.with("phase","error").with("pending",s.pending.exclude(Set(s.generation)))
      .with("decoded",s.decoded.exclude(Set(s.generation)))
      .with("closed",s.closed.union(Set(s.generation)))}
  action closeDepartedBitmap = all {s.generation==2,s.decoded.contains(1),closeJob(1)}
  action remove = all {s.phase=="idle",s'=s.with("image",0)}
  action step = any {choose,rejectType,discardDraft,decode(1),decode(2),encodeCurrent,
    invalidImage,closeDepartedBitmap,remove,s'=s}
  val invariant = all {s.image==0 or s.image==s.generation,
    s.closed.intersect(s.pending)==Set(),s.decoded.subseteq(s.pending)}
  run discardedDecodeTest = init.then(choose).then(discardDraft).then(decode(1))
    .then(closeDepartedBitmap).expect(s.image==0 and s.closed.contains(1))
  run successfulDecodeTest = init.then(choose).then(decode(1)).then(encodeCurrent)
    .expect(s.image==1 and s.closed.contains(1) and s.phase=="idle")
  run invalidDecodeClosesTest = init.then(choose).then(decode(1)).then(invalidImage)
    .expect(s.phase=="error" and s.closed.contains(1) and s.image==0)
  run overlappingGenerationsTest = init.then(choose).then(discardDraft).then(choose)
    .then(decode(2)).then(encodeCurrent).then(decode(1)).then(closeDepartedBitmap)
    .expect(s.image==2 and s.closed==Set(1,2))
}
