import { afterEach, expect, test } from "bun:test";
import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import {
  githubAppJwt,
  installGitHubAppTokenRefresh,
} from "./github-app-token-refresh";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const original = globalThis.fetch;
const HOUR = 60 * 60_000;

afterEach(() => {
  globalThis.fetch = original;
});

function environment() {
  return {
    COLLECTOR_APP_CLIENT_ID: "Iv23client",
    COLLECTOR_APP_PRIVATE_KEY: privateKey,
    COLLECTOR_APP_INSTALLATION_ID: "183393690",
    COLLECTOR_APP_REPOSITORY: "slopdotcash",
    GITHUB_TOKEN: "ghs_initial",
  };
}

function fakeGitHub(options: { failMint?: () => boolean } = {}) {
  const seen: { url: string; authorization: string | null }[] = [];
  let minted = 0;
  globalThis.fetch = (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    const request = input instanceof Request ? input : null;
    const url = request?.url ?? String(input);
    const headers = new Headers(init?.headers ?? request?.headers);
    if (url.endsWith("/app/installations/183393690/access_tokens")) {
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        repositories: ["slopdotcash"],
        permissions: {
          contents: "read",
          issues: "read",
          pull_requests: "read",
        },
      });
      const jwt = headers.get("authorization")?.replace(/^Bearer /u, "") ?? "";
      const [header, payload, signature] = jwt.split(".");
      expect(
        verify(
          "RSA-SHA256",
          Buffer.from(`${header}.${payload}`),
          createPublicKey(publicKey),
          Buffer.from(signature, "base64url"),
        ),
      ).toBe(true);
      if (options.failMint?.()) return new Response("{}", { status: 502 });
      minted += 1;
      return Response.json(
        {
          token: `ghs_fresh_${minted}`,
          expires_at: new Date(clock + HOUR).toISOString(),
        },
        { status: 201 },
      );
    }
    seen.push({ url, authorization: headers.get("authorization") });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  return { seen, minted: () => minted };
}

let clock = Date.parse("2026-11-18T18:30:00Z");
const now = () => clock;

test("without the App settings nothing is installed", () => {
  const before = globalThis.fetch;
  expect(installGitHubAppTokenRefresh({ GITHUB_TOKEN: "ghs_x" }, now)).toBe(
    null,
  );
  expect(globalThis.fetch).toBe(before);
});

test("the original token is replaced and renewed before it expires", async () => {
  const github = fakeGitHub();
  installGitHubAppTokenRefresh(environment(), now);
  await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: "Bearer ghs_initial" },
  });
  await fetch(
    new Request("https://api.github.com/repos/a/b/pulls", {
      headers: { authorization: "Bearer ghs_initial" },
    }),
  );
  expect(github.minted()).toBe(1);
  clock += 49 * 60_000;
  await fetch("https://api.github.com/repos/a/b", {
    headers: { authorization: "Bearer ghs_initial" },
  });
  expect(github.minted()).toBe(1);
  clock += 2 * 60_000;
  await fetch("https://api.github.com/repos/a/b", {
    headers: { authorization: "Bearer ghs_initial" },
  });
  expect(github.minted()).toBe(2);
  expect(github.seen.map((request) => request.authorization)).toEqual([
    "Bearer ghs_fresh_1",
    "Bearer ghs_fresh_1",
    "Bearer ghs_fresh_1",
    "Bearer ghs_fresh_2",
  ]);
});

test("other hosts and other credentials pass through untouched", async () => {
  const github = fakeGitHub();
  installGitHubAppTokenRefresh(environment(), now);
  await fetch("https://slop.cash/data/points.json", {
    headers: { authorization: "Bearer ghs_initial" },
  });
  await fetch("https://api.github.com/repos/a/b", {
    headers: { authorization: "Bearer someone_else" },
  });
  await fetch("https://api.github.com/repos/a/b");
  expect(github.minted()).toBe(0);
  expect(github.seen.map((request) => request.authorization)).toEqual([
    "Bearer ghs_initial",
    "Bearer someone_else",
    null,
  ]);
});

test("a failed mint keeps the current token and retries a minute later", async () => {
  let fail = true;
  const github = fakeGitHub({ failMint: () => fail });
  installGitHubAppTokenRefresh(environment(), now);
  await fetch("https://api.github.com/repos/a/b", {
    headers: { authorization: "Bearer ghs_initial" },
  });
  fail = false;
  clock += 30_000;
  await fetch("https://api.github.com/repos/a/b", {
    headers: { authorization: "Bearer ghs_initial" },
  });
  clock += 31_000;
  await fetch("https://api.github.com/repos/a/b", {
    headers: { authorization: "Bearer ghs_initial" },
  });
  expect(github.seen.map((request) => request.authorization)).toEqual([
    "Bearer ghs_initial",
    "Bearer ghs_initial",
    "Bearer ghs_fresh_1",
  ]);
});

test("installing twice wraps fetch once", () => {
  fakeGitHub();
  expect(installGitHubAppTokenRefresh(environment(), now)).not.toBe(null);
  const wrapped = globalThis.fetch;
  expect(installGitHubAppTokenRefresh(environment(), now)).toBe(null);
  expect(globalThis.fetch).toBe(wrapped);
});

test("the App JWT names the client and lives under ten minutes", () => {
  const [, payload] = githubAppJwt("Iv23client", privateKey, clock).split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  expect(claims.iss).toBe("Iv23client");
  expect(claims.exp - claims.iat).toBeLessThanOrEqual(600);
  expect(claims.iat).toBeLessThan(Math.floor(clock / 1000));
});
