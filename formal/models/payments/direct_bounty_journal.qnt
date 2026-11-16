// @source src/DirectBountyPayment.tsx
// Two component instances, two nonces, three unique prompt identities.
// Synchronous sessionStorage read/modify/write is one transition in a shared
// JS context. Cross-tab/process storage atomicity is not asserted.
// Authored from source only; no model execution or browser check was run.
// Finite reduction: `step` reserves the deterministic fresh request ID
// `used.size() + 1`. Request IDs are opaque prompt identities: every action
// compares them only with each other or with 0 (empty/legacy), and the
// invariant's `used` domain rule is closed under permutations of 1..3. `used`
// only grows, so step-reachable `used` is always 1..k. Any reservation of a
// different unused ID reaches the image of a canonical state under a
// permutation of 1..3 that fixes 0, with the same invariant truth. Direct
// `reserve(q,n,id,stored)` and the named scenarios still accept any ID.
module direct_bounty_journal {
  type Entry={request:int,transaction:int,hash:int,candidate:int}
  type Held={nonce:int,request:int,transaction:int}
  val empty={request:0,transaction:0,hash:0,candidate:0}
  val noHeld={nonce:0,request:0,transaction:0}
  // Only the untouched cell of before is an invariant witness. Its touched
  // cell is canonical empty; actual store/memory/held values are unchanged.
  var s:{store:int->Entry,memory:int->(int->Entry),held:int->Held,used:Set[int],
    warning:int->bool,mounted:int->bool,checked:int->int,emptyInput:int->Set[int],before:int->Entry,touched:int,observed:int,expected:int,wrote:bool}
  action init=s'={store:Map(1->empty,2->empty),
    memory:Map(1->Map(1->empty,2->empty),2->Map(1->empty,2->empty)),
    held:Map(1->noHeld,2->noHeld),used:Set(),warning:Map(1->false,2->false),
    mounted:Map(1->true,2->true),checked:Map(1->0,2->0),
    emptyInput:Map(1->Set(),2->Set()),
    before:Map(1->empty,2->empty),touched:0,observed:0,expected:0,wrote:false}
  action reserve(q:int,n:int,id:int,stored:bool):bool={
    val entry={request:id,transaction:n,hash:0,candidate:0}
    val nextStore=s.store.set(n,entry)
    all{s.mounted.get(q),s.held.get(q)==noHeld,not(s.used.contains(id)),s.store.get(n).transaction==0,
      s'=if(stored)s.with("store",nextStore).with("memory",s.memory.set(q,nextStore))
        .with("held",s.held.set(q,{nonce:n,request:id,transaction:n}))
        .with("used",s.used.union(Set(id))).with("before",s.store.set(n,empty)).with("touched",n)
        .with("observed",0).with("expected",0).with("wrote",true)
      else s.with("warning",s.warning.set(q,true)).with("wrote",false)}
  }
  action returned(q:int,stored:bool):bool={
    val held=s.held.get(q)
    val current=if(held.nonce==0)empty else s.store.get(held.nonce)
    val owned=current.request==held.request and current.transaction==held.transaction
    val nextStore=s.store.set(held.nonce,current.with("hash",1))
    val local=if(held.nonce==0)empty else s.memory.get(q).get(held.nonce)
    all{held!=noHeld,
      s'=s.with("held",s.held.set(q,noHeld))
        .with("store",if(owned and stored)nextStore else s.store)
        .with("memory",if(owned and stored and s.mounted.get(q))s.memory.set(q,nextStore)
          else if(owned and s.mounted.get(q) and local.request==held.request)s.memory.set(q,s.memory.get(q).set(held.nonce,local.with("hash",1)))
          else s.memory)
        .with("warning",s.warning.set(q,not(owned and stored)))
        .with("before",s.store.set(held.nonce,empty)).with("touched",held.nonce)
        .with("observed",current.request).with("expected",held.request).with("wrote",owned and stored)}
  }
  action rejected(q:int):bool={
    val held=s.held.get(q)
    val current=if(held.nonce==0)empty else s.store.get(held.nonce)
    val owned=current.request==held.request and current.transaction==held.transaction
      and current.hash==0 and current.candidate==0
    all{held!=noHeld,
      s'=s.with("held",s.held.set(q,noHeld))
        .with("store",if(owned)s.store.set(held.nonce,empty) else s.store)
        .with("before",s.store.set(held.nonce,empty)).with("touched",held.nonce)
        .with("observed",current.request).with("expected",held.request).with("wrote",owned)}
  }
  action depart(q:int):bool=s'=s.with("mounted",s.mounted.set(q,false))
  action clearInput(q:int,n:int):bool=s'=s.with("emptyInput",
    s.emptyInput.set(q,s.emptyInput.get(q).union(Set(n))))
  // With no input edit, use the stored candidate/hash after restoring a
  // matching known local hash. An explicitly cleared input selects nothing.
  action check(q:int,n:int,stored:bool):bool={
    val local=s.memory.get(q).get(n)
    val current=s.store.get(n)
    val merge=local.hash>0 and current.hash==0 and local.request>0
      and current.request==local.request and current.transaction==local.transaction
    val conflict=local.hash>0 and current.hash==0 and not(merge)
    val entry=if(merge)current.with("hash",local.hash) else current
    val nextStore=s.store.set(n,entry)
    val hash=if(s.emptyInput.get(q).contains(n))0 else if(entry.candidate>0)entry.candidate else entry.hash
    all{s.mounted.get(q),
      s'=s.with("store",if(stored and not(conflict))nextStore else s.store)
        .with("memory",if(stored and not(conflict))s.memory.set(q,nextStore) else s.memory)
        .with("checked",s.checked.set(q,if(stored and not(conflict))hash else 0))
        .with("warning",s.warning.set(q,not(stored) or conflict))
        .with("before",s.store.set(n,empty)).with("touched",n)
        .with("observed",current.request).with("expected",if(merge)local.request else 0)
        .with("wrote",stored and not(conflict))}
  }
  action newerStoredHash(n:int):bool=all{s.store.get(n).transaction>0,
    s'=s.with("store",s.store.set(n,s.store.get(n).with("hash",2)))
      .with("before",s.store.set(n,empty)).with("touched",n).with("expected",0).with("wrote",true)}
  // External resolution/removal makes an ABA reservation possible. This is
  // not an automatic clear operation supplied by DirectBountyPayment.
  action resolvedAndRemoved(n:int):bool=s'=s.with("store",s.store.set(n,empty))
    .with("before",s.store.set(n,empty)).with("touched",n).with("expected",0).with("wrote",true)
  action legacy(n:int):bool=all{s.store.get(n).transaction==0,
    s'=s.with("store",s.store.set(n,{request:0,transaction:n,hash:0,candidate:1}))
      .with("before",s.store.set(n,empty)).with("touched",n).with("expected",0).with("wrote",true)}
  // Choices belong to the action that uses them. This preserves the same
  // transition union without repeating every successor for unrelated values.
  action chooseReserve={nondet q=Set(1,2).oneOf() nondet n=Set(1,2).oneOf()
    nondet stored=Set(false,true).oneOf()
    all{s.used.size()<3,reserve(q,n,s.used.size()+1,stored)}}
  action chooseReturned={nondet q=Set(1,2).oneOf() nondet stored=Set(false,true).oneOf()
    returned(q,stored)}
  action chooseRejected={nondet q=Set(1,2).oneOf() rejected(q)}
  action chooseDepart={nondet q=Set(1,2).oneOf() depart(q)}
  action chooseClearInput={nondet q=Set(1,2).oneOf() nondet n=Set(1,2).oneOf()
    clearInput(q,n)}
  action chooseCheck={nondet q=Set(1,2).oneOf() nondet n=Set(1,2).oneOf()
    nondet stored=Set(false,true).oneOf() check(q,n,stored)}
  action chooseNewerStoredHash={nondet n=Set(1,2).oneOf() newerStoredHash(n)}
  action chooseResolvedAndRemoved={nondet n=Set(1,2).oneOf() resolvedAndRemoved(n)}
  action chooseLegacy={nondet n=Set(1,2).oneOf() legacy(n)}
  action step=any{chooseReserve,chooseReturned,chooseRejected,chooseDepart,chooseClearInput,
    chooseCheck,chooseNewerStoredHash,chooseResolvedAndRemoved,chooseLegacy,s'=s}
  val invariant=all{s.used.subseteq(Set(1,2,3)),
    s.wrote and s.expected>0 implies s.observed==s.expected,
    s.touched>0 implies Set(1,2).exclude(Set(s.touched)).forall(n=>s.store.get(n)==s.before.get(n))}
  run lateNonceResultPreservesOtherLegTest=init.then(reserve(1,1,1,true))
    .then(reserve(2,2,2,true)).then(returned(2,true)).then(returned(1,true))
    .expect(s.store.get(1).hash==1 and s.store.get(2).hash==1)
  run lateResultCannotReplaceNewSameNonceTest=init.then(reserve(1,1,1,true))
    .then(resolvedAndRemoved(1)).then(reserve(2,1,3,true)).then(returned(1,true))
    .expect(s.store.get(1).request==3 and s.store.get(1).hash==0 and s.warning.get(1))
  run oldRejectionCannotDeleteNewSameNonceTest=init.then(reserve(1,1,1,true))
    .then(resolvedAndRemoved(1)).then(reserve(2,1,3,true)).then(rejected(1))
    .expect(s.store.get(1).request==3)
  run duplicateNonceCannotStartSecondPromptTest=init.then(reserve(1,1,1,true))
    .then(reserve(2,1,2,true).fail())
  run failedHashWriteKeepsKnownResultInMemoryTest=init.then(reserve(1,1,1,true))
    .then(reserve(2,2,2,true)).then(returned(1,false))
    .expect(s.store.get(1).hash==0 and s.memory.get(1).get(1).hash==1 and s.store.get(2).request==2)
  run failedMarkerWriteCannotOwnPromptTest=init.then(reserve(1,1,1,false))
    .expect(s.held.get(1)==noHeld and s.store.get(1)==empty)
  run checkAfterFailedHashWriteKeepsKnownHashTest=init.then(reserve(1,1,1,true)).then(returned(1,false))
    .then(check(1,1,true)).expect(s.store.get(1).hash==1 and s.checked.get(1)==1)
  run failedCheckWriteKeepsLocalRecoveryTest=init.then(reserve(1,1,1,true)).then(returned(1,false))
    .then(check(1,1,false)).expect(s.memory.get(1).get(1).hash==1 and s.checked.get(1)==0 and s.warning.get(1))
  run localHashCannotReplaceNewerStoredHashTest=init.then(reserve(1,1,1,true)).then(returned(1,false))
    .then(newerStoredHash(1)).then(check(1,1,true)).expect(s.store.get(1).hash==2 and s.checked.get(1)==2)
  run localHashCannotAttachToNewReservationTest=init.then(reserve(1,1,1,true)).then(returned(1,false))
    .then(resolvedAndRemoved(1)).then(reserve(2,1,3,true)).then(check(1,1,true))
    .expect(s.store.get(1).request==3 and s.store.get(1).hash==0 and s.checked.get(1)==0)
  run noPromptAfterDepartureTest=init.then(depart(1)).then(reserve(1,1,1,true).fail())
  run departedCompletionStillMergesOwnedEvidenceTest=init.then(reserve(1,1,1,true)).then(depart(1))
    .then(reserve(2,2,2,true)).then(returned(1,true))
    .expect(s.store.get(1).hash==1 and s.store.get(2).request==2)
  run legacyCandidateRemainsProtectedTest=init.then(legacy(1))
    .expect(s.store.get(1).candidate==1)
  run legacyCandidateRefusesNewPromptTest=init.then(legacy(1))
    .then(reserve(1,1,1,true).fail())
  run canonicalFreshIdsReachSameNonceAbaTest=init.then(reserve(1,1,1,true))
    .then(resolvedAndRemoved(1)).then(reserve(2,1,2,true)).then(returned(1,true))
    .expect(s.store.get(1).request==2 and s.store.get(1).hash==0 and s.warning.get(1))
  run canonicalFreshIdsExhaustAfterThreeTest=init.then(reserve(1,1,1,true)).then(rejected(1))
    .then(reserve(1,1,2,true)).then(rejected(1)).then(reserve(1,1,3,true)).then(rejected(1))
    .expect(s.used==Set(1,2,3) and s.store.get(1)==empty).then(chooseReserve.fail())
  run clearedInputCannotSubmitStoredCandidateTest=init.then(legacy(1))
    .then(check(1,1,true)).then(clearInput(1,1)).then(check(1,1,true))
    .expect(s.store.get(1).candidate==1 and s.checked.get(1)==0)
}
