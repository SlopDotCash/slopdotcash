// spec/fees/conversion.md, "Story: Sign only a reserved, inspected, same-wallet send"
import { Option, Schema } from "effect";
import { Response } from "miniflare";
import { type Hex, encodeFunctionData, isAddress } from "viem";
import { kyberRouterAbi } from "../../chain/kyberswap.ts";

export const kyberswapOrigin = "https://aggregator-api.kyberswap.com";
export const kyberNative = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

export interface KyberRouteScript {
  readonly chain?: string;
  readonly tokenIn: Hex;
  readonly tokenOut: Hex;
  readonly amountIn?: bigint;
  readonly amountOut: bigint | ((amountIn: bigint) => bigint);
  readonly routerAddress: Hex;
  readonly executor?: Hex;
  readonly targetData?: Hex;
  readonly amountInUsd?: string;
  readonly amountOutUsd?: string;
  readonly gasUsd?: string;
  readonly l1FeeUsd?: string | null;
}

export interface KyberSwapScript {
  /** @throws {never} */
  route(script: KyberRouteScript): void;
}

interface Issued {
  readonly script: KyberRouteScript;
  readonly chain: string;
  readonly amountIn: bigint;
  readonly amountOut: bigint;
  readonly summary: Readonly<Record<string, unknown>>;
}

interface Answered {
  readonly response: Response;
  readonly scripted: boolean;
}

const BuildRequest = Schema.Struct({
  routeSummary: Schema.Struct({ routeID: Schema.String, checksum: Schema.String }),
  sender: Schema.String,
  recipient: Schema.String,
  slippageTolerance: Schema.Number,
  deadline: Schema.Number,
  source: Schema.String,
});

const decimal = /^(0|[1-9][0-9]{0,77})$/u;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function body(code: number, message: string, status: number, data?: unknown) {
  return Response.json({ code, message, ...(data === undefined ? {} : { data }), requestId: `kyber-${code}-${status}` }, { status });
}

export function kyberswapRefusal(mode: "noRoute" | "unavailable"): Response {
  return mode === "noRoute" ? body(4008, "route not found", 400) : body(5000, "internal server error", 503);
}

export function kyberswap() {
  const scripts: KyberRouteScript[] = [];
  const issued = new Map<string, Issued>();

  const script: KyberSwapScript = {
    route: (route) => {
      scripts.push(route);
    },
  };

  function routes(chain: string, query: URLSearchParams): Answered {
    const tokenIn = query.get("tokenIn") ?? "";
    const tokenOut = query.get("tokenOut") ?? "";
    const amountText = query.get("amountIn") ?? "";
    if (!decimal.test(amountText) || tokenIn === "" || tokenOut === "")
      return { response: body(4000, "bad request", 400), scripted: false };
    const amountIn = BigInt(amountText);
    const found = scripts.findLast((candidate) =>
      (candidate.chain === undefined || candidate.chain === chain) &&
      same(candidate.tokenIn, tokenIn) &&
      same(candidate.tokenOut, tokenOut) &&
      (candidate.amountIn === undefined || candidate.amountIn === amountIn));
    if (found === undefined) return { response: kyberswapRefusal("noRoute"), scripted: false };
    const amountOut = typeof found.amountOut === "function" ? found.amountOut(amountIn) : found.amountOut;
    const routeID = `route-${issued.size + 1}`;
    const summary = {
      tokenIn,
      amountIn: amountIn.toString(),
      amountInUsd: found.amountInUsd ?? "1",
      tokenOut,
      amountOut: amountOut.toString(),
      amountOutUsd: found.amountOutUsd ?? "1",
      gas: "250000",
      gasPrice: "1000000000",
      gasUsd: found.gasUsd ?? "0",
      ...(found.l1FeeUsd === null ? {} : { l1FeeUsd: found.l1FeeUsd ?? "0" }),
      extraFee: { feeAmount: "", chargeFeeBy: "", isInBps: false, feeReceiver: "" },
      route: [],
      routeID,
      checksum: `checksum-${routeID}`,
    };
    issued.set(routeID, { script: found, chain, amountIn, amountOut, summary });
    return {
      response: body(0, "successfully", 200, { routeSummary: summary, routerAddress: found.routerAddress }),
      scripted: true,
    };
  }

  function build(chain: string, request: unknown): Answered {
    const parsed = Schema.decodeUnknownOption(BuildRequest)(request);
    if (Option.isNone(parsed)) return { response: body(4001, "unable to bind request body", 400), scripted: false };
    const { routeSummary, recipient, slippageTolerance } = parsed.value;
    if (!isAddress(recipient, { strict: false })) return { response: body(4001, "recipient is not an address", 400), scripted: false };
    const route = issued.get(routeSummary.routeID);
    if (route === undefined || route.chain !== chain || route.summary.checksum !== routeSummary.checksum)
      return { response: body(4227, "route summary is not valid", 400), scripted: false };
    if (!Number.isInteger(slippageTolerance) || slippageTolerance < 0 || slippageTolerance > 2000)
      return { response: body(4001, "slippage tolerance is out of range", 400), scripted: true };
    const { script: found, amountIn, amountOut } = route;
    const minReturnAmount = (amountOut * (10_000n - BigInt(slippageTolerance))) / 10_000n;
    const executor = found.executor ?? found.routerAddress;
    const data = encodeFunctionData({
      abi: kyberRouterAbi,
      functionName: "swap",
      args: [{
        callTarget: executor,
        approveTarget: executor,
        targetData: found.targetData ?? "0x",
        desc: {
          srcToken: found.tokenIn,
          dstToken: found.tokenOut,
          srcReceivers: [],
          srcAmounts: [],
          feeReceivers: [],
          feeAmounts: [],
          dstReceiver: recipient,
          amount: amountIn,
          minReturnAmount,
          flags: 0n,
          permit: "0x",
        },
        clientData: "0x",
      }],
    });
    return {
      response: body(0, "successfully", 200, {
        amountIn: amountIn.toString(),
        amountInUsd: route.summary.amountInUsd,
        amountOut: amountOut.toString(),
        amountOutUsd: route.summary.amountOutUsd,
        gas: route.summary.gas,
        gasUsd: route.summary.gasUsd,
        outputChange: { amount: "0", percent: 0, level: 0 },
        data,
        routerAddress: found.routerAddress,
        transactionValue: same(found.tokenIn, kyberNative) ? amountIn.toString() : "0",
      }),
      scripted: true,
    };
  }

  function answer(method: string, path: string, url: URL, request: unknown): Answered {
    const match = /^\/([a-z0-9-]+)\/api\/v1\/(routes|route\/build)$/u.exec(path);
    if (match === null) return { response: body(4040, "not found", 404), scripted: false };
    const [, chain = "", resource] = match;
    if (resource === "routes" && method === "GET") return routes(chain, url.searchParams);
    if (resource === "route/build" && method === "POST") return build(chain, request);
    return { response: body(4050, "method not allowed", 405), scripted: false };
  }

  return { script, answer };
}
