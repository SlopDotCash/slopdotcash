/**
 * D1 reads and the one write of the SLOP buyback ledger (migration 0121).
 * Every total is derived from the immutable fee journal: there is no stored
 * balance that could drift from it. Amounts are decimal text in D1 and are
 * summed here as BigInt; a SQL SUM of base units would overflow.
 */

import type { BuybackStore, BridgeOutcome } from "./buyback";
import { NETWORK_DEFINITIONS, type Network } from "./config";
import type { ConversionRow } from "./core";
import type { D1Value, FeeD1Database } from "./d1";
import { fromRow, SELECT } from "./store";

const AMOUNT = /^(0|[1-9][0-9]*)$/u;

function total(values: readonly (string | null)[], what: string): bigint {
  let sum = 0n;
  for (const value of values) {
    if (value === null || !AMOUNT.test(value))
      throw new Error(`${what} has an invalid amount`);
    sum += BigInt(value);
  }
  return sum;
}

/** EVM addresses compare without case; Solana addresses are exact. */
const same = (network: Network, column: string) =>
  NETWORK_DEFINITIONS[network].family === "evm"
    ? `lower(${column}) = lower(?)`
    : `${column} = ?`;

export class D1BuybackStore implements BuybackStore {
  constructor(private readonly db: FeeD1Database) {}

  /**
   * Verified fee income of one asset in the fee wallet since `since`: the
   * output of finalized conversions into it, finalized vault claims of it,
   * and completed direct awards that paid their fee in it to this wallet.
   * A fee in another token counts once, as the output of its conversion.
   */
  async feeIncome(
    network: Network,
    token: string,
    feeWallet: string,
    since: string,
  ) {
    const journal = await this.db
      .prepare(
        `SELECT amount_out FROM fee_conversions
          WHERE network = ? AND ${same(network, "fee_wallet")} AND mode = 'live'
            AND state = 'finalized' AND finalized_at >= ?
            AND ((kind = 'conversion' AND ${same(network, "target_token")}) OR
                 (kind = 'claim' AND ${same(network, "token")}))`,
      )
      .bind(network, feeWallet, since, token, token)
      .all<{ amount_out: string | null }>();
    // The same receipt-backed fee fields the native accounting reads; never
    // private report or payer data.
    const direct = await this.db
      .prepare(
        `SELECT json_extract(p.intent,'$.feeBase') AS fee_base,
                json_extract(p.intent,'$.transfers[1].recipient') AS recipient,
                json_extract(p.intent,'$.transfers[1].amountBase') AS transfer_amount
           FROM security_direct_payments p
           JOIN security_direct_payment_receipts r ON r.case_id = p.case_id
          WHERE json_extract(p.intent,'$.chain') = ?
            AND ${same(network, "json_extract(p.intent,'$.asset.address')")}
            AND p.prepared_at >= ?`,
      )
      .bind(network, token, since)
      .all<{
        fee_base: string;
        recipient: string | null;
        transfer_amount: string | null;
      }>();
    let income = total(
      journal.results.map((row) => row.amount_out),
      "Finalized fee income",
    );
    const evm = NETWORK_DEFINITIONS[network].family === "evm";
    for (const row of direct.results) {
      if (typeof row.fee_base !== "string" || !AMOUNT.test(row.fee_base))
        throw new Error("Direct fee has an invalid amount");
      if (row.fee_base === "0") continue;
      if (!row.recipient || row.transfer_amount !== row.fee_base)
        throw new Error("Direct fee differs from its immutable transfers");
      const mine = evm
        ? row.recipient.toLowerCase() === feeWallet.toLowerCase()
        : row.recipient === feeWallet;
      if (mine) income += BigInt(row.fee_base);
    }
    return income;
  }

  /**
   * Input already committed to one leg: every live send that is signed and
   * not proven failed. A bridge deposit proven refunded is released.
   */
  async committed(
    network: Network,
    kind: "bridge" | "buyback" | "burn",
    token: string,
    feeWallet: string,
  ) {
    const { results } = await this.db
      .prepare(
        `SELECT c.amount_in FROM fee_conversions c
          WHERE c.network = ? AND c.kind = ? AND c.mode = 'live'
            AND ${same(network, "c.fee_wallet")} AND ${same(network, "c.token")}
            AND c.state IN ('submitted', 'unknown', 'finalized')
            AND NOT EXISTS (SELECT 1 FROM fee_bridge_outcomes o
                             WHERE o.bridge_id = c.id AND o.outcome = 'refunded')`,
      )
      .bind(network, kind, feeWallet, token)
      .all<{ amount_in: string }>();
    return total(
      results.map((row) => row.amount_in),
      "Committed buyback send",
    );
  }

