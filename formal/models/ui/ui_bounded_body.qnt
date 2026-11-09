// @source src/lib/browser-json.ts
// @evidence scripts/response-rejection.test.ts
// One standard unlocked body; bound=2, each fragment=1/2/3, at most two
// accepted fragments. Header classes absent, within-bound, oversized, invalid.
// retained counts accepted chunks only, not the source's byteLength local:
// byteLength increments before overflow refusal, but that fragment is never
// appended to chunks. The <=2 invariant describes retained payload bytes.
// Header length is an early bound, not an exact expected length or integrity
// check. The reader has no independent timer: an upstream abort appears as a
// read rejection. A cancellation reply may reject or remain pending forever;
// no termination claim assumes it settles. Cancellation failure preserves the
// primary refusal and does not prove source closure. EOF releases without
// cancellation before optional fatal UTF-8 decode and JSON parsing.
// Native stream locks/error propagation, byte copying, UTF-8 and JSON parsers
// are represented by predicates, not reimplemented. Trace storage/hash/ref
// ownership remains in trace_object_storage. No execution is claimed.
module ui_bounded_body {
  type S={phase:str,kind:str,body:bool,header:str,retained:int,chunks:int,reader:bool,
    eof:bool,cancelled:bool,cancelFailed:bool,closed:bool,released:bool,
    primary:str,result:str,utf8:bool,json:bool}
  var s:S
  action init=s'={phase:"initial",kind:"bytes",body:true,header:"absent",retained:0,chunks:0,reader:false,
    eof:false,cancelled:false,cancelFailed:false,closed:false,released:false,
    primary:"none",result:"none",utf8:false,json:false}
  action begin(kind:str,body:bool,header:str):bool=all{s.phase=="initial",
    Set("bytes","text","json").contains(kind),Set("absent","bounded","oversized","invalid").contains(header),
    s'=s.with("phase","header").with("kind",kind).with("body",body).with("header",header)}
  action header=all{s.phase=="header",
    s'=if(Set("oversized","invalid").contains(s.header))
      s.with("phase",if(s.body)"cancel-body" else "done").with("result",if(s.body)"none" else "error")
        .with("primary",if(s.header=="oversized")"size" else "header")
    else if(not(s.body))s.with("phase","done").with("primary","missing").with("result","error")
    else s.with("phase","read").with("reader",true)}
  action fragment(size:int):bool=all{s.phase=="read",Set(1,2,3).contains(size),s.chunks<2 or s.retained+size>2,
    s'=if(s.retained+size>2)s.with("phase","cancel-reader").with("primary","size")
    else s.with("retained",s.retained+size).with("chunks",s.chunks+1)}
  action readFailure=all{s.phase=="read",s'=s.with("phase","cancel-reader").with("primary","read")}
  action eof=all{s.phase=="read",s'=s.with("phase","release").with("eof",true).with("closed",true)}
  action cancelReply(ok:bool):bool=all{Set("cancel-body","cancel-reader").contains(s.phase),
    s'=s.with("phase",if(s.reader)"release" else "done").with("cancelled",true).with("cancelFailed",not(ok))
      .with("closed",ok).with("result",if(s.reader)"none" else "error")}
  action release=all{s.phase=="release",s.reader,
    s'=s.with("reader",false).with("released",true)
      .with("phase",if(s.primary!="none" or s.kind=="bytes")"done" else "decode")
      .with("result",if(s.primary!="none")"error" else if(s.kind=="bytes")"value" else "none")}
  action decode(valid:bool):bool=all{s.phase=="decode",valid or s.retained>0,
    s'=s.with("utf8",valid).with("phase",if(valid and s.kind=="json")"parse" else "done")
      .with("primary",if(valid)"none" else "utf8")
      .with("result",if(not(valid))"error" else if(s.kind=="text")"value" else "none")}
  action parse(valid:bool):bool=all{s.phase=="parse",not(valid) or s.retained>0,s'=s.with("phase","done").with("json",valid)
    .with("primary",if(valid)"none" else "json").with("result",if(valid)"value" else "error")}
  action step={nondet kind=Set("bytes","text","json").oneOf()
    nondet body=Set(false,true).oneOf()
    nondet headerClass=Set("absent","bounded","oversized","invalid").oneOf()
    nondet size=Set(1,2,3).oneOf()
    nondet yes=Set(false,true).oneOf()
    any{begin(kind,body,headerClass),header,fragment(size),readFailure,eof,cancelReply(yes),release,decode(yes),parse(yes),s'=s}}
  val invariant=all{s.retained>=0,s.retained<=2,s.chunks<=2,s.cancelFailed implies s.cancelled,
    s.released implies not(s.reader),s.phase=="done" implies not(s.reader),
    s.result=="value" implies s.eof and s.released and not(s.cancelled) and s.primary=="none",
    s.result=="value" and s.kind!="bytes" implies s.utf8,
    s.result=="value" and s.kind=="json" implies s.json,
    s.result=="error" implies s.primary!="none"}
  action bytes=begin("bytes",true,"absent").then(header)
  action json=begin("json",true,"bounded").then(header)
  run emptyBytesNeedEofTest=init.then(bytes).then(eof).then(release).expect(s.result=="value" and s.retained==0 and invariant)
  run exactBoundInTwoFragmentsTest=init.then(bytes).then(fragment(1)).then(fragment(1)).then(eof).then(release)
    .expect(s.result=="value" and s.retained==2 and invariant)
  run boundWithoutEofIsNotSuccessTest=init.then(bytes).then(fragment(2)).expect(s.result=="none" and s.reader and invariant)
  run extraFragmentAfterExactBoundRefusedTest=init.then(bytes).then(fragment(2)).then(fragment(1)).then(cancelReply(true)).then(release)
    .expect(s.result=="error" and s.primary=="size" and s.retained==2 and invariant)
  run oversizedFirstFragmentNeverBufferedTest=init.then(bytes).then(fragment(3)).then(cancelReply(true)).then(release)
    .expect(s.retained==0 and s.primary=="size" and invariant)
  run headerOversizeCancelsBeforeReaderTest=init.then(begin("bytes",true,"oversized")).then(header).then(cancelReply(true))
    .expect(s.result=="error" and s.primary=="size" and not(s.released) and invariant)
  run invalidHeaderCancellationFailureKeepsHeaderErrorTest=init.then(begin("bytes",true,"invalid")).then(header).then(cancelReply(false))
    .expect(s.primary=="header" and s.cancelFailed and not(s.closed) and invariant)
  run absentBodyRefusedWithoutCancellationTest=init.then(begin("bytes",false,"absent")).then(header)
    .expect(s.primary=="missing" and not(s.cancelled) and invariant)
  run invalidHeaderWithoutBodyKeepsHeaderRefusalTest=init.then(begin("bytes",false,"invalid")).then(header)
    .expect(s.primary=="header" and not(s.cancelled) and invariant)
  run withinBoundHeaderDoesNotRequireExactLengthTest=init.then(begin("bytes",true,"bounded")).then(header).then(fragment(1)).then(eof).then(release)
    .expect(s.result=="value" and s.retained==1 and invariant)
  run readFailureCancelsAndReleasesTest=init.then(bytes).then(fragment(1)).then(readFailure).then(cancelReply(true)).then(release)
    .expect(s.primary=="read" and s.released and invariant)
  run rejectedCancellationDoesNotHideReadErrorTest=init.then(bytes).then(readFailure).then(cancelReply(false)).then(release)
    .expect(s.primary=="read" and s.cancelFailed and not(s.closed) and invariant)
  run pendingCancellationHasNoTerminalClaimTest=init.then(bytes).then(fragment(3))
    .expect(s.phase=="cancel-reader" and s.result=="none" and s.reader and invariant)
  run malformedUtf8RefusedAfterReleaseTest=init.then(json).then(fragment(2)).then(eof).then(release).then(decode(false))
    .expect(s.primary=="utf8" and not(s.cancelled) and s.released and invariant)
  run malformedJsonIsSeparateFromUtf8FailureTest=init.then(json).then(fragment(2)).then(eof).then(release).then(decode(true)).then(parse(false))
    .expect(s.primary=="json" and s.utf8 and not(s.json) and invariant)
  run validJsonCompletesAfterEofAndReleaseTest=init.then(json).then(fragment(2)).then(eof).then(release).then(decode(true)).then(parse(true))
    .expect(s.result=="value" and invariant)
  run textReaderDoesNotParseJsonTest=init.then(begin("text",true,"absent")).then(header).then(eof).then(release).then(decode(true))
    .expect(s.result=="value" and not(s.json) and invariant)
  run emptyJsonDecodesAsTextButRejectsAtParseTest=init.then(json).then(eof).then(release).then(decode(true)).then(parse(false))
    .expect(s.retained==0 and s.utf8 and s.primary=="json" and s.result=="error" and invariant)
}
