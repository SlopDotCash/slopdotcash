/** Two retained messages through the real recovery verifier; RPC truth is controlled. */
import { expect, test } from "bun:test";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { retireSolanaPlans } from "../../backend/security/direct-solana-recovery";
import { solanaBase58, solanaBase64 } from "../../contracts/solana/adapter";
import {
  concat,
  le,
  message,
  SYSTEM,
} from "../../contracts/solana/transactions";

test("retirement model: every issued message expires before challenges; two matching failed receipts retire and disagreement holds", async () => {
  const secret = new Uint8Array(32).fill(7);
  const payer = solanaBase58(ed25519.getPublicKey(secret));
  const target = solanaBase58(ed25519.getPublicKey(new Uint8Array(32).fill(8)));
  const blockhash = solanaBase58(new Uint8Array(32).fill(9));
  const messages = [1n, 2n].map((amount) =>
    message(payer, blockhash, [
      {
        program: SYSTEM,
        accounts: [
          { key: payer, write: true },
          { key: target, write: true },
        ],
        data: concat(Uint8Array.of(2, 0, 0, 0), le(amount)),
      },
    ]),
  );
  const signatures = messages.map((bytes) =>
    solanaBase58(ed25519.sign(bytes, secret)),
  );
  const plans = messages.map((bytes) => ({
    messageId: solanaBase58(sha256(bytes)),
    transaction: solanaBase64(
      concat(Uint8Array.of(1), new Uint8Array(64), bytes),
    ),
    blockhash,
    blockhashSlot: 10,
    lastValidBlockHeight: 20,
  }));
  let secondFailureDisagrees = false;
  let firstFound = false;
  let invalidLaterObservation = false;
  let statusRequests = 0;
  const servers = [0, 1].map((provider) =>
    Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const body = (await request.json()) as {
          id: number;
          method: string;
          params: unknown[];
        };
        const signature = (body.params[0] as string[])?.[0];
        const index = signatures.indexOf(signature);
        const error =
          firstFound && index === 0
            ? null
            : {
                InstructionError: [
                  0,
                  secondFailureDisagrees && provider === 1
                    ? "different"
                    : "failed",
                ],
              };
        let result: unknown;
        if (body.method === "getGenesisHash") result = "local-model-genesis";
        else if (body.method === "getBlockHeight") result = 30;
        else if (body.method === "isBlockhashValid")
          result = { context: { slot: 20 }, value: false };
        else if (body.method === "getSignatureStatuses") {
          statusRequests++;
          result = {
            context: { slot: invalidLaterObservation && index === 1 ? -1 : 20 },
            value: [{ slot: 12, err: error, confirmationStatus: "finalized" }],
          };
        } else if (body.method === "getTransaction") {
          const receiptIndex = signatures.indexOf(body.params[0] as string);
          const receiptError =
            firstFound && receiptIndex === 0
              ? null
              : {
                  InstructionError: [
                    0,
                    secondFailureDisagrees && provider === 1
                      ? "different"
                      : "failed",
                  ],
                };
          result = {
            slot: 12,
            meta: { err: receiptError },
            transaction: [
              solanaBase64(
                concat(
                  Uint8Array.of(1),
                  ed25519.sign(messages[receiptIndex], secret),
                  messages[receiptIndex],
                ),
              ),
              "base64",
            ],
          };
        } else if (body.method === "getBlock")
          result =
            body.params[0] === 10
              ? { blockhash }
              : { blockhash: "matching-finalized-block", signatures };
        else throw new Error(`Unexpected recovery method: ${body.method}`);
        return Response.json({ jsonrpc: "2.0", id: body.id, result });
      },
    }),
  );
  const input = {
    rpcUrl: `http://127.0.0.1:${servers[0].port}`,
    recoveryRpcUrl: `http://127.0.0.1:${servers[1].port}`,
    genesisHash: "local-model-genesis",
    payer,
    plans,
    signatures: [] as { messageId: string; signature: string }[],
    // Matching finalized failures do not invoke the separate absence scanner.
    store: {
      read: async () => {
        throw new Error("Unexpected absence scan");
      },
      save: async () => {
        throw new Error("Unexpected absence scan");
      },
    },
  };
  try {
    expect(
      (await retireSolanaPlans({ ...input, recoveryRpcUrl: input.rpcUrl }))
        .state,
    ).toBe("history-check");
    expect(
      (
        await retireSolanaPlans({
          ...input,
          plans: [plans[0], { ...plans[1], lastValidBlockHeight: 40 }],
        })
      ).state,
    ).toBe("expiry-required");
    expect(statusRequests).toBe(0);
    const challenge = await retireSolanaPlans(input);
    expect(challenge.state).toBe("signature-required");
    if (challenge.state !== "signature-required")
      throw new Error("Missing challenge");
    expect(challenge.challenges.map((entry) => entry.message)).toEqual(
      messages.map(solanaBase64),
    );
    const signed = plans.map((plan, index) => ({
      messageId: plan.messageId,
      signature: signatures[index],
    }));
    expect(
      (await retireSolanaPlans({ ...input, signatures: [signed[0]] })).state,
    ).toBe("signature-required");
    await expect(
      retireSolanaPlans({
        ...input,
        signatures: [{ ...signed[0], signature: signatures[1] }, signed[1]],
      }),
    ).rejects.toThrow("Invalid Solana recovery signature");
    expect(
      (await retireSolanaPlans({ ...input, signatures: signed })).state,
    ).toBe("retired");
    secondFailureDisagrees = true;
    expect(
      (await retireSolanaPlans({ ...input, signatures: signed })).state,
    ).toBe("history-check");
    firstFound = true;
    const found = await retireSolanaPlans({ ...input, signatures: signed });
    expect(found.state).toBe("payment-found");
    if (found.state !== "payment-found")
      throw new Error("Missing observed payment");
    expect(found.transactionIds).toEqual([signatures[0]]);
    invalidLaterObservation = true;
    expect(
      (await retireSolanaPlans({ ...input, signatures: signed })).state,
    ).toBe("history-check");
  } finally {
    for (const server of servers) await server.stop(true);
  }
});
