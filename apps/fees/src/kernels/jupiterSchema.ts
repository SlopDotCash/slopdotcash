// spec/fees/conversion.md, "Native gas is reserved before signing and committed atomically with the signed row"; spec/settlement/signer.md, "Each service key permits only its named operations and none can pay, withdraw or upgrade"
import type { RouteRole } from "./jupiterPolicy.ts";
import { type WireShape, type WireTable, arrayShape, boolShape, bytesShape, decodeJupiter, enumShape, optionShape, structShape, unsignedShape, vecShape, wellFormedTable } from "./jupiterWire.ts";

const unsignedWidths = { u8: 1, u16: 2, u32: 4, u64: 8, u128: 16 } as const;

export type JupiterType =
  | keyof typeof unsignedWidths
  | "bool"
  | "bytes"
  | { readonly defined: string }
  | { readonly vec: JupiterType }
  | { readonly option: JupiterType }
  | { readonly array: readonly [JupiterType, number] };

export type JupiterFields = readonly (readonly [string, JupiterType])[];

export type JupiterDefinition =
  | { readonly kind: "struct"; readonly fields: JupiterFields }
  | { readonly kind: "enum"; readonly variants: readonly (string | readonly [string, JupiterFields])[] };

export interface JupiterInstruction {
  readonly name: string;
  readonly discriminator: readonly number[];
  readonly accounts: readonly RouteRole[];
  readonly args: JupiterFields;
}

export type JupiterRoute =
  | { readonly kind: "refused"; readonly error: number; readonly at: number }
  | { readonly kind: "route"; readonly instruction: JupiterInstruction; readonly args: Readonly<Record<string, bigint>> };

