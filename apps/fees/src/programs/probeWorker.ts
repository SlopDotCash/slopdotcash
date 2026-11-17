// spec/fees/buybackRpc.md, "Operator qualification checks the expected Worker and an independent finalized block"
import { circleUsdc, solanaGenesis } from "../runtime/pins.ts";

export const solanaProbeRecovery = "https://public.rpc.solanavibestation.com";

export const solanaProbeWorker = `
const mint = ${JSON.stringify(circleUsdc.solana)};
const genesis = ${JSON.stringify(solanaGenesis)};
const recovery = ${JSON.stringify(solanaProbeRecovery)};
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
        let httpStatus = null;
        try {
          const response = await fetch(endpoint, {method:"POST",redirect:"manual",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params}),signal:AbortSignal.timeout(15000)});
          httpStatus = response.status;
          const body = await response.json().catch(() => null);
          const ok = response.ok && body?.jsonrpc === "2.0" && body.id === 1 && !body.error && body.result !== undefined;
          row.reads.push({method,ok,httpStatus,rpcCode:Number.isSafeInteger(body?.error?.code)?body.error.code:null,errorCategory:ok?null:(!body?"invalid-json":(response.status>=300&&response.status<400?"redirect":"rpc-refused"))});
          return ok ? body.result : undefined;
        } catch (error) {
          const category = ["TypeError","SyntaxError","AbortError","TimeoutError"].includes(error?.name) ? error.name : "request-error";
          row.reads.push({method,ok:false,httpStatus,rpcCode:null,errorCategory:category});
        }
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

/** @throws {never} */
export function solanaProbeModule(): File {
  return new File([solanaProbeWorker], "probe.js", { type: "application/javascript+module" });
}
