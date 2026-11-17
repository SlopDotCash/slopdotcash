//@ backend dafny
// spec/security/admission.md, "Every reviewed batch covers the next unreviewed inventory entries"

/** @throws {never} */
//@ type bytes number[]
export function declaresInterpreter(bytes: Uint8Array): boolean {
  //@ ensures \result <==> (bytes.length >= 2 && bytes[0] === 35 && bytes[1] === 33)
  return bytes.length >= 2 && bytes[0] === 35 && bytes[1] === 33;
}

/** @throws {never} */
//@ type bytes number[]
export function binaryMagic(bytes: Uint8Array): boolean {
  //@ ensures (bytes.length >= 4 && bytes[0] === 127 && bytes[1] === 69 && bytes[2] === 76 && bytes[3] === 70) ==> \result
  //@ ensures (bytes.length >= 2 && bytes[0] === 77 && bytes[1] === 90) ==> \result
  //@ ensures (bytes.length >= 4 && bytes[0] === 207 && bytes[1] === 250 && bytes[2] === 237 && bytes[3] === 254) ==> \result
  //@ ensures (bytes.length >= 4 && bytes[0] === 254 && bytes[1] === 237 && bytes[2] === 250 && bytes[3] === 207) ==> \result
  //@ ensures (bytes.length >= 4 && bytes[0] === 202 && bytes[1] === 254 && bytes[2] === 186 && bytes[3] === 190) ==> \result
  //@ ensures (bytes.length >= 4 && bytes[0] === 0 && bytes[1] === 97 && bytes[2] === 115 && bytes[3] === 109) ==> \result
  //@ ensures \result ==> (bytes.length >= 2 && (bytes[0] === 127 || bytes[0] === 77 || bytes[0] === 207 || bytes[0] === 254 || bytes[0] === 202 || bytes[0] === 0))
  if (bytes.length < 2) return false;
  const first = bytes[0];
  const second = bytes[1];
  if (first === 77 && second === 90) return true;
  if (bytes.length < 4) return false;
  const third = bytes[2];
  const fourth = bytes[3];
  return (
    (first === 127 && second === 69 && third === 76 && fourth === 70) ||
    (first === 207 && second === 250 && third === 237 && fourth === 254) ||
    (first === 254 && second === 237 && third === 250 && fourth === 207) ||
    (first === 202 && second === 254 && third === 186 && fourth === 190) ||
    (first === 0 && second === 97 && third === 115 && fourth === 109)
  );
}
