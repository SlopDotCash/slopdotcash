// @source scripts/quint-tla-normalization.mjs
// @source scripts/quint-local-translator.mjs
// One fold candidate, two nested LETs/comments and a quoted escape. Token
// spelling and source offsets are abstracted; real literal/fixture tests bind
// these lexical boundaries to the normalizer and the actual TLC pipeline.
module formal_tla_lexing {
  var s:{mode:str,commentDepth:int,escape:bool,fold:bool,lets:int,
    ready:bool,rewrites:int,lastRewriteMode:str}
  action init = s'={mode:"code",commentDepth:0,escape:false,fold:false,
    lets:0,ready:false,rewrites:0,lastRewriteMode:"code"}
  action quote = all {Set("code","string").contains(s.mode),
    s'=if(s.mode=="code") s.with("mode","string")
      .with("fold",s.fold and not(s.ready)).with("ready",false)
      else if(s.escape) s.with("escape",false) else s.with("mode","code")}
  action slash = all {s.mode=="string",s'=s.with("escape",not(s.escape))}
  action textChar = all {s.mode!="code",s'=s.with("escape",false)}
  action openBlock = all {Set("code","block").contains(s.mode),s.commentDepth<2,
    s'=s.with("mode","block").with("commentDepth",s.commentDepth+1)}
  action closeBlock = all {s.mode=="block",s.commentDepth>0,
    s'=s.with("commentDepth",s.commentDepth-1)
      .with("mode",if(s.commentDepth==1) "code" else "block")}
  action openLine = all {s.mode=="code",s'=s.with("mode","line")}
  action newline = all {s.mode=="line",s'=s.with("mode","code")}
  action startFold = all {s.mode=="code",not(s.fold),s.rewrites==0,
    s'=s.with("fold",true).with("lets",1).with("ready",false)}
  action nestedLet = all {s.mode=="code",s.fold,s.lets>0,s.lets<2,
    s'=s.with("lets",s.lets+1)}
  action inToken = all {s.mode=="code",s.fold,s.lets>0,
    s'=s.with("lets",s.lets-1).with("ready",s.lets==1)}
  action lambda = all {s.mode=="code",s.ready,s.fold,
    s'=s.with("rewrites",1).with("lastRewriteMode",s.mode)
      .with("fold",false).with("ready",false)}
  action otherToken = all {s.mode=="code",s.ready,
    s'=s.with("fold",false).with("ready",false)}
  action step = any {quote,slash,textChar,openBlock,closeBlock,openLine,newline,
    startFold,nestedLet,inToken,lambda,otherToken,s'=s}
  val invariant = all {
    (s.mode=="block") == (s.commentDepth>0),
    s.escape implies s.mode=="string",
    s.ready implies (s.fold and s.lets==0),
    s.rewrites>0 implies s.lastRewriteMode=="code"
  }
  run quotedFoldIsDataTest = init.then(quote).then(startFold.fail())
  run escapedQuoteStaysLiteralTest = init.then(quote).then(slash).then(quote)
    .expect(s.mode=="string").then(startFold.fail())
  run nestedCommentStaysProtectedTest = init.then(openBlock).then(openBlock).then(closeBlock)
    .expect(s.mode=="block").then(startFold.fail())
  run lineCommentEndsAtNewlineTest = init.then(openLine).then(newline).then(startFold)
    .then(inToken).then(lambda).expect(s.rewrites==1 and invariant)
  run innerInCannotRewriteOuterFoldTest = init.then(startFold).then(nestedLet).then(inToken)
    .expect(not(s.ready)).then(inToken).then(lambda).expect(s.rewrites==1 and invariant)
  run nonLambdaDoesNotRewriteTest = init.then(startFold).then(inToken).then(otherToken)
    .expect(s.rewrites==0 and invariant)
  run stringCannotBeSkippedToLambdaTest = init.then(startFold).then(inToken).then(quote).then(quote)
    .expect(not(s.ready)).then(lambda.fail())
}
