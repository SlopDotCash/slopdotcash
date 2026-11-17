//@ backend dafny
// spec/security/evidence.md, "References, permanent admission and pending uploads are separate"

/** @throws {never} */
//@ pure
export function partCount(size: bigint, width: bigint): bigint {
  //@ requires size > 0 && width > 0
  //@ ensures \result > 0
  //@ ensures (\result - 1) * width < size && size <= \result * width
  return (size - 1n) / width + 1n;
}

/** @throws {never} */
//@ pure
export function partSize(size: bigint, width: bigint, index: bigint): bigint {
  //@ requires size > 0 && width > 0
  //@ requires index >= 0 && index < partCount(size, width)
  //@ ensures \result > 0 && \result <= width
  //@ ensures index * width + \result <= size
  //@ ensures index < partCount(size, width) - 1 ==> \result === width
  //@ ensures index === partCount(size, width) - 1 ==> index * width + \result === size
  const remaining = size - index * width;
  return remaining < width ? remaining : width;
}

/** @throws {never} */
//@ pure
export function chunked(size: bigint, width: bigint): boolean {
  //@ requires width > 0
  //@ ensures \result <==> size > width
  //@ ensures \result ==> partCount(size, width) > 1
  return size > width;
}

/** @throws {never} */
//@ pure
export function slotAccepted(index: bigint, size: bigint, width: bigint): boolean {
  //@ requires width > 0
  //@ ensures \result <==> index >= -1 && size >= 0 && size <= width
  return index >= -1n && size >= 0n && size <= width;
}
