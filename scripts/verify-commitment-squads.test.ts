/** Proves Squads evidence binds program-owned multisig, vault PDA, and USDC. */
import { describe, expect, it } from "vitest";
import { SOLANA_MAINNET_USDC_MINT } from "../src/lib/settlement-plan";
import {
  assertSquadsVaultIdentity,
  assertSquadsVaultUsdcState,
  deriveSquadsVaultAddress,
  SPL_TOKEN_PROGRAM_ID,
  SQUADS_V4_PROGRAM_ID,
} from "../src/lib/squads-funding";
import {
  parseCommitmentSquadsArguments,
  verifyCommitmentSquads,
} from "./verify-commitment-squads";

// Published SDK-compatible pair; derivation is cluster-independent.
const MULTISIG = "xmWqhNJwNL4z4BcDo1Yh7BbStLU7omVafZNmg91y2Vg";
const VAULT = "FTK6ckiPWbe1jAiRtcPCz9sCrvCV6Y6hAJhAU5b9S3nv";
const TOKEN_ACCOUNT = "11111111111111111111111111111111";
const FUNDER = "Stake11111111111111111111111111111111111111";
const RECIPIENT = "SysvarRent111111111111111111111111111111111";
const SIGNATURE = "3".repeat(88);
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function publicKeyBytes(value: string): Uint8Array {
  const bytes: number[] = [0];
  for (const character of value) {
    let carry = BASE58.indexOf(character);
    for (let index = 0; index < bytes.length; index += 1) {
      carry += bytes[index] * 58;
      bytes[index] = carry & 255;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 255);
      carry >>= 8;
    }
  }
  let zeroes = 0;
  while (value[zeroes] === "1") zeroes += 1;
  return Uint8Array.from([...new Array(zeroes).fill(0), ...bytes.reverse()]);
}

function multisigAccount(overrides: Record<string, unknown> = {}) {
  const bytes = new Uint8Array(198);
  bytes.set([224, 116, 121, 186, 68, 161, 79, 236]);
  new DataView(bytes.buffer).setUint16(72, 2, true);
  new DataView(bytes.buffer).setUint32(128, 2, true);
  bytes.set(publicKeyBytes(FUNDER), 132);
  bytes[164] = 7;
  bytes.set(publicKeyBytes(RECIPIENT), 165);
  bytes[197] = 7;
  return {
    executable: false,
    owner: SQUADS_V4_PROGRAM_ID,
    data: [btoa(String.fromCharCode(...bytes)), "base64"],
    ...overrides,
  };
}

function tokenAccount(balance: string, owner = VAULT) {
  return {
    owner: SPL_TOKEN_PROGRAM_ID,
    data: {
      program: "spl-token",
      parsed: {
        type: "account",
        info: {
          mint: SOLANA_MAINNET_USDC_MINT,
          owner,
          tokenAmount: { amount: balance, decimals: 6 },
        },
      },
    },
  };
}

function accountsResult(
  balance: string,
  slot = 500,
  multisig = multisigAccount(),
) {
  return { context: { slot }, value: [multisig, tokenAccount(balance)] };
}

function tokenBalance(accountIndex: number, owner: string, amount: string) {
  return {
    accountIndex,
    mint: SOLANA_MAINNET_USDC_MINT,
    owner,
    uiTokenAmount: { amount, decimals: 6 },
  };
}

function transaction(mode: "deposit" | "release") {
  const deposit = mode === "deposit";
  const source = deposit ? FUNDER : VAULT;
  const destination = deposit ? VAULT : RECIPIENT;
  const amount = deposit ? "5000000" : "2000000";
  const sourceBefore = deposit ? "9000000" : "5000000";
  const sourceAfter = deposit ? "4000000" : "3000000";
  return {
    slot: deposit ? 700 : 800,
    blockTime: 1_786_000_000,
    meta: {
      err: null,
      preTokenBalances: [
        tokenBalance(0, source, sourceBefore),
        tokenBalance(1, destination, "0"),
      ],
      postTokenBalances: [
        tokenBalance(0, source, sourceAfter),
        tokenBalance(1, destination, amount),
      ],
    },
    transaction: { signatures: [SIGNATURE] },
  };
}

