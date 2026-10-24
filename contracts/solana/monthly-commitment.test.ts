import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { D1TransactionalDatabase } from "../../backend/d1";
import { handlePaymentsApi } from "../../backend/payments/handler";
import {
  type SolanaEscrowConfig,
  solanaBase58,
  solanaVaultAddress,
} from "./adapter";
import {
  solanaMonthlyCommitmentInstruction,
  solanaMonthlyCommitmentMessage,
  solanaMonthlyCommitmentState,
} from "./monthly-commitment";
import { SolanaWalletActionError } from "./wallet-transactions";

const PROGRAM = "7E5ZRh5y6Xgg7k3kdS75CMiTE2efoq9PqNWR5fCVDavQ";
const PROJECT = solanaBase58(new Uint8Array(32).fill(7));
const OWNER = solanaBase58(new Uint8Array(32).fill(3));
const OTHER = solanaBase58(new Uint8Array(32).fill(4));
const BLOCKHASH = solanaBase58(new Uint8Array(32).fill(5));
const deployment = {
  programId: PROGRAM,
  projectPda: PROJECT,
  vault: solanaVaultAddress(PROGRAM, PROJECT),
  mint: solanaBase58(new Uint8Array(32).fill(9)),
  owner: OWNER,
  feeRecipient: solanaBase58(new Uint8Array(32).fill(6)),
};
// The Anchor discriminator computed independently of the shared encoder.
const discriminator = createHash("sha256")
  .update("global:set_monthly_commitment")
  .digest()
  .subarray(0, 8);
const expectedData = (cap: bigint, enabled: boolean) => {
  const data = Buffer.alloc(17);
  discriminator.copy(data, 0);
  data.writeBigUInt64LE(cap, 8);
  data[16] = enabled ? 1 : 0;
  return [...data];
};

describe("set_monthly_commitment instruction", () => {
  test("names the owner signer and the writable project, then cap and flag", () => {
    const on = solanaMonthlyCommitmentInstruction(deployment, {
      wallet: OWNER,
      cap: "2500000000",
      enabled: true,
    });
    expect(on.program).toBe(PROGRAM);
    expect(on.accounts).toEqual([
      { key: OWNER, write: false },
      { key: PROJECT, write: true },
    ]);
    expect([...on.data]).toEqual(expectedData(2_500_000_000n, true));
    const off = solanaMonthlyCommitmentInstruction(deployment, {
      wallet: OWNER,
      cap: "0",
      enabled: false,
    });
    expect([...off.data]).toEqual(expectedData(0n, false));
    const max = solanaMonthlyCommitmentInstruction(deployment, {
      wallet: OWNER,
      cap: ((1n << 64n) - 1n).toString(),
      enabled: true,
    });
    expect([...max.data]).toEqual(expectedData((1n << 64n) - 1n, true));
  });

  test("refuses another wallet, a foreign vault, a zero cap when on and u64 overflow", () => {
    const intent = { wallet: OWNER, cap: "1", enabled: true };
    expect(() =>
      solanaMonthlyCommitmentInstruction(deployment, {
        ...intent,
        wallet: OTHER,
      }),
    ).toThrow("vault owner's wallet");
    expect(() =>
      solanaMonthlyCommitmentInstruction(
        { ...deployment, vault: OTHER },
        intent,
      ),
    ).toThrow("does not belong");
    expect(() =>
      solanaMonthlyCommitmentInstruction(deployment, {
        ...intent,
        cap: "0",
      }),
    ).toThrow("positive monthly amount");
    expect(() =>
      solanaMonthlyCommitmentInstruction(deployment, {
        ...intent,
        cap: (1n << 64n).toString(),
      }),
    ).toThrow(SolanaWalletActionError);
    expect(() =>
      solanaMonthlyCommitmentInstruction(deployment, {
        ...intent,
        cap: "01",
      }),
    ).toThrow(SolanaWalletActionError);
  });

  test("compiles a one-signer legacy message with the program read-only", () => {
    const msg = solanaMonthlyCommitmentMessage(deployment, {
      wallet: OWNER,
      cap: "7",
      enabled: true,
      blockhash: BLOCKHASH,
    });
    // Header: one signer, no read-only signer, one read-only unsigned account.
    expect([...msg.slice(0, 4)]).toEqual([1, 0, 1, 3]);
    const keys = [0, 1, 2].map((index) =>
      solanaBase58(msg.slice(4 + index * 32, 36 + index * 32)),
    );
    expect(keys).toEqual([OWNER, PROJECT, PROGRAM]);
    expect(solanaBase58(msg.slice(100, 132))).toBe(BLOCKHASH);
    // One instruction: program index 2, accounts [0, 1], 17 data bytes.
    expect([...msg.slice(132, 138)]).toEqual([1, 2, 2, 0, 1, 17]);
    expect([...msg.slice(138)]).toEqual(expectedData(7n, true));
  });
});

describe("monthly commitment state", () => {
  test("reads the u64 cap at 307 and the switch at 315 of the project account", () => {
    const project = new Uint8Array(332);
    new DataView(project.buffer).setBigUint64(307, 123_456_789n, true);
    project[315] = 1;
    expect(solanaMonthlyCommitmentState(project)).toEqual({
      cap: "123456789",
      enabled: true,
    });
    project[315] = 0;
    expect(solanaMonthlyCommitmentState(project).enabled).toBe(false);
    project[315] = 2;
    expect(() => solanaMonthlyCommitmentState(project)).toThrow(
      "could not be read",
    );
  });
});

describe("Solana monthly setting route", () => {
  const config: SolanaEscrowConfig = {
    ...deployment,
    rpcUrl: "http://127.0.0.1:1",
    genesisHash: "x",
    projectId: "eliza",
    network: "solana-devnet",
    networkDomain: "solana-devnet",
    identityAuthority: OTHER,
    rotationAuthority: OTHER,
    codeSha256: "a".repeat(64),
    upgradeAuthority: null,
    bindingDelaySeconds: "3600",
    rotationDelaySeconds: "3600",
  };
  const call = (body: unknown, withConfig = true) =>
    handlePaymentsApi(
      new Request(
        "https://slop.cash/api/v1/payments/projects/eliza/solana-monthly-commitment",
        {
          method: "POST",
          headers: {
            origin: "https://slop.cash",
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        },
      ),
      {
        db: {} as D1TransactionalDatabase,
        ...(withConfig
          ? { solanaFundingConfig: async () => config }
          : undefined),
      },
    );
  const base = {
    network: "solana-devnet",
    vault: deployment.vault,
    wallet: OWNER,
    cap: "1000000",
    enabled: true,
  };

  test("is unavailable without the reviewed vault resolver", async () => {
    const response = await call({ ...base, step: "review" }, false);
    expect(response.status).toBe(503);
  });

  test("rejects malformed settings before resolving the vault", async () => {
    for (const body of [
      { ...base, step: "send" },
      { ...base, step: "review", enabled: "true" },
      { ...base, step: "review", cap: "1.5" },
      { ...base, step: "review", wallet: "0xabc" },
      { ...base, step: "check" },
    ]) {
      const response = await call(body);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "invalid_monthly_setting",
      });
    }
  });

  test("refuses a non-owner wallet with a readable reason and no chain read", async () => {
    const response = await call({ ...base, step: "review", wallet: OTHER });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: "monthly_setting_rejected",
      message:
        "Connect the vault owner's wallet to change automatic monthly payment.",
    });
  });
});
