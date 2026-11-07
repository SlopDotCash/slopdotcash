import { expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { assertProjectPolicyTransition } from "../../src/lib/project-policy.mjs";
import { rewardFields } from "../../src/lib/project-proposal";
import { assertProjectDefinition } from "../../src/lib/project-schema.mjs";
import { applicationManifest } from "../../tests/project-application-manifest";
import { handleRepositoryRead } from "../../workers/slopbot/repository-access";
import type { EdgeCache } from "../projects/edge-cache";
import { slopbotGithubFetch } from "../projects/repository-access";
import { readVettingPin } from "./live-pin";

const FORMER_PATH = "example/open-registry";
const CURRENT_PATH = "renamed-org/open-registry-current";
const FORMER_HEAD = "b".repeat(40);
const CURRENT_HEAD = "a".repeat(40);
const TEMPLATE_SHA256 = "d".repeat(64);

const SLOPBOT_ENV = {
  SLOPBOT_APP_ID: "1",
  SLOPBOT_APP_PRIVATE_KEY: generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ format: "pem", type: "pkcs8" })
    .toString(),
};

function renamedManifest() {
  const raw = applicationManifest(
    "open-registry",
    FORMER_PATH,
    rewardFields(
      {
        mode: "none",
        network: "base",
        assetKind: "stablecoin",
        tokenAddress: "",
        tokenSymbol: "",
        monthlyAmount: "",
      },
      new Date("2026-10-18T00:00:00.000Z"),
    ),
  );
  delete raw.rewardAsset;
  const initial = assertProjectDefinition(raw);
  const [repository] = initial.repositories;
  const renamed = assertProjectDefinition({
    ...initial,
    repositories: [
      {
        ...repository,
        aliases: [CURRENT_PATH],
        displayName: CURRENT_PATH,
        githubUrl: `https://github.com/${CURRENT_PATH}`,
      },
    ],
  });
  assertProjectPolicyTransition(initial, renamed);
  return renamed;
}

function memoryEdgeCache() {
  const entries = new Map<string, Response>();
  const keys: string[] = [];
  const store: EdgeCache = {
    async match(request) {
      const url = typeof request === "string" ? request : request.url;
      keys.push(url);
      return entries.get(url)?.clone();
    },
    async put(request, response) {
      const url = typeof request === "string" ? request : request.url;
      entries.set(url, response.clone());
    },
    async delete(request) {
      const url = typeof request === "string" ? request : request.url;
      return entries.delete(url);
    },
  };
  return { store, keys, entries };
}

test("readVettingPin reads a renamed repository's integration branch through its Slopbot installation without falling back to anonymous reads", async () => {
  const manifest = renamedManifest();
  const githubCalls: string[] = [];
  const githubApi = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    githubCalls.push(url.pathname);
    // GitHub answers the former path with a 301 redirect, which Slopbot refuses (`redirect: "manual"`).
    if (url.pathname.startsWith(`/repos/${FORMER_PATH}`))
      return new Response(null, {
        status: 301,
        headers: {
          location: `https://api.github.com/repositories/123456789${url.pathname.slice(`/repos/${FORMER_PATH}`.length)}`,
        },
      });
    if (url.pathname === `/repos/${CURRENT_PATH}/installation`)
      return Response.json({ id: 42, suspended_at: null });
    if (url.pathname === "/app/installations/42/access_tokens")
      return Response.json({ token: "ghs_installation_token_fixture" });
    if (url.pathname === `/repos/${CURRENT_PATH}`)
      return Response.json({
        id: 123456789,
        node_id: "R_example",
        full_name: CURRENT_PATH,
        private: false,
      });
    if (url.pathname === `/repos/${CURRENT_PATH}/branches/main`)
      return Response.json({ name: "main", commit: { sha: CURRENT_HEAD } });
    throw new Error(`Unexpected GitHub API path ${url.pathname}`);
  }) as typeof fetch;

  const githubFetch = slopbotGithubFetch(
    {
      fetch: (request) => handleRepositoryRead(request, SLOPBOT_ENV, githubApi),
    },
    "https://api.github.com",
    async () => {
      throw new Error("The installed repository must not use anonymous reads");
    },
  );

  const pin = await readVettingPin(
    { fetch: githubFetch, apiOrigin: "https://api.github.com" },
    manifest,
    TEMPLATE_SHA256,
  );
  expect(pin).toEqual({
    commitSha: CURRENT_HEAD,
    templateSha256: TEMPLATE_SHA256,
  });
  expect(
    githubCalls.some((path) => path.startsWith(`/repos/${FORMER_PATH}`)),
  ).toBe(false);
  expect(githubCalls).toContain(`/repos/${CURRENT_PATH}/branches/main`);
});

test("readVettingPin pins and caches the current GitHub path even when the former path is recreated on GitHub", async () => {
  const manifest = renamedManifest();
  const cache = memoryEdgeCache();
  const requestedPaths: string[] = [];

  const pin = await readVettingPin(
    {
      apiOrigin: "https://api.github.com",
      cache: { store: cache.store, origin: "https://slop.cash" },
      fetch: async (url) => {
        const { pathname } = new URL(url);
        requestedPaths.push(pathname);
        if (pathname === `/repos/${FORMER_PATH}/branches/main`)
          return Response.json({ name: "main", commit: { sha: FORMER_HEAD } });
        if (pathname === `/repos/${CURRENT_PATH}/branches/main`)
          return Response.json({ name: "main", commit: { sha: CURRENT_HEAD } });
        return new Response(null, { status: 404 });
      },
    },
    manifest,
    TEMPLATE_SHA256,
  );

  expect(pin).toEqual({
    commitSha: CURRENT_HEAD,
    templateSha256: TEMPLATE_SHA256,
  });
  expect(requestedPaths).toEqual([`/repos/${CURRENT_PATH}/branches/main`]);
  expect([...cache.entries.keys()]).toEqual([
    `https://slop.cash/__slop-cache/branch-head-v1/${CURRENT_PATH}/main`,
  ]);
});

test("readVettingPin reuses a valid cached head for the current path and rejects invalid template digests", async () => {
  const manifest = renamedManifest();
  const cache = memoryEdgeCache();
  let networkReads = 0;
  const github = {
    apiOrigin: "https://api.github.com",
    cache: { store: cache.store, origin: "https://slop.cash" },
    fetch: async (url: string) => {
      networkReads += 1;
      if (new URL(url).pathname === `/repos/${CURRENT_PATH}/branches/main`)
        return Response.json({ name: "main", commit: { sha: CURRENT_HEAD } });
      return new Response(null, { status: 404 });
    },
  };

  expect(await readVettingPin(github, manifest, TEMPLATE_SHA256)).toEqual({
    commitSha: CURRENT_HEAD,
    templateSha256: TEMPLATE_SHA256,
  });
  expect(await readVettingPin(github, manifest, TEMPLATE_SHA256)).toEqual({
    commitSha: CURRENT_HEAD,
    templateSha256: TEMPLATE_SHA256,
  });
  expect(networkReads).toBe(1);

  await expect(
    readVettingPin(github, manifest, "not-a-sha256"),
  ).rejects.toThrow("The skill template digest is not a SHA-256.");
});
