/** Retain exact unsigned replay inputs for an authorized reviewer. */
import { readFile, writeFile } from "node:fs/promises";
import { brotliCompressSync } from "node:zlib";
import type { LeaderboardSnapshot } from "../src/lib/leaderboard";
import { sha256Hex } from "../src/lib/sha256";
import type { HistoricalReplayReceipt } from "./historical-replay-qualification";
import {
  type PrivatePacketManifest,
  parsePrivatePacketManifest,
  type reviewedPacketStorage,
} from "./private-payout-packet";
import type { HistoricalPointsPacket } from "./reviewed-historical-points";

const CHUNK_BYTES = 393_216;
const MAX_RAW_BYTES = 128 * 1024 * 1024;
const MAX_CHUNKS = 64;
const digest = (value: unknown) => sha256Hex(JSON.stringify(value));

type HistoricalReplayReview = {
  schemaVersion: "slop-historical-replay-review-v1";
  sourceAudit: HistoricalPointsPacket["sourceAudit"];
  valueSnapshot: LeaderboardSnapshot | null;
  valueKeys: string[];
  qualificationSha256: string;
};

type Store = Awaited<ReturnType<typeof reviewedPacketStorage>>;

export async function stageHistoricalReplayReview(
  review: Omit<HistoricalReplayReview, "schemaVersion">,
  store: Store,
): Promise<string> {
  const payload: HistoricalReplayReview = {
    schemaVersion: "slop-historical-replay-review-v1",
    ...review,
  };
  const raw = Buffer.from(JSON.stringify(payload));
  if (raw.length > MAX_RAW_BYTES)
    throw new Error("Historical replay review exceeds the private size bound");
  const compressed = brotliCompressSync(raw);
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < compressed.length; offset += CHUNK_BYTES) {
    chunks.push(compressed.subarray(offset, offset + CHUNK_BYTES));
  }
  if (chunks.length > MAX_CHUNKS)
    throw new Error("Historical replay review exceeds the private chunk bound");
  const manifest: PrivatePacketManifest = {
    schemaVersion: "1",
    compression: "br",
    rawSha256: sha256Hex(raw),
    rawBytes: raw.length,
    compressedSha256: sha256Hex(compressed),
    compressedBytes: compressed.length,
    chunks: chunks.map((chunk) => ({
      sha256: sha256Hex(chunk),
      bytes: chunk.length,
    })),
  };
  const text = JSON.stringify(manifest);
  for (const [index, chunk] of chunks.entries()) {
    await store.stage(text, index, chunk.toString("base64"));
  }
  if (!(await store.read(text)).equals(raw))
    throw new Error(
      "Stored historical replay review differs from producer bytes",
    );
  return text;
}

/** Read exact review bytes from the manifest embedded in the trusted receipt. */
export async function readHistoricalReplayReview(
  receipt: HistoricalReplayReceipt,
  store: Pick<Store, "read">,
): Promise<Buffer> {
  const text = receipt?.replay?.privateReviewManifest;
  if (
    receipt?.schemaVersion !== "1" ||
    receipt.mode !== "assessment-replay" ||
    typeof text !== "string" ||
    text.length > 8_192 ||
    !/^[a-f0-9]{64}$/u.test(receipt.replay.qualificationSha256 ?? "")
  )
    throw new Error("Historical replay receipt has no private review manifest");
  const manifest = parsePrivatePacketManifest(text);
  if (
    manifest.compression !== "br" ||
    manifest.chunks.length > MAX_CHUNKS ||
    manifest.rawBytes > MAX_RAW_BYTES
  )
    throw new Error("Historical replay review exceeds its transport contract");
  const bytes = await store.read(text);
  const bundle: HistoricalReplayReview = JSON.parse(bytes.toString("utf8"));
  if (
    bundle?.schemaVersion !== "slop-historical-replay-review-v1" ||
    Object.keys(bundle).sort().join(",") !==
      "qualificationSha256,schemaVersion,sourceAudit,valueKeys,valueSnapshot" ||
    bundle.qualificationSha256 !== receipt.replay.qualificationSha256 ||
    digest(bundle.sourceAudit) !== receipt.sourceDigest ||
    bundle.sourceAudit.repositoryNodeId !== receipt.sourceRepositoryNodeId ||
    bundle.sourceAudit.from !== receipt.sourceFrom ||
    bundle.sourceAudit.through !== receipt.sourceThrough ||
    bundle.sourceAudit.sources.length !== receipt.sourceCount ||
    !Array.isArray(bundle.valueKeys) ||
    new Set(bundle.valueKeys).size !== bundle.valueKeys.length ||
    bundle.valueKeys.some(
      (key) => typeof key !== "string" || !/^[a-f0-9]{64}$/u.test(key),
    ) ||
    (receipt.replay.snapshotSha256 === null
      ? bundle.valueSnapshot !== null || bundle.valueKeys.length !== 0
      : digest(bundle.valueSnapshot) !== receipt.replay.snapshotSha256)
  )
    throw new Error(
      "Historical replay review differs from the trusted receipt",
    );
  return bytes;
}

if (import.meta.main) {
  try {
    const [, , receiptPath, outputPath, ...extra] = process.argv;
    if (!receiptPath || !outputPath || extra.length !== 0)
      throw new Error(
        "Historical replay review requires an exact receipt and output",
      );
    const { privatePacketPreviewStorage } = await import(
      "./private-packet-preview"
    );
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    const bytes = await readHistoricalReplayReview(
      receipt,
      privatePacketPreviewStorage(
        process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
        process.env.CLOUDFLARE_API_TOKEN ?? "",
      ),
    );
    await writeFile(outputPath, bytes, { mode: 0o600, flag: "wx" });
  } catch {
    console.error("Could not read the private historical replay review.");
    process.exitCode = 1;
  }
}
