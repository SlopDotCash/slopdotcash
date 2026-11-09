// @source src/InboxEmail.tsx
// @evidence tests/e2e/email-editor-focus.spec.ts
// Entry ownership only; ui_email_preference_requests models the subsequent
// HTTP/session observations. Two load contexts, two reads, one actor/closure
// replacement. Layout owns listener attachment and a distinct active token;
// initial loading remains passive. A captured old callback can be invoked
// after removal/replacement but cannot allocate a new generation or dispatch.
// Focus while a mutation is busy does not interrupt the editor. Native event
// scheduling is an input; no browser execution or liveness claim is made.
module ui_email_focus_lifetime {
  type S={context:int,present:bool,attached:bool,busy:bool,initial:bool,queued:int,
    active:Set[int],reads:int,badRead:bool,aborted:Set[int]}
  var s:S
  action init=s'={context:1,present:true,attached:false,busy:false,initial:false,queued:0,
    active:Set(),reads:0,badRead:false,aborted:Set()}
  action layout=all{s.present,not(s.attached),s'=s.with("attached",true).with("active",s.active.union(Set(s.context)))}
  action capture=all{s.attached,s'=s.with("queued",s.context)}
  def owns(context:int):bool=s.present and s.active.contains(context) and context==s.context
  action load(context:int):bool=all{Set(1,2).contains(context),s.reads<2,
    s'=if(owns(context))s.with("reads",s.reads+1).with("aborted",if(s.reads>0)s.aborted.union(Set(s.reads)) else s.aborted)
      else s}
  action passiveInitial=all{s.present,not(s.initial),owns(s.context),s.reads<2,
    s'=s.with("initial",true).with("reads",s.reads+1).with("aborted",if(s.reads>0)s.aborted.union(Set(s.reads)) else s.aborted)}
  action focus=all{s.attached,not(s.busy),s.reads<2,load(s.context)}
  action queuedCallback=all{s.queued>0,not(s.busy),s.reads<2,load(s.queued)}
  action setBusy(value:bool):bool=s'=s.with("busy",value)
  action depart=all{s.present,s'=s.with("present",false).with("attached",false).with("active",s.active.exclude(Set(s.context)))
    .with("aborted",if(s.reads>0)s.aborted.union(Set(s.reads)) else s.aborted)}
  action replace=all{s.present,s.context==1,s'=s.with("context",2).with("attached",false).with("initial",false)
    .with("active",s.active.exclude(Set(1))).with("aborted",if(s.reads>0)s.aborted.union(Set(s.reads)) else s.aborted)}
  action historicalPassiveCallback=all{s.queued>0,not(owns(s.queued)),not(s.busy),s.reads<2,
    s'=s.with("reads",s.reads+1).with("badRead",true)}
  action step={nondet context=Set(1,2).oneOf() nondet yes=Set(false,true).oneOf()
    any{layout,capture,load(context),passiveInitial,focus,queuedCallback,setBusy(yes),depart,replace,s'=s}}
  val invariant=all{s.reads<=2,not(s.badRead),s.attached implies owns(s.context),not(s.present) implies s.active==Set()}
  run passiveInitialNeedsCommittedOwnerTest=init.then(passiveInitial.fail())
  run committedOwnerStartsPassiveInitialTest=init.then(layout).then(passiveInitial).expect(s.reads==1 and invariant)
  run focusRefreshStartsOwnedReadTest=init.then(layout).then(passiveInitial).then(focus).expect(s.reads==2 and s.aborted==Set(1) and invariant)
  run busyMutationIgnoresFocusTest=init.then(layout).then(setBusy(true)).expect(s.reads==0 and invariant).then(focus.fail())
  run departureRemovesListenerBeforeFocusTest=init.then(layout).then(depart).expect(s.reads==0 and invariant).then(focus.fail())
  run capturedCallbackAfterDepartureCannotLoadTest=init.then(layout).then(capture).then(depart).then(queuedCallback).expect(s.reads==0 and invariant)
  run oldLoadAfterContextReplacementCannotLoadTest=init.then(layout).then(capture).then(replace).then(layout).then(queuedCallback)
    .expect(s.reads==0 and invariant).then(passiveInitial).expect(s.reads==1 and invariant)
  run oldPassiveInitialCannotLoadReplacementTest=init.then(layout).then(replace).then(layout).then(load(1)).expect(s.reads==0 and invariant)
  run currentFocusAfterReplacementCanLoadTest=init.then(layout).then(replace).then(layout).then(focus).expect(s.reads==1 and invariant)
  run departureAbortsCurrentReadTest=init.then(layout).then(passiveInitial).then(depart).expect(s.aborted==Set(1) and invariant)
  run oldListenerCouldRestartAfterRemovalNegativeControlTest=init.then(layout).then(capture).then(depart)
    .then(historicalPassiveCallback).expect(s.reads==1 and not(invariant))
}
