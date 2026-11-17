// The decoder reads exactly the bytes its value encodes: what it decodes re-encodes to the bytes it consumed, and any byte string that begins with that encoding decodes back to the same value (DecodeEncode).

lemma LittleEndianShift(data: seq<int>, at: int, width: int)
  requires 1 <= |data| && 0 <= at && 0 <= width && at + 1 + width <= |data|
  ensures littleEndian(data, at + 1, width) == littleEndian(data[1..], at, width)
  decreases width
{
  if width > 0 {
    LittleEndianShift(data, at + 1, width - 1);
    assert data[1..][at] == data[at + 1];
  }
}

lemma LittleEndianRoundTrip(value: int, width: int)
  requires 0 <= width && 0 <= value && value < byteSpan(width)
  ensures |littleEndianBytes(value, width)| == width
  ensures forall i :: 0 <= i < width ==> 0 <= littleEndianBytes(value, width)[i] <= 255
  ensures littleEndian(littleEndianBytes(value, width), 0, width) == value
  decreases width
{
  if width > 0 {
    assert JSRem(value, 256) == value % 256;
    assert JSTruncDiv(value, 256) == value / 256;
    assert byteSpan(width) == 256 * byteSpan(width - 1);
    assert value / 256 < byteSpan(width - 1);
    LittleEndianRoundTrip(value / 256, width - 1);
    var rest := littleEndianBytes(value / 256, width - 1);
    var bytes := littleEndianBytes(value, width);
    assert bytes == [value % 256] + rest;
    assert bytes[1..] == rest;
    assert forall i :: 1 <= i < width ==> bytes[i] == rest[i - 1];
    LittleEndianShift(bytes, 0, width - 1);
    assert littleEndian(bytes, 0, width) == value % 256 + 256 * littleEndian(rest, 0, width - 1);
    assert value == value % 256 + 256 * (value / 256);
  }
}

lemma LittleEndianBytesOfRead(data: seq<int>, at: int, width: int)
  requires 0 <= at && 0 <= width && at + width <= |data|
  requires forall i :: 0 <= i < |data| ==> 0 <= data[i] <= 255
  ensures 0 <= littleEndian(data, at, width) < byteSpan(width)
  ensures littleEndianBytes(littleEndian(data, at, width), width) == data[at .. at + width]
  decreases width
{
  if width > 0 {
    LittleEndianBytesOfRead(data, at + 1, width - 1);
    var rest := littleEndian(data, at + 1, width - 1);
    var value := littleEndian(data, at, width);
    assert value == data[at] + 256 * rest;
    assert byteSpan(width) == 256 * byteSpan(width - 1);
    assert value % 256 == data[at];
    assert value / 256 == rest;
    assert JSRem(value, 256) == value % 256;
    assert JSTruncDiv(value, 256) == value / 256;
    assert littleEndianBytes(value, width) == [value % 256] + littleEndianBytes(value / 256, width - 1);
    assert data[at .. at + width] == [data[at]] + data[at + 1 .. at + width];
  }
}

lemma LengthPrefixIsLittleEndian(data: seq<int>, at: int)
  requires 0 <= at && at + 4 <= |data|
  ensures lengthPrefix(data, at) == littleEndian(data, at, 4)
{
  assert littleEndian(data, at + 4, 0) == 0;
  assert littleEndian(data, at + 3, 1) == data[at + 3];
  assert littleEndian(data, at + 2, 2) == data[at + 2] + 256 * data[at + 3];
  assert littleEndian(data, at + 1, 3) == data[at + 1] + 256 * data[at + 2] + 65536 * data[at + 3];
}

lemma PrefixBytes(data: seq<int>, at: int)
  requires 0 <= at && at + 4 <= |data|
  requires forall i :: 0 <= i < |data| ==> 0 <= data[i] <= 255
  ensures 0 <= lengthPrefix(data, at)
  ensures littleEndianBytes(lengthPrefix(data, at), 4) == data[at .. at + 4]
{
  LengthPrefixIsLittleEndian(data, at);
  LittleEndianBytesOfRead(data, at, 4);
}

lemma LittleEndianLocal(data: seq<int>, data2: seq<int>, at: int, at2: int, width: int)
  requires 0 <= at && 0 <= at2 && 0 <= width && at + width <= |data| && at2 + width <= |data2|
  requires data2[at2 .. at2 + width] == data[at .. at + width]
  ensures littleEndian(data2, at2, width) == littleEndian(data, at, width)
  decreases width
{
  if width > 0 {
    assert data2[at2] == data2[at2 .. at2 + width][0];
    assert data[at] == data[at .. at + width][0];
    assert data2[at2 + 1 .. at2 + width] == data2[at2 .. at2 + width][1..];
    assert data[at + 1 .. at + width] == data[at .. at + width][1..];
    LittleEndianLocal(data, data2, at + 1, at2 + 1, width - 1);
  }
}

lemma SliceAt(data: seq<int>, data2: seq<int>, at: int, at2: int, length: int, j: int)
  requires 0 <= at && 0 <= at2 && 0 <= j < length && at + length <= |data| && at2 + length <= |data2|
  requires data2[at2 .. at2 + length] == data[at .. at + length]
  ensures data2[at2 + j] == data[at + j]
{
  assert data2[at2 .. at2 + length][j] == data2[at2 + j];
  assert data[at .. at + length][j] == data[at + j];
}

lemma SubSlice(data: seq<int>, data2: seq<int>, at: int, at2: int, length: int, x: int, y: int)
  requires 0 <= at && 0 <= at2 && 0 <= x <= y <= length && at + length <= |data| && at2 + length <= |data2|
  requires data2[at2 .. at2 + length] == data[at .. at + length]
  ensures data2[at2 + x .. at2 + y] == data[at + x .. at + y]
{
  assert data2[at2 + x .. at2 + y] == data2[at2 .. at2 + length][x .. y];
  assert data[at + x .. at + y] == data[at .. at + length][x .. y];
}

lemma PrefixLocal(data: seq<int>, data2: seq<int>, at: int, at2: int, length: int)
  requires 0 <= at && 0 <= at2 && 4 <= length && at + length <= |data| && at2 + length <= |data2|
  requires data2[at2 .. at2 + length] == data[at .. at + length]
  ensures lengthPrefix(data2, at2) == lengthPrefix(data, at)
{
  SliceAt(data, data2, at, at2, length, 0);
  SliceAt(data, data2, at, at2, length, 1);
  SliceAt(data, data2, at, at2, length, 2);
  SliceAt(data, data2, at, at2, length, 3);
}

