// spec/contributor/publication.md, "Discovery leaves out a monthly pool configured at zero this month, a project paused at its intake cap or out of rotation, and a failed count read pauses nothing"

lemma lawOutOfRotationPauses_ensures(cap: int)
  ensures (lawOutOfRotationPauses(cap) == true)
{
  var r := backend__backlogRule_BacklogRead(true, 50, 0, backend__backlogRule_startsAtHours);
  var now := backend__backlogRule_startsAtHours;
  var f := (total: int, r: backend__backlogRule_BacklogRead) => (total + (if (r.read && ((now - r.observedAt) <= backend__backlogRule_readMaxAgeHours)) then r.waiting else 0));
  assert [] + [r] == [r];
  ProofLib.FoldLeftAppend(f, 0, [], r);
}

lemma lawSitemapListsListedProjectsAndPublishedCycles_ensures(sitemapProjects: seq<SitemapProject>, publishedCycles: seq<PublishedCycle>)
  ensures (lawSitemapListsListedProjectsAndPublishedCycles(sitemapProjects, publishedCycles) == true)
{
  var p := (x: SitemapProject) => frontend__projections_listed(x.view);
  var fixed := seq(|sitemapFixedKinds|, i_map requires 0 <= i_map < |sitemapFixedKinds| => var k := sitemapFixedKinds[i_map]; app_page(k));
  var filtered := ProofLib.Filter(p, sitemapProjects);
  var projects := seq(|filtered|, i_map requires 0 <= i_map < |filtered| => var x := filtered[i_map]; app_page(app_RouteKind.Project).(projectId := x.slug));
  var cycles := seq(|publishedCycles|, i_map requires 0 <= i_map < |publishedCycles| => var x := publishedCycles[i_map]; app_page(app_RouteKind.Cycle).(projectId := x.projectId, cycleId := x.cycleId));
  var listedRoutes := sitemapRoutes(sitemapProjects, publishedCycles);
  assert listedRoutes == (fixed + projects) + cycles;
  forall x | x in sitemapProjects && frontend__projections_listed(x.view)
    ensures app_page(app_RouteKind.Project).(projectId := x.slug) in listedRoutes
  {
    ProofLib.FilterMember(p, sitemapProjects, x);
    var i :| 0 <= i < |filtered| && filtered[i] == x;
    assert projects[i] == app_page(app_RouteKind.Project).(projectId := x.slug);
    assert projects[i] in projects;
  }
  forall x | x in publishedCycles
    ensures app_page(app_RouteKind.Cycle).(projectId := x.projectId, cycleId := x.cycleId) in listedRoutes
  {
    var i :| 0 <= i < |publishedCycles| && publishedCycles[i] == x;
    assert cycles[i] == app_page(app_RouteKind.Cycle).(projectId := x.projectId, cycleId := x.cycleId);
    assert cycles[i] in cycles;
  }
  forall r | r in listedRoutes && r.kind.Project?
    ensures exists x :: x in sitemapProjects && frontend__projections_listed(x.view) && x.slug == r.projectId
  {
    if r in fixed {
      var i :| 0 <= i < |fixed| && fixed[i] == r;
      assert r.kind == sitemapFixedKinds[i];
      assert !r.kind.Project?;
    } else if r in cycles {
      var i :| 0 <= i < |cycles| && cycles[i] == r;
      assert r.kind == app_RouteKind.Cycle;
      assert !r.kind.Project?;
    } else {
      assert r in projects;
      var i :| 0 <= i < |filtered| && projects[i] == r;
      ProofLib.FilterMember(p, sitemapProjects, filtered[i]);
      assert filtered[i] in sitemapProjects && frontend__projections_listed(filtered[i].view) && filtered[i].slug == r.projectId;
    }
  }
}
