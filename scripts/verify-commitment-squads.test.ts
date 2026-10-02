/** Proves Squads evidence binds program-owned multisig, vault PDA, and USDC. */
import { describe, expect, it } from "vitest";
import { SOLANA_MAINNET_USDC_MINT } from "../src/lib/settlement-plan";
import {
  assertSquadsProjectVaultIdentity,
  assertSquadsVaultIdentity,
  assertSquadsVaultUsdcState,
  deriveSquadsVaultAddress,
  SPL_TOKEN_PROGRAM_ID,
  SQUADS_V4_PROGRAM_ID,
} from "../src/lib/squads-funding";
import {
  parseCommitmentSquadsArguments,
  verifyCommitmentSquads,
  verifyProjectVaultSquads,
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
    { balance?: string; error?: Error; refuse?: number; transaction?: unknown }
  >,
) {
  const methods: string[] = [];
  const refused = new Map<string, number>();
  const fetchImpl = async (url: URL, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as {
      id: string;
      method: string;
    };
    methods.push(request.method);
    const authority = state[url.host];
    if (authority.error) throw authority.error;
    if ((refused.get(url.host) ?? 0) < (authority.refuse ?? 0)) {
      refused.set(url.host, (refused.get(url.host) ?? 0) + 1);
      return new Response("", { status: 429, headers: { "retry-after": "0" } });
    }
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
      "public.rpc.solanavibestation.com": { balance: "4000000" },
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

  it("retries a rate limit refusal and drops an authority that never relents", async () => {
    const { fetchImpl, methods } = fetchAuthorities({
      "api.mainnet-beta.solana.com": { balance: "5000000", refuse: 2 },
      "solana-rpc.publicnode.com": { balance: "5000000", refuse: 100 },
      "public.rpc.solanavibestation.com": { balance: "5000000" },
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
      balanceMinor: "5000000",
      authorities: [
        { authority: "https://api.mainnet-beta.solana.com/" },
        { authority: "https://public.rpc.solanavibestation.com/" },
      ],
    });
    // 3 for the first authority, 4 for the one that never relents, 1 for the third.
    expect(methods).toHaveLength(8);
  });

  it("validates multisig identity before every transaction authority", async () => {
    const { fetchImpl, methods } = fetchAuthorities({
      "api.mainnet-beta.solana.com": { transaction: transaction("deposit") },
      "solana-rpc.publicnode.com": { transaction: transaction("deposit") },
      "public.rpc.solanavibestation.com": { error: new Error("offline") },
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
      "public.rpc.solanavibestation.com": {
        transaction: transaction("release"),
      },
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

// Recorded from Solana devnet at finalized commitment on 2026-09-29: the
// RFC #500 proof vault, created with no rent collector and an 8 second time
// lock. Members are throwaway devnet keys.
const PROOF_MULTISIG = "HuAc8gLWm6ZyKtVsW57DZf8vUVSGEPv5iSgUj4L5WEod";
const PROOF_VAULT = "9Mcf62kqjs227D2NtdetAC9cBiHqUrnqP7TNssxWotHM";
const PROOF_MEMBERS = {
  creatorMember: "J121yGRih9BrmJPv3GinqFVtdNHrAheaURFdA4GYyE4H",
  slopMember: "3xBt7k8cqCD8auiTxpmCcDhzusQ8csQtpewKV4HGy6ui",
  independentMember: "BxqnpgMtjHfSmNT1KAFa2VwgaM6iXXa2GsVe1Ucxe7CJ",
};
const PROOF_ACCOUNT_DATA =
  "4HR5ukShT+xA4TLM+/YZIvdSREeR5bnPpQbWqKUOb/xMtbp2SjnKGwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAIAAAABgAAAAAAAAAAAAAAAAAAAAD9AwAAACvanzRwpftCr55IC6woPoU6QuQUYBljwdajDOzmCEcVAqLi+xfEOjHjPoSlCgZTLl1Nw2W9T2gRBvmFY0DDRDI/BvyX084akoVs0Pjt88f0HNlvNjUd1FnNAzlV0KmbSYbiBwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
// Byte offsets in the recorded account: members start at 100 because the
// rent collector is unset, in on-chain order Slop, independent, creator.
const SLOP_MASK = 132;
const INDEPENDENT_MASK = 165;
const CREATOR_MASK = 198;

function proofAccount(edit?: (bytes: Uint8Array) => Uint8Array | undefined) {
  const recorded = Uint8Array.from(atob(PROOF_ACCOUNT_DATA), (character) =>
    character.charCodeAt(0),
  );
  const bytes = edit?.(recorded) ?? recorded;
  return {
    executable: false,
    owner: SQUADS_V4_PROGRAM_ID,
    data: [btoa(String.fromCharCode(...bytes)), "base64"],
  };
}

function assertProof(
  account: unknown,
  members: typeof PROOF_MEMBERS = PROOF_MEMBERS,
) {
  return assertSquadsProjectVaultIdentity(
    account,
    PROOF_MULTISIG,
    PROOF_VAULT,
    0,
    members,
  );
}

describe("Squads v4 project vault shape", () => {
  it("accepts the recorded devnet proof vault and reports its time lock", async () => {
    await expect(assertProof(proofAccount())).resolves.toEqual({
      ...PROOF_MEMBERS,
      memberCount: 3,
      multisig: PROOF_MULTISIG,
      threshold: 2,
      timeLockSeconds: 8,
      vault: PROOF_VAULT,
      vaultIndex: 0,
    });
  });

  it("accepts the same members when a rent collector shifts the layout", async () => {
    const shifted = proofAccount((bytes) => {
      const moved = new Uint8Array(bytes.length);
      moved.set(bytes.slice(0, 94));
      moved[94] = 1;
      moved.set(publicKeyBytes(RECIPIENT), 95);
      moved.set(bytes.slice(95, 199), 127);
      return moved;
    });
    await expect(assertProof(shifted)).resolves.toMatchObject({
      memberCount: 3,
      timeLockSeconds: 8,
    });
  });

  it("rejects any permission mask other than creator 7, Slop 2, independent 6", async () => {
    for (const [offset, mask] of [
      [SLOP_MASK, 3],
      [SLOP_MASK, 6],
      [SLOP_MASK, 7],
      [INDEPENDENT_MASK, 7],
      [INDEPENDENT_MASK, 2],
      [CREATOR_MASK, 3],
    ]) {
      await expect(
        assertProof(
          proofAccount((bytes) => {
            bytes[offset] = mask;
          }),
        ),
      ).rejects.toThrow(/creator 7, Slop 2, independent signer 6/u);
    }
    // The right keys in the wrong roles carry the wrong masks.
    await expect(
      assertProof(proofAccount(), {
        ...PROOF_MEMBERS,
        slopMember: PROOF_MEMBERS.independentMember,
        independentMember: PROOF_MEMBERS.slopMember,
      }),
    ).rejects.toThrow(/creator 7, Slop 2, independent signer 6/u);
  });

  it("rejects a wrong threshold, a set authority, and a changed member set", async () => {
    for (const threshold of [1, 3]) {
      await expect(
        assertProof(
          proofAccount((bytes) => {
            new DataView(bytes.buffer).setUint16(72, threshold, true);
          }),
        ),
      ).rejects.toThrow(/exact 2-of-3/u);
    }
    await expect(
      assertProof(
        proofAccount((bytes) => {
          bytes.set(publicKeyBytes(PROOF_MEMBERS.slopMember), 40);
        }),
      ),
    ).rejects.toThrow(/no config authority/u);
    // A fourth member with every permission, in a correctly sized account.
    await expect(
      assertProof(
        proofAccount((bytes) => {
          const grown = new Uint8Array(bytes.length + 33);
          grown.set(bytes.slice(0, 199));
          new DataView(grown.buffer).setUint32(96, 4, true);
          grown.set(publicKeyBytes(RECIPIENT), 199);
          grown[231] = 7;
          return grown;
        }),
      ),
    ).rejects.toThrow(/exact 2-of-3/u);
    // Two members is the 2-of-2 shape, never a project vault.
    await expect(
      assertProof(
        proofAccount((bytes) => {
          new DataView(bytes.buffer).setUint32(96, 2, true);
        }),
      ),
    ).rejects.toThrow(/exact 2-of-3/u);
    await expect(
      assertProof(proofAccount(), {
        ...PROOF_MEMBERS,
        independentMember: RECIPIENT,
      }),
    ).rejects.toThrow(/exact three reviewed members/u);
    await expect(
      assertProof(proofAccount(), {
        ...PROOF_MEMBERS,
        independentMember: PROOF_MEMBERS.slopMember,
      }),
    ).rejects.toThrow(/must be distinct/u);
  });

  it("does not accept a project vault as a 2-of-2 commitment", async () => {
    await expect(
      assertSquadsVaultIdentity(
        proofAccount(),
        PROOF_MULTISIG,
        PROOF_VAULT,
        0,
        PROOF_MEMBERS.creatorMember,
        PROOF_MEMBERS.independentMember,
      ),
    ).rejects.toThrow(/exact 2-of-2/u);
  });
});

function projectVaultAuthorities(
  state: Record<string, { balance?: string; timeLockSeconds?: number }>,
) {
  return async (url: URL, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as {
      id: string;
      method: string;
    };
    const authority = state[url.host];
    const account = proofAccount((bytes) => {
      new DataView(bytes.buffer).setUint32(
        74,
        authority.timeLockSeconds ?? 8,
        true,
      );
    });
    const result =
      request.method === "getMultipleAccounts"
        ? {
            context: { slot: 500 },
            value: [
              account,
              tokenAccount(authority.balance ?? "5000000", PROOF_VAULT),
            ],
          }
        : request.method === "getAccountInfo"
          ? { context: { slot: 600 }, value: account }
          : transactionFrom(PROOF_VAULT);
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: request.id, result }),
    );
  };
}

function transactionFrom(vault: string) {
  const release = transaction("release");
  for (const balances of [
    release.meta.preTokenBalances,
    release.meta.postTokenBalances,
  ])
    balances[0].owner = vault;
  return release;
}

describe("Squads project vault verifier", () => {
  const input = {
    ...PROOF_MEMBERS,
    multisig: PROOF_MULTISIG,
    vault: PROOF_VAULT,
    vaultIndex: 0,
  };

  it("publishes the verified shape with state and release evidence", async () => {
    const fetchImpl = projectVaultAuthorities({
      "api.mainnet-beta.solana.com": {},
      "solana-rpc.publicnode.com": {},
      "solana.drpc.org": { balance: "4000000" },
    });
    await expect(
      verifyProjectVaultSquads({
        ...input,
        mode: "state",
        tokenAccount: TOKEN_ACCOUNT,
        fetchImpl,
      }),
    ).resolves.toMatchObject({
      instrument: "squads-project-vault",
      ...PROOF_MEMBERS,
      threshold: 2,
      permissions: { creator: 7, slop: 2, independent: 6 },
      configAuthority: null,
      timeLockSeconds: 8,
      balanceMinor: "5000000",
      verifier: { version: "project-vault-squads-v1" },
    });
    await expect(
      verifyProjectVaultSquads({
        ...input,
        mode: "release",
        recipient: RECIPIENT,
        signature: SIGNATURE,
        amountMinor: "2000000",
        fetchImpl,
      }),
    ).resolves.toMatchObject({
      event: "release",
      instrument: "squads-project-vault",
      timeLockSeconds: 8,
      chainEvidence: { slot: 800 },
    });
  });

  it("fails closed when authorities disagree on the time lock", async () => {
    await expect(
      verifyProjectVaultSquads({
        ...input,
        mode: "state",
        tokenAccount: TOKEN_ACCOUNT,
        fetchImpl: projectVaultAuthorities({
          "api.mainnet-beta.solana.com": { timeLockSeconds: 8 },
          "solana-rpc.publicnode.com": { timeLockSeconds: 0 },
          "solana.drpc.org": { timeLockSeconds: 259200 },
        }),
      }),
    ).rejects.toThrow(/did not reach commitment quorum/u);
  });

  it("rejects a repeated member before any network request", async () => {
    await expect(
      verifyProjectVaultSquads({
        ...input,
        slopMember: PROOF_MEMBERS.creatorMember,
        mode: "state",
        tokenAccount: TOKEN_ACCOUNT,
        fetchImpl: async () => {
          throw new Error("no request expected");
        },
      }),
    ).rejects.toThrow(/multisig, vault, or vault index is invalid/u);
  });
});