lemma EncodeCons(table: WireTable, node: WireNode, items: seq<WireNode>)
  requires 0 <= node.shape < |table.shapes| && 0 <= node.number
  requires forall k: int :: 0 <= k < |items| ==> 0 <= (items)[k].shape < |table.shapes| && 0 <= (items)[k].number
  ensures forall k: int :: 0 <= k < |[node] + items| ==> 0 <= ([node] + items)[k].shape < |table.shapes| && 0 <= ([node] + items)[k].number
  ensures encodeNodes(table, [node] + items) == nodeBytes(table, node) + encodeNodes(table, items)
{
  forall k: int | 0 <= k < |[node] + items|
    ensures 0 <= ([node] + items)[k].shape < |table.shapes| && 0 <= ([node] + items)[k].number
  {
    if k > 0 {
      assert ([node] + items)[k] == items[k - 1];
    }
  }
  assert ([node] + items)[0] == node;
  assert ([node] + items)[1..] == items;
}

lemma EncodeAppend(table: WireTable, a: seq<WireNode>, b: seq<WireNode>)
  requires forall k: int :: 0 <= k < |a| ==> 0 <= (a)[k].shape < |table.shapes| && 0 <= (a)[k].number
  requires forall k: int :: 0 <= k < |b| ==> 0 <= (b)[k].shape < |table.shapes| && 0 <= (b)[k].number
  ensures forall k: int :: 0 <= k < |a + b| ==> 0 <= (a + b)[k].shape < |table.shapes| && 0 <= (a + b)[k].number
  ensures encodeNodes(table, a + b) == encodeNodes(table, a) + encodeNodes(table, b)
  decreases |a|
{
  forall k: int | 0 <= k < |a + b|
    ensures 0 <= (a + b)[k].shape < |table.shapes| && 0 <= (a + b)[k].number
  {
    if k < |a| {
      assert (a + b)[k] == a[k];
    } else {
      assert (a + b)[k] == b[k - |a|];
    }
  }
  if |a| == 0 {
    assert a + b == b;
  } else {
    assert (a + b)[0] == a[0];
    assert (a + b)[1..] == a[1..] + b;
    EncodeAppend(table, a[1..], b);
    assert encodeNodes(table, a + b) == nodeBytes(table, a[0]) + (encodeNodes(table, a[1..]) + encodeNodes(table, b));
    assert encodeNodes(table, a) == nodeBytes(table, a[0]) + encodeNodes(table, a[1..]);
    assert nodeBytes(table, a[0]) + (encodeNodes(table, a[1..]) + encodeNodes(table, b)) == (nodeBytes(table, a[0]) + encodeNodes(table, a[1..])) + encodeNodes(table, b);
  }
}

lemma HeaderThenItems(data: seq<int>, table: WireTable, node: WireNode, items: seq<WireNode>, at: int, start: int, end: int)
  requires 0 <= node.shape < |table.shapes| && 0 <= node.number
  requires forall k: int :: 0 <= k < |items| ==> 0 <= (items)[k].shape < |table.shapes| && 0 <= (items)[k].number
  ensures forall k: int :: 0 <= k < |[node] + items| ==> 0 <= ([node] + items)[k].shape < |table.shapes| && 0 <= ([node] + items)[k].number
  ensures 0 <= at <= start <= end <= |data| && nodeBytes(table, node) == data[at .. start] && encodeNodes(table, items) == data[start .. end] ==> encodeNodes(table, [node] + items) == data[at .. end]
{
  EncodeCons(table, node, items);
  if 0 <= at <= start <= end <= |data| {
    assert data[at .. start] + data[start .. end] == data[at .. end];
  }
}

