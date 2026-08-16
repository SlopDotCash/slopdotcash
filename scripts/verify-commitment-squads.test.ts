/** Proves the Squads commitment verifier needs quorum and fails closed. */

import { describe, expect, it } from "vitest";
import { SOLANA_MAINNET_USDC_MINT } from "../src/lib/settlement-plan";
import {
  assertSquadsVaultUsdcState,
  SPL_TOKEN_PROGRAM_ID,
} from "../src/lib/squads-funding";
import { verifyCommitmentSquads } from "./verify-commitment-squads";

const VAULT = "Vote111111111111111111111111111111111111111";
const TOKEN_ACCOUNT = "11111111111111111111111111111111";
const FUNDER = "Stake11111111111111111111111111111111111111";
const RECIPIENT = "SysvarRent111111111111111111111111111111111";
const SIGNATURE = "3".repeat(88);

interface AccountResultFixture {
  context: { slot: number };
  value: {
    owner: string;
    data: {
      program: string;
      parsed: {
        type: string;
        info: {
          mint: string;
          owner: string;
          tokenAmount: { amount: string; decimals: number };
        };
      };
    };
  };
}

function accountResult(balance: string, slot = 500): AccountResultFixture {
  return {
    context: { slot },
    value: {
      owner: SPL_TOKEN_PROGRAM_ID,
      data: {
        program: "spl-token",
        parsed: {
          type: "account",
          info: {
            mint: SOLANA_MAINNET_USDC_MINT,
            owner: VAULT,
            tokenAmount: { amount: balance, decimals: 6 },
          },
        },
      },
    },
  };
}

function tokenBalance(accountIndex: number, owner: string, amount: string) {
  return {
    accountIndex,
    mint: SOLANA_MAINNET_USDC_MINT,
    owner,
    uiTokenAmount: { amount, decimals: 6 },
  };
}

function depositTransaction() {
  return {
    slot: 700,
    blockTime: 1_786_000_000,
    meta: {
      err: null,
      preTokenBalances: [
        tokenBalance(0, FUNDER, "9000000"),
        tokenBalance(1, VAULT, "0"),
      ],
      postTokenBalances: [
        tokenBalance(0, FUNDER, "4000000"),
        tokenBalance(1, VAULT, "5000000"),
      ],
    },
    transaction: { signatures: [SIGNATURE] },
  };
}

function releaseTransaction() {
  return {
    slot: 800,
    blockTime: 1_786_100_000,
    meta: {
      err: null,
      preTokenBalances: [
        tokenBalance(0, VAULT, "5000000"),
        tokenBalance(1, RECIPIENT, "0"),
      ],
      postTokenBalances: [
        tokenBalance(0, VAULT, "3000000"),
        tokenBalance(1, RECIPIENT, "2000000"),
      ],
    },
    transaction: { signatures: [SIGNATURE] },
  };
}

function fetchByAuthority(results: Record<string, unknown>) {
  const queried: string[] = [];
  const fetchImpl = async (url: URL, init?: RequestInit) => {
    queried.push(url.host);
    const request = JSON.parse(String(init?.body)) as { id: string };
    const result = results[url.host];
    if (result instanceof Error) throw result;
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: request.id, result }),
    );
  };
  return { fetchImpl, queried };
}

describe("Squads vault state assertions", () => {
  it("accepts only the vault-owned canonical USDC token account", () => {
    expect(
      assertSquadsVaultUsdcState(
        accountResult("5000000"),
        VAULT,
        TOKEN_ACCOUNT,
      ),
    ).toEqual({
      balanceMinor: "5000000",
      slot: 500,
      tokenAccount: TOKEN_ACCOUNT,
      vault: VAULT,
    });
    const wrongMint = accountResult("5000000");
    wrongMint.value.data.parsed.info.mint = TOKEN_ACCOUNT;
    expect(() =>
      assertSquadsVaultUsdcState(wrongMint, VAULT, TOKEN_ACCOUNT),
    ).toThrow(/mint is not mainnet USDC/u);
    const wrongOwner = accountResult("5000000");
    wrongOwner.value.data.parsed.info.owner = FUNDER;
    expect(() =>
      assertSquadsVaultUsdcState(wrongOwner, VAULT, TOKEN_ACCOUNT),
    ).toThrow(/owner is not the declared vault/u);
    expect(() =>
      assertSquadsVaultUsdcState(
        { context: { slot: 1 }, value: null },
        VAULT,
        TOKEN_ACCOUNT,
      ),
    ).toThrow(/absent at finalized commitment/u);
    const wrongBalance = accountResult("1.5");
    expect(() =>
      assertSquadsVaultUsdcState(wrongBalance, VAULT, TOKEN_ACCOUNT),
    ).toThrow(/balance is not canonical/u);
  });
});

