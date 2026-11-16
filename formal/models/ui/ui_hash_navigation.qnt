// @source src/Link.tsx
// @source src/App.tsx
// One incoming hash target, delayed DOM arrival, reader takeover, and one
// trusted history return. Actual pixel positions and DOM parsing are abstract.
module ui_hash_navigation {
  var s:{route:int,historyTarget:int,targetExists:bool,settling:bool,
    elapsed:bool,readerInput:bool,observer:bool,position:int,saved:int,
    restoring:bool,aligned:bool}
  action init = s'={route:1,historyTarget:0,targetExists:false,settling:false,
    elapsed:false,readerInput:false,observer:false,position:0,saved:0,
    restoring:false,aligned:false}
  action hashNavigate = all {s.route==1,s'=s.with("route",2).with("historyTarget",2)
    .with("settling",true).with("observer",true).with("aligned",false)
    .with("readerInput",false).with("elapsed",false).with("restoring",false)}
  action targetArrives = all {s.route==2,s'=s.with("targetExists",true)}
  action align = all {s.settling,s.targetExists,
    s'=s.with("position",if(s.restoring) s.saved else 1).with("aligned",true)}
  action readerTakeover = all {s.route==2,
    s'=s.with("readerInput",true).with("settling",false).with("observer",false)}
  action scroll = all {s.route==2,not(s.settling),
    s'=s.with("position",2).with("saved",2)}
  action timeout = all {s.route==2,s'=s.with("elapsed",true).with("settling",false).with("observer",false)}
  action depart = all {s.route==2,s'=s.with("route",1).with("settling",false).with("observer",false)}
  action trustedBack = all {s.route==1,s.historyTarget==2,
    s'=s.with("route",2).with("restoring",true).with("settling",true)
      .with("readerInput",false).with("elapsed",false).with("observer",true)}
  action step = any {hashNavigate,targetArrives,align,readerTakeover,scroll,timeout,depart,trustedBack,s'=s}
  val invariant = all {s.readerInput implies not(s.settling),
    s.observer==s.settling,s.position>=0,s.position<=2}
  run delayedTargetTest = init.then(hashNavigate).then(targetArrives).then(align).expect(s.aligned and s.position==1)
  run readerStopsObserverTest = init.then(hashNavigate).then(readerTakeover).then(targetArrives).expect(not(s.observer) and s.position==0)
  run restoreReaderPositionTest = init.then(hashNavigate).then(targetArrives).then(align)
    .then(readerTakeover).then(scroll).then(depart).then(trustedBack).then(align).expect(s.position==2)
  run settleTimeoutTest = init.then(hashNavigate).then(timeout).then(targetArrives).expect(not(s.observer) and not(s.aligned))
}