lemma ReadFacts(data: seq<int>, table: WireTable, shape: int, at: nat, nodes: int, depth: int)
  requires forall i: int :: ((0 <= i) ==> (i < |data|) ==> ((0 <= data[i]) && (data[i] <= 255)))
  requires forall i: int :: ((0 <= i) ==> (i < |table.members|) ==> ((0 <= table.members[i]) && (table.members[i] < |table.shapes|)))
  requires forall i: int :: ((0 <= i) ==> (i < |table.shapes|) ==> shapeWellFormed(table.shapes[i], |table.shapes|, |table.members|))
  requires forall i: int :: ((0 <= i) ==> (i < |table.shapes|) ==> (table.shapes[i].kind == enumShape) ==> forall k: int :: ((table.shapes[i].first <= k) ==> (k < (table.shapes[i].first + table.shapes[i].count)) ==> (table.shapes[table.members[k]].kind == structShape)))
  requires 0 <= shape < |table.shapes|
  requires 0 <= depth <= maximumDepth + 1
  ensures var r := readShape(data, table, shape, at, nodes, depth); at <= r.at && (at <= |data| ==> r.at <= |data|)
  ensures var r := readShape(data, table, shape, at, nodes, depth); nodes < r.nodes && (nodes <= maximumNodes ==> r.nodes <= maximumNodes + 1) && (r.error == 0 ==> r.nodes <= maximumNodes)
  ensures var r := readShape(data, table, shape, at, nodes, depth); r.error == 0 || r.error == truncated || r.error == collectionTooLarge || r.error == boundsExceeded || r.error == invalidBool || r.error == invalidOption || r.error == unknownVariant
  ensures var r := readShape(data, table, shape, at, nodes, depth); table.shapes[shape].kind == unsignedShape && r.error == 0 ==> r.at == at + table.shapes[shape].width && r.at <= |data| && r.node.number == littleEndian(data, at, table.shapes[shape].width)
  ensures var r := readShape(data, table, shape, at, nodes, depth); table.shapes[shape].kind == vecShape && r.error == 0 ==> at + 4 <= r.at && at + 4 <= |data| && r.node.number == lengthPrefix(data, at)
  ensures var r := readShape(data, table, shape, at, nodes, depth); r.error == 0 ==> forall k: int :: 0 <= k < |[r.node] + r.items| ==> 0 <= ([r.node] + r.items)[k].shape < |table.shapes| && 0 <= ([r.node] + r.items)[k].number
  ensures var r := readShape(data, table, shape, at, nodes, depth); r.error == 0 && at <= |data| ==> encodeNodes(table, [r.node] + r.items) == data[at .. r.at]
  decreases (maximumDepth + 1 - depth) * 258
{
  var r := readShape(data, table, shape, at, nodes, depth);
  var n := nodes + 1;
  if n <= maximumNodes && depth <= maximumDepth {
    var s := table.shapes[shape];
    assert shapeWellFormed(s, |table.shapes|, |table.members|);
    if s.kind == unsignedShape {
      if s.width <= |data| - at {
        var node := WireNode(shape, littleEndian(data, at, s.width), []);
        assert r == WireRead(0, at + s.width, n, node, []);
        LittleEndianBytesOfRead(data, at, s.width);
        assert nodeBytes(table, node) == data[at .. at + s.width];
        assert encodeNodes(table, []) == data[at + s.width .. at + s.width];
        HeaderThenItems(data, table, node, [], at, at + s.width, at + s.width);
      }
    } else if s.kind == bytesShape || s.kind == vecShape {
      if 4 <= |data| - at {
        var count := lengthPrefix(data, at);
        PrefixBytes(data, at);
        if count <= maximumCollection {
          if s.kind == vecShape {
            var node := WireNode(shape, count, []);
            var w := readItems(data, table, true, s.child, 0, count, 0, at + 4, n, depth + 1);
            assert r == withNode(node, w);
            ItemsFacts(data, table, true, s.child, 0, count, 0, at + 4, n, depth + 1);
            if w.error == 0 {
              assert nodeBytes(table, node) == data[at .. at + 4];
              HeaderThenItems(data, table, node, w.items, at, at + 4, w.at);
            }
          } else if count <= |data| - at - 4 {
            var node := WireNode(shape, count, data[at + 4 .. at + 4 + count]);
            assert r == WireRead(0, at + 4 + count, n, node, []);
            assert data[at .. at + 4] + data[at + 4 .. at + 4 + count] == data[at .. at + 4 + count];
            assert nodeBytes(table, node) == data[at .. at + 4 + count];
            assert encodeNodes(table, []) == data[at + 4 + count .. at + 4 + count];
            HeaderThenItems(data, table, node, [], at, at + 4 + count, at + 4 + count);
          }
        }
      }
    } else if s.kind == arrayShape {
      var node := WireNode(shape, 0, []);
      var w := readItems(data, table, true, s.child, 0, s.count, 0, at, n, depth + 1);
      assert r == withNode(node, w);
      ItemsFacts(data, table, true, s.child, 0, s.count, 0, at, n, depth + 1);
      if w.error == 0 {
        if at <= |data| {
          assert nodeBytes(table, node) == data[at .. at];
        }
        HeaderThenItems(data, table, node, w.items, at, at, w.at);
      }
    } else if s.kind == structShape {
      var node := WireNode(shape, 0, []);
      var w := readItems(data, table, false, 0, s.first, s.count, 0, at, n, depth + 1);
      assert r == withNode(node, w);
      ItemsFacts(data, table, false, 0, s.first, s.count, 0, at, n, depth + 1);
      if w.error == 0 {
        if at <= |data| {
          assert nodeBytes(table, node) == data[at .. at];
        }
        HeaderThenItems(data, table, node, w.items, at, at, w.at);
      }
    } else if at < |data| {
      if s.kind == boolShape || s.kind == optionShape {
        if data[at] == 0 || (s.kind == boolShape && data[at] == 1) {
          var node := WireNode(shape, data[at], []);
          assert r == WireRead(0, at + 1, n, node, []);
          assert nodeBytes(table, node) == data[at .. at + 1];
          assert encodeNodes(table, []) == data[at + 1 .. at + 1];
          HeaderThenItems(data, table, node, [], at, at + 1, at + 1);
        } else if s.kind == optionShape && data[at] == 1 {
          var node := WireNode(shape, 1, []);
          var w := readItems(data, table, true, s.child, 0, 1, 0, at + 1, n, depth + 1);
          assert r == withNode(node, w);
          ItemsFacts(data, table, true, s.child, 0, 1, 0, at + 1, n, depth + 1);
          if w.error == 0 {
            assert nodeBytes(table, node) == data[at .. at + 1];
            HeaderThenItems(data, table, node, w.items, at, at + 1, w.at);
          }
        }
      } else if data[at] < s.count {
        assert s.kind == enumShape;
        var variant := table.shapes[table.members[s.first + data[at]]];
        assert variant.kind == structShape;
        assert shapeWellFormed(variant, |table.shapes|, |table.members|);
        var node := WireNode(shape, data[at], []);
        var w := readItems(data, table, false, 0, variant.first, variant.count, 0, at + 1, n, depth + 1);
        assert r == withNode(node, w);
        ItemsFacts(data, table, false, 0, variant.first, variant.count, 0, at + 1, n, depth + 1);
        if w.error == 0 {
          assert nodeBytes(table, node) == data[at .. at + 1];
          HeaderThenItems(data, table, node, w.items, at, at + 1, w.at);
        }
      }
    }
  }
}

lemma ItemsFacts(data: seq<int>, table: WireTable, repeated: bool, child: int, first: int, count: int, i: int, at: nat, nodes: int, depth: int)
  requires forall i: int :: ((0 <= i) ==> (i < |data|) ==> ((0 <= data[i]) && (data[i] <= 255)))
  requires forall i: int :: ((0 <= i) ==> (i < |table.members|) ==> ((0 <= table.members[i]) && (table.members[i] < |table.shapes|)))
  requires forall i: int :: ((0 <= i) ==> (i < |table.shapes|) ==> shapeWellFormed(table.shapes[i], |table.shapes|, |table.members|))
  requires forall i: int :: ((0 <= i) ==> (i < |table.shapes|) ==> (table.shapes[i].kind == enumShape) ==> forall k: int :: ((table.shapes[i].first <= k) ==> (k < (table.shapes[i].first + table.shapes[i].count)) ==> (table.shapes[table.members[k]].kind == structShape)))
  requires repeated ==> 0 <= child < |table.shapes|
  requires !repeated ==> 0 <= first && first + count <= |table.members|
  requires 0 <= i <= count <= maximumCollection
  requires 0 <= depth <= maximumDepth + 1
  ensures var w := readItems(data, table, repeated, child, first, count, i, at, nodes, depth); at <= w.at && (at <= |data| ==> w.at <= |data|)
  ensures var w := readItems(data, table, repeated, child, first, count, i, at, nodes, depth); nodes <= w.nodes && (nodes <= maximumNodes ==> w.nodes <= maximumNodes + 1) && (w.error == 0 && nodes <= maximumNodes ==> w.nodes <= maximumNodes)
  ensures var w := readItems(data, table, repeated, child, first, count, i, at, nodes, depth); w.error == 0 || w.error == truncated || w.error == collectionTooLarge || w.error == boundsExceeded || w.error == invalidBool || w.error == invalidOption || w.error == unknownVariant
  ensures var w := readItems(data, table, repeated, child, first, count, i, at, nodes, depth); w.error == 0 ==> forall k: int :: 0 <= k < |w.items| ==> 0 <= (w.items)[k].shape < |table.shapes| && 0 <= (w.items)[k].number
  ensures var w := readItems(data, table, repeated, child, first, count, i, at, nodes, depth); w.error == 0 && at <= |data| ==> encodeNodes(table, w.items) == data[at .. w.at]
  decreases (maximumDepth + 1 - depth) * 258 + count - i + 1
{
  var w := readItems(data, table, repeated, child, first, count, i, at, nodes, depth);
  if i < count {
    var sh := if repeated then child else table.members[first + i];
    var item := readShape(data, table, sh, at, nodes, depth);
    ReadFacts(data, table, sh, at, nodes, depth);
    if item.error == 0 {
      var rest := readItems(data, table, repeated, child, first, count, i + 1, item.at, item.nodes, depth);
      ItemsFacts(data, table, repeated, child, first, count, i + 1, item.at, item.nodes, depth);
      assert w == WireItems(rest.error, rest.at, rest.nodes, ([item.node] + item.items) + rest.items);
      if rest.error == 0 {
        EncodeAppend(table, [item.node] + item.items, rest.items);
        if at <= |data| {
          assert data[at .. item.at] + data[item.at .. rest.at] == data[at .. rest.at];
        }
      }
    }
  } else {
    assert w == WireItems(0, at, nodes, []);
    if at <= |data| {
      assert data[at .. at] == [];
    }
  }
}

