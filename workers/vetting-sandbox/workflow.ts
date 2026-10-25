/** Real signed Pages handler -> local Worker -> disposable container workflow. */
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { CloudflareProjectPersistence } from "../../backend/projects/cloudflare-persistence";
import {
  handleVettingApi,
  type VettingApiDependencies,
} from "../../backend/vetting/handler";
import { CloudflareVettingPersistence } from "../../backend/vetting/persistence";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { signedServiceHeaders } from "../vetting/service";
import { qualifySandbox } from "./probes";

const target = process.env.SLOP_SANDBOX_TEST_URL;
assert(
  target && /^http:\/\/127\.0\.0\.1:\d+$/.test(target),
  "Set a local Worker URL",
);
const keys = (await crypto.subtle.generateKey("Ed25519", true, [
  "sign",
  "verify",
])) as CryptoKeyPair;
const raw = new Uint8Array(
  await crypto.subtle.exportKey("raw", keys.publicKey),
);
const database = sqliteD1(
  readdirSync(new URL("../../migrations", import.meta.url))
    .filter((n) => n.endsWith(".sql"))
    .sort(),
);
let forwarded = 0;
const dependencies: VettingApiDependencies = {
  vetting: new CloudflareVettingPersistence(database.db, async () => false),
  projects: new CloudflareProjectPersistence(database.db),
  resultPublicKeys: btoa(String.fromCharCode(...raw)),
  now: () => new Date(),
  randomId: () => crypto.randomUUID(),
  session: async () => null,
  livePin: async () => {
    throw new Error("No project lookup belongs in isolated execution");
  },
  sandbox: {
    fetch: async (request) => {
      forwarded++;
      assert.equal(request.headers.has("authorization"), false);
      assert.equal(request.headers.has("cookie"), false);
      assert.equal(request.headers.has("x-slop-vetting-signature"), false);
      return fetch(`${target}${new URL(request.url).pathname}`, {
        method: request.method,
        headers: { "content-type": "application/json" },
        ...(request.method === "POST"
          ? { body: await request.arrayBuffer() }
          : {}),
      });
    },
  },
};
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: async (request) =>
    (await handleVettingApi(request, dependencies)) ??
    new Response("Not found", { status: 404 }),
});
const endpoint = `${server.url.origin}/api/v1/vetting/sandbox`;

try {
  const result = await qualifySandbox({
    connection: { origin: server.url.origin, ...keys },
    afterUnsigned: () => assert.equal(forwarded, 0),
    send: async (body, signed = true) =>
      fetch(endpoint, {
        method: "POST",
        body: new Uint8Array(body),
        headers: {
          "content-type": "application/json",
          ...(signed
            ? await signedServiceHeaders({
                signer: keys,
                method: "POST",
                pathAndQuery: "/api/v1/vetting/sandbox",
                body,
              })
            : {}),
        },
      }),
  });
  console.log(JSON.stringify(result));
} finally {
  await server.stop(true);
  database.sqlite.close();
}