  /** Bridged arrivals of one asset delivered to this Robinhood fee wallet. */
  async arrivedCredit(token: string, feeWallet: string) {
    const { results } = await this.db
      .prepare(
        `SELECT o.amount FROM fee_bridge_outcomes o
           JOIN fee_conversions c ON c.id = o.bridge_id
          WHERE o.outcome = 'arrived' AND lower(o.token) = lower(?)
            AND lower(json_extract(c.quote, '$.receiver')) = lower(?)`,
      )
      .bind(token, feeWallet)
      .all<{ amount: string }>();
    return total(
      results.map((row) => row.amount),
      "Bridge arrival",
    );
  }

  /** SLOP received by finalized purchases of this fee wallet. */
  async bought(network: Network, token: string, feeWallet: string) {
    const { results } = await this.db
      .prepare(
        `SELECT amount_out FROM fee_conversions
          WHERE network = ? AND kind = 'buyback' AND mode = 'live' AND state = 'finalized'
            AND ${same(network, "fee_wallet")} AND ${same(network, "target_token")}`,
      )
      .bind(network, feeWallet, token)
      .all<{ amount_out: string | null }>();
    return total(
      results.map((row) => row.amount_out),
      "Finalized purchase",
    );
  }

  /** Finalized deposits with no proven outcome yet, oldest first. */
  async inTransit(network?: Network) {
    const { results } = await this.db
      .prepare(
        `SELECT ${SELECT} FROM fee_conversions c
          WHERE c.kind = 'bridge' AND c.mode = 'live' AND c.state = 'finalized'
            ${network ? "AND c.network = ?" : ""}
            AND NOT EXISTS (SELECT 1 FROM fee_bridge_outcomes o WHERE o.bridge_id = c.id)
          ORDER BY c.finalized_at, c.id`,
      )
      .bind(...(network ? [network] : []))
      .all<Record<string, D1Value>>();
    return results.map(fromRow);
  }

  /**
   * Writes one proven outcome. The table's trigger binds it to its finalized
   * deposit, recorded order and the proving network's live lease; a second
   * outcome for the same deposit is refused by the primary key.
   */
  async recordOutcome(outcome: BridgeOutcome) {
    const result = await this.db
      .prepare(
        `INSERT INTO fee_bridge_outcomes (bridge_id, source_network, order_id, outcome,
           token, amount, evidence_network, evidence_block, evidence_block_hash, run_id, observed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        outcome.bridgeId,
        outcome.sourceNetwork,
        outcome.orderId,
        outcome.outcome,
        outcome.token,
        outcome.amount,
        outcome.evidenceNetwork,
        outcome.evidenceBlock,
        outcome.evidenceBlockHash,
        outcome.runId,
        outcome.observedAt,
      )
      .run();
    if ((result.meta?.changes ?? 0) !== 1)
      throw new Error("Bridge outcome was not recorded");
  }

  /** Value of live sends of one leg created since `since`, in micro-units. */
  async valueSince(
    network: Network,
    kind: "bridge" | "buyback",
    since: string,
  ) {
    const row = await this.db
      .prepare(
        `SELECT COALESCE(SUM(quote_value_micro), 0) AS total FROM fee_conversions
          WHERE network = ? AND mode = 'live' AND kind = ?
            AND state IN ('submitted', 'unknown', 'finalized') AND created_at >= ?`,
      )
      .bind(network, kind, since)
      .first<{ total: number }>();
    return BigInt(row?.total ?? 0);
  }

  async latestOf(
    network: Network,
    kind: "bridge" | "buyback" | "burn",
    token: string,
  ): Promise<ConversionRow | null> {
    const row = await this.db
      .prepare(
        `SELECT ${SELECT} FROM fee_conversions
          WHERE network = ? AND kind = ? AND ${same(network, "token")}
          ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
      .bind(network, kind, token)
      .first<Record<string, D1Value>>();
    return row ? fromRow(row) : null;
  }
}