lemma ReadLocal(data: seq<int>, data2: seq<int>, table: WireTable, shape: int, at: nat, at2: nat, nodes: int, depth: int)
  requires forall i: int :: ((0 <= i) ==> (i < |data|) ==> ((0 <= data[i]) && (data[i] <= 255)))
  requires forall i: int :: ((0 <= i) ==> (i < |data2|) ==> ((0 <= data2[i]) && (data2[i] <= 255)))
  requires forall i: int :: ((0 <= i) ==> (i < |table.members|) ==> ((0 <= table.members[i]) && (table.members[i] < |table.shapes|)))
  requires forall i: int :: ((0 <= i) ==> (i < |table.shapes|) ==> shapeWellFormed(table.shapes[i], |table.shapes|, |table.members|))
  requires forall i: int :: ((0 <= i) ==> (i < |table.shapes|) ==> (table.shapes[i].kind == enumShape) ==> forall k: int :: ((table.shapes[i].first <= k) ==> (k < (table.shapes[i].first + table.shapes[i].count)) ==> (table.shapes[table.members[k]].kind == structShape)))
  requires 0 <= shape < |table.shapes|
  requires 0 <= depth <= maximumDepth + 1
  requires readShape(data, table, shape, at, nodes, depth).error == 0
  requires at <= readShape(data, table, shape, at, nodes, depth).at <= |data|
  requires var r := readShape(data, table, shape, at, nodes, depth); at2 + (r.at - at) <= |data2| && data2[at2 .. at2 + (r.at - at)] == data[at .. r.at]
  ensures var r := readShape(data, table, shape, at, nodes, depth); readShape(data2, table, shape, at2, nodes, depth) == WireRead(0, at2 + (r.at - at), r.nodes, r.node, r.items)
  decreases (maximumDepth + 1 - depth) * 258
{
  var r := readShape(data, table, shape, at, nodes, depth);
  var length := r.at - at;
  var n := nodes + 1;
  var s := table.shapes[shape];
  assert shapeWellFormed(s, |table.shapes|, |table.members|);
  assert n <= maximumNodes && depth <= maximumDepth;
  if s.kind == unsignedShape {
    assert r.at == at + s.width;
    LittleEndianLocal(data, data2, at, at2, s.width);
  } else if s.kind == bytesShape || s.kind == vecShape {
    assert 4 <= |data| - at;
    var count := lengthPrefix(data, at);
    PrefixBytes(data, at);
    assert count <= maximumCollection;
    if s.kind == vecShape {
      var w := readItems(data, table, true, s.child, 0, count, 0, at + 4, n, depth + 1);
      assert r == withNode(WireNode(shape, count, []), w);
      ItemsFacts(data, table, true, s.child, 0, count, 0, at + 4, n, depth + 1);
      PrefixLocal(data, data2, at, at2, length);
      SubSlice(data, data2, at, at2, length, 4, length);
      ItemsLocal(data, data2, table, true, s.child, 0, count, 0, at + 4, at2 + 4, n, depth + 1);
    } else {
      assert r == WireRead(0, at + 4 + count, n, WireNode(shape, count, data[at + 4 .. at + 4 + count]), []);
      PrefixLocal(data, data2, at, at2, length);
      SubSlice(data, data2, at, at2, length, 4, length);
    }
  } else if s.kind == arrayShape {
    assert r == withNode(WireNode(shape, 0, []), readItems(data, table, true, s.child, 0, s.count, 0, at, n, depth + 1));
    ItemsLocal(data, data2, table, true, s.child, 0, s.count, 0, at, at2, n, depth + 1);
  } else if s.kind == structShape {
    assert r == withNode(WireNode(shape, 0, []), readItems(data, table, false, 0, s.first, s.count, 0, at, n, depth + 1));
    ItemsLocal(data, data2, table, false, 0, s.first, s.count, 0, at, at2, n, depth + 1);
  } else {
    assert at < |data|;
    if s.kind == boolShape || (s.kind == optionShape && data[at] == 0) {
      assert r.at == at + 1;
      SliceAt(data, data2, at, at2, length, 0);
    } else if s.kind == optionShape {
      assert data[at] == 1;
      var w := readItems(data, table, true, s.child, 0, 1, 0, at + 1, n, depth + 1);
      assert r == withNode(WireNode(shape, 1, []), w);
      ItemsFacts(data, table, true, s.child, 0, 1, 0, at + 1, n, depth + 1);
      SliceAt(data, data2, at, at2, length, 0);
      SubSlice(data, data2, at, at2, length, 1, length);
      ItemsLocal(data, data2, table, true, s.child, 0, 1, 0, at + 1, at2 + 1, n, depth + 1);
    } else {
      assert s.kind == enumShape && data[at] < s.count;
      var variant := table.shapes[table.members[s.first + data[at]]];
      assert variant.kind == structShape;
      assert shapeWellFormed(variant, |table.shapes|, |table.members|);
      var w := readItems(data, table, false, 0, variant.first, variant.count, 0, at + 1, n, depth + 1);
      assert r == withNode(WireNode(shape, data[at], []), w);
      ItemsFacts(data, table, false, 0, variant.first, variant.count, 0, at + 1, n, depth + 1);
      SliceAt(data, data2, at, at2, length, 0);
      SubSlice(data, data2, at, at2, length, 1, length);
      ItemsLocal(data, data2, table, false, 0, variant.first, variant.count, 0, at + 1, at2 + 1, n, depth + 1);
    }
  }
}

