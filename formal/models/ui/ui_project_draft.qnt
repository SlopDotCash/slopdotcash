// @source src/ProjectProposalPage.tsx
// ProjectUpdateForm: two headline values, revisions 1..3, one pending publish.
// Public owner drafts use localStorage. Storage events do not merge open forms;
// reads happen on mount and the API's expectedRevision fences remote changes.
// JSON grammar, authority, funding amounts and the create wizard are separate.
module ui_project_draft {
  var s: {mounted:bool, base:int, server:int, field:int, draftBase:int,
    savedField:int, savedBase:int, storageOk:bool, saveError:bool,
    phase:str, submittedField:int, submittedBase:int, laterEdit:bool}
  action init = s'={mounted:true,base:1,server:1,field:0,draftBase:0,
    savedField:0,savedBase:0,storageOk:true,saveError:false,
    phase:"idle",submittedField:0,submittedBase:0,laterEdit:false}
  val stale = s.field!=0 and s.draftBase!=s.base
  action edit = all {s.mounted,s.field<2,
    s'=s.with("field",s.field+1)
      .with("draftBase",if(s.field==0) s.base else s.draftBase)
      .with("laterEdit",s.phase=="publishing")}
  action writeStorage = all {s.mounted,
    s'=if(s.storageOk) s.with("savedField",s.field).with("savedBase",s.draftBase).with("saveError",false)
      else s.with("saveError",true)}
  action storageUnavailable = s'=s.with("storageOk",false)
  action storageAvailable = s'=s.with("storageOk",true)
  action remoteRevision = all {s.server<3,s'=s.with("server",s.server+1)}
  action refresh = all {s.mounted,s.phase!="publishing",s'=s.with("base",s.server)}
  action confirmDraft = all {s.mounted,stale,s'=s.with("draftBase",s.base)}
  action discard = all {s.mounted,stale,
    s'=s.with("field",0).with("draftBase",0).with("phase","idle")}
  action beginPublish = all {s.mounted,s.phase!="publishing",s.field!=0,not(stale),s.base<3,
    s'=s.with("phase","publishing").with("submittedField",s.field)
      .with("submittedBase",s.base).with("laterEdit",false)}
  action conflict = all {s.phase=="publishing",s.submittedBase!=s.server,
    s'=s.with("phase","conflict")}
  action publishSuccess = all {s.phase=="publishing",s.submittedBase==s.server,s.server<3,
    s'=s.with("server",s.server+1).with("base",s.server+1).with("phase","published")
      .with("field",if(s.laterEdit) s.field else 0)
      .with("draftBase",if(s.laterEdit) s.server+1 else 0)}
  action depart = s'=s.with("mounted",false)
  action remount = all {not(s.mounted),s.phase!="publishing",
    s'=s.with("mounted",true).with("base",s.server)
      .with("field",s.savedField).with("draftBase",s.savedBase).with("phase","idle").with("laterEdit",false)}
  action step = any {edit,writeStorage,storageUnavailable,storageAvailable,
    remoteRevision,refresh,confirmDraft,discard,beginPublish,conflict,
    publishSuccess,depart,remount,s'=s}
  val invariant = all {s.base<=s.server,s.server<=3,
    s.field==0 implies s.draftBase==0,
    s.phase=="published" and s.laterEdit implies s.field>s.submittedField}
  run editsDuringSaveTest = init.then(edit).then(beginPublish).then(edit)
    .then(publishSuccess).expect(s.field==2 and s.draftBase==2)
  run competingRevisionTest = init.then(edit).then(beginPublish).then(remoteRevision)
    .then(conflict).expect(s.field==1 and s.phase=="conflict")
  run restoreStaleDraftTest = init.then(edit).then(writeStorage).then(depart)
    .then(remoteRevision).then(remount).expect(stale)
  run failedStorageRetainsFormTest = init.then(edit).then(storageUnavailable)
    .then(writeStorage).expect(s.field==1 and s.savedField==0 and s.saveError)
  run discardRemovesPersistenceTest = init.then(edit).then(remoteRevision).then(refresh)
    .then(discard).then(writeStorage).then(depart).then(remount).expect(s.field==0)
}
