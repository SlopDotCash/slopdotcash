import { afterEach, describe, expect, test } from "bun:test";
import {
  PROJECT_DISCRIMINATOR,
  PROJECT_SIZE,
  readVaultTotals,
  solanaBase58,
  solanaConfigAddress,
  solanaMintDecimals,
  solanaMintDetails,
  solanaVaultAddress,
} from "./adapter";

const PROGRAM = "7E5ZRh5y6Xgg7k3kdS75CMiTE2efoq9PqNWR5fCVDavQ";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const PROJECT_BYTES = new Uint8Array(32).fill(7);
const PROJECT = solanaBase58(PROJECT_BYTES);
const MINT_BYTES = new Uint8Array(32).fill(9);
const MINT = solanaBase58(MINT_BYTES);
const VAULT = solanaVaultAddress(PROGRAM, PROJECT);
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

interface Counters {
  reserved: bigint;
  deposited: bigint;
  paid: bigint;
  payoutFees: bigint;
  withdrawnGross: bigint;
  withdrawalFees: bigint;
  accruedFees: bigint;
}
const base: Counters = {
  reserved: 30n,
  deposited: 10n ** 19n,
  paid: 98n,
  payoutFees: 2n,
  withdrawnGross: 500n,
  withdrawalFees: 10n,
  accruedFees: 12n,
};
/** A Project account in the current 332-byte layout. */
function projectAccount(c: Counters, mint = MINT_BYTES): Uint8Array {
  const data = new Uint8Array(PROJECT_SIZE);
  const view = new DataView(data.buffer);
  data.set(
    Uint8Array.from(PROJECT_DISCRIMINATOR.match(/../g) ?? [], (h) =>
      Number.parseInt(h, 16),
    ),
  );
  data.set(mint, 168);
  view.setBigUint64(200, c.reserved, true);
  view.setBigUint64(208, c.deposited, true);
  view.setBigUint64(216, c.paid, true);
  view.setBigUint64(224, c.payoutFees, true);
  view.setBigUint64(232, c.withdrawnGross, true);
  view.setBigUint64(240, c.withdrawalFees, true);
  data[248] = 254;
  view.setBigInt64(249, 3600n, true);
  view.setBigInt64(298, 604800n, true);
  view.setBigUint64(316, c.accruedFees, true);
  return data;
}
function mintAccount(decimals: number, initialized = 1): Uint8Array {
  const data = new Uint8Array(82);
  data[44] = decimals;
  data[45] = initialized;
  return data;
}
/** The vault token account: mint, owner (the project PDA) and amount. */
function vaultAccount(amount: bigint, mint = MINT_BYTES): Uint8Array {
  const data = new Uint8Array(165);
  data.set(mint, 0);
  data.set(Buffer.from(PROJECT_BYTES), 32);
  new DataView(data.buffer).setBigUint64(64, amount, true);
  return data;
}
const encoded = (owner: string, data: Uint8Array) => ({
  owner,
  executable: false,
  lamports: 1,
  data: [Buffer.from(data).toString("base64"), "base64"],
});
/** An approved metadata-only Token-2022 mint: base, account type, MetadataPointer and
 * TokenMetadata that name this project's mint. */
