/** The guide's published penalty rows, derived from the Slopbot table. */

import { PENALTY_TABLE } from "../../workers/slopbot/penalties";

type PenaltyRowDef = {
  /** Guide label for the row. */
  category: string;
  /** Slopbot categories the row covers. */
  slopbotCategories: readonly (keyof typeof PENALTY_TABLE)[];
};

/**
 * Guide copy for the published penalty table: labels and category coverage
 * only. Debits and actions are not copied here — PENALTY_ROWS derives
 * them from PENALTY_TABLE in workers/slopbot/penalties.ts, so the guide
 * cannot drift from the bot. The quoted-rule row covers both busywork and
 * gaming, which share one rule there. The bot's `empty` and
 * `missing_evidence` categories carry no debit and are not published rows.
 */
const PENALTY_ROW_DEFS: readonly PenaltyRowDef[] = [
  { category: "Spam", slopbotCategories: ["spam"] },
  { category: "Scam or malicious", slopbotCategories: ["scam"] },
  {
    category: "Clear violation of a quoted project rule",
    slopbotCategories: ["busywork", "gaming"],
  },
  { category: "Low quality", slopbotCategories: ["low_quality"] },
  { category: "Duplicate", slopbotCategories: ["duplicate"] },
  { category: "Out of scope", slopbotCategories: ["out_of_scope"] },
];

export const PENALTY_ROWS = PENALTY_ROW_DEFS.map((def) => {
  const rule = PENALTY_TABLE[def.slopbotCategories[0]];
  return {
    category: def.category,
    slopbotCategories: def.slopbotCategories,
    action:
      (rule.action === "close" ? "Close" : "Label") +
      (rule.moderatorReview ? " + account review" : ""),
    debitThirds: rule.debitThirds,
  };
});
