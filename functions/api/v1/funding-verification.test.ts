import { afterEach, describe, expect, it, vi } from "vitest";
import type { TracePersistence } from "../../../backend/trace/contracts";
import { readFundingVerification } from "../../../backend/trace/funding-verification";
import {
  handleTraceApi,
  type TraceApiDependencies,
} from "../../../backend/trace/handler";
import { findProject } from "../../../src/lib/projects.mjs";
import { SOLANA_MAINNET_USDC_MINT } from "../../../src/lib/settlement-plan";
import {
  deriveVaultUsdcTokenAccount,
  SPL_TOKEN_PROGRAM_ID,
  SQUADS_V4_PROGRAM_ID,
} from "../../../src/lib/squads-funding";

vi.mock("../../../src/lib/projects.mjs", async (original) => {
  const actual =
    await original<typeof import("../../../src/lib/projects.mjs")>();
  return { ...actual, findProject: vi.fn(actual.findProject) };
});

// Published SDK-compatible pair; derivation is cluster-independent.
const MULTISIG = "xmWqhNJwNL4z4BcDo1Yh7BbStLU7omVafZNmg91y2Vg";
const VAULT = "FTK6ckiPWbe1jAiRtcPCz9sCrvCV6Y6hAJhAU5b9S3nv";
const FUNDER = "Stake11111111111111111111111111111111111111";
const RECIPIENT = "SysvarRent111111111111111111111111111111111";
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function publicKeyBytes(value: string): Uint8Array {
  const bytes: number[] = [0];
  for (const character of value) {
    let carry = BASE58.indexOf(character);
    for (let index = 0; index < bytes.length; index += 1) {
      carry += bytes[index] * 58;
      bytes[index] = carry & 255;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 255);
      carry >>= 8;
    }
  }
  let zeroes = 0;
  while (value[zeroes] === "1") zeroes += 1;
  return Uint8Array.from([...new Array(zeroes).fill(0), ...bytes.reverse()]);
}

function multisigAccount(overrides: Record<string, unknown> = {}) {
  const bytes = new Uint8Array(198);
  bytes.set([224, 116, 121, 186, 68, 161, 79, 236]);
  new DataView(bytes.buffer).setUint16(72, 2, true);
  new DataView(bytes.buffer).setUint32(128, 2, true);
  bytes.set(publicKeyBytes(FUNDER), 132);
  bytes[164] = 7;
  bytes.set(publicKeyBytes(RECIPIENT), 165);
  bytes[197] = 7;
  return {
    executable: false,
    owner: SQUADS_V4_PROGRAM_ID,
    data: [btoa(String.fromCharCode(...bytes)), "base64"],
    ...overrides,
  };
}

function tokenAccount(balance: string, owner = VAULT) {
  return {
    owner: SPL_TOKEN_PROGRAM_ID,
    data: {
      program: "spl-token",
      parsed: {
        type: "account",
        info: {
          mint: SOLANA_MAINNET_USDC_MINT,
          owner,
          tokenAmount: { amount: balance, decimals: 6 },
        },
      },
    },
  };
}

function accountsResult(
  balance: string,
  slot = 500,
  multisig = multisigAccount(),
) {
  return { context: { slot }, value: [multisig, tokenAccount(balance)] };
}

const instrument = {
  kind: "squads-v4-vault" as const,
  network: "solana" as const,
  asset: "USDC" as const,
  multisig: MULTISIG,
  vault: VAULT,
  vaultIndex: 0,
  funderActorId: "123",
  funderMember: FUNDER,
  stewardMember: RECIPIENT,
  monthlyCommitment: {
    cycleId: "2026-08",
    amountMinor: "5000000",
    accessibility: "unknown" as const,
  },
  effectiveAt: "2026-08-01T00:00:00.000Z",
  deadline: "2026-09-01T00:00:00.000Z",
  replacedAt: null,
};
const canonical = findProject("eliza");
if (!canonical) throw new Error("Missing canonical fixture project");
const project = {
  ...canonical,
  funding: { ...canonical.funding, commitments: [instrument] },
};
const deps: TraceApiDependencies = {
  persistence: new Proxy({} as TracePersistence, {
    get(_target, key) {
      if (key === "consumeVerificationAdmission")
        return async () => ({ allowed: true, retryAfterSeconds: 60 });
      throw new Error("Persistence must not be accessed");
    },
  }),
  authSecret: "A".repeat(43),
  operatorGithubIds: new Set(),
  now: () => new Date("2026-09-10T00:00:00.000Z"),
  randomId: () => "funding-test-session-000001",
  verifyIdentityAssertion: async () => null,
  privateIntakeStatus: async () => ({ status: "unavailable" }),
};
const route = "/api/v1/projects/eliza/funding/2026-08";
function request(path = route, init: RequestInit = {}) {
  return handleTraceApi(
    new Request(`https://api.slop.cash${path}`, {
      ...init,
      headers: {
        "cf-connecting-ip": "192.0.2.1",
        ...Object.fromEntries(new Headers(init.headers)),
      },
    }),
    deps,
  );
}
function reviewed() {
  vi.mocked(findProject).mockReturnValue(project);
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.mocked(findProject).mockReset();
});

