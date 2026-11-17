// spec/fees/conversion.md, "Story: Sign only a reserved, inspected, same-wallet send"
import { Option, Schema } from "effect";
import { Response } from "miniflare";
import { type LatestBlockhash, latestBlockhash } from "./solanaHistory.ts";

export const jupiterOrigin = "https://api.jup.ag/swap/v1";

export interface JupiterQuoteScript {
  readonly inputMint: string;
  readonly outputMint: string;
  readonly amount?: bigint;
  readonly outAmount: bigint | ((amount: bigint) => bigint);
  readonly priceImpactPct?: string;
  readonly venue?: string;
}

export interface JupiterSwapRequest extends LatestBlockhash {
  readonly userPublicKey: string;
  readonly quote: Readonly<Record<string, unknown>>;
  readonly body: unknown;
}

export interface JupiterSwapScript {
  readonly userPublicKey?: string;
  readonly build: (request: JupiterSwapRequest) => Uint8Array | Promise<Uint8Array>;
}

export interface JupiterScript {
  /** @throws {never} */
  quote(script: JupiterQuoteScript): void;
  /** @throws {Error} */
  swapTransaction(script: JupiterSwapScript): void;
}

const SwapRequest = Schema.Struct({ quoteResponse: Schema.Record(Schema.String, Schema.Unknown), userPublicKey: Schema.String });

const decimal = /^(0|[1-9][0-9]{0,77})$/u;

function failure(status: number, error: string, errorCode: string) {
  return Response.json({ error, errorCode }, { status });
}

export function jupiterRefusal(mode: "noRoute" | "unavailable"): Response {
  return mode === "noRoute"
    ? failure(400, "Could not find any route", "COULD_NOT_FIND_ANY_ROUTE")
    : failure(503, "Service unavailable", "SERVICE_UNAVAILABLE");
}

export function jupiter(solanaRpc: string | undefined) {
  const quotes: JupiterQuoteScript[] = [];
  const swaps: JupiterSwapScript[] = [];
  const issued = new Map<string, Readonly<Record<string, unknown>>>();

  const script: JupiterScript = {
    quote: (quote) => {
      quotes.push(quote);
    },
    swapTransaction: (swap) => {
      if (solanaRpc === undefined) throw new Error("jupiter.swapTransaction builds against the local validator: give quotesFake chains.solana");
      swaps.push(swap);
    },
  };

  function quote(query: URLSearchParams) {
    const inputMint = query.get("inputMint") ?? "";
    const outputMint = query.get("outputMint") ?? "";
    const amountText = query.get("amount") ?? "";
    const slippageBps = Number(query.get("slippageBps") ?? "50");
    const swapMode = query.get("swapMode") ?? "ExactIn";
    if (!decimal.test(amountText) || inputMint === "" || outputMint === "" || !Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 10_000)
      return { response: failure(400, "Query parameter is invalid", "INVALID_REQUEST"), scripted: false };
    if (swapMode !== "ExactIn") return { response: jupiterRefusal("noRoute"), scripted: false };
    const amount = BigInt(amountText);
    const found = quotes.findLast((candidate) =>
      candidate.inputMint === inputMint && candidate.outputMint === outputMint && (candidate.amount === undefined || candidate.amount === amount));
    if (found === undefined) return { response: jupiterRefusal("noRoute"), scripted: false };
    const outAmount = typeof found.outAmount === "function" ? found.outAmount(amount) : found.outAmount;
    const threshold = (outAmount * BigInt(10_000 - slippageBps) + 9_999n) / 10_000n;
    const body = {
      inputMint,
      inAmount: amount.toString(),
      outputMint,
      outAmount: outAmount.toString(),
      otherAmountThreshold: threshold.toString(),
      swapMode,
      slippageBps,
      platformFee: null,
      priceImpactPct: found.priceImpactPct ?? "0",
      routePlan: [{
        swapInfo: {
          label: found.venue ?? "Whirlpool",
          inputMint,
          outputMint,
          inAmount: amount.toString(),
          outAmount: outAmount.toString(),
          feeAmount: "0",
          feeMint: inputMint,
        },
        percent: 100,
      }],
      contextSlot: issued.size + 1,
      timeTaken: 0.001,
    };
    issued.set(JSON.stringify(body), body);
    return { response: Response.json(body), scripted: true };
  }

  /** @throws {Error} */
  async function swap(request: unknown) {
    const parsed = Schema.decodeUnknownOption(SwapRequest)(request);
    if (Option.isNone(parsed)) return { response: failure(400, "Request body is invalid", "INVALID_REQUEST"), scripted: false };
    const { quoteResponse, userPublicKey } = parsed.value;
    const quoted = issued.get(JSON.stringify(quoteResponse));
    if (quoted === undefined) return { response: failure(400, "Quote response is not a quote this API issued", "INVALID_QUOTE"), scripted: false };
    const found = swaps.findLast((candidate) => candidate.userPublicKey === undefined || candidate.userPublicKey === userPublicKey);
    if (found === undefined || solanaRpc === undefined) return { response: failure(500, "Failed to build the swap transaction", "SWAP_BUILD_FAILED"), scripted: false };
    const latest = await latestBlockhash(solanaRpc);
    const transaction = await found.build({ ...latest, userPublicKey, quote: quoted, body: request });
    return {
      response: Response.json({ swapTransaction: Buffer.from(transaction).toString("base64"), lastValidBlockHeight: latest.lastValidBlockHeight }),
      scripted: true,
    };
  }

  /** @throws {Error} */
  async function answer(method: string, path: string, url: URL, request: unknown) {
    if (path === "/quote" && method === "GET") return quote(url.searchParams);
    if (path === "/swap" && method === "POST") return swap(request);
    return { response: failure(404, "Not found", "NOT_FOUND"), scripted: false };
  }

  return { script, answer };
}
