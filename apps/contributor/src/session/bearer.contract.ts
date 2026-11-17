// spec/contributor/sessionExchange.md, "Assertion consumption survives signing errors and a lost session reply"
import { Arbitrary, Schema } from "effect";
import { contract } from "vibestack/testing";
import { claimsTimely, partsShaped, roleKept, tokenBounded } from "./bearer.ts";

const windows = Arbitrary.schema(Schema.Struct({ issuedAt: Schema.Int, lifetime: Schema.Int, now: Schema.Int, operator: Schema.Boolean })).pipe(
  Arbitrary.map(({ issuedAt, lifetime, now, operator }) => ({ issuedAt, expiresAt: issuedAt + (lifetime % 1200), now: issuedAt + (now % 1200), operator })),
);

const parts = Arbitrary.schema(Schema.Struct({ payload: Schema.Int, signature: Schema.Int })).pipe(
  Arbitrary.map(({ payload, signature }) => ({ payload: Math.abs(payload) % 5000, signature: Math.abs(signature) % 64 })),
);

const roles = Arbitrary.schema(Schema.Struct({ role: Schema.Literals(["contributor", "project_owner", "operator", "admin"]), listed: Schema.Boolean }));

export const aTokenNeverOutlivesItsRole = contract({
  input: windows,
  run: ({ issuedAt, expiresAt, now, operator }: { readonly issuedAt: number; readonly expiresAt: number; readonly now: number; readonly operator: boolean }) => claimsTimely(issuedAt, expiresAt, now, operator),
  deterministic: true,
  invariant: ({ issuedAt, expiresAt, now, operator }, timely) =>
    !timely || (expiresAt > issuedAt && expiresAt - issuedAt <= (operator ? 300 : 600) && issuedAt <= now + 30 && expiresAt > now - 30),
});

export const onlyExactPartsAreAdmitted = contract({
  input: parts,
  run: ({ payload, signature }: { readonly payload: number; readonly signature: number }) => partsShaped(payload, signature) && tokenBounded(4 + payload + signature),
  invariant: ({ payload, signature }, admitted) => admitted === (payload >= 1 && payload <= 4096 && signature === 43),
});

export const operatorAuthorityNeedsTheAllowlist = contract({
  input: roles,
  run: ({ role, listed }: { readonly role: string; readonly listed: boolean }) => roleKept(role, listed),
  invariant: ({ role, listed }, kept) => (role === "operator" ? kept === listed : kept),
});
