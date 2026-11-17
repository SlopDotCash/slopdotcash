//@ backend dafny
// spec/contributor/artifactTransport.md, "Each request carries a credential only at the GitHub authority"

export const documentReadLimitBytes = 2097152;
export const fullContentLimitBytes = 33554432;
export const minImageBytes = 1024;
export const minVideoBytes = 16384;

/** @throws {never} */
//@ pure
export function usefulImageDimensions(width: number, height: number): boolean {
  //@ ensures \result === (width >= 320 && height >= 180)
  return width >= 320 && height >= 180;
}

/** @throws {never} */
//@ pure
export function transientHttpStatus(status: number): boolean {
  //@ ensures \result === (status === 408 || status === 429 || (500 <= status && status <= 599))
  return status === 408 || status === 429 || (500 <= status && status <= 599);
}

/** @throws {never} */
//@ pure
export function readLimit(document: boolean, fullContent: boolean): number {
  //@ ensures fullContent ==> \result === 33554432
  //@ ensures (!fullContent && document) ==> \result === 2097152
  //@ ensures (!fullContent && !document) ==> \result === 65536
  //@ ensures \result >= 65536
  if (fullContent) {
    return 33554432;
  }
  return document ? 2097152 : 65536;
}

/** @throws {never} */
//@ pure
export function imageTooSmall(size: number): boolean {
  //@ ensures \result === (size < 1024)
  return size < 1024;
}

/** @throws {never} */
//@ pure
export function videoTooSmall(size: number): boolean {
  //@ ensures \result === (size < 16384)
  return size < 16384;
}
