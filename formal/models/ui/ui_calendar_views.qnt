// @source src/Points.tsx
// @source src/Profiles.tsx
// @source src/OwnerAwards.tsx
// @source src/ProjectProposalPage.tsx
// @source src/lib/use-time-boundary.ts
// One July award remains immutable while UTC days cross August 1. The project
// standings and the cached month totals have separate timer deliveries. Two day
// ticks. The profile Points chart and the /points month/all-time switch were
// removed (operator decision, 18 November 2026), so no lifetime view remains.
module ui_calendar_views {
  var s: {day:int,monthViewDay:int,monthPoints:int,projectDay:int}
  action init = s'={day:0,monthViewDay:0,monthPoints:10,projectDay:0}
  action nextDay = all {s.day<2,s'=s.with("day",s.day+1)}
  action refreshMonth = all {s.monthViewDay<s.day,
    s'=s.with("monthViewDay",s.day).with("monthPoints",0)}
  action refreshProject = all {s.projectDay<s.day,s'=s.with("projectDay",s.day)}
  action step = any {nextDay,refreshMonth,refreshProject,s'=s}
  val invariant = all {s.monthPoints==(if(s.monthViewDay==0) 10 else 0),
    s.monthViewDay<=s.day,s.projectDay<=s.day}
  temporal calendarEventuallyCurrentProperty = all {
    refreshMonth.weakFair(s), refreshProject.weakFair(s)
  }.implies(eventually(always(s.monthViewDay==s.day and s.projectDay==s.day)))
  run projectMonthRolloverTest = init.then(nextDay).then(refreshProject).expect(s.projectDay==1)
  run monthRolloverTest = init.then(nextDay).then(refreshMonth).expect(s.monthPoints==0)
}
