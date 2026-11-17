// spec/fees/conversion.md, "Story: Sign only a reserved, inspected, same-wallet send"
import { Option, Schema } from "effect";
import { Response, fetch } from "miniflare";

export type Commitment = "processed" | "confirmed" | "finalized";

export interface SignatureItem {
  readonly signature: string;
  readonly slot: number;
  readonly err?: unknown;
  readonly memo?: string | null;
  readonly blockTime?: number | null;
  readonly confirmationStatus?: Commitment;
}

export interface SolanaHistoryScript {
  /** @throws {never} */
  signatures(address: string, items: ReadonlyArray<SignatureItem>): void;
}

export interface LatestBlockhash {
  readonly blockhash: string;
  readonly lastValidBlockHeight: number;
}

const RpcCall = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Schema.Union([Schema.String, Schema.Number, Schema.Null]),
  method: Schema.String,
  params: Schema.optionalKey(Schema.Array(Schema.Unknown)),
});

const PageOptions = Schema.Struct({
  commitment: Schema.optionalKey(Schema.Literals(["processed", "confirmed", "finalized"])),
  limit: Schema.optionalKey(Schema.Number),
  before: Schema.optionalKey(Schema.String),
  until: Schema.optionalKey(Schema.String),
  minContextSlot: Schema.optionalKey(Schema.Number),
});

const BlockhashReply = Schema.Struct({
  result: Schema.Struct({ value: Schema.Struct({ blockhash: Schema.String, lastValidBlockHeight: Schema.Number }) }),
});

export const historyMethod = "getSignaturesForAddress";

const rank: Readonly<Record<Commitment, number>> = { processed: 0, confirmed: 1, finalized: 2 };

/** @throws {Error} */
export async function latestBlockhash(rpcUrl: string): Promise<LatestBlockhash> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getLatestBlockhash", params: [{ commitment: "confirmed" }] }),
  });
  const reply = Schema.decodeUnknownOption(BlockhashReply)(await response.json());
  if (Option.isNone(reply)) throw new Error(`the local validator at ${rpcUrl} gave no latest blockhash`);
  return reply.value.result.value;
}

function rpcError(id: string | number | null, code: number, message: string) {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } });
}

export function solanaHistoryRefusal(): Response {
  return new Response("upstream unavailable", { status: 503 });
}

export function solanaHistory(rpcUrl: string | undefined) {
  const scripted = new Map<string, ReadonlyArray<SignatureItem>>();

  const script: SolanaHistoryScript = {
    signatures: (address, items) => {
      scripted.set(address, items);
    },
  };

  function page(id: string | number | null, items: ReadonlyArray<SignatureItem>, options: unknown) {
    const parsed = Schema.decodeUnknownOption(PageOptions)(options ?? {});
    if (Option.isNone(parsed)) return rpcError(id, -32602, "Invalid params: invalid getSignaturesForAddress configuration");
    const { commitment = "finalized", limit = 1000, before, until } = parsed.value;
    if (commitment === "processed") return rpcError(id, -32602, "Method does not support commitment below `confirmed`");
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) return rpcError(id, -32602, "Invalid limit; max 1000");
    const visible = items.filter((item) => rank[item.confirmationStatus ?? "finalized"] >= rank[commitment]);
    const start = before === undefined ? 0 : visible.findIndex((item) => item.signature === before) + 1;
    const after = start === 0 && before !== undefined ? [] : visible.slice(start);
    const stop = until === undefined ? -1 : after.findIndex((item) => item.signature === until);
    const result = (stop === -1 ? after : after.slice(0, stop)).slice(0, limit).map((item) => ({
      signature: item.signature,
      slot: item.slot,
      err: item.err ?? null,
      memo: item.memo ?? null,
      blockTime: item.blockTime ?? null,
      confirmationStatus: item.confirmationStatus ?? "finalized",
    }));
    return Response.json({ jsonrpc: "2.0", id, result });
  }

  /** @throws {Error} */
  async function forward(text: string, method: string): Promise<Response> {
    if (rpcUrl === undefined) throw new Error(`solanaHistory forwards ${method} to the local validator, but quotesFake was given no chains.solana`);
    const answered = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: text });
    return new Response(await answered.arrayBuffer(), { status: answered.status, headers: answered.headers });
  }

  /** @throws {never} */
  function decoded(body: unknown) {
    return Option.getOrUndefined(Schema.decodeUnknownOption(RpcCall)(body));
  }

  /** @throws {Error} */
  async function answer(text: string, call: typeof RpcCall.Type | undefined): Promise<{ readonly response: Response; readonly scripted: boolean }> {
    if (call === undefined) return { response: rpcError(null, -32600, "Invalid request"), scripted: false };
    const { id, method, params = [] } = call;
    const [address, options] = params;
    const items = method === historyMethod && typeof address === "string" ? scripted.get(address) : undefined;
    if (items === undefined) return { response: await forward(text, method), scripted: false };
    return { response: page(id, items, options), scripted: true };
  }

  return { script, decoded, answer };
}