export const jupiterTypes: Readonly<Record<string, JupiterDefinition>> = {
  BisonFiPredictSide: {
    kind: "enum",
    variants: [
      "Yes",
      "No",
    ],
  },
  CandidateSwap: {
    kind: "enum",
    variants: [
      ["HumidiFi", [["swap_id", "u64"], ["is_base_to_quote", "bool"]]],
      ["TesseraV", [["side", { defined: "Side" }]]],
      ["HumidiFiV2", [["swap_id", "u64"], ["is_base_to_quote", "bool"]]],
      "RaydiumV2",
      "RaydiumClmm",
      ["Whirlpool", [["a_to_b", "bool"]]],
      "ZeroFi",
      ["BisonFiV2", [["a_to_b", "bool"]]],
      ["GoonFiV2", [["is_bid", "bool"]]],
      ["GoonFiV3", [["is_bid", "bool"]]],
      ["WhirlpoolV2", [["a_to_b", "bool"], ["remaining_accounts_info", { option: { defined: "RemainingAccountsInfo" } }]]],
      "ZeroFiSwapV2",
      ["BisonFiMarketBacked", [["a_to_b", "bool"]]],
      "RaydiumClmmV2",
      ["TesseraVV2", [["side", { defined: "Side" }]]],
      ["HumidiFiRouter", [["claimed_ms", "u64"], ["seed_rng", { array: ["u8", 32] }], ["token", { array: ["u8", 16] }], ["is_base_to_quote", "bool"]]],
      ["HumidiFiRouterV2", [["router_id", "u64"], ["claimed_ms", "u64"], ["seed_rng", { array: ["u8", 32] }], ["token", { array: ["u8", 16] }], ["is_base_to_quote", "bool"]]],
      ["HumidiFiRouterV3", [["router_id", "u64"], ["generation", "u64"], ["minted", "u64"], ["expiry", "u64"], ["seed_rng", { array: ["u8", 32] }], ["token", { array: ["u8", 16] }], ["is_base_to_quote", "bool"]]],
      "ZeroFiSwapV3",
    ],
  },
  CandidateSwapWithBps: { kind: "struct", fields: [["candidate_swap", { defined: "CandidateSwap" }], ["bps", "u32"]] },
  HyloSwapType: {
    kind: "enum",
    variants: [
      "MintStable",
      "RedeemStable",
      "MintLever",
      "RedeemLever",
      "SwapStableToLever",
      "SwapLeverToStable",
      "StabilityPoolDeposit",
      "StabilityPoolWithdraw",
    ],
  },
  PerenaTrancheKind: {
    kind: "enum",
    variants: [
      "Junior",
      "Senior",
    ],
  },
  RemainingAccountsInfo: { kind: "struct", fields: [["slices", { vec: { defined: "RemainingAccountsSlice" } }]] },
  RemainingAccountsSlice: { kind: "struct", fields: [["accounts_type", "u8"], ["length", "u8"]] },
  RoutePlanStep: { kind: "struct", fields: [["swap", { defined: "Swap" }], ["percent", "u8"], ["input_index", "u8"], ["output_index", "u8"]] },
  RoutePlanStepV2: { kind: "struct", fields: [["swap", { defined: "Swap" }], ["bps", "u16"], ["input_index", "u8"], ["output_index", "u8"]] },
  SanctumSolsSwapType: {
    kind: "enum",
    variants: [
      "Mint",
      "Claim",
      "ClaimHolding",
    ],
  },
  Side: {
    kind: "enum",
    variants: [
      "Bid",
      "Ask",
    ],
  },
  Swap: {
    kind: "enum",
    variants: [
      "Saber",
      "SaberAddDecimalsDeposit",
      "SaberAddDecimalsWithdraw",
      "TokenSwap",
      "Sencha",
      "Step",
      "Cropper",
      "Raydium",
      ["Crema", [["a_to_b", "bool"]]],
      "Lifinity",
      "Mercurial",
      "Cykura",
      ["Serum", [["side", { defined: "Side" }]]],
      "MarinadeDeposit",
      "MarinadeUnstake",
      ["Aldrin", [["side", { defined: "Side" }]]],
      ["AldrinV2", [["side", { defined: "Side" }]]],
      ["Whirlpool", [["a_to_b", "bool"]]],
      ["Invariant", [["x_to_y", "bool"]]],
      "Meteora",
      "GooseFX",
      ["DeltaFi", [["stable", "bool"]]],
      "Balansol",
      ["MarcoPolo", [["x_to_y", "bool"]]],
      ["Dradex", [["side", { defined: "Side" }]]],
      "LifinityV2",
      "RaydiumClmm",
      ["Openbook", [["side", { defined: "Side" }]]],
      ["Phoenix", [["side", { defined: "Side" }]]],
      ["Symmetry", [["from_token_id", "u64"], ["to_token_id", "u64"]]],
      "TokenSwapV2",
      "HeliumTreasuryManagementRedeemV0",
      "StakeDexStakeWrappedSol",
      ["StakeDexSwapViaStake", [["bridge_stake_seed", "u32"]]],
      "GooseFXV2",
      "Perps",
      "PerpsAddLiquidity",
      "PerpsRemoveLiquidity",
      "MeteoraDlmm",
      ["OpenBookV2", [["side", { defined: "Side" }]]],
      "RaydiumClmmV2",
      ["StakeDexPrefundWithdrawStakeAndDepositStake", [["bridge_stake_seed", "u32"]]],
      ["Clone", [["pool_index", "u8"], ["quantity_is_input", "bool"], ["quantity_is_collateral", "bool"]]],
      ["SanctumS", [["src_lst_value_calc_accs", "u8"], ["dst_lst_value_calc_accs", "u8"], ["src_lst_index", "u32"], ["dst_lst_index", "u32"]]],
      ["SanctumSAddLiquidity", [["lst_value_calc_accs", "u8"], ["lst_index", "u32"]]],
      ["SanctumSRemoveLiquidity", [["lst_value_calc_accs", "u8"], ["lst_index", "u32"]]],
      "RaydiumCP",
      ["WhirlpoolSwapV2", [["a_to_b", "bool"], ["remaining_accounts_info", { option: { defined: "RemainingAccountsInfo" } }]]],
      "OneIntro",
      "PumpWrappedBuy",
      "PumpWrappedSell",
      "PerpsV2",
      "PerpsV2AddLiquidity",
      "PerpsV2RemoveLiquidity",
      "MoonshotWrappedBuy",
      "MoonshotWrappedSell",
      "StabbleStableSwap",
      "StabbleWeightedSwap",
      ["Obric", [["x_to_y", "bool"]]],
      "FoxBuyFromEstimatedCost",
      ["FoxClaimPartial", [["is_y", "bool"]]],
      ["SolFi", [["is_quote_to_base", "bool"]]],
      "SolayerDelegateNoInit",
      "SolayerUndelegateNoInit",
      ["TokenMill", [["side", { defined: "Side" }]]],
      "DaosFunBuy",
      "DaosFunSell",
      "ZeroFi",
      "StakeDexWithdrawWrappedSol",
      "VirtualsBuy",
      "VirtualsSell",
      ["Perena", [["in_index", "u8"], ["out_index", "u8"]]],
      "PumpSwapBuy",
      "PumpSwapSell",
      "Gamma",
      ["MeteoraDlmmSwapV2", [["remaining_accounts_info", { defined: "RemainingAccountsInfo" }]]],
      "Woofi",
      "MeteoraDammV2",
      "MeteoraDynamicBondingCurveSwap",
      "StabbleStableSwapV2",
      "StabbleWeightedSwapV2",
      ["RaydiumLaunchlabBuy", [["share_fee_rate", "u64"]]],
      ["RaydiumLaunchlabSell", [["share_fee_rate", "u64"]]],
      "BoopdotfunWrappedBuy",
      "BoopdotfunWrappedSell",
      ["Plasma", [["side", { defined: "Side" }]]],
      ["GoonFi", [["is_bid", "bool"], ["blacklist_bump", "u8"]]],
      ["HumidiFi", [["swap_id", "u64"], ["is_base_to_quote", "bool"]]],
      "MeteoraDynamicBondingCurveSwapWithRemainingAccounts",
      ["TesseraV", [["side", { defined: "Side" }]]],
      "PumpWrappedBuyV2",
      "PumpWrappedSellV2",
      "PumpSwapBuyV2",
      "PumpSwapSellV2",
      ["Heaven", [["a_to_b", "bool"]]],
      ["SolFiV2", [["is_quote_to_base", "bool"]]],
      "Aquifer",
      "PumpWrappedBuyV3",
      "PumpWrappedSellV3",
      "PumpSwapBuyV3",
      "PumpSwapSellV3",
      "JupiterLendDeposit",
      "JupiterLendRedeem",
      ["DefiTuna", [["a_to_b", "bool"], ["remaining_accounts_info", { option: { defined: "RemainingAccountsInfo" } }]]],
      ["AlphaQ", [["a_to_b", "bool"]]],
      "RaydiumV2",
      ["SarosDlmm", [["swap_for_y", "bool"]]],
      ["Futarchy", [["side", { defined: "Side" }]]],
      "MeteoraDammV2WithRemainingAccounts",
      "Obsidian",
      ["WhaleStreet", [["side", { defined: "Side" }]]],
      ["DynamicV1", [["candidate_swaps", { vec: { defined: "CandidateSwap" } }], ["best_position", { option: "u8" }]]],
      "PumpWrappedBuyV4",
      "PumpWrappedSellV4",
      "CarrotIssue",
      "CarrotRedeem",
      ["Manifest", [["side", { defined: "Side" }]]],
      ["BisonFi", [["a_to_b", "bool"]]],
      ["HumidiFiV2", [["swap_id", "u64"], ["is_base_to_quote", "bool"]]],
      ["PerenaStar", [["is_mint", "bool"]]],
      ["JupiterRfqV2", [["side", { defined: "Side" }], ["fill_data", "bytes"]]],
      ["GoonFiV2", [["is_bid", "bool"]]],
      ["Scorch", [["swap_id", "u128"]]],
      ["VaultLiquidUnstake", [["lst_amounts", { array: ["u64", 5] }], ["seed", "u64"]]],
      "XOrca",
      ["Quantum", [["side", { defined: "Side" }]]],
      ["WhaleStreetV2", [["side", { defined: "Side" }], ["auth_amount_in", "u64"], ["auth", "u64"]]],
      ["Riptide", [["amount_is_token_a", "bool"]]],
      "RunnerRodeo",
      ["TaurusFi", [["is_base_in", "bool"]]],
      "Omnipair",
      "MSwap",
      ["Hylo", [["swap_type", { defined: "HyloSwapType" }]]],
      "VoltrDeposit",
      "VoltrWithdraw",
      ["SanctumSV2", [["src_lst_value_calc_accs", "u8"], ["dst_lst_value_calc_accs", "u8"], ["src_lst_index", "u32"], ["dst_lst_index", "u32"]]],
      ["LemmingsFi", [["is_base_in", "bool"]]],
      "ScaleVmmBuy",
      "ScaleVmmSell",
      "ScaleAmmBuy",
      "ScaleAmmSell",
      ["BisonFiV2", [["a_to_b", "bool"]]],
      "Trends",
      "HumaDeposit",
      "HumaInstantWithdraw",
      ["Kipseli", [["is_base_to_quote", "bool"]]],
      ["DynamicV2", [["candidate_swaps", { vec: { defined: "CandidateSwapWithBps" } }], ["max_split_quote_calls", "u8"], ["max_split_candidates", "u8"]]],
      "PumpSwapBuyV3WithCashbackClaim",
      "PumpSwapSellV3WithCashbackClaim",
      "PumpWrappedBuyV4WithCashbackClaim",
      "PumpWrappedSellV4WithCashbackClaim",
      ["GoonFiV3", [["is_bid", "bool"]]],
      ["PumpWrappedBuyV5", [["claim_cashback", "bool"]]],
      ["PumpWrappedSellV5", [["claim_cashback", "bool"]]],
      "ZeroFiSwapV2",
      ["BisonFiPredict", [["side", { defined: "BisonFiPredictSide" }], ["is_buy", "bool"]]],
      "ByrealDynamicV3",
      ["Flux", [["swap_id", "u64"], ["base_to_quote", "bool"]]],
      "VaultLiquidSellLst",
      ["VaultLiquidBuyLst", [["lst_amount", "u64"]]],
      ["KipseliV2", [["is_base_to_quote", "bool"]]],
      ["Deriverse", [["side", { defined: "Side" }], ["instr_id", "u32"]]],
      ["Hadron", [["is_x", "bool"]]],
      "BinaryFi",
      ["Metric", [["zero_for_one", "bool"]]],
      ["JupiterLendDexSwap", [["swap0to1", "bool"]]],
      ["Gatorswap", [["base_to_quote", "bool"]]],
      ["Flint", [["is_global", "bool"], ["taker_buy", "bool"]]],
      ["Denali", [["base_to_quote", "bool"]]],
      "PerenaStarV2Deposit",
      ["PerenaStarV2WithdrawFromExternal", [["external_liquidity_source", "u8"]]],
      ["SanctumSols", [["swap_type", { defined: "SanctumSolsSwapType" }]]],
      ["HyloV2", [["swap_type", { defined: "HyloSwapType" }]]],
      "SanctumPamm",
      ["Archer", [["side", { defined: "Side" }]]],
      "TrenchWrappedBuy",
      "TrenchWrappedSell",
      ["BisonFiMarketBacked", [["a_to_b", "bool"]]],
      ["TesseraVV2", [["side", { defined: "Side" }]]],
      "Stableswap",
      "BinaryFiV2",
      ["KipseliV3", [["is_base_to_quote", "bool"]]],
      ["PerenaStarV2TrancheDeposit", [["kind", { defined: "PerenaTrancheKind" }]]],
      ["PerenaStarV2TrancheWithdrawFromExternal", [["kind", { defined: "PerenaTrancheKind" }], ["external_liquidity_source", { option: "u8" }]]],
      ["Quay", [["sell_base", "bool"]]],
      ["HumidiFiRouter", [["claimed_ms", "u64"], ["seed_rng", { array: ["u8", 32] }], ["token", { array: ["u8", 16] }], ["is_base_to_quote", "bool"]]],
      ["HumidiFiRouterV2", [["router_id", "u64"], ["claimed_ms", "u64"], ["seed_rng", { array: ["u8", 32] }], ["token", { array: ["u8", 16] }], ["is_base_to_quote", "bool"]]],
      ["PumpWrappedBuyV6", [["claim_cashback", "bool"], ["allow_partial_fill", "bool"]]],
      "HyloRouter",
      ["Memefun", [["quote_to_base", "bool"]]],
      ["HumidiFiRouterV3", [["router_id", "u64"], ["generation", "u64"], ["minted", "u64"], ["expiry", "u64"], ["seed_rng", { array: ["u8", 32] }], ["token", { array: ["u8", 16] }], ["is_base_to_quote", "bool"]]],
      ["PumpWrappedBuyV7", [["allow_partial_fill", "bool"], ["close_user_volume_accumulator", "bool"]]],
      ["PumpWrappedSellV6", [["close_user_volume_accumulator", "bool"]]],
      ["PumpSwapBuyV4", [["close_user_volume_accumulator", "bool"]]],
      ["PumpSwapSellV4", [["close_user_volume_accumulator", "bool"]]],
      "ZeroFiSwapV3",
      ["DenaliV2", [["base_to_quote", "bool"]]],
      ["QuantumV2", [["side", { defined: "Side" }]]],
      "DrFraudsworthSolBuy",
      ["DrFraudsworthSolSell", [["is_zig", "bool"]]],
      "DrFraudsworthSplBuy",
      "DrFraudsworthSplSell",
      "DrFraudsworthVaultConvert",
    ],
  },
};