describe("Squads commitment verifier", () => {
  it("verifies vault state only with two exactly agreeing authorities", async () => {
    const { fetchImpl, queried } = fetchByAuthority({
      "api.mainnet-beta.solana.com": accountResult("5000000", 501),
      "solana-rpc.publicnode.com": accountResult("5000000", 502),
      "solana.drpc.org": accountResult("4000000", 503),
    });
    const result = await verifyCommitmentSquads({
      mode: "state",
      vault: VAULT,
      tokenAccount: TOKEN_ACCOUNT,
      fetchImpl,
    });
    expect(queried).toHaveLength(3);
    expect(result).toMatchObject({
      mode: "state",
      state: "verified-on-chain",
      balanceMinor: "5000000",
      slot: 502,
      verifier: {
        version: "commitment-squads-v1",
        evidenceUrl: `https://solscan.io/account/${VAULT}`,
      },
    });
  });

  it("refuses a state quorum when balances disagree", async () => {
    const { fetchImpl } = fetchByAuthority({
      "api.mainnet-beta.solana.com": accountResult("5000000"),
      "solana-rpc.publicnode.com": accountResult("4000000"),
      "solana.drpc.org": new Error("authority offline"),
    });
    await expect(
      verifyCommitmentSquads({
        mode: "state",
        vault: VAULT,
        tokenAccount: TOKEN_ACCOUNT,
        fetchImpl,
      }),
    ).rejects.toThrow(/did not reach commitment quorum/u);
  });

  it("verifies a finalized deposit credited exactly to the vault", async () => {
    const { fetchImpl } = fetchByAuthority({
      "api.mainnet-beta.solana.com": depositTransaction(),
      "solana-rpc.publicnode.com": depositTransaction(),
      "solana.drpc.org": null,
    });
    const result = await verifyCommitmentSquads({
      mode: "deposit",
      vault: VAULT,
      signature: SIGNATURE,
      amountMinor: "5000000",
      fetchImpl,
    });
    expect(result).toMatchObject({
      mode: "deposit",
      event: "deposit",
      state: "verified-on-chain",
      finality: { kind: "finalized" },
      chainEvidence: { signature: SIGNATURE, slot: 700 },
      verifier: { evidenceUrl: `https://solscan.io/tx/${SIGNATURE}` },
    });
    await expect(
      verifyCommitmentSquads({
        mode: "deposit",
        vault: VAULT,
        signature: SIGNATURE,
        amountMinor: "4000000",
        fetchImpl,
      }),
    ).rejects.toThrow(/quorum/u);
  });

  it("verifies a release only against the explicit expected recipient", async () => {
    const { fetchImpl } = fetchByAuthority({
      "api.mainnet-beta.solana.com": releaseTransaction(),
      "solana-rpc.publicnode.com": releaseTransaction(),
      "solana.drpc.org": releaseTransaction(),
    });
    const result = await verifyCommitmentSquads({
      mode: "release",
      vault: VAULT,
      recipient: RECIPIENT,
      signature: SIGNATURE,
      amountMinor: "2000000",
      fetchImpl,
    });
    expect(result).toMatchObject({
      mode: "release",
      chainEvidence: { slot: 800 },
    });
    await expect(
      verifyCommitmentSquads({
        mode: "release",
        vault: VAULT,
        recipient: FUNDER,
        signature: SIGNATURE,
        amountMinor: "2000000",
        fetchImpl,
      }),
    ).rejects.toThrow(/quorum/u);
  });

  it("rejects invalid inputs before querying any authority", async () => {
    let queried = false;
    const fetchImpl = async () => {
      queried = true;
      return new Response();
    };
    await expect(
      verifyCommitmentSquads({
        mode: "state",
        vault: "not-a-key",
        tokenAccount: TOKEN_ACCOUNT,
        fetchImpl,
      }),
    ).rejects.toThrow(/not a Solana public key/u);
    await expect(
      verifyCommitmentSquads({
        mode: "release",
        vault: VAULT,
        signature: SIGNATURE,
        amountMinor: "2000000",
        fetchImpl,
      }),
    ).rejects.toThrow(/explicit recipient/u);
    await expect(
      verifyCommitmentSquads({
        mode: "deposit",
        vault: VAULT,
        signature: SIGNATURE,
        amountMinor: "1".repeat(41),
        fetchImpl,
      }),
    ).rejects.toThrow(/signature or amount is invalid/u);
    await expect(
      verifyCommitmentSquads({
        mode: "state",
        vault: VAULT,
        tokenAccount: TOKEN_ACCOUNT,
        signature: SIGNATURE,
        fetchImpl,
      }),
    ).rejects.toThrow(/state mode requires only/u);
    expect(queried).toBe(false);
  });
});
