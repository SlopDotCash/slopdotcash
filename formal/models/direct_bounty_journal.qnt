// @source src/DirectBountyPayment.tsx
// Two component instances, two nonces, three unique prompt identities.
// Synchronous sessionStorage read/modify/write is one transition in a shared
// JS context. Cross-tab/process storage atomicity is not asserted.
// Authored from source only; no model execution or browser check was run.
module direct_bounty_journal {
  type Entry={request:int,transaction:int,hash:int,candidate:int}
  type Held={nonce:int,request:int,transaction:int}
  val empty={request:0,transaction:0,hash:0,candidate:0}
  val noHeld={nonce:0,request:0,transaction:0}
  var s:{store:int->Entry,memory:int->(int->Entry),held:int->Held,used:Set[int],
    warning:int->bool,before:int->Entry,touched:int,observed:int,expected:int,wrote:bool}
  action init=s'={store:Map(1->empty,2->empty),
    memory:Map(1->Map(1->empty,2->empty),2->Map(1->empty,2->empty)),
    held:Map(1->noHeld,2->noHeld),used:Set(),warning:Map(1->false,2->false),
    before:Map(1->empty,2->empty),touched:0,observed:0,expected:0,wrote:false}
  action reserve(q:int,n:int,id:int,stored:bool):bool={
    val entry={request:id,transaction:n,hash:0,candidate:0}
    val next=s.store.set(n,entry)
    all{s.held.get(q)==noHeld,not(s.used.contains(id)),s.store.get(n).transaction==0,
      s'=if(stored)s.with("store",next).with("memory",s.memory.set(q,next))
        .with("held",s.held.set(q,{nonce:n,request:id,transaction:n}))
        .with("used",s.used.union(Set(id))).with("before",s.store).with("touched",n)
        .with("observed",0).with("expected",0).with("wrote",true)
      else s.with("warning",s.warning.set(q,true)).with("wrote",false)}
  }
  action returned(q:int,stored:bool):bool={
    val held=s.held.get(q)
    val current=if(held.nonce==0)empty else s.store.get(held.nonce)
    val owned=current.request==held.request and current.transaction==held.transaction
    val next=s.store.set(held.nonce,current.with("hash",1))
    val local=if(held.nonce==0)empty else s.memory.get(q).get(held.nonce)
    all{held!=noHeld,
      s'=s.with("held",s.held.set(q,noHeld))
        .with("store",if(owned and stored)next else s.store)
        .with("memory",if(owned and stored)s.memory.set(q,next)
          else if(owned and local.request==held.request)s.memory.set(q,s.memory.get(q).set(held.nonce,local.with("hash",1)))
          else s.memory)
        .with("warning",s.warning.set(q,not(owned and stored)))
        .with("before",s.store).with("touched",held.nonce)
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
        .with("before",s.store).with("touched",held.nonce)
        .with("observed",current.request).with("expected",held.request).with("wrote",owned)}
  }
  // External resolution/removal makes an ABA reservation possible. This is
  // not an automatic clear operation supplied by DirectBountyPayment.
  action resolvedAndRemoved(n:int):bool=s'=s.with("store",s.store.set(n,empty))
    .with("before",s.store).with("touched",n).with("expected",0).with("wrote",true)
  action legacy(n:int):bool=all{s.store.get(n).transaction==0,
    s'=s.with("store",s.store.set(n,{request:0,transaction:n,hash:0,candidate:1}))
      .with("before",s.store).with("touched",n).with("expected",0).with("wrote",true)}
  action step={
    nondet q=Set(1,2).oneOf()
    nondet n=Set(1,2).oneOf()
    nondet id=Set(1,2,3).oneOf()
    any{reserve(q,n,id,true),reserve(q,n,id,false),returned(q,true),returned(q,false),
      rejected(q),resolvedAndRemoved(n),legacy(n),s'=s}}
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
  run legacyCandidateRemainsProtectedTest=init.then(legacy(1))
    .then(reserve(1,1,1,true).fail()).expect(s.store.get(1).candidate==1)
}
