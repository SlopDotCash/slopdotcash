// Read-only dry run against mainnet quote APIs and RPCs, recorded into an
// in-memory D1. It never loads a key. Usage:
//   bun workers/fee-converter/dry-run.ts <base-wallet> <base-token> <solana-wallet> <solana-mint>
// Any public holder address can stand in for the fee wallet: the run only
// reads its balance and asks the aggregators for quotes. The conversion
// limits have no fallback: set FEE_CONVERTER_MIN_VALUE_MICRO,
// FEE_CONVERTER_GAS_MULTIPLE, FEE_CONVERTER_MAX_SLIPPAGE_BPS,
// FEE_CONVERTER_MAX_PRICE_IMPACT_BPS, FEE_CONVERTER_RUN_CAP_MICRO and
// FEE_CONVERTER_DAILY_CAP_MICRO in the environment.

import { sqliteD1 } from "../../tests/sqlite-d1";
import { runOnce } from "./index";

const [baseWallet, baseToken, solanaWallet, solanaMint] = process.argv.slice(2);
if (!solanaMint) {
  console.error(
    "usage: bun workers/fee-converter/dry-run.ts <base-wallet> <base-token> <solana-wallet> <solana-mint>",
  );
  process.exit(2);
}
const { db, sqlite } = sqliteD1();
const results = await runOnce({
  FEE_DB: db,
  FEE_CONVERTER_MODE: "dry_run",
  FEE_CONVERTER_NETWORKS: "base,solana",
  FEE_WALLET_BASE: baseWallet,
  FEE_WALLET_SOLANA: solanaWallet,
  FEE_CONVERTER_ALLOWLIST: JSON.stringify({
    base: [baseToken],
    solana: [solanaMint],
  }),
  RPC_URL_SOLANA: process.env.SOLANA_RPC_URL || undefined,
  FEE_CONVERTER_MIN_VALUE_MICRO: process.env.FEE_CONVERTER_MIN_VALUE_MICRO,
  FEE_CONVERTER_GAS_MULTIPLE: process.env.FEE_CONVERTER_GAS_MULTIPLE,
  FEE_CONVERTER_MAX_SLIPPAGE_BPS: process.env.FEE_CONVERTER_MAX_SLIPPAGE_BPS,
  FEE_CONVERTER_MAX_PRICE_IMPACT_BPS:
    process.env.FEE_CONVERTER_MAX_PRICE_IMPACT_BPS,
  FEE_CONVERTER_RUN_CAP_MICRO: process.env.FEE_CONVERTER_RUN_CAP_MICRO,
  FEE_CONVERTER_DAILY_CAP_MICRO: process.env.FEE_CONVERTER_DAILY_CAP_MICRO,
});
console.log(JSON.stringify(results, null, 2));
console.log(
  JSON.stringify(
    sqlite
      .query(
        `SELECT network, mode, token, target_token, amount_in, route, quote_amount_out,
                min_amount_out, quote_value_micro, price_impact_bps, token_balance_before,
                target_balance_before, state, reason, quote, created_at
           FROM fee_conversions ORDER BY network`,
      )
      .all(),
    null,
    2,
  ),
);
