import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { brotliCompressSync } from "node:zlib";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { sha256Hex } from "../src/lib/sha256";
import {
  decryptPacketObject,
  encryptPacketObject,
  privatePacketPreviewStorage,
  privatePacketWorker,
} from "./private-packet-preview";

const encryptionKey = Buffer.alloc(32, 7);
const encryptionSecret = encryptionKey.toString("base64url");

function fixture() {
  const raw = Buffer.from('{"private":"reviewed payout packet"}');
  const compressed = brotliCompressSync(raw);
  const chunks = [compressed.subarray(0, 8), compressed.subarray(8)];
  const manifest = {
    schemaVersion: "1",
    compression: "br",
    rawSha256: sha256Hex(raw),
    rawBytes: raw.length,
    compressedSha256: sha256Hex(compressed),
    compressedBytes: compressed.length,
    chunks: chunks.map((bytes) => ({
      sha256: sha256Hex(bytes),
      bytes: bytes.length,
    })),
  };
  return { raw, chunks, manifest, text: JSON.stringify(manifest) };
}

function workerHarness(text: string) {
  const objects = new Map<string, Uint8Array>();
  let writes = 0;
  const handler = runInNewContext(
    privatePacketWorker(text, encryptionKey).replace(
      "export default",
      "globalThis.worker =",
    ),
    { Response, URL, Uint8Array, crypto },
  );
  const env = {
    PACKET_AUTH: "private-test-auth",
    PACKET_STORE: {
      async get(key: string) {
        const value = objects.get(key);
        return value
          ? { body: new Response(Uint8Array.from(value).buffer).body }
          : null;
      },
      async put(
        key: string,
        value: Uint8Array,
        options: { onlyIf: { etagDoesNotMatch: string } },
      ) {
        expect(options.onlyIf).toEqual({ etagDoesNotMatch: "*" });
        if (!objects.has(key)) {
          objects.set(key, value);
          writes++;
        }
      },
    },
  };
  const send = (
    path: string,
    method = "GET",
    bytes?: Uint8Array,
    auth = "private-test-auth",
  ) =>
    handler.fetch(
      new Request(`https://private.invalid${path}`, {
        method,
        headers: { authorization: `Bearer ${auth}` },
        ...(bytes ? { body: Uint8Array.from(bytes).buffer } : {}),
      }),
      env,
    ) as Promise<Response>;
  return { send, objects, env, writes: () => writes };
}

test("packet worker refuses unauthorized methods, paths, sizes and hashes", async () => {
  const f = fixture(),
    h = workerHarness(f.text);
  expect(
    (
      await h.send(
        "/packet/0.gzpart",
        "PUT",
        encryptPacketObject(f.text, "0.gzpart", f.chunks[0], encryptionKey),
        "wrong",
      )
    ).status,
  ).toBe(403);
  for (const path of [
    "/packet/../scan-object",
    "/packet/2.gzpart",
    "/packet/0.gzpart?other=1",
    "/scan-object",
  ])
    expect((await h.send(path, "PUT", f.chunks[0])).status).toBe(404);
  expect((await h.send("/packet/0.gzpart", "DELETE")).status).toBe(404);
  expect(
    (await h.send("/packet/0.gzpart", "PUT", Buffer.from("bad"))).status,
  ).toBe(400);
  expect(
    (await h.send("/packet/0.gzpart", "PUT", Buffer.alloc(f.chunks[0].length)))
      .status,
  ).toBe(400);
  expect(h.writes()).toBe(0);
});

