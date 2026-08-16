/** Proves Bitcoin funding credits verify by exact UTXO sums and fail closed. */

import { describe, expect, it } from "vitest";
import {
  assertConfirmedBtcFundingTransfer,
  BITCOIN_FUNDING_VERIFIER_VERSION,
} from "./bitcoin-funding";
import {
  assertProjectFundingAddresses,
  assertProjectFundingRecord,
} from "./funding";

const RECIPIENT = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
const SENDER = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
const TXID = "a".repeat(64);
const BLOCK_HASH = "f".repeat(64);
const TIP = 800_010;

function transaction(overrides: Record<string, unknown> = {}) {
  return {
    txid: TXID,
    status: {
      confirmed: true,
      block_height: 800_000,
      block_hash: BLOCK_HASH,
    },
    vin: [
      {
        is_coinbase: false,
        prevout: { scriptpubkey_address: SENDER, value: 200_000 },
      },
    ],
    vout: [
      { scriptpubkey_address: RECIPIENT, value: 150_000 },
      { scriptpubkey_address: SENDER, value: 49_000 },
    ],
    fee: 1_000,
    ...overrides,
  };
}

describe("Bitcoin funding transfer verification", () => {
  it("verifies an exact confirmed credit with a reconciled fee", () => {
    expect(
      assertConfirmedBtcFundingTransfer(
        transaction(),
        TXID,
        RECIPIENT,
        "150000",
        TIP,
        BLOCK_HASH,
      ),
    ).toEqual({
      transactionId: TXID,
      blockHash: BLOCK_HASH,
      blockHeight: 800_000,
      confirmations: 11,
    });
  });

  it("sums multiple non-dust credits to the recipient", () => {
    expect(
      assertConfirmedBtcFundingTransfer(
        transaction({
          vout: [
            { scriptpubkey_address: RECIPIENT, value: 100_000 },
            { scriptpubkey_address: RECIPIENT, value: 50_000 },
            { scriptpubkey_address: SENDER, value: 49_000 },
          ],
        }),
        TXID,
        RECIPIENT,
        "150000",
        TIP,
        BLOCK_HASH,
      ).confirmations,
    ).toBe(11);
  });

  it("rejects unconfirmed, reorged, shallow, or mismatched transactions", () => {
    expect(() =>
      assertConfirmedBtcFundingTransfer(
        transaction({ status: { confirmed: false } }),
        TXID,
        RECIPIENT,
        "150000",
        TIP,
        BLOCK_HASH,
      ),
    ).toThrow(/unconfirmed/u);
    expect(() =>
      assertConfirmedBtcFundingTransfer(
        transaction(),
        TXID,
        RECIPIENT,
        "150000",
        TIP,
        "e".repeat(64),
      ),
    ).toThrow(/best chain/u);
    expect(() =>
      assertConfirmedBtcFundingTransfer(
        transaction(),
        TXID,
        RECIPIENT,
        "150000",
        800_004,
        BLOCK_HASH,
      ),
    ).toThrow(/finality policy/u);
    expect(() =>
      assertConfirmedBtcFundingTransfer(
        transaction({ txid: "b".repeat(64) }),
        TXID,
        RECIPIENT,
        "150000",
        TIP,
        BLOCK_HASH,
      ),
    ).toThrow(/does not match/u);
  });

  it("rejects wrong amounts, self-funding, coinbase, dust, and bad fees", () => {
    expect(() =>
      assertConfirmedBtcFundingTransfer(
        transaction(),
        TXID,
        RECIPIENT,
        "149999",
        TIP,
        BLOCK_HASH,
      ),
    ).toThrow(/exact amount/u);
    expect(() =>
      assertConfirmedBtcFundingTransfer(
        transaction({
          vin: [
            {
              is_coinbase: false,
              prevout: { scriptpubkey_address: RECIPIENT, value: 200_000 },
            },
          ],
        }),
        TXID,
        RECIPIENT,
        "150000",
        TIP,
        BLOCK_HASH,
      ),
    ).toThrow(/recipient's own coins/u);
    expect(() =>
      assertConfirmedBtcFundingTransfer(
        transaction({
          vin: [{ is_coinbase: true, prevout: {} }],
        }),
        TXID,
        RECIPIENT,
        "150000",
        TIP,
        BLOCK_HASH,
      ),
    ).toThrow(/coinbase/u);
    expect(() =>
      assertConfirmedBtcFundingTransfer(
        transaction(),
        TXID,
        RECIPIENT,
        "500",
        TIP,
        BLOCK_HASH,
      ),
    ).toThrow(/dust/u);
    expect(() =>
      assertConfirmedBtcFundingTransfer(
        transaction({
          vout: [
            { scriptpubkey_address: RECIPIENT, value: 546 },
            { scriptpubkey_address: RECIPIENT, value: 149_454 },
            { scriptpubkey_address: SENDER, value: 49_000 },
          ],
        }),
        TXID,
        RECIPIENT,
        "150000",
        TIP,
        BLOCK_HASH,
      ),
    ).toThrow(/dust-level output/u);
    expect(() =>
      assertConfirmedBtcFundingTransfer(
        transaction({ fee: 2_000 }),
        TXID,
        RECIPIENT,
        "150000",
        TIP,
        BLOCK_HASH,
      ),
    ).toThrow(/fee does not reconcile/u);
    expect(() =>
      assertConfirmedBtcFundingTransfer(
        transaction({
          fee: 0,
          vout: [
            { scriptpubkey_address: RECIPIENT, value: 150_000 },
            { scriptpubkey_address: SENDER, value: 50_000 },
          ],
        }),
        TXID,
        RECIPIENT,
        "150000",
        TIP,
        BLOCK_HASH,
      ),
    ).toThrow(/fee does not reconcile/u);
  });

  it("rejects malformed expectations before reading the transaction", () => {
    expect(() =>
      assertConfirmedBtcFundingTransfer(
        transaction(),
        TXID,
        "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
        "150000",
        TIP,
        BLOCK_HASH,
      ),
    ).toThrow(/expectation is invalid/u);
    expect(() =>
      assertConfirmedBtcFundingTransfer(
        transaction(),
        `0x${"a".repeat(62)}`,
        RECIPIENT,
        "150000",
        TIP,
        BLOCK_HASH,
      ),
    ).toThrow(/expectation is invalid/u);
    expect(() =>
      assertConfirmedBtcFundingTransfer(
        transaction(),
        TXID,
        RECIPIENT,
        "1".repeat(41),
        TIP,
        BLOCK_HASH,
      ),
    ).toThrow(/expectation is invalid/u);
  });

  it("produces verifier fields the funding record schema accepts", () => {
    const routes = assertProjectFundingAddresses([
      {
        network: "bitcoin",
        asset: "BTC",
        address: RECIPIENT,
        effectiveAt: "2026-08-01T00:00:00.000Z",
        replacedAt: null,
      },
    ]);
    const verified = assertConfirmedBtcFundingTransfer(
      transaction(),
      TXID,
      RECIPIENT,
      "150000",
      TIP,
      BLOCK_HASH,
    );
    expect(
      assertProjectFundingRecord(
        {
          schemaVersion: "1",
          kind: "project-funding",
          recordId: "fund_fixture_01",
          projectId: "eliza",
          manifestRevision: "b".repeat(40),
          network: "bitcoin",
          asset: "BTC",
          transactionId: TXID,
          recipient: RECIPIENT,
          amountMinor: "150000",
          observedAt: "2026-08-02T00:00:00.000Z",
          state: "verified-on-chain",
          donor: { attribution: "anonymous" },
          finality: {
            kind: "confirmations",
            confirmations: verified.confirmations,
          },
          verifier: {
            version: BITCOIN_FUNDING_VERIFIER_VERSION,
            checkedAt: "2026-08-02T01:00:00.000Z",
            evidenceUrl: `https://mempool.space/tx/${TXID}`,
            reason: null,
          },
          supersedes: null,
        },
        routes,
      ),
    ).toMatchObject({ state: "verified-on-chain" });
  });
});
