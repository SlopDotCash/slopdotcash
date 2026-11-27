lemma EachNetworkOnceUsesFilter(deployments: seq<VaultNetwork>)
  ensures lawEachNetworkOnce(deployments) == (var local_0 := projectNetworks(deployments); !((exists entry :: entry in local_0 && !((|ProofLib.Filter((other: VaultNetwork) => (other.network == entry.network), local_0)| == 1)))))
{
}

lemma WithNetworkPreservesDistinct(networks: seq<VaultNetwork>, incoming: VaultNetwork)
  requires ProofLib.DistinctBy(networks, (v: VaultNetwork) => v.network)
  ensures ProofLib.DistinctBy(withNetwork(networks, incoming), (v: VaultNetwork) => v.network)
{
  var res := withNetwork(networks, incoming);
  if exists entry :: entry in networks && (entry.network == incoming.network) {
    assert |res| == |networks|;
    forall i | 0 <= i < |networks|
      ensures res[i].network == networks[i].network
    {
    }
  } else {
    assert res == networks + [incoming];
    forall i, j | 0 <= i < |res| && 0 <= j < |res| && i != j
      ensures res[i].network != res[j].network
    {
      if i == |networks| {
        assert res[j] in networks;
      } else if j == |networks| {
        assert res[i] in networks;
      }
    }
  }
}

lemma FoldNetworksDistinct(acc: seq<VaultNetwork>, rest: seq<VaultNetwork>)
  requires ProofLib.DistinctBy(acc, (v: VaultNetwork) => v.network)
  ensures ProofLib.DistinctBy(Std.Collections.Seq.FoldLeft((networks: seq<VaultNetwork>, incoming: VaultNetwork) => withNetwork(networks, incoming), acc, rest), (v: VaultNetwork) => v.network)
  decreases |rest|
{
  if |rest| > 0 {
    WithNetworkPreservesDistinct(acc, rest[0]);
    FoldNetworksDistinct(withNetwork(acc, rest[0]), rest[1..]);
  }
}

lemma WithNetworkKeepsAndAdds(networks: seq<VaultNetwork>, incoming: VaultNetwork)
  ensures forall x :: x in networks ==> exists y :: y in withNetwork(networks, incoming) && y.network == x.network
  ensures exists y :: y in withNetwork(networks, incoming) && y.network == incoming.network
{
  var res := withNetwork(networks, incoming);
  if exists entry :: entry in networks && (entry.network == incoming.network) {
    forall i | 0 <= i < |networks|
      ensures res[i] in res && res[i].network == networks[i].network
    {
    }
    var entry :| entry in networks && entry.network == incoming.network;
    var k :| 0 <= k < |networks| && networks[k] == entry;
    assert res[k] in res && res[k].network == incoming.network;
  } else {
    assert res == networks + [incoming];
    assert incoming in res;
  }
}

lemma FoldNetworksHasAll(acc: seq<VaultNetwork>, rest: seq<VaultNetwork>)
  ensures forall x :: x in acc ==> exists y :: y in Std.Collections.Seq.FoldLeft((networks: seq<VaultNetwork>, incoming: VaultNetwork) => withNetwork(networks, incoming), acc, rest) && y.network == x.network
  ensures forall d :: d in rest ==> exists y :: y in Std.Collections.Seq.FoldLeft((networks: seq<VaultNetwork>, incoming: VaultNetwork) => withNetwork(networks, incoming), acc, rest) && y.network == d.network
  decreases |rest|
{
  if |rest| == 0 {
    forall x | x in acc
      ensures exists y :: y in acc && y.network == x.network
    {
      assert x in acc && x.network == x.network;
    }
  } else {
    var next := withNetwork(acc, rest[0]);
    WithNetworkKeepsAndAdds(acc, rest[0]);
    FoldNetworksHasAll(next, rest[1..]);
    var final := Std.Collections.Seq.FoldLeft((networks: seq<VaultNetwork>, incoming: VaultNetwork) => withNetwork(networks, incoming), acc, rest);
    assert final == Std.Collections.Seq.FoldLeft((networks: seq<VaultNetwork>, incoming: VaultNetwork) => withNetwork(networks, incoming), next, rest[1..]);
    forall x | x in acc
      ensures exists y :: y in final && y.network == x.network
    {
      var z :| z in next && z.network == x.network;
      var y :| y in final && y.network == z.network;
      assert y in final && y.network == x.network;
    }
    forall d | d in rest
      ensures exists y :: y in final && y.network == d.network
    {
      if d == rest[0] {
        var z :| z in next && z.network == rest[0].network;
        var y :| y in final && y.network == z.network;
        assert y in final && y.network == d.network;
      } else {
        assert d in rest[1..];
      }
    }
  }
}

lemma lawDisagreeingSymbolsShowNone_ensures(firstVault: VaultNetwork, secondVault: VaultNetwork)
  ensures (lawDisagreeingSymbolsShowNone(firstVault, secondVault) == true)
{
  if firstVault.network == secondVault.network && firstVault.symbol != secondVault.symbol {
    var f := (networks: seq<VaultNetwork>, incoming: VaultNetwork) => withNetwork(networks, incoming);
    var xs := [firstVault, secondVault];
    assert xs[0] == firstVault && xs[1..] == [secondVault];
    assert [secondVault][0] == secondVault && [secondVault][1..] == [];
    assert withNetwork([], firstVault) == [firstVault];
    assert firstVault in [firstVault];
    assert withNetwork([firstVault], secondVault) == [firstVault.(symbol := "")];
    assert Std.Collections.Seq.FoldLeft(f, [], xs) == Std.Collections.Seq.FoldLeft(f, [firstVault], [secondVault]);
    assert Std.Collections.Seq.FoldLeft(f, [firstVault], [secondVault]) == Std.Collections.Seq.FoldLeft(f, [firstVault.(symbol := "")], []);
  }
}

lemma lawEachNetworkOnce_ensures(deployments: seq<VaultNetwork>)
  ensures (lawEachNetworkOnce(deployments) == true)
{
  EachNetworkOnceUsesFilter(deployments);
  var nets := projectNetworks(deployments);
  FoldNetworksDistinct([], deployments);
  forall entry | entry in nets
    ensures |ProofLib.Filter((other: VaultNetwork) => (other.network == entry.network), nets)| == 1
  {
    var i :| 0 <= i < |nets| && nets[i] == entry;
    ProofLib.FilterOne((other: VaultNetwork) => (other.network == entry.network), nets, i);
  }
}

lemma lawEveryVaultNetworkListed_ensures(deployments: seq<VaultNetwork>)
  ensures (lawEveryVaultNetworkListed(deployments) == true)
{
  FoldNetworksHasAll([], deployments);
}
