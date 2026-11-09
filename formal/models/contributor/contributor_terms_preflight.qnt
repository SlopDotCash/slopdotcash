// @source skills/project-contributor-template/scripts/terms-preflight.mjs
// A cache can avoid a download only for immutable GitHub bytes matching the
// expected digest. Cache failures never grant authority or block valid network bytes.
module contributor_terms_preflight {
  type S = { policy: bool, revisionMatches: bool, immutable: bool, cached: bool,
    digestMatches: bool, documents: bool, acknowledged: bool,
    cacheCloseFailed: bool, cachePublishFailed: bool, projectActive: bool, admitted: bool, documentsRequired: bool }
  var s: S
  action init = s' = { policy:false,revisionMatches:false,immutable:false,cached:false,digestMatches:false,documents:false,acknowledged:false,
    cacheCloseFailed:false,cachePublishFailed:false,projectActive:false,admitted:false,documentsRequired:true }
  action policy(matches: bool): bool = all { not(s.policy),s'=s.with("policy",true).with("revisionMatches",matches) }
  action cache(immutable: bool, digest: bool): bool = all { s.policy,
    s'=s.with("immutable",immutable).with("cached",true).with("digestMatches",digest) }
  action useCache = all { s.policy,s.immutable,s.cached,s.digestMatches,s'=s.with("documents",true) }
  action cacheCloseFailure = all { s.cached,s'=s.with("cacheCloseFailed",true) }
  action cachePublicationFailure = all { s.documents,s'=s.with("cachePublishFailed",true) }
  action policyWithoutDocuments = all { not(s.policy),s'=s.with("policy",true).with("revisionMatches",true).with("documentsRequired",false) }
  action noRequiredDocuments = all { s.policy,not(s.documentsRequired),s'=s.with("documents",true) }
  action projectStatus(active: bool): bool = s'=s.with("projectActive",active)
  action download(validAuthority: bool, validDigest: bool): bool = all { s.policy,validAuthority,validDigest,s'=s.with("documents",true) }
  action acknowledge = all { s.policy,s.revisionMatches,s.documents,s'=s.with("acknowledged",true) }
  action step = any { policy(true),policy(false),cache(true,true),cache(true,false),cache(false,true),useCache,
    cacheCloseFailure,cachePublicationFailure,policyWithoutDocuments,noRequiredDocuments,projectStatus(true),projectStatus(false),download(true,true),acknowledge,s'=s }
  val invariant = all { s.acknowledged implies s.policy and s.revisionMatches and s.documents,not(s.admitted) }
  run changedRevisionRefusedTest = init.then(policy(false)).then(download(true,true)).then(acknowledge.fail())
  run corruptedCacheDoesNotAuthorizeTest = init.then(policy(true)).then(cache(true,false)).then(useCache.fail())
  run mutableUrlNotCacheAuthorityTest = init.then(policy(true)).then(cache(false,true)).then(useCache.fail())
  run cacheMissMayFetchTest = init.then(policy(true)).then(cache(true,false)).then(download(true,true)).then(acknowledge).expect(invariant)
  run cacheCloseFailureKeepsVerifiedBytesTest = init.then(policy(true)).then(cache(true,true)).then(cacheCloseFailure)
    .then(useCache).then(acknowledge).expect(s.acknowledged and s.cacheCloseFailed)
  run corruptCacheCloseFailureStillAllowsNetworkTest = init.then(policy(true)).then(cache(true,false)).then(cacheCloseFailure)
    .then(download(true,true)).then(acknowledge).expect(s.acknowledged)
  run optionalCachePublicationDoesNotBlockAcknowledgementTest = init.then(policy(true)).then(download(true,true))
    .then(cachePublicationFailure).then(acknowledge).expect(s.acknowledged)
  run noDocumentsMayAcknowledgeTest = init.then(policyWithoutDocuments).then(noRequiredDocuments).then(acknowledge).expect(s.acknowledged)
  run pausedProjectDocumentCheckDoesNotGrantAdmissionTest = init.then(policyWithoutDocuments).then(projectStatus(false))
    .then(noRequiredDocuments).then(acknowledge).expect(s.acknowledged and not(s.admitted) and not(s.projectActive))
}