lemma ItemsLocal(data: seq<int>, data2: seq<int>, table: WireTable, repeated: bool, child: int, first: int, count: int, i: int, at: nat, at2: nat, nodes: int, depth: int)
  requires forall i: int :: ((0 <= i) ==> (i < |data|) ==> ((0 <= data[i]) && (data[i] <= 255)))
  requires forall i: int :: ((0 <= i) ==> (i < |data2|) ==> ((0 <= data2[i]) && (data2[i] <= 255)))
  requires forall i: int :: ((0 <= i) ==> (i < |table.members|) ==> ((0 <= table.members[i]) && (table.members[i] < |table.shapes|)))
  requires forall i: int :: ((0 <= i) ==> (i < |table.shapes|) ==> shapeWellFormed(table.shapes[i], |table.shapes|, |table.members|))
  requires forall i: int :: ((0 <= i) ==> (i < |table.shapes|) ==> (table.shapes[i].kind == enumShape) ==> forall k: int :: ((table.shapes[i].first <= k) ==> (k < (table.shapes[i].first + table.shapes[i].count)) ==> (table.shapes[table.members[k]].kind == structShape)))
  requires repeated ==> 0 <= child < |table.shapes|
  requires !repeated ==> 0 <= first && first + count <= |table.members|
  requires 0 <= i <= count <= maximumCollection
  requires 0 <= depth <= maximumDepth + 1
  requires readItems(data, table, repeated, child, first, count, i, at, nodes, depth).error == 0
  requires at <= readItems(data, table, repeated, child, first, count, i, at, nodes, depth).at <= |data|
  requires var w := readItems(data, table, repeated, child, first, count, i, at, nodes, depth); at2 + (w.at - at) <= |data2| && data2[at2 .. at2 + (w.at - at)] == data[at .. w.at]
  ensures var w := readItems(data, table, repeated, child, first, count, i, at, nodes, depth); readItems(data2, table, repeated, child, first, count, i, at2, nodes, depth) == WireItems(0, at2 + (w.at - at), w.nodes, w.items)
  decreases (maximumDepth + 1 - depth) * 258 + count - i + 1
{
  if i < count {
    var w := readItems(data, table, repeated, child, first, count, i, at, nodes, depth);
    var sh := if repeated then child else table.members[first + i];
    var item := readShape(data, table, sh, at, nodes, depth);
    ReadFacts(data, table, sh, at, nodes, depth);
    assert item.error == 0;
    var rest := readItems(data, table, repeated, child, first, count, i + 1, item.at, item.nodes, depth);
    ItemsFacts(data, table, repeated, child, first, count, i + 1, item.at, item.nodes, depth);
    assert w == WireItems(rest.error, rest.at, rest.nodes, ([item.node] + item.items) + rest.items);
    var length := w.at - at;
    SubSlice(data, data2, at, at2, length, 0, item.at - at);
    SubSlice(data, data2, at, at2, length, item.at - at, length);
    ReadLocal(data, data2, table, sh, at, at2, nodes, depth);
    ItemsLocal(data, data2, table, repeated, child, first, count, i + 1, item.at, at2 + (item.at - at), item.nodes, depth);
  }
}

lemma DecodeEncode(data: seq<int>, data2: seq<int>, table: WireTable, shape: int, at: nat, nodes: int, depth: int)
  requires forall i: int :: ((0 <= i) ==> (i < |data|) ==> ((0 <= data[i]) && (data[i] <= 255)))
  requires forall i: int :: ((0 <= i) ==> (i < |data2|) ==> ((0 <= data2[i]) && (data2[i] <= 255)))
  requires forall i: int :: ((0 <= i) ==> (i < |table.members|) ==> ((0 <= table.members[i]) && (table.members[i] < |table.shapes|)))
  requires forall i: int :: ((0 <= i) ==> (i < |table.shapes|) ==> shapeWellFormed(table.shapes[i], |table.shapes|, |table.members|))
  requires forall i: int :: ((0 <= i) ==> (i < |table.shapes|) ==> (table.shapes[i].kind == enumShape) ==> forall k: int :: ((table.shapes[i].first <= k) ==> (k < (table.shapes[i].first + table.shapes[i].count)) ==> (table.shapes[table.members[k]].kind == structShape)))
  requires 0 <= shape < |table.shapes|
  requires 0 <= depth <= maximumDepth + 1
  requires at <= |data|
  requires readShape(data, table, shape, at, nodes, depth).error == 0
  ensures var r := readShape(data, table, shape, at, nodes, depth); at <= r.at <= |data|
  ensures var r := readShape(data, table, shape, at, nodes, depth); forall k: int :: 0 <= k < |[r.node] + r.items| ==> 0 <= ([r.node] + r.items)[k].shape < |table.shapes| && 0 <= ([r.node] + r.items)[k].number
  ensures var r := readShape(data, table, shape, at, nodes, depth); encodeNodes(table, [r.node] + r.items) == data[at .. r.at]
  ensures var r := readShape(data, table, shape, at, nodes, depth); var bytes := encodeNodes(table, [r.node] + r.items); |bytes| <= |data2| && data2[.. |bytes|] == bytes ==> readShape(data2, table, shape, 0, nodes, depth) == WireRead(0, |bytes|, r.nodes, r.node, r.items)
{
  ReadFacts(data, table, shape, at, nodes, depth);
  var r := readShape(data, table, shape, at, nodes, depth);
  var bytes := encodeNodes(table, [r.node] + r.items);
  if |bytes| <= |data2| && data2[.. |bytes|] == bytes {
    assert data2[0 .. 0 + (r.at - at)] == data[at .. r.at];
    ReadLocal(data, data2, table, shape, at, 0, nodes, depth);
  }
}