describe("public canonical funding verification", () => {
  it("preserves trusted CORS and retry diagnostics when admission is exhausted", async () => {
    reviewed();
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const response = await handleTraceApi(
      new Request(`https://api.slop.cash${route}`, {
        headers: {
          origin: "https://slop.cash",
          "cf-connecting-ip": "192.0.2.1",
        },
      }),
      {
        ...deps,
        persistence: new Proxy(deps.persistence, {
          get(target, key) {
            if (key === "consumeVerificationAdmission")
              return async () => ({ allowed: false, retryAfterSeconds: 17 });
            return Reflect.get(target, key);
          },
        }),
      },
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("17");
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://slop.cash",
    );
    expect(upstream).not.toHaveBeenCalled();
  });
  it("never calls RPC without successful admission", async () => {
    reviewed();
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const raw = new Request(`https://api.slop.cash${route}`);
    expect(
      (await readFundingVerification(raw, "eliza", "2026-08")).status,
    ).toBe(503);
    expect(
      (
        await readFundingVerification(
          raw,
          "eliza",
          "2026-08",
          async () => new Response(null, { status: 429 }),
        )
      ).status,
    ).toBe(429);
    expect(upstream).not.toHaveBeenCalled();
  });
  it.each([
    "/api/v1/projects/other/funding/2026-08",
    "/api/v1/projects/eliza/funding/2026-07",
    "/api/v1/projects/eliza/funding/2026-13",
  ])("rejects wrong project/cycle %s", async (path) => {
    reviewed();
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    expect((await request(path)).status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });
  it("rejects absent or unreviewed instruments without network", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    for (const commitments of [
      [],
      [{ ...instrument, replacedAt: "2026-09-01T00:00:00.000Z" }],
      [
        {
          ...instrument,
          effectiveAt: "2026-07-01T00:00:00.000Z",
          deadline: "2026-08-01T00:00:00.000Z",
          monthlyCommitment: {
            ...instrument.monthlyCommitment,
            cycleId: "2026-07",
          },
        },
      ],
    ]) {
      vi.mocked(findProject).mockReturnValue({
        ...project,
        funding: { ...project.funding, commitments },
      });
      expect((await request()).status).toBe(404);
    }
    expect(upstream).not.toHaveBeenCalled();
  });
  it("returns 503 for malformed canonical instruments without network", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    vi.mocked(findProject).mockReturnValue({
      ...project,
      funding: {
        ...project.funding,
        commitments: [{ ...instrument, vault: "invalid" }],
      },
    });
    const response = await request();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: "funding_manifest_invalid",
    });
    expect(upstream).not.toHaveBeenCalled();
  });
  it("does not report a balance when all authorities disagree", async () => {
    reviewed();
    let balance = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: URL, init?: RequestInit) =>
        Response.json({
          jsonrpc: "2.0",
          id: JSON.parse(String(init?.body)).id,
          result: accountsResult(String(++balance)),
        }),
      ),
    );
    const response = await request();
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty("balanceMinor");
  });
  it.each(["0", "1000000"])(
    "keeps declared amount distinct from lower balance %s",
    async (balance) => {
      reviewed();
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: URL, init?: RequestInit) =>
          Response.json({
            jsonrpc: "2.0",
            id: JSON.parse(String(init?.body)).id,
            result: accountsResult(balance),
          }),
        ),
      );
      const response = await request();
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        balanceMinor: balance,
        declaredCommitmentMinor: "5000000",
        coversCommitment: false,
        accessibility: "unknown",
        paymentReady: false,
      });
    },
  );
  it("returns unknown and no balance when upstream quorum fails", async () => {
    reviewed();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("private upstream detail");
      }),
    );
    const response = await request(route, {
      headers: { origin: "https://slop.cash" },
    });
    expect(response.status).toBe(503);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://slop.cash",
    );
    expect(await response.json()).toEqual({
      error: "funding_verification_unavailable",
      message: "Finalized vault state could not be verified by RPC quorum",
      accessibility: "unknown",
      paymentReady: false,
    });
  });
  it("uses finalized fixed-authority quorum and canonical identity with the existing Squads fixture", async () => {
    reviewed();
    const tokenAccount = await deriveVaultUsdcTokenAccount(VAULT);
    const upstream = vi.fn(async (url: URL, init?: RequestInit) => {
      expect([
        "api.mainnet-beta.solana.com",
        "solana-rpc.publicnode.com",
        "solana.drpc.org",
      ]).toContain(url.hostname);
      const body = JSON.parse(String(init?.body));
      expect(body.method).toBe("getMultipleAccounts");
      expect(body.params).toEqual([
        [MULTISIG, tokenAccount],
        { commitment: "finalized", encoding: "jsonParsed" },
      ]);
      expect(init?.redirect).toBe("error");
      expect(init?.signal).toBeDefined();
      return Response.json({
        jsonrpc: "2.0",
        id: body.id,
        result: accountsResult("7000000"),
      });
    });
    vi.stubGlobal("fetch", upstream);
    const response = await request();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      schemaVersion: 1,
      projectId: "eliza",
      cycleId: "2026-08",
      state: "verified-on-chain",
      instrument: {
        ...instrument,
        tokenAccount,
        mint: SOLANA_MAINNET_USDC_MINT,
      },
      balanceMinor: "7000000",
      declaredCommitmentMinor: "5000000",
      coversCommitment: true,
      observedAt: expect.any(String),
      finality: "finalized",
      slot: 500,
      accessibility: "unknown",
      paymentReady: false,
    });
    expect(upstream).toHaveBeenCalledTimes(3);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("rejects caller-controlled parameters before network access", async () => {
    reviewed();
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    expect((await request(`${route}?rpc=https://evil.example`)).status).toBe(
      400,
    );
    expect(upstream).not.toHaveBeenCalled();
  });
});