function token2022Mint(decimals: number): Uint8Array {
  const data = new Uint8Array(166 + 68 + 4 + 89);
  data[44] = decimals;
  data[45] = 1;
  data[165] = 1;
  const view = new DataView(data.buffer);
  let at = 166;
  view.setUint16(at, 18, true); // MetadataPointer
  view.setUint16(at + 2, 64, true);
  data.set(MINT_BYTES, at + 4 + 32);
  at += 4 + 64;
  view.setUint16(at, 19, true); // TokenMetadata
  view.setUint16(at + 2, 89, true);
  const payload = at + 4;
  data.set(MINT_BYTES, payload + 32);
  for (const [offset, text] of [
    [64, "PMUP"],
    [72, "PMUP"],
    [80, "u"],
  ] as const) {
    view.setUint32(payload + offset, text.length, true);
    data.set(
      Uint8Array.from(text, (c) => c.charCodeAt(0)),
      payload + offset + 4,
    );
  }
  view.setUint32(payload + 85, 0, true); // no additional metadata
  return data;
}
/** A Token-2022 vault token account. `extension` defaults to ImmutableOwner. */
function token2022Vault(amount: bigint, extension = [7, 0, 0, 0]): Uint8Array {
  const data = new Uint8Array(166 + extension.length);
  data.set(MINT_BYTES, 0);
  data.set(PROJECT_BYTES, 32);
  new DataView(data.buffer).setBigUint64(64, amount, true);
  data[165] = 2;
  data.set(extension, 166);
  return data;
}
/** An initialized mint sized between the base and account layouts: no valid Token-2022 shape. */
function truncatedMint(size: number): Uint8Array {
  const data = new Uint8Array(size);
  data[44] = 6;
  data[45] = 1;
  return data;
}
function mockRpc(accounts: {
  project: Uint8Array;
  mint: Uint8Array;
  mintOwner?: string;
  slot?: number;
  vaultAmount?: bigint;
  vault?: Uint8Array;
  vaultOwner?: string;
}) {
  const slot = accounts.slot ?? 123456;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const project = encoded(PROGRAM, accounts.project);
    let result: unknown;
    if (body.method === "getAccountInfo") {
      expect(body.params[0]).toBe(PROJECT);
      expect(body.params[1].commitment).toBe("finalized");
      result = { context: { slot: 1 }, value: project };
    } else if (body.method === "getMultipleAccounts") {
      expect(body.params[0]).toEqual([PROJECT, MINT, VAULT]);
      expect(body.params[1].commitment).toBe("finalized");
      result = {
        context: { slot },
        value: [
          project,
          encoded(accounts.mintOwner ?? TOKEN, accounts.mint),
          encoded(
            accounts.vaultOwner ?? TOKEN,
            accounts.vault ??
              vaultAccount(accounts.vaultAmount ?? 2n ** 64n - 1n),
          ),
        ],
      };
    } else if (body.method === "getBlockTime") {
      expect(body.params[0]).toBe(slot);
      result = 1_792_000_000;
    } else throw new Error(`Unexpected RPC ${body.method}`);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
  }) as typeof fetch;
}
const config = {
  rpcUrl: "https://rpc.invalid",
  network: "solana-localnet",
  projectPda: PROJECT,
  programId: PROGRAM,
};

