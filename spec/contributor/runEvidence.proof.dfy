lemma lawOpenedRetryIdempotent_ensures(s: OpenedRun, actor: string, pr: string, remoteRun: string, eventBody: string, authorized: bool)
  ensures (lawOpenedRetryIdempotent(s, actor, pr, remoteRun, eventBody, authorized) == true)
{
  var once := recordOpened(s, actor, pr, remoteRun, eventBody, authorized);
  if eventBody !in s.eventBodies {
    var excludeKnown := (body: string) => body !in s.eventBodies;
    ProofLib.FilterMember(excludeKnown, [eventBody], eventBody);
    assert eventBody in once.eventBodies;
  }
  assert once == recordOpened(once, actor, pr, remoteRun, eventBody, authorized);
}
