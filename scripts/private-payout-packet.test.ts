import { expect, test } from "bun:test";
import { gzipSync } from "node:zlib";
import { sha256Hex } from "../src/lib/sha256";
import {
  parsePrivatePacketManifest,
  privatePayoutStorage,
} from "./private-payout-packet";

function fixture() {
  const raw = Buffer.from(
    JSON.stringify({ source: "complete private reviewed packet" }),
  );
  const compressed = gzipSync(raw);
  const chunks = [compressed.subarray(0, 15), compressed.subarray(15)];
  const text = JSON.stringify({
    schemaVersion: "1",
    rawSha256: sha256Hex(raw),
    rawBytes: raw.length,
    compressedSha256: sha256Hex(compressed),
    compressedBytes: compressed.length,
    chunks: chunks.map((chunk) => ({
      sha256: sha256Hex(chunk),
      bytes: chunk.length,
    })),
  });
  const objects = new Map<string, Uint8Array>();
  let managed = false;
  let mutations = 0;
  const request = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const path = new URL(String(input)).pathname;
    expect(init?.redirect).toBe("error");
    if (path.endsWith("/domains/managed"))
      return Response.json({ success: true, result: { enabled: managed } });
    if (path.endsWith("/domains/custom"))
      return Response.json({ success: true, result: { domains: [] } });
    if (!path.includes("/objects/"))
      return Response.json({
        success: true,
        result: { name: "slop-reviewed-payouts" },
      });
    if (init?.method === "PUT") {
      mutations++;
      objects.set(path, new Uint8Array(init.body as Uint8Array));
      return new Response("ok");
    }
    const stored = objects.get(path);
    return stored
      ? new Response(Buffer.from(stored))
      : new Response(null, { status: 404 });
  }) as typeof fetch;
  return {
    raw,
    chunks,
    text,
    objects,
    request,
    setPublic: () => {
      managed = true;
    },
    mutationCount: () => mutations,
  };
}
test("private packet chunks replay exactly and decode complete ordered bytes", async () => {
  const f = fixture();
  const store = privatePayoutStorage(
    "a".repeat(32),
    "private-test-token",
    f.request,
  );
  for (const [index, chunk] of f.chunks.entries())
    await store.stage(f.text, index, chunk.toString("base64"));
  const mutations = f.mutationCount();
  await store.stage(f.text, 0, f.chunks[0].toString("base64"));
  expect(f.mutationCount()).toBe(mutations);
  expect(Buffer.from(await store.read(f.text))).toEqual(f.raw);
});
test("private packet refuses missing, altered and public storage", async () => {
  const f = fixture();
  const store = privatePayoutStorage(
    "a".repeat(32),
    "private-test-token",
    f.request,
  );
  await store.stage(f.text, 0, f.chunks[0].toString("base64"));
  await expect(store.read(f.text)).rejects.toThrow();
  await expect(
    store.stage(f.text, 1, Buffer.from("changed").toString("base64")),
  ).rejects.toThrow();
  f.setPublic();
  await expect(
    store.stage(f.text, 1, f.chunks[1].toString("base64")),
  ).rejects.toThrow();
});
test("private packet rejects a mismatched declared raw size", async () => {
  const f = fixture();
  const manifest = JSON.parse(f.text);
  manifest.rawBytes--;
  const text = JSON.stringify(manifest);
  const store = privatePayoutStorage(
    "a".repeat(32),
    "private-test-token",
    f.request,
  );
  for (const [index, chunk] of f.chunks.entries())
    await store.stage(text, index, chunk.toString("base64"));
  await expect(store.read(text)).rejects.toThrow();
});
test("private manifest forbids arbitrary paths and inconsistent ordered lengths", () => {
  const f = fixture();
  expect(parsePrivatePacketManifest(f.text).chunks).toHaveLength(2);
  expect(() =>
    parsePrivatePacketManifest(
      JSON.stringify({ ...JSON.parse(f.text), bucket: "elsewhere" }),
    ),
  ).toThrow();
  expect(() =>
    parsePrivatePacketManifest(
      JSON.stringify({ ...JSON.parse(f.text), compressedBytes: 1 }),
    ),
  ).toThrow();
});

test("staging creates only the fixed private bucket and refuses different stored bytes", async () => {
  const f = fixture();
  let exists = false;
  const request = (async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/r2/buckets") && init?.method === "POST") {
      expect(JSON.parse(String(init.body))).toEqual({
        name: "slop-reviewed-payouts",
      });
      exists = true;
      return Response.json({
        success: true,
        result: { name: "slop-reviewed-payouts" },
      });
    }
    if (path.endsWith("/r2/buckets/slop-reviewed-payouts") && !exists)
      return new Response(null, { status: 404 });
    return f.request(input, init);
  }) as typeof fetch;
  const store = privatePayoutStorage(
    "a".repeat(32),
    "private-test-token",
    request,
  );
  await store.stage(f.text, 0, f.chunks[0].toString("base64"));
  expect(exists).toBe(true);
  const object = [...f.objects.keys()].find((key) => key.endsWith("/0.gzpart"));
  if (!object) throw Error("Missing fixture object");
  f.objects.set(object, Buffer.from("changed"));
  await expect(
    store.stage(f.text, 0, f.chunks[0].toString("base64")),
  ).rejects.toThrow();
});
