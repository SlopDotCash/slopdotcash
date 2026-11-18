import { expect, test } from "bun:test";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "../src/lib/byte-encoding";
import {
  initialSolanaProofRecord,
  SOLANA_PUBLIC_PAIR,
  validateRetainedSolanaProof,
} from "./qualify-solana-rpc-pair";

const digest = (value: unknown) =>
  bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(value))));

function partialProof() {
  const record = initialSolanaProofRecord();
  const cursor = record.coverage[0];
  const blocks = Array.from({ length: 32 }, (_, index) => ({
    slot: cursor.tipSlot - index,
    blockhash: index === 0 ? cursor.tipHash : `fixture-${index}`,
    previousBlockhash: `fixture-${index + 1}`,
    parentSlot: cursor.tipSlot - index - 1,
    signatureCount: 0,
    signaturesSha256: digest([]),
  }));
  for (const block of blocks) {
    cursor.digest = digest({ prior: cursor.digest, block });
    cursor.nextSlot = block.parentSlot;
    cursor.expectedHash = block.previousBlockhash;
    cursor.blocks++;
  }
  cursor.revision++;
  record.pages.push({ operator: cursor.operator, blocks });
  return record;
}

test("public pair and initial witness are fixed and independent", () => {
  expect(SOLANA_PUBLIC_PAIR).toEqual([
    "https://api.mainnet-beta.solana.com",
    "https://public.rpc.solanavibestation.com",
  ]);
  const record = initialSolanaProofRecord();
  expect(record.coverage.map((entry) => entry.operator)).toEqual([
    "solana-public",
    "solana-vibe-station",
  ]);
  expect(validateRetainedSolanaProof(record)).toEqual(record);
});

test("a retained partial cursor must reconstruct from every exact page", () => {
  const record = partialProof();
  expect(validateRetainedSolanaProof(record)).toEqual(record);
  record.pages[0].blocks[7].signaturesSha256 = "f".repeat(64);
  expect(() => validateRetainedSolanaProof(record)).toThrow("inconsistent");
});

test("a cached completed proof cannot skip its retained history", () => {
  const record = initialSolanaProofRecord();
  for (const cursor of record.coverage) {
    cursor.complete = true;
    cursor.blocks = 211;
    cursor.digest =
      "8a58871a15801484a89e2283728a3b76643100608c50553b9acfd770c8c99368";
  }
  expect(() => validateRetainedSolanaProof(record)).toThrow("inconsistent");
});

test("retained state refuses wrong identity, source, revision and missing pages", () => {
  for (const change of [
    (record: ReturnType<typeof partialProof>) => {
      record.coverage[1].operator = record.coverage[0].operator;
    },
    (record: ReturnType<typeof partialProof>) => {
      record.coverage[0].txId = "another-transaction";
    },
    (record: ReturnType<typeof partialProof>) => {
      record.coverage[0].tipSlot++;
    },
    (record: ReturnType<typeof partialProof>) => {
      record.coverage[0].revision++;
    },
    (record: ReturnType<typeof partialProof>) => {
      record.pages = [];
    },
    (record: ReturnType<typeof partialProof>) => {
      record.pages.push(record.pages[0]);
    },
  ]) {
    const record = partialProof();
    change(record);
    expect(() => validateRetainedSolanaProof(record)).toThrow("inconsistent");
  }
  expect(() => validateRetainedSolanaProof(null)).toThrow("inconsistent");
  expect(() => validateRetainedSolanaProof({})).toThrow("inconsistent");
});
