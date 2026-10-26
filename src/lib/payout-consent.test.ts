import { expect, test } from "bun:test";
import { ed25519 } from "@noble/curves/ed25519.js";
import { solanaBase58 } from "../../contracts/solana/adapter";
import {
  bytes,
  encoder,
  instructionData,
  le,
  message,
  pda,
  SYSTEM,
} from "../../contracts/solana/transactions";
import {
  verifyPreparedSolanaBinding,
  verifySignedSolanaBinding,
} from "./payout-consent";

test("the wallet co-signature preserves the attester's exact Solana message and signature", () => {
  const attester = new Uint8Array(32).fill(1),
    wallet = new Uint8Array(32).fill(2);
  const pub = ed25519.getPublicKey(wallet);
  const message = new Uint8Array([
    2,
    0,
    0,
    2,
    ...ed25519.getPublicKey(attester),
    ...pub,
    ...new Uint8Array(32),
    0,
  ]);
  const prepared = new Uint8Array([
    2,
    ...ed25519.sign(message, attester),
    ...new Uint8Array(64),
    ...message,
  ]);
  const signed = prepared.slice();
  signed.set(ed25519.sign(message, wallet), 65);
  expect(() =>
    verifySignedSolanaBinding(prepared, signed, solanaBase58(pub)),
  ).not.toThrow();
  for (const offset of [1, 65, 129, signed.length - 1]) {
    const changed = signed.slice();
    changed[offset] ^= 1;
    expect(() =>
      verifySignedSolanaBinding(prepared, changed, solanaBase58(pub)),
    ).toThrow();
  }
  expect(() =>
    verifySignedSolanaBinding(
      prepared,
      signed,
      solanaBase58(ed25519.getPublicKey(new Uint8Array(32).fill(3))),
    ),
  ).toThrow();
});

test("the binding review refuses an extra instruction or different actor even with a valid attester signature", () => {
  const attesterKey = new Uint8Array(32).fill(1);
  const key = (n: number) =>
    solanaBase58(ed25519.getPublicKey(new Uint8Array(32).fill(n)));
  const context = {
    vault: key(8),
    programId: key(3),
    projectPda: key(4),
    networkDomain: "a".repeat(64),
    githubUserId: "123",
    destination: key(2),
    claimDigest: "c".repeat(64),
  };
  const attester = key(1);
  const instruction = {
    program: context.programId,
    accounts: [
      { key: attester, write: true },
      { key: attester, write: false },
      { key: context.destination, write: false },
      { key: context.projectPda, write: false },
      {
        key: pda(context.programId, [
          encoder.encode("wallet"),
          bytes(context.projectPda),
          le(123n),
        ]),
        write: true,
      },
      { key: SYSTEM, write: false },
    ],
    data: instructionData(
      "bind_wallet",
      le(123n),
      new Uint8Array(32).fill(0xaa),
      le(0n),
      new Uint8Array(32).fill(0xcc),
      le(2000000000n),
    ),
  };
  const wire = (msg: Uint8Array) =>
    new Uint8Array([
      2,
      ...ed25519.sign(msg, attesterKey),
      ...new Uint8Array(64),
      ...msg,
    ]);
  const prepared = wire(
    message(attester, key(7), [instruction], [context.destination]),
  );
  expect(() => verifyPreparedSolanaBinding(prepared, context)).not.toThrow();
  expect(() =>
    verifyPreparedSolanaBinding(prepared, { ...context, githubUserId: "124" }),
  ).toThrow();
  const extra = wire(
    message(
      attester,
      key(7),
      [instruction, instruction],
      [context.destination],
    ),
  );
  expect(() => verifyPreparedSolanaBinding(extra, context)).toThrow();
});
