// Regression definitions for PRD STATE-02/03. These use ephemeral local keys
// and an in-memory transport; they do not qualify a deployed scanner service.
import { expect, test } from "bun:test";
import { vettingSignedMessage } from "../../backend/vetting/handler";
import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import { decodeBase64 } from "../../src/lib/byte-encoding";
import {
  serviceOrigin,
  signedServiceHeaders,
  signedVettingFetch,
  type VettingConnection,
  type VettingServiceSigner,
  vettingServiceSigner,
} from "./service";

const PATH = "/api/v1/vetting/requests?limit=2";
const AT = "2026-11-09T12:00:00.000Z";
const bytes = () => new TextEncoder().encode("private request bytes");
const keys = async (): Promise<VettingServiceSigner> =>
  (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;

async function expectSignature(
  headers: Headers,
  signer: VettingServiceSigner,
  method: "GET" | "POST" | "PUT",
  path: string,
  body: Uint8Array,
) {
  expect(headers.get("x-slop-vetting-timestamp")).toBe(AT);
  expect(headers.get("x-slop-vetting-key")).toBe(
    await sha256Hex(
      new Uint8Array(await crypto.subtle.exportKey("raw", signer.publicKey)),
    ),
  );
  const message = vettingSignedMessage(method, path, AT, await sha256Hex(body));
  expect(
    await crypto.subtle.verify(
      "Ed25519",
      signer.publicKey,
      decodeBase64(headers.get("x-slop-vetting-signature") ?? ""),
      message as Uint8Array<ArrayBuffer>,
    ),
  ).toBe(true);
}

test("service origins are exact HTTPS origins with explicit local-runner opt-in", () => {
  expect(serviceOrigin("https://scanner.example")).toBe("https://scanner.example");
  expect(serviceOrigin("http://127.0.0.1:8100", true)).toBe(
    "http://127.0.0.1:8100",
  );
  for (const value of [
    "https://scanner.example/",
    "https://scanner.example?token=private",
    "https://scanner.example#fragment",
    "https://user:password@scanner.example",
    "https://scanner.example:443",
    "http://scanner.example",
    "http://localhost:8100",
    "http://127.0.0.1:8100",
  ]) {
    expect(() => serviceOrigin(value)).toThrow();
  }
});

test("signing rejects paths whose URL interpretation differs from signed bytes", async () => {
  const signer = await keys();
  for (const pathAndQuery of [
    "https://other.example/api/v1/vetting/requests",
    "//other.example/api/v1/vetting/requests",
    "/api/v1/vetting/../projects",
    "/api/v1/vetting/%2e%2e/projects",
    "/api/v1/vetting/requests#fragment",
    "/api/v1/vetting/requests?",
    "/api/v1/projects",
    "/api/v1/vetting",
  ]) {
    await expect(
      signedServiceHeaders({ signer, method: "GET", pathAndQuery, body: bytes() }),
    ).rejects.toThrow("Invalid vetting service path");
  }
});

test("signer import proves the configured Ed25519 key pair", async () => {
  const original = await keys();
  const jwk = await crypto.subtle.exportKey("jwk", original.privateKey);
  const signer = await vettingServiceSigner(JSON.stringify(jwk));
  expect(signer.privateKey.extractable).toBe(false);
  expect(signer.publicKey.extractable).toBe(true);
  const body = bytes();
  const headers = await signedServiceHeaders({
    signer,
    method: "POST",
    pathAndQuery: PATH,
    body,
    at: new Date(AT),
  });
  await expectSignature(new Headers(headers), original, "POST", PATH, body);
});

test("signer import refuses malformed or mismatched keys without returning capability", async () => {
  const original = await keys();
  const other = await keys();
  const privateJwk = await crypto.subtle.exportKey("jwk", original.privateKey);
  const otherPublic = await crypto.subtle.exportKey("jwk", other.publicKey);
  for (const raw of [
    undefined,
    "not-json",
    "null",
    JSON.stringify({ ...privateJwk, crv: "X25519" }),
    JSON.stringify({ ...privateJwk, d: "" }),
    JSON.stringify({ ...privateJwk, x: otherPublic.x }),
  ]) {
    await expect(vettingServiceSigner(raw)).rejects.toThrow(
      "The scanner signing key is invalid",
    );
  }
});

test("header signing owns bytes, method, path, timestamp and key references across awaits", async () => {
  const original = await keys();
  const other = await keys();
  const body = bytes();
  const expectedBody = new Uint8Array(body);
  const input: Parameters<typeof signedServiceHeaders>[0] = {
    signer: { ...original },
    method: "POST",
    pathAndQuery: PATH,
    body,
    at: new Date(AT),
  };
  const pending = signedServiceHeaders(input);
  body.fill(0);
  input.body = new Uint8Array([1]);
  input.method = "PUT";
  input.pathAndQuery = "/api/v1/vetting/results";
  input.at?.setUTCFullYear(2030);
  input.signer.privateKey = other.privateKey;
  input.signer.publicKey = other.publicKey;
  await expectSignature(
    new Headers(await pending),
    original,
    "POST",
    PATH,
    expectedBody,
  );
});

test("signed fetch sends one owned request snapshot despite caller mutation", async () => {
  const original = await keys();
  const other = await keys();
  const originalBody = bytes();
  const expectedBody = new Uint8Array(originalBody);
  const response = new Response("accepted");
  let calls = 0;
  const connection: VettingConnection = {
    ...original,
    origin: "https://scanner.example",
    now: () => new Date(AT),
    fetch: (async (url, init) => {
      calls++;
      expect(String(url)).toBe(`https://scanner.example${PATH}`);
      expect(init?.method).toBe("POST");
      expect(init?.redirect).toBe("error");
      expect(init?.body).toEqual(expectedBody);
      const headers = new Headers(init?.headers);
      expect(headers.get("content-type")).toBe("application/octet-stream");
      await expectSignature(headers, original, "POST", PATH, expectedBody);
      return response;
    }) as typeof fetch,
  };
  const request: Parameters<typeof signedVettingFetch>[1] = {
    method: "POST",
    path: PATH,
    body: originalBody,
    contentType: "application/octet-stream",
    timeoutMs: 30_000,
  };
  const pending = signedVettingFetch(connection, request);
  originalBody.fill(0);
  request.body = new Uint8Array([1]);
  request.method = "GET";
  request.path = "/api/v1/vetting/results";
  request.contentType = "text/plain";
  request.timeoutMs = 1;
  connection.origin = "https://other.example";
  connection.privateKey = other.privateKey;
  connection.publicKey = other.publicKey;
  connection.now = () => new Date("2030-01-01T00:00:00.000Z");
  connection.fetch = (async () => {
    throw new Error("Changed transport must not be called");
  }) as typeof fetch;
  expect(await pending).toBe(response);
  expect(calls).toBe(1);
});

test("GET signs the absent transport body even if caller supplies ignored bytes", async () => {
  const signer = await keys();
  let calls = 0;
  await signedVettingFetch(
    {
      ...signer,
      origin: "http://127.0.0.1:8100",
      now: () => new Date(AT),
      fetch: (async (_url, init) => {
        calls++;
        expect(init?.method).toBe("GET");
        expect(init?.body).toBeUndefined();
        await expectSignature(
          new Headers(init?.headers),
          signer,
          "GET",
          PATH,
          new Uint8Array(),
        );
        return new Response(null, { status: 204 });
      }) as typeof fetch,
    },
    { method: "GET", path: PATH, body: bytes(), timeoutMs: 30_000 },
  );
  expect(calls).toBe(1);
});

test("signed fetch returns successful and refused response bodies to the caller", async () => {
  const signer = await keys();
  for (const status of [200, 503]) {
    let cancelled = false;
    const response = new Response(
      new ReadableStream({
        cancel: () => {
          cancelled = true;
        },
      }),
      { status },
    );
    const received = await signedVettingFetch(
      {
        ...signer,
        origin: "https://scanner.example",
        fetch: (async () => response) as typeof fetch,
      },
      { method: "GET", path: PATH, timeoutMs: 30_000 },
    );
    expect(received).toBe(response);
    expect(received.bodyUsed).toBe(false);
    expect(cancelled).toBe(false);
    await received.body?.cancel();
    expect(cancelled).toBe(true);
  }
});

test("signed fetch refuses malformed origins before dispatch", async () => {
  const signer = await keys();
  let calls = 0;
  for (const origin of [
    "https://scanner.example?credential=private",
    "https://scanner.example/forward",
    "http://scanner.example",
  ]) {
    await expect(
      signedVettingFetch(
        {
          ...signer,
          origin,
          fetch: (async () => {
            calls++;
            return new Response(null, { status: 204 });
          }) as typeof fetch,
        },
        { method: "GET", path: PATH, timeoutMs: 30_000 },
      ),
    ).rejects.toThrow();
  }
  expect(calls).toBe(0);
});
