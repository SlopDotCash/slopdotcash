// @source src/lib/document-head.ts
// @source src/App.tsx
// @source src/Presentation.tsx
// @evidence tests/e2e/navigation.spec.ts
// Two mounted not-found views, null/two canonical paths, and existing metadata.
// This models effect ordering, not DOM parsing or search-engine behavior.
module ui_document_head {
  type Head={path:int,missing:Set[int],canonical:int,robots:str,og:int,ogPresent:bool}
  pure val views=Set(1,2)
  pure def headAfter(value:Head):Head =
    if(value.path==0 or value.missing.size()>0)
      value.with("canonical",0).with("robots","noindex")
    else value.with("canonical",value.path)
      .with("robots",if(value.robots=="noindex")"absent" else value.robots)
      .with("og",if(value.ogPresent)value.path else value.og)
  var s:Head
  action init=s'={path:0,missing:Set(),canonical:0,robots:"absent",og:0,ogPresent:true}
  action setRoute(path:int):bool=all{path>=0,path<=2,s'=headAfter(s.with("path",path))}
  action mountMissing(id:int):bool=all{views.contains(id),not(s.missing.contains(id)),
    s'=headAfter(s.with("missing",s.missing.union(Set(id))))}
  action unmountMissing(id:int):bool=all{s.missing.contains(id),
    s'=headAfter(s.with("missing",s.missing.exclude(Set(id))))}
  action existingRobots=all{s.path==0,s.missing.size()==0,s.robots=="absent",s'=s.with("robots","other")}
  action noOpenGraphElement=all{s.path==0,s.missing.size()==0,s.og==0,s'=s.with("ogPresent",false)}
  action step={nondet path=Set(0,1,2).oneOf() nondet id=views.oneOf()
    any{setRoute(path),mountMissing(id),unmountMissing(id),existingRobots,noOpenGraphElement,s'=s}}
  // At initial page construction no applyHead has run yet. After a route or
  // hook effect the canonical/robots fields follow the current conjunction.
  val invariant=all{s.missing.subseteq(views),s.canonical>=0,s.canonical<=2,
    s.missing.size()>0 implies (s.canonical==0 and s.robots=="noindex"),
    s.canonical>0 implies (s.canonical==s.path and s.missing.size()==0)}
  run validRouteGetsCanonicalTest=init.then(setRoute(1)).expect(s.canonical==1 and s.og==1 and s.robots=="absent")
  run missingAfterRouteRemovesCanonicalTest=init.then(setRoute(1)).then(mountMissing(1))
    .expect(s.canonical==0 and s.robots=="noindex" and s.og==1)
  run routeAfterMissingStaysNoindexTest=init.then(mountMissing(1)).then(setRoute(1))
    .expect(s.canonical==0 and s.robots=="noindex")
  run lastMissingCleanupRestoresCurrentRouteTest=init.then(setRoute(1)).then(mountMissing(1)).then(mountMissing(2))
    .then(setRoute(2)).then(unmountMissing(1)).expect(s.canonical==0)
    .then(unmountMissing(2)).expect(s.canonical==2 and s.robots=="absent" and s.og==2)
  run nullRouteAfterCleanupStaysNoindexTest=init.then(setRoute(1)).then(mountMissing(1)).then(setRoute(0))
    .then(unmountMissing(1)).expect(s.canonical==0 and s.robots=="noindex")
  run unrelatedRobotsValueIsPreservedTest=init.then(existingRobots).then(setRoute(1)).expect(s.robots=="other")
  run missingOpenGraphElementIsNotCreatedTest=init.then(noOpenGraphElement).then(setRoute(2))
    .expect(not(s.ogPresent) and s.og==0 and s.canonical==2)
}