lemma FieldsFacts(data: seq<int>, table: WireTable, first: int, count: int, plan: int, i: int, at: nat, nodes: int)
  requires forall i: int :: ((0 <= i) ==> (i < |data|) ==> ((0 <= data[i]) && (data[i] <= 255)))
  requires forall i: int :: ((0 <= i) ==> (i < |table.members|) ==> ((0 <= table.members[i]) && (table.members[i] < |table.shapes|)))
  requires forall i: int :: ((0 <= i) ==> (i < |table.shapes|) ==> shapeWellFormed(table.shapes[i], |table.shapes|, |table.members|))
  requires forall i: int :: ((0 <= i) ==> (i < |table.shapes|) ==> (table.shapes[i].kind == enumShape) ==> forall k: int :: ((table.shapes[i].first <= k) ==> (k < (table.shapes[i].first + table.shapes[i].count)) ==> (table.shapes[table.members[k]].kind == structShape)))
  requires 0 <= first && first + count <= |table.members| && 0 <= i <= count
  requires at <= |data|
  ensures var f := readFields(data, table, first, count, plan, i, at, nodes); at <= f.at <= |data|
  ensures var f := readFields(data, table, first, count, plan, i, at, nodes); f.error == 0 || f.error == truncated || f.error == collectionTooLarge || f.error == boundsExceeded || f.error == invalidBool || f.error == invalidOption || f.error == unknownVariant
  ensures var f := readFields(data, table, first, count, plan, i, at, nodes); f.error == 0 ==> |f.fields| == count - i
  ensures var f := readFields(data, table, first, count, plan, i, at, nodes); f.error == 0 && i < count ==> f.fields[0].start == at && f.fields[|f.fields| - 1].end == f.at
  ensures var f := readFields(data, table, first, count, plan, i, at, nodes); f.error == 0 ==> forall k: int :: 0 <= k < |f.fields| ==> at <= f.fields[k].start <= f.fields[k].end <= f.at && (k + 1 < |f.fields| ==> f.fields[k].end == f.fields[k + 1].start)
  ensures var f := readFields(data, table, first, count, plan, i, at, nodes); f.error == 0 ==> forall k: int :: 0 <= k < |f.fields| && table.shapes[table.members[first + i + k]].kind == unsignedShape ==> f.fields[k].end == f.fields[k].start + table.shapes[table.members[first + i + k]].width && f.fields[k].value == littleEndian(data, f.fields[k].start, table.shapes[table.members[first + i + k]].width)
  ensures var f := readFields(data, table, first, count, plan, i, at, nodes); f.error == 0 ==> forall k: int :: 0 <= k < |f.fields| && table.shapes[table.members[first + i + k]].kind == vecShape ==> f.fields[k].start + 4 <= f.fields[k].end && f.fields[k].value == lengthPrefix(data, f.fields[k].start)
  ensures var f := readFields(data, table, first, count, plan, i, at, nodes); f.error == 0 && i <= plan < count ==> f.plan == f.fields[plan - i].value
  decreases count - i
{
  var f := readFields(data, table, first, count, plan, i, at, nodes);
  if i < count {
    var sh := table.members[first + i];
    var field := readShape(data, table, sh, at, nodes, 0);
    ReadFacts(data, table, sh, at, nodes, 0);
    assert shapeWellFormed(table.shapes[sh], |table.shapes|, |table.members|);
    if field.error == 0 {
      var rest := readFields(data, table, first, count, plan, i + 1, field.at, field.nodes);
      FieldsFacts(data, table, first, count, plan, i + 1, field.at, field.nodes);
      var head := WireField(at, field.at, field.node.number);
      assert f == WireFields(rest.error, rest.at, rest.nodes, (if i == plan then field.node.number else rest.plan), [head] + rest.fields);
      if f.error == 0 {
        assert f.fields[0] == head;
        forall k: int | 0 < k < |f.fields|
          ensures f.fields[k] == rest.fields[k - 1]
          ensures table.members[first + i + k] == table.members[first + (i + 1) + (k - 1)]
        {
        }
        if i < plan < count {
          assert f.fields[plan - i] == rest.fields[plan - (i + 1)];
        }
      }
    }
  } else {
    assert f == WireFields(0, at, nodes, 0, []);
  }
}

lemma DecodeLayoutFacts(data: seq<int>, table: WireTable, layout: int)
  requires forall i: int :: ((0 <= i) ==> (i < |data|) ==> ((0 <= data[i]) && (data[i] <= 255)))
  requires forall i: int :: ((0 <= i) ==> (i < |table.members|) ==> ((0 <= table.members[i]) && (table.members[i] < |table.shapes|)))
  requires forall i: int :: ((0 <= i) ==> (i < |table.shapes|) ==> shapeWellFormed(table.shapes[i], |table.shapes|, |table.members|))
  requires forall i: int :: ((0 <= i) ==> (i < |table.shapes|) ==> (table.shapes[i].kind == enumShape) ==> forall k: int :: ((table.shapes[i].first <= k) ==> (k < (table.shapes[i].first + table.shapes[i].count)) ==> (table.shapes[table.members[k]].kind == structShape)))
  requires forall l: int :: ((0 <= l) ==> (l < |table.layouts|) ==> (((((((|table.layouts[l].discriminator| == discriminatorBytes) && (0 <= table.layouts[l].args)) && (table.layouts[l].args < |table.shapes|)) && (table.shapes[table.layouts[l].args].kind == structShape)) && (0 <= table.layouts[l].routePlan)) && (table.layouts[l].routePlan < table.shapes[table.layouts[l].args].count)) && (table.shapes[table.members[(table.shapes[table.layouts[l].args].first + table.layouts[l].routePlan)]].kind == vecShape)))
  requires discriminatorBytes <= |data| && 0 <= layout
  ensures var d := decodeLayout(data, table, layout); d.refused? ==> d.error == unknownInstruction || d.error == truncated || d.error == collectionTooLarge || d.error == boundsExceeded || d.error == invalidBool || d.error == invalidOption || d.error == unknownVariant || d.error == trailingBytes || d.error == emptyRoute
  ensures (forall l: int :: layout <= l < |table.layouts| ==> !prefixEquals(data, table.layouts[l].discriminator, discriminatorBytes)) ==> decodeLayout(data, table, layout).refused? && decodeLayout(data, table, layout).error == unknownInstruction
  ensures var d := decodeLayout(data, table, layout); d.route? ==> layout <= d.layout < |table.layouts| && prefixEquals(data, table.layouts[d.layout].discriminator, discriminatorBytes)
  ensures var d := decodeLayout(data, table, layout); d.route? ==> |d.fields| == table.shapes[table.layouts[d.layout].args].count
  ensures var d := decodeLayout(data, table, layout); d.route? ==> d.fields[0].start == discriminatorBytes && d.fields[|d.fields| - 1].end == |data|
  ensures var d := decodeLayout(data, table, layout); d.route? ==> forall k: int :: 0 <= k < |d.fields| ==> discriminatorBytes <= d.fields[k].start <= d.fields[k].end <= |data| && (k + 1 < |d.fields| ==> d.fields[k].end == d.fields[k + 1].start)
  ensures var d := decodeLayout(data, table, layout); d.route? ==> forall k: int :: 0 <= k < |d.fields| && fieldShape(table, d.layout, k).kind == unsignedShape ==> d.fields[k].end == d.fields[k].start + fieldShape(table, d.layout, k).width && d.fields[k].value == littleEndian(data, d.fields[k].start, fieldShape(table, d.layout, k).width)
  ensures var d := decodeLayout(data, table, layout); d.route? ==> forall k: int :: 0 <= k < |d.fields| && fieldShape(table, d.layout, k).kind == vecShape ==> d.fields[k].start + 4 <= d.fields[k].end && d.fields[k].value == lengthPrefix(data, d.fields[k].start)
  ensures var d := decodeLayout(data, table, layout); d.route? ==> d.fields[table.layouts[d.layout].routePlan].value != 0
  decreases |table.layouts| - layout
{
  if layout < |table.layouts| {
    if !prefixEquals(data, table.layouts[layout].discriminator, discriminatorBytes) {
      DecodeLayoutFacts(data, table, layout + 1);
    } else {
      var args := table.shapes[table.layouts[layout].args];
      var plan := table.layouts[layout].routePlan;
      assert args.kind == structShape && 0 <= plan < args.count;
      assert shapeWellFormed(args, |table.shapes|, |table.members|);
      FieldsFacts(data, table, args.first, args.count, plan, 0, discriminatorBytes, 0);
      var read := readFields(data, table, args.first, args.count, plan, 0, discriminatorBytes, 0);
      var d := decodeLayout(data, table, layout);
      if d.route? {
        assert read.error == 0 && read.at == |data| && read.plan != 0;
        assert d == route(layout, read.fields);
        forall k: int | 0 <= k < |d.fields|
          ensures fieldShape(table, layout, k) == table.shapes[table.members[args.first + 0 + k]]
        {
        }
      }
    }
  }
}

