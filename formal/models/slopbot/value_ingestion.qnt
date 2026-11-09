// @source scripts/value-ingestion.ts
// Authoritative fixed-origin histories and fresh GitHub identities are separate
// dependencies. Missing history is not unavailable history. Two joint members
// share one decision; a permitted missing member holds the whole group.
module value_ingestion {
  var s: { phase:str,history:str,repository:bool,sourceMatches:bool,
    members:Set[int],available:Set[int],unavailableMembers:Set[int],actors:bool,decision:str,outputs:Set[int] }
  action init = s'={phase:"new",history:"unchecked",repository:false,
    sourceMatches:false,members:Set(1,2),available:Set(),unavailableMembers:Set(),actors:false,
    decision:"none",outputs:Set()}
  action inspect(history,repository) = all {s.phase=="new",
    s'=s.with("phase","read").with("history",history).with("repository",repository)}
  action missing = all {s.phase=="read",s.history=="empty",s.repository,
    s'=s.with("phase","done").with("decision","missing").with("outputs",Set(1))}
  action source(id,matches) = all {s.phase=="read",s.history=="joint",s.repository,matches,
    not(s.unavailableMembers.contains(id)),
    s'=s.with("available",s.available.union(Set(id))).with("sourceMatches",true)}
  // Only the caller's complete, classified NOT_FOUND response may authorize a
  // held joint source. Transport/permission/partial errors fail the collection.
  action classifyMissingMember(id) = all {s.phase=="read",s.history=="joint",
    s.members.contains(id),not(s.available.contains(id)),
    s'=s.with("unavailableMembers",s.unavailableMembers.union(Set(id)))}
  action hold = all {s.phase=="read",s.history=="joint",s.repository,
    not(s.members.subseteq(s.available)),s.unavailableMembers.size()>0,
    s'=s.with("phase","done").with("decision","held").with("outputs",s.members)}
  action hydrateActors = all {s.phase=="read",s.members.subseteq(s.available),
    s'=s.with("actors",true)}
  action assess = all {s.phase=="read",s.history=="joint",s.repository,s.sourceMatches,
    s.members.subseteq(s.available),s.actors,
    s'=s.with("phase","done").with("decision","assessed").with("outputs",s.members)}
  action unavailable = all {s.phase=="read",s.history=="unavailable",
    s'=s.with("phase","failed")}
  action step = {nondet h=Set("empty","joint","unavailable").oneOf()
    nondet id=Set(1,2).oneOf() nondet b=Set(false,true).oneOf()
    any {inspect(h,b),missing,source(id,b),classifyMissingMember(id),hold,hydrateActors,assess,unavailable,s'=s}}
  val invariant = all {
    s.decision=="assessed" implies (s.repository and s.sourceMatches and s.actors and s.members.subseteq(s.available)),
    Set("assessed","held").contains(s.decision) implies s.outputs==s.members,
    s.history=="unavailable" implies s.decision=="none",
    s.decision=="missing" implies s.history=="empty",
    s.decision=="held" implies s.unavailableMembers.size()>0,
    s.available.intersect(s.unavailableMembers).size()==0,
  }
  run outageNeverBecomesEmptyTest = init.then(inspect("unavailable",true)).then(unavailable)
    .expect(s.phase=="failed" and s.decision=="none" and invariant)
  run unavailableJointMemberHoldsGroupTest = init.then(inspect("joint",true)).then(source(1,true))
    .then(classifyMissingMember(2)).then(hold).expect(s.decision=="held" and s.outputs==Set(1,2) and invariant)
  run allSourcesAndActorsRequiredTest = init.then(inspect("joint",true)).then(source(1,true))
    .then(source(2,true)).then(assess.fail())
  run jointDecisionSharedTest = init.then(inspect("joint",true)).then(source(1,true)).then(source(2,true))
    .then(hydrateActors).then(assess).expect(s.decision=="assessed" and invariant)
  run missingMemberCannotAlsoBeHydratedTest = init.then(inspect("joint",true)).then(classifyMissingMember(2))
    .expect(s.unavailableMembers==Set(2)).then(source(2,true).fail())
}
