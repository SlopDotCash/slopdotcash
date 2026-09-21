# Wallet destination possession

This is the read-only verification component for payout destinations. It
verifies that the holder of a claimed Solana key signed a server-issued
challenge bound to one wallet claim. It does not approve an amount, select a
destination, activate payments, change an allocation, or authorize a
transaction, and it never holds or creates key material.

## The gap it closes

A wallet claim binds a GitHub actor to an address and nothing else. The site
says so in plain terms today: GitHub identity never proves wallet control. A
contributor can register an address they mistyped, an address someone else
controls, or an address pasted from a poisoned transaction history. On Solana a
transfer to any of those is final.

`slop-wallet-possession:v1` turns that unproven assumption into evidence a
reviewer can check, without changing what registration requires.

## What a valid attestation proves, and what it does not

A valid attestation proves that at signing time someone held the private key for
the claimed destination and chose to bind it to that claim.

It does not prove that the key is still held, that the holder is the GitHub
actor rather than someone acting for them, that the destination is correct for
the contributor's intent, or that any amount is payable. Verification of a
historical attestation is not a claim that possession is still current.

## Additive by construction

Possession is evidence, never a gate.

- Registration is unchanged. No wallet connection or signature is required to
  register a destination, and the existing flow is untouched.
- Every claim registered before this existed reads `unproven`. That is the
  honest pre-existing state, not a defect and not a finding.
- `unproven` never holds, excludes, reduces, or delays a position. Creator and
  platform inaction must not be able to extinguish a contributor's position,
  and neither may a missing optional proof.
- No payout state is derived from this table. Nothing in the reward, allocation,
  settlement, or verification path reads it.

## States

- `proven`: an attestation exists for the claim.
- `unproven`: no attestation exists and the address could produce one.
- `not-provable-by-signature`: the address is off the Ed25519 curve, the shape a
  program derived address or a Squads vault takes. This is a valid destination
  that cannot produce a detached signature. It is reported as unprovable rather
  than rejected, so a contributor paid to a multisig is not pushed toward a
  worse destination to satisfy a check.

## The signed bytes

`walletPossessionMessage` in `src/lib/wallet-possession.ts` returns the exact
UTF-8 bytes. The first line is domain separation:

```text
Slop wallet possession only; no payment authorization.
```

The second line is the canonical challenge with sorted keys, binding kind,
schema version, audience, challenge id, claim id, GitHub actor id, address,
issue time, and expiry. The message is a UTF-8 string, not a serialized
transaction message, so a signature collected here cannot be replayed as
consent to move funds.

## Verification boundary

`verifyWalletPossession` compares every bound field against server-held state
rather than trusting the request, so a signature for one claim, actor, or
address cannot be presented for another. It refuses a challenge issued in the
future or past its expiry, and refuses a challenge whose window is not exactly
`WALLET_POSSESSION_LIFETIME_MS`, so a caller cannot widen its own replay window.

Signatures are canonical padded base64 and exactly 64 bytes. Verification uses
lockfile-pinned Noble Curves strict verification (`zip215: false`), matching
`protocol/signer-access-attestations.md`, not permissive consensus verification
that accepts identity-point forgeries.

The module has no Node filesystem, Buffer, signing, or broadcast dependency. It
uses Web Crypto primitives and the repository's existing Noble curve
implementation. **This repository contains no signing code.** Contributors sign
with their own wallet; Slop verifies.

## Endpoints

```text
POST /api/v1/wallet-claims/<claimId>/possession-challenge   authenticated
POST /api/v1/wallet-claims/<claimId>/possession             authenticated
GET  /api/v1/wallet-claims/<claimId>/possession             public
```

The challenge endpoint issues a single-use nonce for the authenticated actor's
own claim only, and returns `409 address_not_signable` for an off-curve
destination. The attestation endpoint consumes the challenge atomically before
the signature is trusted, so two concurrent submissions cannot both be recorded.
The public read reports state with a short cache.

The immutable by-id claim response is deliberately unchanged. A claim is
immutable; an attestation about it is a separate append-only record, so adding
one never invalidates a response already served as immutable.

## Storage

`migrations/0007_wallet_possession_attestations.sql` adds two tables.
`wallet_possession_challenges` holds consumable nonces and is the one wallet
table that accepts an update, to mark a challenge used.
`wallet_possession_attestations` is permanent, one row per claim, with update
and delete triggers matching the wallet claim registry. A contributor who
changes destination appends a successor claim and proves that one. History is
never edited.
