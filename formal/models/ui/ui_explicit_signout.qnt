// @source src/lib/project-api.ts
// @source src/Points.tsx
// @source src/Inbox.tsx
// @source src/Earnings.tsx
// @source src/OwnerAwards.tsx
// @source src/InboxEmail.tsx
// @evidence tests/e2e/explicit-signout-lifetime.spec.ts
// Source-only projection; all scenarios are unexecuted. One successful explicit
// signout, three session reads, one private action and one mail action. Server
// acceptance is independent of the later browser publication. No cross-tab
// broadcast, cookie transport, React scheduling or storage durability proof.
module ui_explicit_signout {
  type Read = { phase: str, epoch: int }
  var s: { epoch: int, signout: str, mounted: bool, enabled: bool,
    hook: str, hookEpoch: int, latestRead: int, reads: int -> Read,
    privateView: bool, privateEpoch: int, actionState: str, actionEpoch: int,
    accepted: bool, completion: bool, walletOpen: bool, walletRequests: int,
    marker: bool, email: str, emailActor: bool, emailEpoch: int,
    emailPending: bool, emailToken: bool, emailDone: bool }
  val ids = Set(1, 2, 3)
  action init = s' = { epoch: 0, signout: "idle", mounted: true, enabled: true,
    hook: "checking", hookEpoch: 0, latestRead: 0,
    reads: ids.mapBy(_ => {phase: "unused", epoch: 0}),
    privateView: false, privateEpoch: 0, actionState: "idle", actionEpoch: 0,
    accepted: false, completion: false, walletOpen: false, walletRequests: 0,
    marker: true, email: "none", emailActor: false, emailEpoch: 0,
    emailPending: false, emailToken: false, emailDone: false }
  val hookPrivate = s.mounted and s.enabled and s.hook == "signed-in"
    and s.hookEpoch == s.epoch
  action beginRead(id: int): bool = all {
    s.mounted, s.enabled, ids.contains(id), s.reads.get(id).phase == "unused",
    s' = s.with("hook", "checking").with("hookEpoch", s.epoch).with("latestRead", id)
      .with("reads", s.reads.set(id, {phase: "pending", epoch: s.epoch})) }
  // The reply's identity was observed by the provider, not inferred from a
  // wallet. An old epoch cannot publish even if the effect was disabled later.
  action readReply(id: int, result: str): bool = all {
    ids.contains(id), s.reads.get(id).phase == "pending",
    Set("signed-in", "signed-out", "error").contains(result),
    s' = if (s.mounted and s.enabled and s.latestRead == id and s.reads.get(id).epoch == s.epoch)
      s.with("hook", result).with("hookEpoch", s.epoch)
        .with("reads", s.reads.set(id, s.reads.get(id).with("phase", "done")))
    else s.with("reads", s.reads.set(id, s.reads.get(id).with("phase", "done"))) }
  action disable = all { s.enabled, s' = s.with("enabled", false).with("latestRead", 0) }
  action enable = all { not(s.enabled), s' = s.with("enabled", true) }
  // Independent consumers publish only after their existing identity checks.
  action privateReadAccepted = all {
    s.mounted, hookPrivate,
    s' = s.with("privateView", true).with("privateEpoch", s.epoch) }
  action beginAction = all {
    s.mounted, s.privateView, s.actionState == "idle",
    s' = s.with("actionState", "pending").with("actionEpoch", s.epoch) }
  action requestWallet = all {
    s.mounted, s.actionState == "pending", s.actionEpoch == s.epoch,
    s.walletRequests == 0,
    s' = s.with("walletOpen", true).with("walletRequests", 1) }
  action acceptAction = all {
    s.actionState == "pending", not(s.accepted),
    s' = s.with("accepted", true) }
  action actionReply = all {
    s.actionState == "pending",
    s' = s.with("actionState", "done").with("walletOpen", false)
      .with("completion", s.mounted and s.actionEpoch == s.epoch) }
  action walletReply = all {
    s.walletOpen,
    s' = s.with("walletOpen", false)
      .with("completion", s.mounted and s.actionEpoch == s.epoch) }
  action beginSignout = all {
    s.mounted, s.signout == "idle", s' = s.with("signout", "pending") }
  action refuseSignout = all {
    s.signout == "pending", s' = s.with("signout", "failed") }
  action confirmSignout = all {
    s.signout == "pending", s.epoch == 0,
    s' = s.with("signout", "done").with("epoch", 1).with("latestRead", 0)
      .with("hook", if (s.enabled) "checking" else s.hook)
      .with("privateView", false).with("completion", false)
      .with("emailActor", if (s.email == "verify") false else s.emailActor)
      .with("emailDone", if (s.email == "verify") false else s.emailDone) }
  action openMail(kind: str): bool = all {
    s.email == "none", Set("verify", "unsubscribe").contains(kind),
    s' = s.with("email", kind).with("emailToken", true)
      .with("emailEpoch", s.epoch).with("emailActor", kind == "verify") }
  action beginMail = all {
    s.emailToken, not(s.emailPending),
    s.email == "unsubscribe" or (s.emailActor and s.emailEpoch == s.epoch),
    s' = s.with("emailPending", true) }
  action mailReply = all {
    s.emailPending,
    s' = if (s.mounted and (s.email == "unsubscribe" or s.emailEpoch == s.epoch))
      s.with("emailPending", false).with("emailDone", true).with("emailToken", false)
    else s.with("emailPending", false) }
  action unmount = s' = s.with("mounted", false).with("privateView", false).with("completion", false)
  action step = any { beginRead(1), beginRead(2), beginRead(3),
    readReply(1, "signed-in"), readReply(1, "signed-out"), readReply(1, "error"),
    readReply(2, "signed-in"), readReply(2, "signed-out"), readReply(2, "error"),
    readReply(3, "signed-in"), readReply(3, "signed-out"), readReply(3, "error"),
    disable, enable, privateReadAccepted, beginAction, requestWallet,
    acceptAction, actionReply, walletReply, beginSignout, refuseSignout,
    confirmSignout, openMail("verify"), openMail("unsubscribe"), beginMail,
    mailReply, unmount, s' = s }
  val invariant = all {
    hookPrivate implies s.hookEpoch == s.epoch,
    s.privateView implies (s.mounted and s.privateEpoch == s.epoch),
    s.completion implies (s.mounted and s.actionEpoch == s.epoch),
    s.signout == "done" implies s.epoch == 1,
    s.marker,
    s.email == "verify" and s.emailDone implies s.emailEpoch == s.epoch }
  run successfulSignoutHidesReadyHookTest = init.then(beginRead(1))
    .then(readReply(1, "signed-in")).then(beginSignout).then(confirmSignout)
    .expect(not(hookPrivate) and s.hook == "checking")
  run failedSignoutDoesNotInvalidateTest = init.then(beginRead(1))
    .then(readReply(1, "signed-in")).then(privateReadAccepted)
    .then(beginSignout).then(refuseSignout)
    .expect(hookPrivate and s.privateView and s.epoch == 0)
  run preSignoutReadCannotRestoreTest = init.then(beginRead(1))
    .then(beginSignout).then(confirmSignout).then(readReply(1, "signed-in"))
    .expect(not(hookPrivate))
  run postSignoutReadCanReportSignedOutTest = init.then(beginSignout)
    .then(confirmSignout).then(beginRead(1)).then(readReply(1, "signed-out"))
    .expect(s.hook == "signed-out")
  run postSignoutReadErrorStaysDistinctTest = init.then(beginSignout)
    .then(confirmSignout).then(beginRead(1)).then(readReply(1, "error"))
    .expect(s.hook == "error" and not(hookPrivate))
  run disabledSnapshotCannotReappearTest = init.then(beginRead(1))
    .then(readReply(1, "signed-in")).then(disable).then(beginSignout)
    .then(confirmSignout).then(enable).expect(not(hookPrivate))
  run disabledPendingReadCannotReappearTest = init.then(beginRead(1))
    .then(disable).then(beginSignout).then(confirmSignout).then(enable)
    .then(readReply(1, "signed-in")).expect(not(hookPrivate))
  run readyPrivateViewDropsImmediatelyTest = init.then(beginRead(1))
    .then(readReply(1, "signed-in")).then(privateReadAccepted)
    .then(beginSignout).then(confirmSignout).expect(not(s.privateView))
  run acceptedWriteSurvivesSignoutTest = init.then(beginRead(1))
    .then(readReply(1, "signed-in")).then(privateReadAccepted).then(beginAction)
    .then(acceptAction).then(beginSignout).then(confirmSignout).then(actionReply)
    .expect(s.accepted and not(s.completion) and not(s.privateView))
  run lateFailureCannotRestorePrivateViewTest = init.then(beginRead(1))
    .then(readReply(1, "signed-in")).then(privateReadAccepted).then(beginAction)
    .then(beginSignout).then(confirmSignout).then(actionReply)
    .expect(not(s.completion) and not(s.privateView))
  run signedOutWalletCannotStartTest = init.then(beginRead(1))
    .then(readReply(1, "signed-in")).then(privateReadAccepted).then(beginAction)
    .then(beginSignout).then(confirmSignout).then(requestWallet.fail())
  run alreadyOpenWalletReplyIsIgnoredTest = init.then(beginRead(1))
    .then(readReply(1, "signed-in")).then(privateReadAccepted).then(beginAction)
    .then(requestWallet).then(beginSignout).then(confirmSignout).then(walletReply)
    .expect(s.walletRequests == 1 and not(s.completion) and s.marker)
  run pendingVerificationKeepsTokenTest = init.then(openMail("verify"))
    .then(beginMail).then(beginSignout).then(confirmSignout).then(mailReply)
    .expect(s.emailToken and not(s.emailDone) and not(s.emailActor))
  run unsubscribeDoesNotRequireSessionTest = init.then(openMail("unsubscribe"))
    .then(beginMail).then(beginSignout).then(confirmSignout).then(mailReply)
    .expect(s.emailDone and not(s.emailToken))
  run unmountedReadCannotPublishTest = init.then(beginRead(1)).then(unmount)
    .then(readReply(1, "signed-in")).expect(not(hookPrivate))
}