test("packet worker retains create-only exact replay and never reaches scanner objects", async () => {
  const f = fixture(),
    h = workerHarness(f.text);
  const key = `reviewed-payouts/v1/${f.manifest.rawSha256}/${f.manifest.compressedSha256}/0.gzpart`;
  h.objects.set("scanner/private-object", Buffer.from("scanner"));
  expect((await h.send("/packet/0.gzpart")).status).toBe(404);
  for (let i = 0; i < 2; i++)
    expect(
      (
        await h.send(
          "/packet/0.gzpart",
          "PUT",
          encryptPacketObject(f.text, "0.gzpart", f.chunks[0], encryptionKey),
        )
      ).status,
    ).toBe(200);
  expect(h.writes()).toBe(1);
  expect(
    decryptPacketObject(
      f.text,
      "0.gzpart",
      new Uint8Array(await (await h.send("/packet/0.gzpart")).arrayBuffer()),
      encryptionKey,
    ),
  ).toEqual(f.chunks[0]);
  h.objects.set(key, Buffer.from("corrupt"));
  expect(
    (
      await h.send(
        "/packet/0.gzpart",
        "PUT",
        encryptPacketObject(f.text, "0.gzpart", f.chunks[0], encryptionKey),
      )
    ).status,
  ).toBe(409);
  expect(Buffer.from(h.objects.get("scanner/private-object") ?? [])).toEqual(
    Buffer.from("scanner"),
  );
});

test("native workerd packet storage supports partial retry and exact private readback", async () => {
  const f = fixture();
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: privatePacketWorker(f.text, encryptionKey),
      compatibilityDate: "2026-09-14",
      r2Buckets: ["PACKET_STORE"],
      bindings: { PACKET_AUTH: "private-test-auth" },
    }),
  );
  const send = (suffix: string, method = "GET", body?: Uint8Array) =>
    runtime.dispatchFetch(`https://private.invalid/packet/${suffix}`, {
      method,
      headers: { authorization: "Bearer private-test-auth" },
      ...(body ? { body: Buffer.from(body) } : {}),
    });
  try {
    expect((await send("1.gzpart")).status).toBe(404);
    expect(
      (
        await send(
          "0.gzpart",
          "PUT",
          encryptPacketObject(f.text, "0.gzpart", f.chunks[0], encryptionKey),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await send(
          "0.gzpart",
          "PUT",
          encryptPacketObject(f.text, "0.gzpart", f.chunks[0], encryptionKey),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await send(
          "1.gzpart",
          "PUT",
          encryptPacketObject(f.text, "1.gzpart", f.chunks[1], encryptionKey),
        )
      ).status,
    ).toBe(200);
    expect(
      decryptPacketObject(
        f.text,
        "1.gzpart",
        new Uint8Array(await (await send("1.gzpart")).arrayBuffer()),
        encryptionKey,
      ),
    ).toEqual(f.chunks[1]);
    expect(
      (
        await send(
          "manifest.json",
          "PUT",
          encryptPacketObject(
            f.text,
            "manifest.json",
            Buffer.from(f.text),
            encryptionKey,
          ),
        )
      ).status,
    ).toBe(200);
    expect(
      decryptPacketObject(
        f.text,
        "manifest.json",
        new Uint8Array(await (await send("manifest.json")).arrayBuffer()),
        encryptionKey,
      ).toString(),
    ).toBe(f.text);
    expect((await send("9.gzpart")).status).toBe(404);
  } finally {
    await runtime.dispose();
  }
}, 30000);