const role = (name: string, flags = ""): RouteRole => ({ name, writable: flags.includes("w"), signer: flags.includes("s"), optional: flags.includes("?") });

const sharedAccounts = [
  role("program_authority"),
  role("user_transfer_authority", "s"),
  role("source_token_account", "w"),
  role("program_source_token_account", "w"),
  role("program_destination_token_account", "w"),
  role("destination_token_account", "w"),
  role("source_mint"),
  role("destination_mint"),
];
const tokenPrograms = [role("source_token_program"), role("destination_token_program")];
const eventAccounts = [role("event_authority"), role("program")];

export const jupiterInstructions: readonly JupiterInstruction[] = [
  {
    name: "route",
    discriminator: [229, 23, 203, 151, 122, 227, 173, 42],
    accounts: [
      role("token_program"),
      role("user_transfer_authority", "s"),
      role("user_source_token_account", "w"),
      role("user_destination_token_account", "w"),
      role("destination_token_account", "w?"),
      role("destination_mint"),
      role("platform_fee_account", "w?"),
      ...eventAccounts,
    ],
    args: [["route_plan", { vec: { defined: "RoutePlanStep" } }], ["in_amount", "u64"], ["quoted_out_amount", "u64"], ["slippage_bps", "u16"], ["platform_fee_bps", "u8"]],
  },
  {
    name: "shared_accounts_route",
    discriminator: [193, 32, 155, 51, 65, 214, 156, 129],
    accounts: [
      role("token_program"),
      ...sharedAccounts,
      role("platform_fee_account", "w?"),
      role("token_2022_program", "?"),
      ...eventAccounts,
    ],
    args: [["id", "u8"], ["route_plan", { vec: { defined: "RoutePlanStep" } }], ["in_amount", "u64"], ["quoted_out_amount", "u64"], ["slippage_bps", "u16"], ["platform_fee_bps", "u8"]],
  },
  {
    name: "route_v2",
    discriminator: [187, 100, 250, 204, 49, 196, 175, 20],
    accounts: [
      role("user_transfer_authority", "s"),
      role("user_source_token_account", "w"),
      role("user_destination_token_account", "w"),
      role("source_mint"),
      role("destination_mint"),
      ...tokenPrograms,
      role("destination_token_account", "w?"),
      ...eventAccounts,
    ],
    args: [["in_amount", "u64"], ["quoted_out_amount", "u64"], ["slippage_bps", "u16"], ["platform_fee_bps", "u16"], ["positive_slippage_bps", "u16"], ["route_plan", { vec: { defined: "RoutePlanStepV2" } }]],
  },
  {
    name: "shared_accounts_route_v2",
    discriminator: [209, 152, 83, 147, 124, 254, 216, 233],
    accounts: [
      ...sharedAccounts,
      ...tokenPrograms,
      ...eventAccounts,
    ],
    args: [["id", "u8"], ["in_amount", "u64"], ["quoted_out_amount", "u64"], ["slippage_bps", "u16"], ["platform_fee_bps", "u16"], ["positive_slippage_bps", "u16"], ["route_plan", { vec: { defined: "RoutePlanStepV2" } }]],
  },
];

