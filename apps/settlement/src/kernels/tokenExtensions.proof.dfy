lemma u16_ensures(bytes: seq<int>, at: int)
  requires (0 <= at)
  requires ((at + 1) < |bytes|)
  requires forall i: int :: ((0 <= i) ==> (i < |bytes|) ==> ((0 <= bytes[i]) && (bytes[i] <= 255)))
  ensures (0 <= u16(bytes, at))
  ensures (u16(bytes, at) <= 65535)
{
  assert 0 <= bytes[at] <= 255;
  assert 0 <= bytes[at + 1] <= 255;
}

lemma u32_ensures(bytes: seq<int>, at: int)
  requires (0 <= at)
  requires ((at + 3) < |bytes|)
  requires forall i: int :: ((0 <= i) ==> (i < |bytes|) ==> ((0 <= bytes[i]) && (bytes[i] <= 255)))
  ensures (0 <= u32(bytes, at))
  ensures (u32(bytes, at) <= 4294967295)
{
  assert 0 <= bytes[at] <= 255;
  assert 0 <= bytes[at + 1] <= 255;
  assert 0 <= bytes[at + 2] <= 255;
  assert 0 <= bytes[at + 3] <= 255;
}

lemma ZeroTailAll(bytes: seq<int>, at: int)
  requires 0 <= at
  ensures zeroTail(bytes, at) <==> forall i: int :: at <= i < |bytes| ==> bytes[i] == 0
  decreases |bytes| - at
{
  if at < |bytes| {
    ZeroTailAll(bytes, at + 1);
  }
}

lemma zeroTail_ensures(bytes: seq<int>, at: int)
  requires (0 <= at)
  ensures (zeroTail(bytes, at) <==> forall i: int :: ((at <= i) ==> (i < |bytes|) ==> (bytes[i] == 0)))
{
  ZeroTailAll(bytes, at);
}

lemma nextField_ensures(bytes: seq<int>, at: int)
  requires (-1 <= at)
  requires (at <= |bytes|)
  requires forall i: int :: ((0 <= i) ==> (i < |bytes|) ==> ((0 <= bytes[i]) && (bytes[i] <= 255)))
  ensures ((nextField(bytes, at) == -1) || (((at + 4) <= nextField(bytes, at)) && (nextField(bytes, at) <= |bytes|)))
  ensures ((nextField(bytes, at) != -1) <==> (((0 <= at) && ((at + 4) <= |bytes|)) && (u32(bytes, at) <= ((|bytes| - at) - 4))))
{
  if 0 <= at && at + 4 <= |bytes| {
    u32_ensures(bytes, at);
  }
}

lemma WalkFieldsBounded(bytes: seq<int>, at: int, count: int)
  requires -1 <= at <= |bytes|
  requires count >= 0
  requires forall i: int :: 0 <= i < |bytes| ==> 0 <= bytes[i] <= 255
  ensures walkFields(bytes, at, count) == -1 || (at <= walkFields(bytes, at, count) <= |bytes|)
  decreases count
{
  if count > 0 {
    nextField_ensures(bytes, at);
    var next := nextField(bytes, at);
    if next >= 0 {
      WalkFieldsBounded(bytes, next, count - 1);
    }
  }
}

lemma walkFields_ensures(bytes: seq<int>, at: int, count: int)
  requires (-1 <= at)
  requires (at <= |bytes|)
  requires (count >= 0)
  requires forall i: int :: ((0 <= i) ==> (i < |bytes|) ==> ((0 <= bytes[i]) && (bytes[i] <= 255)))
  ensures ((walkFields(bytes, at, count) == -1) || ((at <= walkFields(bytes, at, count)) && (walkFields(bytes, at, count) <= |bytes|)))
{
  WalkFieldsBounded(bytes, at, count);
}

lemma metadataPayloadValid_ensures(bytes: seq<int>)
  requires forall i: int :: ((0 <= i) ==> (i < |bytes|) ==> ((0 <= bytes[i]) && (bytes[i] <= 255)))
  ensures (metadataPayloadValid(bytes) ==> ((|bytes| >= 72) && (walkFields(bytes, 64, 3) >= 64)))
{
  if |bytes| >= 72 {
    WalkFieldsBounded(bytes, 64, 3);
  }
}
