/** Re-run the retained public, synthetic expiry witness without any signing key. */
import {
  closeSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "../src/lib/byte-encoding";
import {
  type CoverageBlock,
  type ExpiryCoverage,
  type ExpiryProof,
  proveSolanaExpiry,
  recoveryOperator,
} from "../workers/fee-converter/solana-expiry";

export const SOLANA_PUBLIC_PAIR = [
  "https://api.mainnet-beta.solana.com",
  "https://public.rpc.solanavibestation.com",
] as const;
const witness = {
  txId: "5EdudYMmXJMqUo5t65PtnZYeVETfaPVL7VBd8fsqqhorDsEaVHQw43oGboxBYfnYeAmRg7BC8r3qSJtLWGTWYJ6e",
  blockhash: "GbU3jQ3a5DBUibb4iGzgKEzH7Uk7qtMHBKNfR9oQzkHg",
  blockhashSlot: 469594628,
  tipSlot: 469594838,
  tipHash: "2sA8sesQRUEEmpEWo9rxAfDMoDgLUXhbFA17YtMHsu1E",
};
const operator = (endpoint: string) => {
  const value = recoveryOperator(endpoint);
  if (!value) throw Error("Unrecognized public operator");
  return value;
};
const digest = (value: unknown) =>
  bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(value))));

type ProofRecord = {
  schemaVersion: 1;
  coverage: ExpiryCoverage[];
  pages: { operator: string; blocks: CoverageBlock[] }[];
  proof: ExpiryProof | null;
};

export function initialSolanaProofRecord(): ProofRecord {
  return {
    schemaVersion: 1,
    pages: [],
    proof: null,
    coverage: SOLANA_PUBLIC_PAIR.map((endpoint) => ({
      txId: witness.txId,
      operator: operator(endpoint),
      blockhash: witness.blockhash,
      blockhashSlot: witness.blockhashSlot,
      tipSlot: witness.tipSlot,
      tipHash: witness.tipHash,
      nextSlot: witness.tipSlot,
      expectedHash: witness.tipHash,
      blocks: 0,
      complete: false,
      revision: 0,
      digest: digest({
        txId: witness.txId,
        blockhash: witness.blockhash,
        blockhashSlot: witness.blockhashSlot,
        horizonSlot: witness.tipSlot,
        horizonHash: witness.tipHash,
      }),
    })),
  };
}

/** Reconstruct every retained cursor from its exact original witness pages. */
export function validateRetainedSolanaProof(value: unknown): ProofRecord {
  const saved = value as ProofRecord;
  const refuse = (): never => {
    throw Error("Retained Solana witness is inconsistent");
  };
  if (
    saved?.schemaVersion !== 1 ||
    !Array.isArray(saved.coverage) ||
    saved.coverage.length !== 2 ||
    !Array.isArray(saved.pages)
  )
    refuse();
  const reconstructed = initialSolanaProofRecord();
  for (const page of saved.pages) {
    const cursor = reconstructed.coverage.find(
      (entry) => entry.operator === page?.operator,
    );
    if (
      !cursor ||
      cursor.complete ||
      !Array.isArray(page.blocks) ||
      page.blocks.length === 0 ||
      page.blocks.length > 32
    )
      refuse();
    for (const block of page.blocks) {
      if (
        cursor.complete ||
        !block ||
        block.slot !== cursor.nextSlot ||
        block.blockhash !== cursor.expectedHash ||
        typeof block.previousBlockhash !== "string" ||
        !block.previousBlockhash ||
        !Number.isSafeInteger(block.parentSlot) ||
        block.parentSlot < 0 ||
        !Number.isSafeInteger(block.signatureCount) ||
        block.signatureCount < 0 ||
        !/^[a-f0-9]{64}$/u.test(block.signaturesSha256)
      )
        refuse();
      const complete = block.slot === witness.blockhashSlot;
      if (
        (complete && block.blockhash !== witness.blockhash) ||
        (!complete &&
          (block.parentSlot >= block.slot ||
            block.parentSlot < witness.blockhashSlot))
      )
        refuse();
      cursor.digest = digest({ prior: cursor.digest, block });
      cursor.blocks++;
      cursor.complete = complete;
      if (!complete) {
        cursor.nextSlot = block.parentSlot;
        cursor.expectedHash = block.previousBlockhash;
      }
    }
    if (page.blocks.length < 32 && !cursor.complete) refuse();
    cursor.revision++;
  }
  for (const expected of reconstructed.coverage) {
    const matches = saved.coverage.filter(
      (entry) => entry?.operator === expected.operator,
    );
    if (matches.length !== 1) refuse();
    for (const key of Object.keys(expected) as (keyof ExpiryCoverage)[]) {
      if (matches[0][key] !== expected[key]) refuse();
    }
  }
  return saved;
}

