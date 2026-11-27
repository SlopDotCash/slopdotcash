// spec/security/evidence.md, "References, permanent admission and pending uploads are separate"
lemma partCount_ensures(size: int, width: int)
  requires (size > 0)
  requires (width > 0)
  ensures (partCount(size, width) > 0)
  ensures (((partCount(size, width) - 1) * width) < size)
  ensures (size <= (partCount(size, width) * width))
{
  assert JSTruncDiv((size - 1), width) == (size - 1) / width;
  assert size - 1 == ((size - 1) / width) * width + (size - 1) % width;
}

lemma partSize_ensures(size: int, width: int, index: int)
  requires (size > 0)
  requires (width > 0)
  requires (index >= 0)
  requires (index < partCount(size, width))
  ensures (partSize(size, width, index) > 0)
  ensures (partSize(size, width, index) <= width)
  ensures (((index * width) + partSize(size, width, index)) <= size)
  ensures ((index < (partCount(size, width) - 1)) ==> (partSize(size, width, index) == width))
  ensures ((index == (partCount(size, width) - 1)) ==> (((index * width) + partSize(size, width, index)) == size))
{
  partCount_ensures(size, width);
  assert (partCount(size, width) - 1) * width < size;
  assert index * width <= (partCount(size, width) - 1) * width;
  if index < partCount(size, width) - 1 {
    assert (index + 1) * width <= (partCount(size, width) - 1) * width;
  } else {
    assert size <= partCount(size, width) * width;
  }
}

lemma chunked_ensures(size: int, width: int)
  requires (width > 0)
  ensures (chunked(size, width) <==> (size > width))
  ensures (chunked(size, width) ==> (partCount(size, width) > 1))
{
  if size > width {
    partCount_ensures(size, width);
  }
}