function previewTransport(f: ReturnType<typeof fixture>) {
  const h = workerHarness(f.text),
    calls: { path: string; method: string }[] = [];
  let uploaded = false;
  const request = Object.assign(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input));
      calls.push({ path: url.pathname, method: init.method ?? "GET" });
      expect(init.redirect).toBe("error");
      if (url.pathname.endsWith("/workers/subdomain"))
        return Response.json({
          success: true,
          result: { subdomain: "fixture" },
        });
      if (url.pathname.endsWith("/subdomain/edge-preview"))
        return Response.json({
          success: true,
          result: { token: "private-session" },
        });
      if (url.pathname.endsWith("/edge-preview")) {
        const form = init.body as FormData,
          metadata = JSON.parse(String(form.get("metadata")));
        expect(metadata.bindings.map((b: { name: string }) => b.name)).toEqual([
          "PACKET_STORE",
          "PACKET_AUTH",
        ]);
        expect(metadata.bindings[0]).toEqual({
          name: "PACKET_STORE",
          type: "r2_bucket",
          bucket_name: "slop-vetting-evidence",
        });
        h.env.PACKET_AUTH = metadata.bindings[1].text;
        expect(h.env.PACKET_AUTH).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(await (form.get("packet.js") as File).text()).toBe(
          privatePacketWorker(f.text, encryptionKey),
        );
        uploaded = true;
        return Response.json({
          success: true,
          result: { preview_token: "private-preview" },
        });
      }
      expect(uploaded).toBe(true);
      expect(new Headers(init.headers).get("cf-workers-preview-token")).toBe(
        "private-preview",
      );
      return h.send(
        url.pathname,
        init.method,
        init.body as Uint8Array,
        new Headers(init.headers).get("authorization")?.slice(7),
      );
    },
    { preconnect: fetch.preconnect },
  );
  return { request, calls, h };
}

test("preview adapter preserves the canonical codec and uploads only an ephemeral bound worker", async () => {
  const f = fixture(),
    t = previewTransport(f);
  const store = privatePacketPreviewStorage(
    "a".repeat(32),
    "private-cf-token",
    t.request,
    encryptionSecret,
  );
  await store.stage(f.text, 0, f.chunks[0].toString("base64"));
  await expect(store.read(f.text)).rejects.toThrow("absent");
  await store.stage(f.text, 1, f.chunks[1].toString("base64"));
  expect(Buffer.from(await store.read(f.text))).toEqual(f.raw);
  expect(
    t.calls.filter(
      (call) => call.path.endsWith("/edge-preview") && call.method === "POST",
    ),
  ).toHaveLength(1);
  expect(
    t.calls.every(
      (call) =>
        !call.path.includes("/r2/buckets") &&
        !call.path.includes("/deployments") &&
        !call.path.includes("/versions"),
    ),
  ).toBe(true);
});

test("preview storage refuses binding mismatch and drops external failure contents", async () => {
  const f = fixture();
  const request = Object.assign(
    async () =>
      Response.json(
        {
          success: false,
          errors: [{ code: 10000, message: "private-token-and-packet" }],
        },
        { status: 403 },
      ),
    { preconnect: fetch.preconnect },
  );
  await expect(
    privatePacketPreviewStorage(
      "a".repeat(32),
      "private-token",
      request,
      encryptionSecret,
    ).stage(f.text, 0, f.chunks[0].toString("base64")),
  ).rejects.toThrow("Private packet preview refused");
  const h = workerHarness(f.text);
  const response = await h.send("/packet/0.gzpart", "GET");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});

test("a worker for another manifest cannot read or replace prior packet bytes", async () => {
  const f = fixture(),
    first = workerHarness(f.text);
  await first.send(
    "/packet/0.gzpart",
    "PUT",
    encryptPacketObject(f.text, "0.gzpart", f.chunks[0], encryptionKey),
  );
  const other = JSON.stringify({ ...f.manifest, rawSha256: "a".repeat(64) });
  const second = workerHarness(other);
  for (const [key, value] of first.objects) second.objects.set(key, value);
  expect((await second.send("/packet/0.gzpart")).status).toBe(404);
  expect(
    (await second.send("/packet/0.gzpart", "GET", undefined, "another-session"))
      .status,
  ).toBe(403);
});

test("parallel exact puts converge and corrupted storage never becomes a successful read", async () => {
  const f = fixture(),
    h = workerHarness(f.text);
  const results = await Promise.all([
    h.send(
      "/packet/0.gzpart",
      "PUT",
      encryptPacketObject(f.text, "0.gzpart", f.chunks[0], encryptionKey),
    ),
    h.send(
      "/packet/0.gzpart",
      "PUT",
      encryptPacketObject(f.text, "0.gzpart", f.chunks[0], encryptionKey),
    ),
  ]);
  expect(results.map((value) => value.status)).toEqual([200, 200]);
  expect(h.writes()).toBe(1);
  expect(h.objects.size).toBe(1);
});