function fetchAuthorities(
  state: Record<
    string,
    { balance?: string; error?: Error; transaction?: unknown }
  >,
) {
  const methods: string[] = [];
  const fetchImpl = async (url: URL, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as {
      id: string;
      method: string;
    };
    methods.push(request.method);
    const authority = state[url.host];
    if (authority.error) throw authority.error;
    let result: unknown;
    if (request.method === "getMultipleAccounts")
      result = accountsResult(authority.balance ?? "5000000");
    else if (request.method === "getAccountInfo")
      result = { context: { slot: 600 }, value: multisigAccount() };
    else result = authority.transaction;
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: request.id, result }),
    );
  };
  return { fetchImpl, methods };
}

describe("Squads v4 identity assertions", () => {
  it("derives the official vault PDA and accepts only an exact Squads 2-of-2", async () => {
    await expect(deriveSquadsVaultAddress(MULTISIG, 0)).resolves.toBe(VAULT);
    await expect(
      assertSquadsVaultIdentity(
        multisigAccount(),
        MULTISIG,
        VAULT,
        0,
        FUNDER,
        RECIPIENT,
      ),
    ).resolves.toEqual({
      memberCount: 2,
      funderMember: FUNDER,
      multisig: MULTISIG,
      stewardMember: RECIPIENT,
      threshold: 2,
      vault: VAULT,
      vaultIndex: 0,
    });
    await expect(
      assertSquadsVaultIdentity(
        multisigAccount({ owner: SPL_TOKEN_PROGRAM_ID }),
        MULTISIG,
        VAULT,
        0,
        FUNDER,
        RECIPIENT,
      ),
    ).rejects.toThrow(/Squads v4 program/u);
    await expect(
      assertSquadsVaultIdentity(
        multisigAccount(),
        MULTISIG,
        VAULT,
        1,
        FUNDER,
        RECIPIENT,
      ),
    ).rejects.toThrow(/canonical Squads PDA/u);
    const oneOfTwo = multisigAccount();
    const bytes = Uint8Array.from(
      atob((oneOfTwo.data as string[])[0]),
      (character) => character.charCodeAt(0),
    );
    new DataView(bytes.buffer).setUint16(72, 1, true);
    oneOfTwo.data = [btoa(String.fromCharCode(...bytes)), "base64"];
    await expect(
      assertSquadsVaultIdentity(
        oneOfTwo,
        MULTISIG,
        VAULT,
        0,
        FUNDER,
        RECIPIENT,
      ),
    ).rejects.toThrow(/exact 2-of-2/u);
    const configurable = multisigAccount();
    const configurableBytes = Uint8Array.from(
      atob((configurable.data as string[])[0]),
      (character) => character.charCodeAt(0),
    );
    configurableBytes[40] = 1;
    configurable.data = [
      btoa(String.fromCharCode(...configurableBytes)),
      "base64",
    ];
    await expect(
      assertSquadsVaultIdentity(
        configurable,
        MULTISIG,
        VAULT,
        0,
        FUNDER,
        RECIPIENT,
      ),
    ).rejects.toThrow(/no config authority/u);
    await expect(
      assertSquadsVaultIdentity(
        multisigAccount(),
        MULTISIG,
        VAULT,
        0,
        FUNDER,
        TOKEN_ACCOUNT,
      ),
    ).rejects.toThrow(/exact two reviewed voting members/u);
  });

  it("binds multisig and token account in one finalized observation", async () => {
    await expect(
      assertSquadsVaultUsdcState(
        accountsResult("5000000"),
        MULTISIG,
        VAULT,
        0,
        TOKEN_ACCOUNT,
        FUNDER,
        RECIPIENT,
      ),
    ).resolves.toMatchObject({
      balanceMinor: "5000000",
      multisig: MULTISIG,
      slot: 500,
      tokenAccount: TOKEN_ACCOUNT,
      vault: VAULT,
      vaultIndex: 0,
    });
    await expect(
      assertSquadsVaultUsdcState(
        accountsResult(
          "5000000",
          500,
          multisigAccount({ owner: SPL_TOKEN_PROGRAM_ID }),
        ),
        MULTISIG,
        VAULT,
        0,
        TOKEN_ACCOUNT,
        FUNDER,
        RECIPIENT,
      ),
    ).rejects.toThrow(/Squads v4 program/u);
    const wrongOwner = accountsResult("5000000");
    wrongOwner.value[1] = tokenAccount("5000000", FUNDER);
    await expect(
      assertSquadsVaultUsdcState(
        wrongOwner,
        MULTISIG,
        VAULT,
        0,
        TOKEN_ACCOUNT,
        FUNDER,
        RECIPIENT,
      ),
    ).rejects.toThrow(/declared vault/u);
  });
});