describe("narrow browser CORS", () => {
  it("routes reviewed execution reads with trusted CORS and no persistence", async () => {
    const response = await request(
      "/api/v1/projects/eliza/executions/2026-07",
      { headers: { origin: "https://slop.cash" } },
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://slop.cash",
    );
    expect(await response.json()).toEqual({
      error: "execution_binding_not_found",
    });
  });
  it("returns a bearer session to the trusted browser without credentials CORS", async () => {
    const response = await handleTraceApi(
      new Request("https://api.slop.cash/api/v1/auth/session", {
        method: "POST",
        headers: {
          origin: "https://slop.cash",
          "x-slop-identity-assertion": "x".repeat(40),
        },
      }),
      {
        ...deps,
        verifyIdentityAssertion: async () => ({
          githubId: "42",
          githubLogin: "contributor",
        }),
      },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://slop.cash",
    );
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
    expect(await response.json()).toMatchObject({
      token: expect.any(String),
      tokenType: "Bearer",
    });
  });
  it.each(["https://slop.cash", "https://slop.tech", "https://eliza.army"])(
    "allows named origin %s with route-specific headers",
    async (origin) => {
      for (const [path, method, headers] of [
        ["/api/v1/auth/session", "POST", "X-Slop-Identity-Assertion"],
        ["/api/v1/wallet-claims", "POST", "Authorization, Content-Type"],
        ["/api/v1/wallet-claims/current", "GET", "Authorization"],
        [route, "GET", ""],
        ["/api/v1/projects/eliza/executions/2026-07", "GET", ""],
      ]) {
        const response = await request(path, {
          method: "OPTIONS",
          headers: {
            origin,
            "access-control-request-method": method,
            "access-control-request-headers": headers,
          },
        });
        expect(response.status).toBe(204);
        expect(response.headers.get("access-control-allow-origin")).toBe(
          origin,
        );
        expect(
          response.headers.get("access-control-allow-credentials"),
        ).toBeNull();
        expect(response.headers.get("access-control-allow-methods")).toBe(
          method,
        );
      }
    },
  );
  it.each([
    "https://evil.example",
    "https://slop.cash.evil.example",
    "null",
    "http://slop.cash",
  ])("rejects origin %s", async (origin) => {
    for (const method of ["OPTIONS", "POST"]) {
      const response = await request("/api/v1/auth/session", {
        method,
        headers: { origin, "access-control-request-method": "POST" },
      });
      expect(response.status).toBe(403);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
    }
  });
  it("does not allow trace routes, arbitrary headers, or methods", async () => {
    for (const [path, method, headers] of [
      ["/api/v1/runs", "POST", "authorization"],
      [route, "DELETE", ""],
      ["/api/v1/auth/session", "POST", "authorization"],
      ["/api/v1/wallet-claims", "POST", "x-extra"],
    ]) {
      const response = await request(path, {
        method: "OPTIONS",
        headers: {
          origin: "https://slop.cash",
          "access-control-request-method": method,
          "access-control-request-headers": headers,
        },
      });
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
    }
  });
  it("includes CORS on session and wallet authentication errors", async () => {
    for (const [path, method] of [
      ["/api/v1/auth/session", "POST"],
      ["/api/v1/wallet-claims", "POST"],
      ["/api/v1/wallet-claims/current", "GET"],
    ]) {
      const response = await request(path, {
        method,
        headers: { origin: "https://eliza.army" },
      });
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.headers.get("access-control-allow-origin")).toBe(
        "https://eliza.army",
      );
    }
  });
});