lemma readShape_ensures(data: seq<int>, table: WireTable, shape: int, at: nat, nodes: int, depth: int)
  requires forall i: int :: ((0 <= i) ==> (i < |data|) ==> ((0 <= data[i]) && (data[i] <= 255)))
  requires forall i: int :: ((0 <= i) ==> (i < |table.members|) ==> ((0 <= table.members[i]) && (table.members[i] < |table.shapes|)))
  requires forall i: int :: ((0 <= i) ==> (i < |table.shapes|) ==> shapeWellFormed(table.shapes[i], |table.shapes|, |table.members|))
  requires forall i: int :: ((0 <= i) ==> (i < |table.shapes|) ==> (table.shapes[i].kind == enumShape) ==> forall k: int :: ((table.shapes[i].first <= k) ==> (k < (table.shapes[i].first + table.shapes[i].count)) ==> (table.shapes[table.members[k]].kind == structShape)))
  requires (0 <= shape)
  requires (shape < |table.shapes|)
  requires (0 <= depth)
  requires (depth <= (maximumDepth + 1))
  ensures (at <= readShape(data, table, shape, at, nodes, depth).at)
  ensures ((at <= |data|) ==> (readShape(data, table, shape, at, nodes, depth).at <= |data|))
  ensures (nodes < readShape(data, table, shape, at, nodes, depth).nodes)
  ensures ((nodes <= maximumNodes) ==> (readShape(data, table, shape, at, nodes, depth).nodes <= (maximumNodes + 1)))
  ensures ((readShape(data, table, shape, at, nodes, depth).error == 0) ==> (readShape(data, table, shape, at, nodes, depth).nodes <= maximumNodes))
  ensures (((((((readShape(data, table, shape, at, nodes, depth).error == 0) || (readShape(data, table, shape, at, nodes, depth).error == truncated)) || (readShape(data, table, shape, at, nodes, depth).error == collectionTooLarge)) || (readShape(data, table, shape, at, nodes, depth).error == boundsExceeded)) || (readShape(data, table, shape, at, nodes, depth).error == invalidBool)) || (readShape(data, table, shape, at, nodes, depth).error == invalidOption)) || (readShape(data, table, shape, at, nodes, depth).error == unknownVariant))
  ensures ((table.shapes[shape].kind == unsignedShape) ==> (readShape(data, table, shape, at, nodes, depth).error == 0) ==> (((readShape(data, table, shape, at, nodes, depth).at == (at + table.shapes[shape].width)) && (readShape(data, table, shape, at, nodes, depth).at <= |data|)) && (readShape(data, table, shape, at, nodes, depth).node.number == littleEndian(data, at, table.shapes[shape].width))))
  ensures ((table.shapes[shape].kind == vecShape) ==> (readShape(data, table, shape, at, nodes, depth).error == 0) ==> ((((at + 4) <= readShape(data, table, shape, at, nodes, depth).at) && ((at + 4) <= |data|)) && (readShape(data, table, shape, at, nodes, depth).node.number == lengthPrefix(data, at))))
  ensures ((nodes < maximumNodes) ==> (depth <= maximumDepth) ==> (table.shapes[shape].kind == unsignedShape) ==> (table.shapes[shape].width > (|data| - at)) ==> ((readShape(data, table, shape, at, nodes, depth).error == truncated) && (readShape(data, table, shape, at, nodes, depth).at == at)))
  ensures ((nodes < maximumNodes) ==> (depth <= maximumDepth) ==> (table.shapes[shape].kind == vecShape) ==> ((at + 4) <= |data|) ==> (lengthPrefix(data, at) > maximumCollection) ==> ((readShape(data, table, shape, at, nodes, depth).error == collectionTooLarge) && (readShape(data, table, shape, at, nodes, depth).at == (at + 4))))
  ensures ((nodes < maximumNodes) ==> (depth <= maximumDepth) ==> (table.shapes[shape].kind == bytesShape) ==> ((at + 4) <= |data|) ==> (lengthPrefix(data, at) > maximumCollection) ==> ((readShape(data, table, shape, at, nodes, depth).error == collectionTooLarge) && (readShape(data, table, shape, at, nodes, depth).at == (at + 4))))
  ensures ((nodes < maximumNodes) ==> (depth <= maximumDepth) ==> (table.shapes[shape].kind == boolShape) ==> (at < |data|) ==> (data[at] > 1) ==> ((readShape(data, table, shape, at, nodes, depth).error == invalidBool) && (readShape(data, table, shape, at, nodes, depth).at == (at + 1))))
  ensures ((nodes < maximumNodes) ==> (depth <= maximumDepth) ==> (table.shapes[shape].kind == optionShape) ==> (at < |data|) ==> (data[at] > 1) ==> ((readShape(data, table, shape, at, nodes, depth).error == invalidOption) && (readShape(data, table, shape, at, nodes, depth).at == (at + 1))))
  ensures ((nodes < maximumNodes) ==> (depth <= maximumDepth) ==> (table.shapes[shape].kind == enumShape) ==> (at < |data|) ==> (data[at] >= table.shapes[shape].count) ==> ((readShape(data, table, shape, at, nodes, depth).error == unknownVariant) && (readShape(data, table, shape, at, nodes, depth).at == (at + 1))))
{
  ReadFacts(data, table, shape, at, nodes, depth);
}

