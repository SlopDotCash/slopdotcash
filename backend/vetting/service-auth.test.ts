import { expect, test } from "bun:test";
import { encodeBase64 } from "../../src/lib/byte-encoding";
import { signedVettingHeaders, vettingKeyPair } from "../../tests/vetting-fixtures";
import { signedVettingRequest, vettingServiceAvailable } from "./handler";

// Actual signature verifier and bounded reader with disposable test keys. These
// definitions make no service/provider calls and do not establish live key custody.
const ORIGIN = "https://slop.cash";
const PATH = "/api/v1/vetting/results?batch=1&after=2";
const NOW = new Date("2026-11-09T12:00:00.000Z");
let retainedKeys: ReturnType<typeof vettingKeyPair> | undefined;
const keys = () => (retainedKeys ??= vettingKeyPair());
async function fixture(body = '{"result":"fixture"}', at = NOW) {
  const key = await keys();
  const headers = await signedVettingHeaders(key.privateKey, key.raw, "POST", PATH, body, at);
  return { key, body, headers, deps: { resultPublicKeys: key.publicKey as string | undefined, now: () => NOW },
    request: () => new Request(`${ORIGIN}${PATH}`, { method: "POST", headers, body }) };
}

for (const [name, offset, admitted] of [
  ["current", 0, true], ["oldest inclusive boundary", -300_000, true],
  ["newest inclusive boundary", 300_000, true], ["one millisecond too old", -300_001, false],
  ["one millisecond too new", 300_001, false],
] as const) {
  test(`signed service timestamp: ${name}`, async () => {
    const f = await fixture("{}", new Date(NOW.getTime() + offset));
    const result = signedVettingRequest(f.request(), f.deps);
    if (admitted) expect(new TextDecoder().decode((await result).body)).toBe("{}");
    else await expect(result).rejects.toMatchObject({ status: 401, code: "invalid_signature" });
  });
}

for (const [name, value] of [
  ["absent", undefined], ["only separators", " , , "], ["invalid base64", "!!"],
  ["wrong key byte length", encodeBase64(new Uint8Array(31))],
] as const) {
  test(`service keys unavailable: ${name}`, async () => {
    expect(await vettingServiceAvailable(value)).toBe(false);
    const f = await fixture();
    f.headers["x-slop-vetting-timestamp"] = "not-a-date";
    await expect(signedVettingRequest(f.request(), { ...f.deps, resultPublicKeys: value }))
      .rejects.toMatchObject({ status: 503, code: "vetting_unavailable" });
  });
}

test("one malformed entry invalidates earlier and later valid keys", async () => {
  const key = await keys();
  expect(await vettingServiceAvailable(`${key.publicKey},!!`)).toBe(false);
  expect(await vettingServiceAvailable(`!!,${key.publicKey}`)).toBe(false);
});

test("empty entries, duplicate keys and URL-safe unpadded key bytes are accepted", async () => {
  const f = await fixture();
  const unpadded = f.key.publicKey.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
  expect(await vettingServiceAvailable(` , ${unpadded}, ,${unpadded}, `)).toBe(true);
  expect((await signedVettingRequest(f.request(), { ...f.deps, resultPublicKeys: unpadded })).body)
    .toEqual(new TextEncoder().encode(f.body));
});

test("a second configured key can authenticate", async () => {
  const f = await fixture();
  const other = await vettingKeyPair();
  await signedVettingRequest(f.request(), { ...f.deps, resultPublicKeys: `${other.publicKey},${f.key.publicKey}` });
});

for (const timestamp of ["", "2026-11-09T12:00:00+00:00", "2026-11-09T12:00:00.00Z", "2026-13-09T12:00:00.000Z"]) {
  test(`timestamp grammar or parse refusal: ${timestamp || "empty"}`, async () => {
    const f = await fixture();
    f.headers["x-slop-vetting-timestamp"] = timestamp;
    await expect(signedVettingRequest(f.request(), f.deps)).rejects.toMatchObject({ status: 401 });
  });
}

test("UTC whole-second timestamps are valid signed bytes", async () => {
  const f = await fixture();
  const timestamp = NOW.toISOString().replace(".000Z", "Z");
  // Sign exactly that spelling; a header-only rewrite would invalidate the signature.
  const { vettingSignedMessage } = await import("./handler");
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(f.body))))
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
  f.headers["x-slop-vetting-timestamp"] = timestamp;
  f.headers["x-slop-vetting-signature"] = encodeBase64(new Uint8Array(await crypto.subtle.sign(
    "Ed25519", f.key.privateKey, vettingSignedMessage("POST", PATH, timestamp, digest) as Uint8Array<ArrayBuffer>,
  )));
  await signedVettingRequest(f.request(), f.deps);
});

