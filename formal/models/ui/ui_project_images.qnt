// @source src/App.tsx
// ProjectImage and ProjectOwnerAvatar: two custom URLs, one owner avatar.
// Image errors belong to the rendered DOM source; browser request/event ordering
// remains an external predicate. A keyed project replacement resets both hooks.
module ui_project_images {
  var s: {custom:int, failed:int, owner:bool, ownerFailed:bool, avatarMounted:bool}
  val initial = {custom:1,failed:0,owner:true,ownerFailed:false,avatarMounted:false}
  action init = s' = initial
  val customVisible = s.custom != 0 and s.custom != s.failed
  val ownerVisible = not(customVisible) and s.owner and not(s.ownerFailed)
  action customError = all {customVisible,
    s' = s.with("failed",s.custom).with("avatarMounted",true).with("ownerFailed",false)}
  action changeCustom(url:int):bool = all {Set(0,1,2).contains(url),
    val nextAvatar = url == 0 or url == s.failed
    s' = s.with("custom",url).with("avatarMounted",nextAvatar)
      .with("ownerFailed",if(nextAvatar and s.avatarMounted) s.ownerFailed else false)}
  action ownerError = all {ownerVisible,s' = s.with("ownerFailed",true)}
  action changeOwner = s' = s.with("owner",not(s.owner))
  action newProject = s' = initial
  action step = any {customError,changeCustom(0),changeCustom(1),changeCustom(2),
    ownerError,changeOwner,newProject,s'=s}
  val invariant = all { s.avatarMounted == not(customVisible),
    s.ownerFailed implies s.avatarMounted,
    not(customVisible and ownerVisible) }
  run customFailureFallsBackToOwnerTest = init.then(customError).expect(ownerVisible)
  run ownerFailureUsesInitialTest = init.then(customError).then(ownerError)
    .expect(not(ownerVisible) and not(customVisible))
  run differentCustomUrlCanLoadTest = init.then(customError).then(ownerError)
    .then(changeCustom(2)).expect(customVisible and not(s.ownerFailed))
  run priorCustomFailureIsRetainedTest = init.then(customError).then(changeCustom(2))
    .then(changeCustom(1)).expect(not(customVisible) and ownerVisible)
  run projectReplacementResetsErrorsTest = init.then(customError).then(ownerError)
    .then(newProject).expect(customVisible and not(s.ownerFailed))
}
