import { expect, test } from "bun:test";
import { sqliteD1 } from "../../tests/sqlite-d1";
import type { D1TransactionalDatabase } from "../d1";
import { handlePaymentsApi } from "./handler";
import { FundingVaultNotFoundError } from "./solana-funding";

const WALLET = "So11111111111111111111111111111111111111112";

function fund(resolve: () => Promise<never>) {
  const { db, sqlite } = sqliteD1();
  return handlePaymentsApi(
    new Request(
      "https://slop.cash/api/v1/payments/projects/alpha/solana-funding",
      {
        method: "POST",
        headers: {
          origin: "https://slop.cash",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          step: "review",
          operation: "deposit",
          network: "solana-mainnet",
          vault: WALLET,
          wallet: WALLET,
          amount: "1",
        }),
      },
    ),
    {
      db: db as unknown as D1TransactionalDatabase,
      solanaFundingConfig: resolve,
    },
  ).finally(() => sqlite.close());
}

test("an unknown vault on a served network is a 404, not a payments outage", async () => {
  const missing = await fund(async () => {
    throw new FundingVaultNotFoundError("Funding vault unavailable");
  });
  expect(missing.status).toBe(404);
  expect((await missing.json()).error).toBe("funding_vault_not_found");
  // A real resolver failure still reports the service as unavailable.
  const outage = await fund(async () => {
    throw new Error("registry read failed");
  });
  expect(outage.status).toBe(503);
  expect((await outage.json()).error).toBe("payments_unavailable");
});
