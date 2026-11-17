//@ backend dafny
// spec/contributor/sessionExchange.md, "Assertion consumption survives signing errors and a lost session reply"

export const contributorLifetimeSeconds = 600;
export const operatorLifetimeSeconds = 300;
export const clockSkewSeconds = 30;
export const maxPayloadChars = 4096;
export const signatureChars = 43;
export const tokenPrefixChars = 4;

/** @throws {never} */
//@ pure
export function maxLifetime(operator: boolean): number {
  //@ ensures operator ==> \result === 300
  //@ ensures !operator ==> \result === 600
  return operator ? operatorLifetimeSeconds : contributorLifetimeSeconds;
}

/** @throws {never} */
//@ pure
export function tokenBounded(tokenLength: number): boolean {
  //@ ensures \result === (tokenLength <= 4 + 4096 + 43)
  return tokenLength <= tokenPrefixChars + maxPayloadChars + signatureChars;
}

/** @throws {never} */
//@ pure
export function partsShaped(payloadLength: number, signatureLength: number): boolean {
  //@ ensures \result === (1 <= payloadLength && payloadLength <= 4096 && signatureLength === 43)
  return 1 <= payloadLength && payloadLength <= maxPayloadChars && signatureLength === signatureChars;
}

/** @throws {never} */
//@ pure
export function claimsTimely(issuedAt: number, expiresAt: number, now: number, operator: boolean): boolean {
  //@ ensures \result ==> expiresAt > issuedAt
  //@ ensures \result ==> expiresAt - issuedAt <= maxLifetime(operator)
  //@ ensures \result ==> issuedAt <= now + 30 && expiresAt > now - 30
  //@ ensures \result === (expiresAt > issuedAt && issuedAt <= now + 30 && expiresAt > now - 30 && expiresAt - issuedAt <= maxLifetime(operator))
  return expiresAt > issuedAt && issuedAt <= now + clockSkewSeconds && expiresAt > now - clockSkewSeconds && expiresAt - issuedAt <= maxLifetime(operator);
}

/** @throws {never} */
//@ pure
export function roleKept(role: string, operatorListed: boolean): boolean {
  //@ ensures \result === (role !== "operator" || operatorListed)
  return role !== "operator" || operatorListed;
}

/** @throws {never} */
//@ pure
export function writerRole(role: string): boolean {
  //@ ensures \result === (role === "contributor" || role === "project_owner" || role === "operator")
  return role === "contributor" || role === "project_owner" || role === "operator";
}
