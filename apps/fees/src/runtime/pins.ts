// spec/fees/conversion.md, "The Worker configuration and the reviewed vaults are published components"

export const chainIds = { base: 8453, ethereum: 1, robinhood: 4663 } as const;

export const solanaGenesis = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

export const circleUsdc = {
  base: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  ethereum: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  solana: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
} as const;

export const kyberswap = {
  api: "https://aggregator-api.kyberswap.com",
  router: "0x6131b5fae19ea4f9d964eac0408e4408b66337b5",
  native: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  clientId: "slop-fee-converter",
} as const;

export const jupiter = {
  api: "https://api.jup.ag/swap/v1",
  program: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
} as const;

export const slopToken = "0xfeb4e36fa4a2a494ff25ae4a63491e4c584a67ae";

export const burnAddress = "0x000000000000000000000000000000000000dead";

export const robinhoodUsdg = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";

export const dln = {
  api: "https://dln.debridge.finance/v1.0",
  source: "0xef4fb24ad0916217251f553c0596f8edc630eb66",
  destination: "0xe7351fd770a37282b91d153ee690b63579d6dd7f",
  solanaProgram: "src5qyZHqTqecJV4aY6Cb6zDZLMDzrDKKezs22MPHr4",
  solanaChainId: "7565164",
  allowedTakers: ["0x555ce236c0220695b68341bc48c68d52210cc35b"],
} as const;

export const baseGasPriceOracle = {
  address: "0x420000000000000000000000000000000000000f",
  l1FeeUpperBound: "0xf1c7a58b",
  operatorFee: "0x275aedd2",
} as const;