function compile(types: Readonly<Record<string, JupiterDefinition>>, instructions: readonly JupiterInstruction[]): WireTable {
  const shapes: WireShape[] = [];
  const members: number[] = [];
  const known = new Map<string, number>();
  const add = (shape: Partial<WireShape> & Pick<WireShape, "kind">) => shapes.push({ width: 0, child: 0, first: 0, count: 0, ...shape }) - 1;
  const fields = (list: JupiterFields) => {
    const indices = list.map(([, type]) => shapeOf(type));
    const first = members.push(...indices) - indices.length;
    return add({ kind: structShape, first, count: indices.length });
  };
  const build = (type: JupiterType): number => {
    if (type === "bool") return add({ kind: boolShape });
    if (type === "bytes") return add({ kind: bytesShape });
    if (typeof type === "string") return add({ kind: unsignedShape, width: unsignedWidths[type] });
    if ("vec" in type) return add({ kind: vecShape, child: shapeOf(type.vec) });
    if ("option" in type) return add({ kind: optionShape, child: shapeOf(type.option) });
    if ("array" in type) return add({ kind: arrayShape, child: shapeOf(type.array[0]), count: type.array[1] });
    const definition = types[type.defined];
    if (definition.kind === "struct") return fields(definition.fields);
    const variants = definition.variants.map((variant) => fields(typeof variant === "string" ? [] : variant[1]));
    const first = members.push(...variants) - variants.length;
    return add({ kind: enumShape, first, count: variants.length });
  };
  const shapeOf = (type: JupiterType): number => {
    const key = JSON.stringify(type);
    const index = known.get(key) ?? build(type);
    known.set(key, index);
    return index;
  };
  const layouts = instructions.map((instruction) => ({
    discriminator: [...instruction.discriminator],
    args: fields(instruction.args),
    routePlan: instruction.args.findIndex(([name]) => name === "route_plan"),
  }));
  const table = { shapes, members, layouts };
  if (!wellFormedTable(table)) throw new Error("The pinned Jupiter wire table is malformed");
  return table;
}

export const jupiterWireTable = compile(jupiterTypes, jupiterInstructions);

const scalar = (type: JupiterType) => (typeof type === "string" ? type in unsignedWidths : "vec" in type);

/** @throws {never} */
export function decodeJupiterRoute(data: Uint8Array): JupiterRoute {
  const decoded = decodeJupiter(Array.from(data), jupiterWireTable);
  if (decoded.kind === "refused") return decoded;
  const instruction = jupiterInstructions[decoded.layout];
  const args = instruction.args.flatMap(([name, type], index) => (scalar(type) ? [[name, decoded.fields[index].value] as const] : []));
  return { kind: "route", instruction, args: Object.fromEntries(args) };
}
