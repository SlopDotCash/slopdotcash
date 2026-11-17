import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  parseBuybackConfig,
  ROBINHOOD_USDG,
  SLOP_TOKEN,
} from "./buyback-config";
import { parseConfig } from "./config";
import { createEvmClient } from "./evm";

const TOKEN = "0x1111111111111111111111111111111111111111";
const { vars } = Bun.TOML.parse(
  readFileSync(new URL("./wrangler.toml", import.meta.url), "utf8"),
) as { vars: Record<string, string> };

function market(valueMicro: bigint, unavailable = false) {
  const config = parseConfig({ ...vars, FEE_CONVERTER_NETWORKS: "robinhood" });
  const buyback = parseBuybackConfig(vars, config.mode);
  if (!buyback.limits)
    throw new Error("buyback fixture requires explicit limits");
  const network = config.networks[0];
  const requestedTargets: string[] = [];
  const client = createEvmClient({
    config: network,
    limits: config.limits,
    kyberClientId: "eligibility-test",
    buyback: { limits: buyback.limits, receiver: network.feeWallet },
    fetch: (async (input) => {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://aggregator-api.kyberswap.com");
      expect(url.pathname).toBe("/robinhood/api/v1/routes");
      const target = url.searchParams.get("tokenOut") as string;
      requestedTargets.push(target);
      if (unavailable && target === ROBINHOOD_USDG)
        return Response.json(
          { message: "valuation unavailable" },
          { status: 400 },
        );
      const amountIn = url.searchParams.get("amountIn") as string;
      return Response.json({
        code: 0,
        data: {
          routerAddress: network.definition.router,
          routeSummary: {
            tokenIn: url.searchParams.get("tokenIn"),
            tokenOut: target,
            amountIn,
            amountOut:
              target === ROBINHOOD_USDG
                ? valueMicro.toString()
                : "1000000000000000000",
            amountInUsd: "25",
            amountOutUsd: "25",
            gasUsd: "0.0001",
            l1FeeUsd: "0",
            route: [],
          },
        },
      });
    }) as typeof fetch,
  });
  const result = client.buyback?.market;
  if (!result) throw new Error("Robinhood market fixture is missing");
  return { market: result, requestedTargets };
}

test("reference funds below $25 do not request a purchase route", async () => {
  const h = market(24_999_999n);
  expect(await h.market.quoteBuy(ROBINHOOD_USDG, 24_999_999n)).toEqual({
    belowMinimumValueMicro: 24_999_999n,
  });
  expect(h.requestedTargets).toEqual([]);
});

test("exactly $25 of reference funds can request a purchase route", async () => {
  const h = market(25_000_000n);
  expect(await h.market.quoteBuy(ROBINHOOD_USDG, 25_000_000n)).toMatchObject({
    valueMicro: 25_000_000n,
    amountIn: 25_000_000n,
  });
  expect(h.requestedTargets).toEqual([SLOP_TOKEN]);
});

test("large token base units do not bypass dollar eligibility", async () => {
  const h = market(24_999_999n);
  expect(await h.market.quoteBuy(TOKEN, 10n ** 24n)).toEqual({
    belowMinimumValueMicro: 24_999_999n,
  });
  expect(h.requestedTargets).toEqual([ROBINHOOD_USDG]);
});

test("non-reference funds are valued before requesting a purchase", async () => {
  const h = market(25_000_000n);
  expect(await h.market.quoteBuy(TOKEN, 10n ** 24n)).toMatchObject({
    valueMicro: 25_000_000n,
    amountIn: 10n ** 24n,
  });
  expect(h.requestedTargets).toEqual([ROBINHOOD_USDG, SLOP_TOKEN]);
});

test("unavailable valuation leaves the purchase route unrequested", async () => {
  const h = market(0n, true);
  const quote = await h.market.quoteBuy(TOKEN, 10n ** 24n);
  expect(quote).toHaveProperty("noRoute");
  expect(h.requestedTargets).toEqual([ROBINHOOD_USDG]);
});
