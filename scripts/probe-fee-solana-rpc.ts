/** Ephemeral, unbound Cloudflare preview. Its fixed Solana calls only read state. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inspectFeeWorkerBindings } from "./inspect-fee-worker-bindings";

const previewName = "slop-fee-rpc-read-probe";
const recovery = "https://public.rpc.solanavibestation.com";
const mint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const genesis = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
type ProbeOperation =
  | "candidate"
  | "subdomain-read"
  | "session-create"
  | "session-exchange"
  | "preview-upload"
  | "preview-invoke";
export class ProbeFailure extends Error {
  constructor(
    readonly operation: ProbeOperation,
    readonly httpStatus: number | null = null,
    readonly cloudflareCode: number | null = null,
  ) {
    super("Solana RPC preview refused");
  }
}
export function safeProbeFailure(error: unknown) {
  return error instanceof ProbeFailure
    ? {
        operation: error.operation,
        httpStatus: error.httpStatus,
        cloudflareCode: error.cloudflareCode,
      }
    : { operation: "unknown", httpStatus: null, cloudflareCode: null };
}

export function requireSolanaProbeCandidate(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".helius-rpc.com") ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== "443")
  )
    throw Error("Expected the existing private Helius RPC candidate");
  return url.href;
}

/** Contains no credentials, account data, signing code or persistent bindings. */
export const solanaProbeWorker = `
const mint = ${JSON.stringify(mint)};
const genesis = ${JSON.stringify(genesis)};
const recovery = ${JSON.stringify(recovery)};
export default {
  async fetch(request) {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/probe") return new Response(null, {status:404});
    const text = await request.text();
    if (text.length > 4096) return new Response(null, {status:400});
    let candidate;
    try {
      const input = JSON.parse(text); const url = new URL(input.candidate);
      if (Object.keys(input).join() !== "candidate" || url.protocol !== "https:" || !url.hostname.endsWith(".helius-rpc.com") || url.username || url.password || url.hash || (url.port && url.port !== "443")) throw Error();
      candidate = url.href;
    } catch { return new Response(null, {status:400}); }
    const rows = [];
    for (const [provider, endpoint] of [["candidate",candidate],["recovery",recovery]]) {
      const row = {provider, reads:[]};
      async function rpc(method, params) {
        try {
          const response = await fetch(endpoint, {method:"POST",redirect:"error",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params}),signal:AbortSignal.timeout(15000)});
          const body = await response.json().catch(() => null);
          const ok = response.ok && body?.jsonrpc === "2.0" && body.id === 1 && !body.error && body.result !== undefined;
          row.reads.push({method,ok,httpStatus:response.status,rpcCode:Number.isSafeInteger(body?.error?.code)?body.error.code:null});
          return ok ? body.result : undefined;
        } catch { row.reads.push({method,ok:false,httpStatus:null,rpcCode:null}); }
      }
      const chain = await rpc("getGenesisHash", []);
      const slot = await rpc("getSlot", [{commitment:"finalized"}]);
      const block = Number.isSafeInteger(slot) && slot > 0 ? await rpc("getBlock", [slot,{commitment:"finalized",transactionDetails:"none",rewards:false,maxSupportedTransactionVersion:0}]) : undefined;
      const account = await rpc("getAccountInfo", [mint,{commitment:"finalized",encoding:"base64"}]);
      const first = await rpc("getFirstAvailableBlock", []);
      row.mainnet = chain === genesis;
      row.finalizedSlot = Number.isSafeInteger(slot) ? slot : null;
      row.finalizedBlock = typeof block?.blockhash === "string" && typeof block?.previousBlockhash === "string";
      row.mintVerified = account?.value?.owner === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" && account.value.executable === false && Array.isArray(account.value.data) && account.value.data[1] === "base64" && atob(account.value.data[0]).length === 82;
      row.firstAvailableSlot = Number.isSafeInteger(first) && first >= 0 ? first : null;
      rows.push(row);
    }
    return Response.json({schemaVersion:1,rows});
  }
};
`;