lemma decodeJupiter_ensures(data: seq<int>, table: WireTable)
  requires forall i: int :: ((0 <= i) ==> (i < |data|) ==> ((0 <= data[i]) && (data[i] <= 255)))
  requires forall i: int :: ((0 <= i) ==> (i < |table.members|) ==> ((0 <= table.members[i]) && (table.members[i] < |table.shapes|)))
  requires forall i: int :: ((0 <= i) ==> (i < |table.shapes|) ==> shapeWellFormed(table.shapes[i], |table.shapes|, |table.members|))
  requires forall i: int :: ((0 <= i) ==> (i < |table.shapes|) ==> (table.shapes[i].kind == enumShape) ==> forall k: int :: ((table.shapes[i].first <= k) ==> (k < (table.shapes[i].first + table.shapes[i].count)) ==> (table.shapes[table.members[k]].kind == structShape)))
  requires forall l: int :: ((0 <= l) ==> (l < |table.layouts|) ==> (((((((|table.layouts[l].discriminator| == discriminatorBytes) && (0 <= table.layouts[l].args)) && (table.layouts[l].args < |table.shapes|)) && (table.shapes[table.layouts[l].args].kind == structShape)) && (0 <= table.layouts[l].routePlan)) && (table.layouts[l].routePlan < table.shapes[table.layouts[l].args].count)) && (table.shapes[table.members[(table.shapes[table.layouts[l].args].first + table.layouts[l].routePlan)]].kind == vecShape)))
  ensures (decodeJupiter(data, table).refused? ==> ((((((((((decodeJupiter(data, table).error == sizeRefused) || (decodeJupiter(data, table).error == unknownInstruction)) || (decodeJupiter(data, table).error == truncated)) || (decodeJupiter(data, table).error == collectionTooLarge)) || (decodeJupiter(data, table).error == boundsExceeded)) || (decodeJupiter(data, table).error == invalidBool)) || (decodeJupiter(data, table).error == invalidOption)) || (decodeJupiter(data, table).error == unknownVariant)) || (decodeJupiter(data, table).error == trailingBytes)) || (decodeJupiter(data, table).error == emptyRoute)))
  ensures (((|data| < discriminatorBytes) || (|data| > maximumInstructionBytes)) ==> (decodeJupiter(data, table).refused? && (decodeJupiter(data, table).error == sizeRefused)))
  ensures ((discriminatorBytes <= |data|) ==> (|data| <= maximumInstructionBytes) ==> (forall l: int :: ((0 <= l) ==> (l < |table.layouts|) ==> !(prefixEquals(data, table.layouts[l].discriminator, discriminatorBytes)))) ==> (decodeJupiter(data, table).refused? && (decodeJupiter(data, table).error == unknownInstruction)))
  ensures (decodeJupiter(data, table).route? ==> (((((discriminatorBytes <= |data|) && (|data| <= maximumInstructionBytes)) && (0 <= decodeJupiter(data, table).layout)) && (decodeJupiter(data, table).layout < |table.layouts|)) && prefixEquals(data, table.layouts[decodeJupiter(data, table).layout].discriminator, discriminatorBytes)))
  ensures (decodeJupiter(data, table).route? ==> (|decodeJupiter(data, table).fields| == table.shapes[table.layouts[decodeJupiter(data, table).layout].args].count))
  ensures (decodeJupiter(data, table).route? ==> ((decodeJupiter(data, table).fields[0].start == discriminatorBytes) && (decodeJupiter(data, table).fields[(|decodeJupiter(data, table).fields| - 1)].end == |data|)))
  ensures (decodeJupiter(data, table).route? ==> forall k: int :: ((0 <= k) ==> (k < |decodeJupiter(data, table).fields|) ==> ((((discriminatorBytes <= decodeJupiter(data, table).fields[k].start) && (decodeJupiter(data, table).fields[k].start <= decodeJupiter(data, table).fields[k].end)) && (decodeJupiter(data, table).fields[k].end <= |data|)) && (((k + 1) < |decodeJupiter(data, table).fields|) ==> (decodeJupiter(data, table).fields[k].end == decodeJupiter(data, table).fields[(k + 1)].start)))))
  ensures (decodeJupiter(data, table).route? ==> forall k: int :: ((0 <= k) ==> (k < |decodeJupiter(data, table).fields|) ==> (fieldShape(table, decodeJupiter(data, table).layout, k).kind == unsignedShape) ==> ((decodeJupiter(data, table).fields[k].end == (decodeJupiter(data, table).fields[k].start + fieldShape(table, decodeJupiter(data, table).layout, k).width)) && (decodeJupiter(data, table).fields[k].value == littleEndian(data, decodeJupiter(data, table).fields[k].start, fieldShape(table, decodeJupiter(data, table).layout, k).width)))))
  ensures (decodeJupiter(data, table).route? ==> forall k: int :: ((0 <= k) ==> (k < |decodeJupiter(data, table).fields|) ==> (fieldShape(table, decodeJupiter(data, table).layout, k).kind == vecShape) ==> (((decodeJupiter(data, table).fields[k].start + 4) <= decodeJupiter(data, table).fields[k].end) && (decodeJupiter(data, table).fields[k].value == lengthPrefix(data, decodeJupiter(data, table).fields[k].start)))))
  ensures (decodeJupiter(data, table).route? ==> (decodeJupiter(data, table).fields[table.layouts[decodeJupiter(data, table).layout].routePlan].value != 0))
{
  if discriminatorBytes <= |data| && |data| <= maximumInstructionBytes {
    DecodeLayoutFacts(data, table, 0);
  }
}
