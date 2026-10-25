import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { open, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const integer = (value) =>
  Number.isSafeInteger(value) && value >= 0 ? value : null;
const errorCode = (value) => {
  if (value === null) return null;
  if (typeof value === "string" && /^[A-Za-z0-9]{1,64}$/.test(value))
    return value;
  const instruction = value?.InstructionError;
  if (Array.isArray(instruction) && integer(instruction[0]) !== null) {
    const detail = instruction[1];
    if (typeof detail === "string" && /^[A-Za-z0-9]{1,64}$/.test(detail))
      return { InstructionError: [instruction[0], detail] };
    if (integer(detail?.Custom) !== null)
      return { InstructionError: [instruction[0], { Custom: detail.Custom }] };
  }
  return "unclassified";
};

async function collect() {
  const [log, exitCode, ...extra] = process.argv.slice(2);
  if (!log || !/^[1-9][0-9]{0,2}$/.test(exitCode) || extra.length)
    throw new Error("Invalid diagnostic arguments");
  const endpoint = new URL(process.env.ANCHOR_PROVIDER_URL);
  if (
    endpoint.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.pathname !== "/"
  )
    throw new Error("Diagnostics require the isolated local validator");

  const file = await open(log, "r");
  let tail, size;
  try {
    size = (await file.stat()).size;
    tail = Buffer.alloc(Math.min(size, 65536));
    await file.read(tail, 0, tail.length, size - tail.length);
  } finally {
    await file.close();
  }
  // Node's test reporter prints this field for the two web3.js expiration
  // errors. Successful fixture messages and arbitrary source text are excluded.
  const signatures = [
    ...new Set(
      [
        ...tail
          .toString()
          .matchAll(/^\s*signature: '([1-9A-HJ-NP-Za-km-z]{64,88})'\s*$/gm),
      ].map((match) => match[1]),
    ),
  ];
  async function rpc(method, params = []) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok || !response.body) return { available: false };
      const reader = response.body.getReader();
      const parts = [];
      let bytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.length;
          if (bytes > 262144) return { available: false };
          parts.push(value);
        }
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
      const body = JSON.parse(Buffer.concat(parts).toString());
      if (body.id !== 1 || body.error) return { available: false };
      return { available: true, value: body.result };
    } catch {
      return { available: false };
    }
  }
  const [
    health,
    confirmedSlot,
    finalizedSlot,
    confirmedHeight,
    finalizedHeight,
  ] = await Promise.all([
    rpc("getHealth"),
    rpc("getSlot", [{ commitment: "confirmed" }]),
    rpc("getSlot", [{ commitment: "finalized" }]),
    rpc("getBlockHeight", [{ commitment: "confirmed" }]),
    rpc("getBlockHeight", [{ commitment: "finalized" }]),
  ]);
  const transactions = await Promise.all(
    signatures.slice(0, 16).map(async (signature) => {
      const status = await rpc("getSignatureStatuses", [
        [signature],
        { searchTransactionHistory: true },
      ]);
      const state = status.value?.value?.[0];
      const receipts = {};
      for (const commitment of ["confirmed", "finalized"]) {
        const read = await rpc("getTransaction", [
          signature,
          { commitment, encoding: "json", maxSupportedTransactionVersion: 0 },
        ]);
        const receipt = read.value;
        receipts[commitment] = {
          available: read.available,
          present: Boolean(receipt),
          ...(receipt && {
            signatureMatches:
              receipt.transaction?.signatures?.[0] === signature,
            slot: integer(receipt.slot),
            blockTime: integer(receipt.blockTime),
            executionError: errorCode(receipt.meta?.err),
            fee: integer(receipt.meta?.fee),
            computeUnitsConsumed: integer(receipt.meta?.computeUnitsConsumed),
          }),
        };
      }
      return {
        signature,
        status: {
          available: status.available,
          present: Boolean(state),
          ...(state && {
            slot: integer(state.slot),
            confirmationStatus: [
              "processed",
              "confirmed",
              "finalized",
            ].includes(state.confirmationStatus)
              ? state.confirmationStatus
              : "unknown",
            executionError: errorCode(state.err),
          }),
        },
        receipts,
      };
    }),
  );
  const report = {
    schemaVersion: 1,
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    observedAt: new Date().toISOString(),
    testExitCode: Number(exitCode),
    testLogBytes: size,
    testLogTailSha256: digest(tail),
    signatureCount: signatures.length,
    signaturesTruncated: signatures.length > 16,
    health: health.available && health.value === "ok" ? "ok" : "unavailable",
    confirmedSlot: integer(confirmedSlot.value),
    finalizedSlot: integer(finalizedSlot.value),
    confirmedHeight: integer(confirmedHeight.value),
    finalizedHeight: integer(finalizedHeight.value),
    transactions,
  };
  await writeFile(
    join(".local/failure-evidence", `${basename(log)}.json`),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log("Safe validator failure evidence saved; test failure retained.");
}

try {
  await collect();
} catch {
  console.error("Safe validator failure evidence unavailable.");
  process.exitCode = 1;
}