test("preview client bounds returned bytes and keeps only fixed diagnostics", async () => {
  const f = fixture(),
    transport = previewTransport(f);
  const request = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/packet/0.gzpart") && init?.method === "GET")
        return new Response(new Uint8Array(f.chunks[0].length + 29));
      return transport.request(input, init);
    },
    { preconnect: fetch.preconnect },
  );
  const store = privatePacketPreviewStorage(
    "a".repeat(32),
    "secret",
    request,
    encryptionSecret,
  );
  let caught: unknown;
  try {
    await store.stage(f.text, 0, f.chunks[0].toString("base64"));
  } catch (error) {
    caught = error;
  }
  const { privatePacketFailure } = await import("./private-payout-packet");
  expect(privatePacketFailure("chunk-stage", caught)).toEqual({
    error: "private_packet_staging_refused",
    phase: "chunk-stage",
    preview: { operation: "object", httpStatus: null },
  });
});

test("encrypted objects bind the key, tag, nonce, exact plaintext and manifest AAD", () => {
  const f = fixture();
  const frame = encryptPacketObject(
    f.text,
    "0.gzpart",
    f.chunks[0],
    encryptionKey,
  );
  expect(
    frame.equals(
      encryptPacketObject(f.text, "0.gzpart", f.chunks[0], encryptionKey),
    ),
  ).toBe(true);
  expect(decryptPacketObject(f.text, "0.gzpart", frame, encryptionKey)).toEqual(
    f.chunks[0],
  );
  expect(frame.includes(f.chunks[0])).toBe(false);
  const badNonce = Buffer.from(frame);
  badNonce[0] ^= 1;
  const badTag = Buffer.from(frame);
  badTag[badTag.length - 1] ^= 1;
  for (const altered of [
    badNonce,
    badTag,
    frame.subarray(1),
    Buffer.concat([frame, Buffer.from([0])]),
  ])
    expect(() =>
      decryptPacketObject(f.text, "0.gzpart", altered, encryptionKey),
    ).toThrow();
  expect(() =>
    decryptPacketObject(f.text, "0.gzpart", frame, Buffer.alloc(32, 8)),
  ).toThrow();
  expect(() =>
    decryptPacketObject(
      JSON.stringify({ ...f.manifest, rawSha256: "a".repeat(64) }),
      "0.gzpart",
      frame,
      encryptionKey,
    ),
  ).toThrow();
  expect(() =>
    decryptPacketObject(f.text, "1.gzpart", frame, encryptionKey),
  ).toThrow();
  expect(() =>
    encryptPacketObject(
      f.text,
      "0.gzpart",
      Buffer.alloc(f.chunks[0].length),
      encryptionKey,
    ),
  ).toThrow();
});

test("a stored poisoned authentication tag refuses client replay without overwrite", async () => {
  const f = fixture(),
    t = previewTransport(f);
  const store = privatePacketPreviewStorage(
    "a".repeat(32),
    "private",
    t.request,
    encryptionSecret,
  );
  await store.stage(f.text, 0, f.chunks[0].toString("base64"));
  const entry = [...t.h.objects.entries()].find(([key]) =>
    key.endsWith("/0.gzpart"),
  );
  if (!entry) throw Error("Missing stored ciphertext");
  const poisoned = Buffer.from(entry[1]);
  poisoned[poisoned.length - 1] ^= 1;
  t.h.objects.set(entry[0], poisoned);
  const writes = t.h.writes();
  await expect(
    store.stage(f.text, 0, f.chunks[0].toString("base64")),
  ).rejects.toThrow();
  expect(t.h.writes()).toBe(writes);
  expect(t.h.objects.get(entry[0])).toEqual(poisoned);
});
