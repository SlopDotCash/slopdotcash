// @source src/Points.tsx
// @source src/Profiles.tsx
// @source src/OwnerAwards.tsx
// @source src/ProjectProposalPage.tsx
// @source src/lib/use-time-boundary.ts
// One July award remains immutable while UTC days cross August 1. The standings,
// cached month totals and chart have separate timer deliveries. Two day ticks.
module ui_calendar_views {
  var s: {day:int,monthViewDay:int,chartDay:int,period:str,total:int,monthPoints:int,projectDay:int}
  action init = s'={day:0,monthViewDay:0,chartDay:0,period:"month",total:10,monthPoints:10,projectDay:0}
  action nextDay = all {s.day<2,s'=s.with("day",s.day+1)}
  action refreshMonth = all {s.monthViewDay<s.day,
    s'=s.with("monthViewDay",s.day).with("monthPoints",0)}
  action refreshChart = all {s.chartDay<s.day,s'=s.with("chartDay",s.day)}
  action refreshProject = all {s.projectDay<s.day,s'=s.with("projectDay",s.day)}
  action showLifetime = s'=s.with("period","lifetime")
  action showMonth = s'=s.with("period","month").with("monthViewDay",s.day)
    .with("monthPoints",if(s.day==0) 10 else 0)
  action step = any {nextDay,refreshMonth,refreshChart,refreshProject,showLifetime,showMonth,s'=s}
  val displayed = if(s.period=="lifetime") s.total else s.monthPoints
  val invariant = all {s.total==10,s.monthPoints==(if(s.monthViewDay==0) 10 else 0),
    s.chartDay<=s.day,s.monthViewDay<=s.day,s.projectDay<=s.day}
  temporal calendarEventuallyCurrentProperty = all {
    refreshMonth.weakFair(s), refreshChart.weakFair(s), refreshProject.weakFair(s)
  }.implies(eventually(always(s.chartDay==s.day and s.monthViewDay==s.day and s.projectDay==s.day)))
  run projectMonthRolloverTest = init.then(nextDay).then(refreshProject).expect(s.projectDay==1)
  run monthRolloverTest = init.then(nextDay).then(refreshMonth).expect(displayed==0 and s.total==10)
  run chartRolloverTest = init.then(nextDay).then(refreshChart).expect(s.chartDay==1)
  run lifetimePreservedTest = init.then(showLifetime).then(nextDay).then(refreshMonth).expect(displayed==10)
  run periodSwitchUsesCurrentMonthTest = init.then(nextDay).then(showLifetime).then(showMonth).expect(displayed==0)
}