describe("Squads commitment verifier", () => {
  it("requires two agreeing combined state observations", async () => {
    const { fetchImpl, methods } = fetchAuthorities({
      "api.mainnet-beta.solana.com": { balance: "5000000" },
      "solana-rpc.publicnode.com": { balance: "5000000" },
      "solana.drpc.org": { balance: "4000000" },
    });
    await expect(
      verifyCommitmentSquads({
        funderMember: FUNDER,
        mode: "state",
        multisig: MULTISIG,
        vault: VAULT,
        vaultIndex: 0,
        tokenAccount: TOKEN_ACCOUNT,
        stewardMember: RECIPIENT,
        fetchImpl,
      }),
    ).resolves.toMatchObject({
      mode: "state",
      balanceMinor: "5000000",
      multisig: MULTISIG,
      vault: VAULT,
      vaultIndex: 0,
      verifier: { version: "commitment-squads-v2" },
    });
    expect(methods).toEqual([
      "getMultipleAccounts",
      "getMultipleAccounts",
      "getMultipleAccounts",
    ]);
  });

  it("validates multisig identity before every transaction authority", async () => {
    const { fetchImpl, methods } = fetchAuthorities({
      "api.mainnet-beta.solana.com": { transaction: transaction("deposit") },
      "solana-rpc.publicnode.com": { transaction: transaction("deposit") },
      "solana.drpc.org": { error: new Error("offline") },
    });
    await expect(
      verifyCommitmentSquads({
        mode: "deposit",
        funderMember: FUNDER,
        multisig: MULTISIG,
        vault: VAULT,
        vaultIndex: 0,
        signature: SIGNATURE,
        stewardMember: RECIPIENT,
        amountMinor: "5000000",
        fetchImpl,
      }),
    ).resolves.toMatchObject({
      event: "deposit",
      multisig: MULTISIG,
      vaultIndex: 0,
      chainEvidence: { slot: 700 },
    });
    expect(
      methods.filter((method) => method === "getAccountInfo"),
    ).toHaveLength(3);
    expect(
      methods.filter((method) => method === "getTransaction"),
    ).toHaveLength(2);
  });

  it("verifies release recipient and fails closed on invalid identity inputs", async () => {
    const { fetchImpl } = fetchAuthorities({
      "api.mainnet-beta.solana.com": { transaction: transaction("release") },
      "solana-rpc.publicnode.com": { transaction: transaction("release") },
      "solana.drpc.org": { transaction: transaction("release") },
    });
    await expect(
      verifyCommitmentSquads({
        mode: "release",
        funderMember: FUNDER,
        multisig: MULTISIG,
        vault: VAULT,
        vaultIndex: 0,
        recipient: RECIPIENT,
        signature: SIGNATURE,
        stewardMember: RECIPIENT,
        amountMinor: "2000000",
        fetchImpl,
      }),
    ).resolves.toMatchObject({ mode: "release", chainEvidence: { slot: 800 } });
    await expect(
      verifyCommitmentSquads({
        mode: "state",
        funderMember: FUNDER,
        multisig: MULTISIG,
        vault: VAULT,
        vaultIndex: 256,
        tokenAccount: TOKEN_ACCOUNT,
        stewardMember: RECIPIENT,
        fetchImpl,
      }),
    ).rejects.toThrow(/vault index/u);
  });

  it("requires unambiguous CLI identity arguments", () => {
    expect(
      parseCommitmentSquadsArguments([
        "--mode",
        "state",
        "--funder-member",
        FUNDER,
        "--multisig",
        MULTISIG,
        "--vault",
        VAULT,
        "--vault-index",
        "0",
        "--token-account",
        TOKEN_ACCOUNT,
        "--steward-member",
        RECIPIENT,
      ]),
    ).toMatchObject({ multisig: MULTISIG, vaultIndex: "0" });
    expect(() =>
      parseCommitmentSquadsArguments(["--mode", "state", "--mode", "deposit"]),
    ).toThrow(/Usage/u);
  });
});