const methods = new Set([
  "getGenesisHash",
  "getSlot",
  "getBlock",
  "getAccountInfo",
  "getFirstAvailableBlock",
]);
interface ProbeRead {
  method: string;
  ok: boolean;
  httpStatus: number | null;
  rpcCode: number | null;
}
interface ProbeRow {
  provider: "candidate" | "recovery";
  mainnet: boolean;
  finalizedSlot: number | null;
  finalizedBlock: boolean;
  mintVerified: boolean;
  firstAvailableSlot: number | null;
  reads: ProbeRead[];
}
export function safeSolanaProbeResult(value: any): {
  schemaVersion: 1;
  rows: ProbeRow[];
} {
  if (
    value?.schemaVersion !== 1 ||
    !Array.isArray(value.rows) ||
    value.rows.length !== 2
  )
    throw Error("Invalid RPC probe response");
  return {
    schemaVersion: 1,
    rows: value.rows.map((row: any, index: number) => {
      if (
        row.provider !== ["candidate", "recovery"][index] ||
        !Array.isArray(row.reads) ||
        row.reads.length < 4 ||
        row.reads.length > 5
      )
        throw Error("Invalid RPC probe provider");
      return {
        provider: row.provider,
        mainnet: row.mainnet === true,
        finalizedSlot:
          Number.isSafeInteger(row.finalizedSlot) && row.finalizedSlot >= 0
            ? row.finalizedSlot
            : null,
        finalizedBlock: row.finalizedBlock === true,
        mintVerified: row.mintVerified === true,
        firstAvailableSlot:
          Number.isSafeInteger(row.firstAvailableSlot) &&
          row.firstAvailableSlot >= 0
            ? row.firstAvailableSlot
            : null,
        reads: row.reads.map((read: any) => {
          if (!methods.has(read.method))
            throw Error("Unexpected RPC probe method");
          return {
            method: read.method,
            ok: read.ok === true,
            httpStatus:
              Number.isSafeInteger(read.httpStatus) &&
              read.httpStatus >= 100 &&
              read.httpStatus <= 599
                ? read.httpStatus
                : null,
            rpcCode: Number.isSafeInteger(read.rpcCode) ? read.rpcCode : null,
          };
        }),
      };
    }),
  };
}

