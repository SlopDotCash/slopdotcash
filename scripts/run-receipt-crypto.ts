/**
 * Verifies project-run device signatures with Node cryptography. A valid
 * signature proves stable receipt bytes and key continuity, not that local
 * agent logs or token counts are truthful.
 */

import {
  createHash,
  createPublicKey,
  type KeyObject,
  verify,
} from "node:crypto";
import {
  assertProjectRunReceipt,
  type ProjectRunReceipt,
  runReceiptSigningPayload,
} from "../src/lib/run-receipts";

function decodeBase64url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function publicKeyFromReceipt(receipt: ProjectRunReceipt): KeyObject {
  try {
    return createPublicKey({
      key: decodeBase64url(receipt.devicePublicKey),
      format: "der",
      type: "spki",
    });
  } catch (cause) {
    throw new TypeError("run receipt device public key is invalid", { cause });
  }
}

export function deviceKeyId(publicKeyDer: Uint8Array): string {
  return createHash("sha256").update(publicKeyDer).digest("hex");
}

export function verifyRunReceiptSignature(value: unknown): ProjectRunReceipt {
  const receipt = assertProjectRunReceipt(value);
  const publicKeyDer = decodeBase64url(receipt.devicePublicKey);
  if (deviceKeyId(publicKeyDer) !== receipt.deviceKeyId) {
    throw new TypeError("run receipt device key id does not match public key");
  }
  const valid = verify(
    null,
    Buffer.from(runReceiptSigningPayload(receipt), "utf8"),
    publicKeyFromReceipt(receipt),
    decodeBase64url(receipt.deviceSignature),
  );
  if (!valid) throw new TypeError("run receipt device signature is invalid");
  return receipt;
}