export async function qualifySolanaRpcPair(directory: string) {
  const path = join(directory, "solana-rpc-public-pair-proof.json");
  let saved: ProofRecord;
  try {
    saved = validateRetainedSolanaProof(JSON.parse(readFileSync(path, "utf8")));
    saved.proof = null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    saved = initialSolanaProofRecord();
  }
  const coverage = new Map(
    saved.coverage.map((value) => [value.operator, value]),
  );
  const persist = () => {
    const temporary = `${path}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(saved, null, 2)}\n`, {
      mode: 0o600,
    });
    const file = openSync(temporary, "r");
    fsyncSync(file);
    closeSync(file);
    renameSync(temporary, path);
    const directoryFile = openSync(directory, "r");
    fsyncSync(directoryFile);
    closeSync(directoryFile);
  };
  const store = {
    async read(_txId: string, operator: string) {
      return coverage.get(operator) ?? null;
    },
    async save(
      previous: ExpiryCoverage | null,
      next: ExpiryCoverage,
      blocks: CoverageBlock[],
    ) {
      if (
        (coverage.get(next.operator)?.revision ?? null) !==
        (previous?.revision ?? null)
      )
        throw Error("Recovery cursor changed");
      coverage.set(next.operator, next);
      saved.coverage = [...coverage.values()];
      saved.pages.push({ operator: next.operator, blocks });
      persist();
    },
  };
  let lastRequest = 0;
  const providers = SOLANA_PUBLIC_PAIR.map((endpoint) => ({
    operator: operator(endpoint),
    async rpc<T>(method: string, params: unknown[]): Promise<T> {
      await Bun.sleep(Math.max(0, 3000 - (Date.now() - lastRequest)));
      lastRequest = Date.now();
      const response = await fetch(endpoint, {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(15000),
      });
      const value = await response.json();
      if (!response.ok || value.error || value.result === undefined)
        throw Error("Public Solana witness read unavailable");
      return value.result as T;
    },
  }));
  const deadline = Date.now() + 60 * 60 * 1000;
  // Recheck fresh provider facts even when a prior completed cursor was retained.
  do {
    try {
      saved.proof = await proveSolanaExpiry(
        witness.txId,
        witness.blockhash,
        witness.blockhashSlot,
        providers,
        store,
      );
      persist();
    } catch {
      saved.proof = null;
      persist();
      await Bun.sleep(10000);
    }
    if (Date.now() >= deadline)
      throw Error("Solana public-pair qualification incomplete");
  } while (!saved.proof);
  if (
    saved.proof.providers.some(
      (value) =>
        value.coverage?.blocks !== 211 ||
        value.coverage.digest !==
          "8a58871a15801484a89e2283728a3b76643100608c50553b9acfd770c8c99368",
    )
  )
    throw Error("Solana witness differs from the reviewed chain");
  console.log(
    JSON.stringify({
      event: "solana_public_pair_qualified",
      blockhashSlot: witness.blockhashSlot,
      horizonSlot: witness.tipSlot,
      blocks: 211,
      operators: saved.proof.providers.map((value) => value.operator),
    }),
  );
}
