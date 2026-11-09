// @source skills/project-contributor-template/scripts/terms-preflight.mjs
// A cache can avoid a download only for immutable GitHub bytes matching the
// expected digest. Cache failures never grant authority or block valid network bytes.
module contributor_terms_preflight {
  type S = { policy: bool, revisionMatches: bool, immutable: bool, cached: bool,
    digestMatches: bool, documents: bool, acknowledged: bool }
  var s: S
  action init = s' = { policy:false,revisionMatches:false,immutable:false,cached:false,digestMatches:false,documents:false,acknowledged:false }
  action policy(matches: bool): bool = all { not(s.policy),s'=s.with("policy",true).with("revisionMatches",matches) }
  action cache(immutable: bool, digest: bool): bool = all { s.policy,
    s'=s.with("immutable",immutable).with("cached",true).with("digestMatches",digest) }
  action useCache = all { s.policy,s.immutable,s.cached,s.digestMatches,s'=s.with("documents",true) }
  action download(validAuthority: bool, validDigest: bool): bool = all { s.policy,validAuthority,validDigest,s'=s.with("documents",true) }
  action acknowledge = all { s.policy,s.revisionMatches,s.documents,s'=s.with("acknowledged",true) }
  action step = any { policy(true),policy(false),cache(true,true),cache(true,false),cache(false,true),useCache,download(true,true),acknowledge,s'=s }
  val invariant = s.acknowledged implies s.policy and s.revisionMatches and s.documents
  run changedRevisionRefusedTest = init.then(policy(false)).then(download(true,true)).then(acknowledge.fail())
  run corruptedCacheDoesNotAuthorizeTest = init.then(policy(true)).then(cache(true,false)).then(useCache.fail())
  run mutableUrlNotCacheAuthorityTest = init.then(policy(true)).then(cache(false,true)).then(useCache.fail())
  run cacheMissMayFetchTest = init.then(policy(true)).then(cache(true,false)).then(download(true,true)).then(acknowledge).expect(invariant)
}
