/** Exercise the actual Vite proxy and project persistence together (PRD §4). */
import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { CloudflareProjectPersistence } from "../backend/projects/cloudflare-persistence";
import {
  handleProjectApi,
  type ProjectApiDependencies,
} from "../backend/projects/handler";
import { applicationManifest } from "../tests/project-application-manifest";
import { sqliteD1 } from "../tests/sqlite-d1";
import base from "../vite.config";

test("local projects use local reads and writes while read-only public requests stay isolated", async () => {
  const previousBackend = process.env.SLOP_DEV_BACKEND;
  const { db, sqlite } = sqliteD1();
  const persistence = new CloudflareProjectPersistence(db);
  const scans: string[] = [];
  const localCalls: string[] = [];
  const publicCalls: string[] = [];
  const walletCalls: string[] = [];
  const snapshotPart = `/data/leaderboard/${"a".repeat(64)}.part`;
  const publicPaymentPaths = [
    "/api/v1/payments/projects/eliza/vault?chainId=8453",
    "/api/v1/payments/projects/eliza/direct-transfers?limit=5",
    "/api/v1/payments/actors/900000002/direct-transfers?limit=5",
    "/api/v1/payments/received?projectId=eliza",
  ];
  const publicWalletPath =
    "/api/v1/wallet-claims/actors/900000002/current?chainId=8453";
  const dependencies: ProjectApiDependencies = {
    persistence,
    adminGithubIds: new Set(),
    moderatorGithubIds: new Set(),
    now: () => new Date("2026-10-30T00:00:00.000Z"),
    randomId: () => crypto.randomUUID(),
    // Identity, GitHub and scan boundaries are protocol doubles. The API,
    // migrations, Vite middleware and HTTP proxy destinations are real.
    sessionActor: async (request) =>
      request.headers.get("cookie") === "fixture-session=owner"
        ? { githubId: "900000002", githubLogin: "fixture-owner" }
        : null,
    readTokenMetadata: async () => {
      throw new Error("Unexpected chain read");
    },
    github: {
      fetch: async () => {
        throw new Error("Unexpected GitHub read");
      },
    },
    vettingClearance: async () => ({ state: "unscanned" }),
    repositoryControl: async () => ({ state: "matched" }),
    repositoryAccess: async () => ({
      installation: "installed",
      installationId: 42,
      permission: "admin",
      roleName: "admin",
    }),
    requestScan: async (project) => {
      scans.push(project.id);
      return { state: "queued" };
    },
  };
  const backend = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      localCalls.push(`${request.method} ${new URL(request.url).pathname}`);
      return (
        (await handleProjectApi(request, dependencies)) ??
        new Response("Not found", { status: 404 })
      );
    },
  });
  const publicRead = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      expect(request.headers.has("cookie")).toBe(false);
      expect(request.headers.has("authorization")).toBe(false);
      const url = new URL(request.url);
      publicCalls.push(`${request.method} ${url.pathname}${url.search}`);
      if (url.pathname === snapshotPart)
        return new Response("retained snapshot part");
      return Response.json(
        { projects: [] },
        { headers: { "x-fixture-upstream": "public-site" } },
      );
    },
  });
  const publicWallet = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      expect(request.headers.has("cookie")).toBe(false);
      expect(request.headers.has("authorization")).toBe(false);
      const url = new URL(request.url);
      walletCalls.push(`${request.method} ${url.pathname}${url.search}`);
      return Response.json(
        { actorId: "900000002" },
        { headers: { "x-fixture-upstream": "public-api" } },
      );
    },
  });
  try {
    for (const readonly of [false, true]) {
      process.env.SLOP_DEV_BACKEND = readonly
        ? "off"
        : `http://127.0.0.1:${backend.port}`;
      const config = base({
        command: "serve",
        mode: "development",
        isPreview: false,
      });
      for (const proxy of Object.values(config.server?.proxy ?? {}))
        if (
          typeof proxy !== "string" &&
          String(proxy.target).startsWith("https:")
        )
          proxy.target = `http://127.0.0.1:${
            proxy.target === "https://api.slop.cash"
              ? publicWallet.port
              : publicRead.port
          }`;
      const vite = await createServer({
        ...config,
        root: fileURLToPath(new URL("../", import.meta.url)),
        configFile: false,
        logLevel: "silent",
        server: { ...config.server, host: "127.0.0.1", port: 0 },
      });
      try {
        await vite.listen();
        const address = vite.httpServer?.address();
        if (!address || typeof address === "string")
          throw new Error("Vite did not listen on TCP");
        const origin = `http://127.0.0.1:${address.port}`;
        const projectId = readonly ? "readonly-project" : "local-project";
        const create = (authenticated: boolean, suffix = "") =>
          fetch(`${origin}/api/v1/projects${suffix}`, {
            method: "POST",
            headers: {
              origin,
              "content-type": "application/json",
              ...(authenticated ? { cookie: "fixture-session=owner" } : {}),
            },
            body: JSON.stringify({
              manifest: applicationManifest(projectId, `example/${projectId}`),
            }),
          });
        expect((await create(false)).status).toBe(readonly ? 404 : 401);
        expect((await create(true, "?from=local-test")).status).toBe(
          readonly ? 404 : 201,
        );
        expect(await persistence.getProject(projectId)).toEqual(
          readonly ? null : expect.objectContaining({ id: projectId }),
        );
        for (const method of readonly ? ["GET", "HEAD"] : ["GET"]) {
          const read = await fetch(`${origin}/api/v1/projects`, {
            method,
            headers: {
              cookie: "fixture-session=owner",
              authorization: "Bearer synthetic-test-only",
            },
          });
          expect(read.status).toBe(200);
          if (!readonly) {
            const body = (await read.json()) as { projects: { id: string }[] };
            expect(body.projects.map((project) => project.id)).toContain(
              projectId,
            );
          }
        }
        const part = await fetch(`${origin}${snapshotPart}`, {
          headers: {
            cookie: "fixture-session=owner",
            authorization: "Bearer synthetic-test-only",
          },
        });
        expect(await part.text()).toBe("retained snapshot part");
        expect(
          (await fetch(`${origin}${snapshotPart}`, { method: "POST" })).status,
        ).toBe(404);
        for (const path of [...publicPaymentPaths, publicWalletPath]) {
          for (const method of ["GET", "HEAD"]) {
            const read = await fetch(`${origin}${path}`, {
              method,
              headers: {
                cookie: "fixture-session=owner",
                authorization: "Bearer synthetic-test-only",
              },
            });
            expect(read.status).toBe(200);
            expect(read.headers.get("x-fixture-upstream")).toBe(
              path === publicWalletPath ? "public-api" : "public-site",
            );
            await read.text();
          }
          expect(
            (await fetch(`${origin}${path}`, { method: "POST" })).status,
          ).toBe(404);
        }
      } finally {
        await vite.close();
      }
    }
    expect(localCalls).toEqual([
      "POST /api/v1/projects",
      "POST /api/v1/projects",
      "GET /api/v1/projects",
    ]);
    expect(scans).toEqual(["local-project"]);
    const paymentReads = publicPaymentPaths.flatMap((path) => [
      `GET ${path}`,
      `HEAD ${path}`,
    ]);
    expect(publicCalls).toEqual([
      `GET ${snapshotPart}`,
      ...paymentReads,
      "GET /api/v1/projects",
      "HEAD /api/v1/projects",
      `GET ${snapshotPart}`,
      ...paymentReads,
    ]);
    expect(walletCalls).toEqual([
      `GET ${publicWalletPath}`,
      `HEAD ${publicWalletPath}`,
      `GET ${publicWalletPath}`,
      `HEAD ${publicWalletPath}`,
    ]);
  } finally {
    if (previousBackend === undefined) delete process.env.SLOP_DEV_BACKEND;
    else process.env.SLOP_DEV_BACKEND = previousBackend;
    backend.stop(true);
    publicRead.stop(true);
    publicWallet.stop(true);
    sqlite.close();
  }
});