for (const [name, field, value] of [
  ["unknown key digest", "x-slop-vetting-key", "0".repeat(64)],
  ["missing signature", "x-slop-vetting-signature", ""],
  ["malformed signature", "x-slop-vetting-signature", "!!"],
  ["wrong signature size", "x-slop-vetting-signature", encodeBase64(new Uint8Array(63))],
  ["wrong signature bytes", "x-slop-vetting-signature", encodeBase64(new Uint8Array(64))],
] as const) {
  test(`service signature refuses ${name}`, async () => {
    const f = await fixture(); f.headers[field] = value;
    await expect(signedVettingRequest(f.request(), f.deps)).rejects.toMatchObject({ status: 401 });
  });
}

test("key digest comparison is exact, not case-normalized", async () => {
  const f = await fixture();
  f.headers["x-slop-vetting-key"] = f.headers["x-slop-vetting-key"]!.toUpperCase();
  await expect(signedVettingRequest(f.request(), f.deps)).rejects.toMatchObject({ status: 401 });
});

for (const field of ["method", "path", "query", "body"] as const) {
  test(`changing signed ${field} invalidates authentication`, async () => {
    const f = await fixture();
    const url = field === "path" ? `${ORIGIN}/api/v1/vetting/other?batch=1&after=2`
      : field === "query" ? `${ORIGIN}/api/v1/vetting/results?after=2&batch=1` : `${ORIGIN}${PATH}`;
    const request = new Request(url, { method: field === "method" ? "PUT" : "POST", headers: f.headers,
      body: field === "body" ? `${f.body}\n` : f.body });
    await expect(signedVettingRequest(request, f.deps)).rejects.toMatchObject({ status: 401 });
  });
}

test("content type is not part of this signature envelope", async () => {
  const f = await fixture(); f.headers["content-type"] = "application/octet-stream";
  await signedVettingRequest(f.request(), f.deps);
});

test("body byte limit is inclusive and a larger signed body is refused", async () => {
  const f = await fixture("abcd");
  expect((await signedVettingRequest(f.request(), f.deps, 4)).body.byteLength).toBe(4);
  await expect(signedVettingRequest(f.request(), f.deps, 3)).rejects.toMatchObject({ status: 413 });
});

test("malformed content length is refused before digest verification", async () => {
  const f = await fixture(); f.headers["content-length"] = "1.5";
  await expect(signedVettingRequest(f.request(), f.deps)).rejects.toMatchObject({ status: 400, code: "invalid_content_length" });
});

test("a body read failure propagates without returning authenticated bytes", async () => {
  const f = await fixture();
  const body = new ReadableStream<Uint8Array>({ pull() { throw new Error("body stream failed"); } }, { highWaterMark: 0 });
  const init: RequestInit & { duplex: "half" } = { method: "POST", headers: f.headers, body, duplex: "half" };
  await expect(signedVettingRequest(new Request(`${ORIGIN}${PATH}`, init), f.deps)).rejects.toThrow("body stream failed");
});

test("in-flight verification retains captured time, configuration and signature headers", async () => {
  const f = await fixture(); let now = NOW;
  const deps = { resultPublicKeys: f.key.publicKey as string | undefined, now: () => now };
  let started!: () => void, release!: () => void;
  const reading = new Promise<void>((resolve) => { started = resolve; });
  const held = new Promise<void>((resolve) => { release = resolve; });
  const body = new ReadableStream<Uint8Array>({ async pull(controller) {
    started(); await held; controller.enqueue(new TextEncoder().encode(f.body)); controller.close();
  } }, { highWaterMark: 0 });
  const init: RequestInit & { duplex: "half" } = { method: "POST", headers: f.headers, body, duplex: "half" };
  const request = new Request(`${ORIGIN}${PATH}`, init);
  const pending = signedVettingRequest(request, deps);
  await reading;
  now = new Date(NOW.getTime() + 600_000); deps.resultPublicKeys = undefined;
  request.headers.set("x-slop-vetting-signature", "invalid-after-capture");
  release();
  expect(new TextDecoder().decode((await pending).body)).toBe(f.body);
  await expect(signedVettingRequest(f.request(), deps)).rejects.toMatchObject({ status: 503 });
});

test("identical fresh requests authenticate twice; endpoint idempotency is separate", async () => {
  const f = await fixture();
  expect((await signedVettingRequest(f.request(), f.deps)).keySha256).toBe(f.headers["x-slop-vetting-key"]!);
  expect((await signedVettingRequest(f.request(), f.deps)).keySha256).toBe(f.headers["x-slop-vetting-key"]!);
});
