import { ed25519 } from "@noble/curves/ed25519.js";
import { solanaBase58 } from "../../contracts/solana/adapter";
import {
  bytes,
  message as encodeMessage,
  encoder,
  instructionData,
  le,
  pda,
  SYSTEM,
} from "../../contracts/solana/transactions";
import { decodeBase58Bytes } from "./base58";

export type SolanaBindingContext = {
  vault: string;
  programId: string;
  projectPda: string;
  networkDomain: string;
  githubUserId: string;
  destination: string;
  claimDigest: string;
};

/** Rebuild the sole bind_wallet instruction before asking the destination wallet to sign. */
export function verifyPreparedSolanaBinding(
  prepared: Uint8Array,
  context: SolanaBindingContext,
) {
  const msg = prepared.slice(129),
    count = msg[3];
  if (
    prepared[0] !== 2 ||
    msg[0] !== 2 ||
    msg[1] !== 1 ||
    count < 2 ||
    count > 32 ||
    prepared.slice(65, 129).some((b) => b !== 0)
  )
    throw new Error("The prepared binding could not be verified.");
  const payload = msg.slice(-96);
  const view = new DataView(
    payload.buffer,
    payload.byteOffset,
    payload.byteLength,
  );
  const digest = (value: string) => {
    if (!/^[a-f0-9]{64}$/.test(value))
      throw new Error("The prepared binding could not be verified.");
    return Uint8Array.from(value.match(/../g) as string[], (v) =>
      Number.parseInt(v, 16),
    );
  };
  const attester = solanaBase58(msg.slice(4, 36));
  const expected = encodeMessage(
    attester,
    solanaBase58(msg.slice(4 + count * 32, 36 + count * 32)),
    [
      {
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
              le(BigInt(context.githubUserId)),
            ]),
            write: true,
          },
          { key: SYSTEM, write: false },
        ],
        data: instructionData(
          "bind_wallet",
          le(BigInt(context.githubUserId)),
          digest(context.networkDomain),
          le(view.getBigUint64(48, true)),
          digest(context.claimDigest),
          le(view.getBigUint64(88, true)),
        ),
      },
    ],
    [context.destination],
  );
  if (
    msg.length !== expected.length ||
    msg.some((b, i) => b !== expected[i]) ||
    !ed25519.verify(prepared.slice(1, 65), msg, bytes(attester), {
      zip215: false,
    })
  )
    throw new Error(
      "The prepared transaction differs from the reviewed destination binding.",
    );
}

/** The attester's binding wire format has two signatures: attester, then destination. */
export function verifySignedSolanaBinding(
  prepared: Uint8Array,
  signed: Uint8Array,
  destination: string,
) {
  const message = prepared.slice(129);
  if (
    prepared.length < 129 + 68 ||
    prepared[0] !== 2 ||
    signed.length !== prepared.length ||
    signed[0] !== 2 ||
    prepared.slice(65, 129).some((b) => b !== 0) ||
    prepared.slice(1, 65).some((b, i) => signed[i + 1] !== b) ||
    message.some((b, i) => signed[i + 129] !== b) ||
    message[0] !== 2 ||
    message[3] < 2 ||
    message[3] > 127 ||
    decodeBase58Bytes(destination).some((b, i) => message[i + 36] !== b) ||
    !ed25519.verify(prepared.slice(1, 65), message, message.slice(4, 36), {
      zip215: false,
    }) ||
    !ed25519.verify(
      signed.slice(65, 129),
      message,
      decodeBase58Bytes(destination),
      { zip215: false },
    )
  )
    throw new Error(
      "Your wallet changed the binding transaction or returned an invalid signature. Nothing was submitted by this page.",
    );
}