describe("readVaultTotals", () => {
  test("reads counters and decimals from one finalized slot", async () => {
    mockRpc({
      project: projectAccount(base),
      mint: mintAccount(18),
    });
    expect(await readVaultTotals(config)).toEqual({
      network: "solana-localnet",
      vault: PROJECT,
      asset: MINT,
      decimals: 18,
      blockNumber: "123456",
      blockTime: new Date(1_792_000_000_000).toISOString(),
      totalDeposited: (10n ** 19n).toString(),
      totalPaid: "98",
      totalPayoutFees: "2",
      totalGrossWithdrawn: "500",
      totalWithdrawalFees: "10",
      freeBalance: (10n ** 19n - 98n - 2n - 500n - 30n).toString(),
      reservedPrincipal: null,
      reservedFees: null,
      accruedFees: "12",
      reserved: "30",
    });
  });

  test("reads mint decimals 0, 6, 9 and 18", async () => {
    for (const decimals of [0, 6, 9, 18]) {
      mockRpc({
        project: projectAccount({ ...base, deposited: 1_000n }),
        mint: mintAccount(decimals),
      });
      const totals = await readVaultTotals(config);
      expect(totals.decimals).toBe(decimals);
      expect(totals.freeBalance).toBe("370");
    }
  });

  test("throws when the vault holds less than free, reserved and accrued", async () => {
    const c = { ...base, deposited: 1_000n };
    const owed = 1_000n - 98n - 2n - 500n - 30n + 30n + 12n;
    mockRpc({
      project: projectAccount(c),
      mint: mintAccount(6),
      vaultAmount: owed,
    });
    expect((await readVaultTotals(config)).freeBalance).toBe("370");
    mockRpc({
      project: projectAccount(c),
      mint: mintAccount(6),
      vaultAmount: owed - 1n,
    });
    await expect(readVaultTotals(config)).rejects.toThrow();
  });

  test("throws when the counters exceed deposits", async () => {
    mockRpc({
      project: projectAccount({ ...base, deposited: 629n }),
      mint: mintAccount(6),
    });
    await expect(readVaultTotals(config)).rejects.toThrow();
  });

  test("refuses a truncated Token-2022 mint and an uninitialized mint", async () => {
    mockRpc({
      project: projectAccount(base),
      mint: truncatedMint(120),
      mintOwner: TOKEN_2022,
      vault: token2022Vault(10n ** 19n),
      vaultOwner: TOKEN_2022,
    });
    await expect(readVaultTotals(config)).rejects.toThrow();
    mockRpc({ project: projectAccount(base), mint: mintAccount(6, 0) });
    await expect(readVaultTotals(config)).rejects.toThrow();
  });

  test("reads an approved metadata-only Token-2022 vault from one finalized slot", async () => {
    mockRpc({
      project: projectAccount(base),
      mint: token2022Mint(6),
      mintOwner: TOKEN_2022,
      vault: token2022Vault(10n ** 19n),
      vaultOwner: TOKEN_2022,
    });
    const totals = await readVaultTotals(config);
    expect(totals.decimals).toBe(6);
    expect(totals.asset).toBe(MINT);
    expect(totals.freeBalance).toBe(
      (10n ** 19n - 98n - 2n - 500n - 30n).toString(),
    );
    mockRpc({
      project: projectAccount(base),
      mint: token2022Mint(9),
      mintOwner: TOKEN_2022,
      vault: token2022Vault(10n ** 19n, []),
      vaultOwner: TOKEN_2022,
    });
    expect((await readVaultTotals(config)).decimals).toBe(9);
  });

  test("refuses a Token-2022 mint outside the approved subset", async () => {
    const mint = token2022Mint(6);
    mint[46] = 1;
    mockRpc({
      project: projectAccount(base),
      mint,
      mintOwner: TOKEN_2022,
      vault: token2022Vault(10n ** 19n),
      vaultOwner: TOKEN_2022,
    });
    await expect(readVaultTotals(config)).rejects.toThrow();
  });

  test("refuses a vault account with an unadmitted extension or token program", async () => {
    mockRpc({
      project: projectAccount(base),
      mint: token2022Mint(6),
      mintOwner: TOKEN_2022,
      vault: token2022Vault(10n ** 19n, [2, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      vaultOwner: TOKEN_2022,
    });
    await expect(readVaultTotals(config)).rejects.toThrow();
    mockRpc({
      project: projectAccount(base),
      mint: token2022Mint(6),
      mintOwner: TOKEN_2022,
    });
    await expect(readVaultTotals(config)).rejects.toThrow();
  });

  test("refuses a legacy-size project account", async () => {
    mockRpc({
      project: projectAccount(base).slice(0, 265),
      mint: mintAccount(6),
    });
    await expect(readVaultTotals(config)).rejects.toThrow();
  });
});

describe("solanaMintDecimals", () => {
  test("reads admitted token programs for the complete owner paths and refuses unsafe mints", async () => {
    const answer = (owner: string, data: Uint8Array) => {
      globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        expect(body.method).toBe("getAccountInfo");
        expect(body.params[0]).toBe(MINT);
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: { context: { slot: 1 }, value: encoded(owner, data) },
          }),
        );
      }) as typeof fetch;
    };
    answer(TOKEN, mintAccount(9));
    expect(await solanaMintDecimals(config, MINT)).toBe(9);
    answer(TOKEN_2022, token2022Mint(6));
    expect(await solanaMintDecimals(config, MINT)).toBe(6);
    expect(await solanaMintDetails(config, MINT)).toEqual({
      decimals: 6,
      tokenProgram: TOKEN_2022,
    });
    const unsafe = token2022Mint(6);
    unsafe[46] = 1;
    answer(TOKEN_2022, unsafe);
    await expect(solanaMintDecimals(config, MINT)).rejects.toThrow();
  });
});

describe("program addresses", () => {
  // Expected values from @solana/web3.js PublicKey.findProgramAddressSync.
  test("derive the Config and vault PDAs", () => {
    expect(PROJECT).toBe("US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx");
    expect(solanaConfigAddress(PROGRAM)).toBe(
      "9hjoFnUrgF65K4DnWSDbS1WJjoGu4LChuz8XFq73UtaS",
    );
    expect(VAULT).toBe("DmCm1opZm61cYKAHYQ24LTVvh8UqPu5hpkRChccaCa6n");
  });
});