export async function probeFeeSolanaRpc(input: {
  account: string;
  token: string;
  candidate: string;
  request?: typeof fetch;
}) {
  if (!/^[a-f0-9]{32}$/.test(input.account) || !input.token)
    throw Error("Missing preview credentials");
  let candidate: string;
  try {
    candidate = requireSolanaProbeCandidate(input.candidate);
  } catch {
    throw new ProbeFailure("candidate");
  }
  const request = input.request ?? fetch;
  const base = `https://api.cloudflare.com/client/v4/accounts/${input.account}`;
  const headers = { authorization: `Bearer ${input.token}` };
  async function api(
    path: string,
    operation: ProbeOperation,
    init: RequestInit = {},
  ) {
    let response: Response;
    try {
      response = await request(base + path, {
        ...init,
        headers: { ...headers, ...init.headers },
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new ProbeFailure(operation);
    }
    const body = (await response.json().catch(() => null)) as any;
    if (!response.ok || body?.success !== true) {
      const code = body?.errors?.[0]?.code;
      throw new ProbeFailure(
        operation,
        response.status,
        Number.isSafeInteger(code) ? code : null,
      );
    }
    return body.result;
  }
  const subdomain = (await api("/workers/subdomain", "subdomain-read"))
    ?.subdomain;
  if (typeof subdomain !== "string" || !/^[a-z0-9-]+$/.test(subdomain))
    throw new ProbeFailure("subdomain-read");
  const session = await api(
    `/workers/scripts/${previewName}/subdomain/edge-preview`,
    "session-create",
  );
  let token = session?.token;
  let previewHost = `${previewName}.${subdomain}.workers.dev`;
  if (session?.exchange_url) {
    const exchange = new URL(session.exchange_url);
    if (
      exchange.protocol !== "https:" ||
      !(
        exchange.hostname.endsWith(".workers.dev") ||
        exchange.hostname.endsWith(".cloudflareworkers.com")
      ) ||
      exchange.username ||
      exchange.password
    )
      throw new ProbeFailure("session-exchange");
    const suffix = exchange.hostname.slice(exchange.hostname.indexOf("."));
    previewHost = previewName + suffix;
    // Wrangler permits the original session token when token re-encoding is unavailable.
    try {
      const response = await request(exchange.href, {
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
      const body = response.ok
        ? ((await response.json().catch(() => null)) as any)
        : null;
      if (typeof body?.token === "string" && body.token) token = body.token;
    } catch {
      /* Retain the original authenticated session token. */
    }
  }
  if (typeof token !== "string" || !token)
    throw new ProbeFailure("session-create");
  const form = new FormData();
  form.set(
    "metadata",
    JSON.stringify({
      main_module: "probe.js",
      bindings: [],
      compatibility_date: "2026-10-01",
    }),
  );
  form.set(
    "probe.js",
    new File([solanaProbeWorker], "probe.js", {
      type: "application/javascript+module",
    }),
  );
  form.set(
    "wrangler-session-config",
    JSON.stringify({ workers_dev: true, minimal_mode: true }),
  );
  const preview = await api(
    `/workers/scripts/${previewName}/edge-preview`,
    "preview-upload",
    {
      method: "POST",
      headers: { "cf-preview-upload-config-token": token },
      body: form,
    },
  );
  if (typeof preview?.preview_token !== "string" || !preview.preview_token)
    throw new ProbeFailure("preview-upload");
  let response: Response;
  try {
    response = await request(`https://${previewHost}/probe`, {
      method: "POST",
      redirect: "error",
      headers: {
        "content-type": "application/json",
        "cf-workers-preview-token": preview.preview_token,
      },
      body: JSON.stringify({ candidate }),
      signal: AbortSignal.timeout(180000),
    });
  } catch {
    throw new ProbeFailure("preview-invoke");
  }
  if (!response.ok) throw new ProbeFailure("preview-invoke", response.status);
  return {
    ...safeSolanaProbeResult(await response.json()),
    workerSha256: createHash("sha256").update(solanaProbeWorker).digest("hex"),
    previewOnly: true,
    persistentBindings: 0,
  };
}

if (import.meta.main) {
  let stage = "trusted-context";
  try {
    if (
      process.env.GITHUB_REF !== "refs/heads/main" ||
      !process.env.RUNNER_TEMP
    )
      throw Error("Main diagnostic runner required");
    const config = Bun.TOML.parse(
      readFileSync("workers/fee-converter/wrangler.toml", "utf8"),
    ) as { vars: Record<string, string> };
    const expected = Object.fromEntries(
      Object.entries(config.vars).filter(([name]) =>
        /^(FEE_CONVERTER_|FEE_WALLET_|BUYBACK_)/.test(name),
      ),
    );
    const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
      token = process.env.CLOUDFLARE_API_TOKEN ?? "",
      head = process.env.GITHUB_SHA ?? "";
    stage = "active-version-before";
    const before = await inspectFeeWorkerBindings(
      account,
      token,
      expected,
      head,
    );
    stage = "remote-read-probe";
    const result = await probeFeeSolanaRpc({
      account,
      token,
      candidate: process.env.SLOP_SOLANA_RPC_CANDIDATE ?? "",
    });
    stage = "active-version-after";
    const after = await inspectFeeWorkerBindings(
      account,
      token,
      expected,
      head,
    );
    if (
      before.versionId !== after.versionId ||
      before.deploymentId !== after.deploymentId ||
      before.sourceCommit !== after.sourceCommit
    )
      throw Error("Active fee version changed");
    const output = {
      ...result,
      checkedAt: new Date().toISOString(),
      feeVersionId: before.versionId,
      feeSourceCommit: before.sourceCommit,
      checkedSource: head,
      qualification: "bounded-readiness-only",
    };
    writeFileSync(
      join(process.env.RUNNER_TEMP, "fee-solana-rpc-probe.json"),
      `${JSON.stringify(output, null, 2)}\n`,
      { mode: 0o600 },
    );
    console.log(JSON.stringify(output));
  } catch (error) {
    console.error(
      JSON.stringify({
        error: "fee_solana_rpc_probe_refused",
        stage,
        ...safeProbeFailure(error),
      }),
    );
    process.exitCode = 1;
  }
}
