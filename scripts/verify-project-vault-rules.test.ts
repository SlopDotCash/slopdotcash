/** Proves the project vault rule checks against recorded devnet history. */
import { describe, expect, it } from "vitest";
import {
  assertSquadsCreatorSeat,
  SPL_TOKEN_PROGRAM_ID,
  SQUADS_V4_PROGRAM_ID,
} from "../src/lib/squads-funding";
import {
  assertNoSpendingLimitHistory,
  assertSquadsHistoryEntry,
  type SquadsHistoryEntry,
} from "../src/lib/squads-history";
import {
  parseProjectVaultRulesArguments,
  verifyProjectVaultRules,
} from "./verify-project-vault-rules";
import fixture from "./verify-project-vault-rules.fixture.json";

// The RFC #500 devnet proof vault. Transaction 1 was released by the creator
// and Slop, 2 by Slop and the independent signer with no wait, and 3 by the
// creator and the independent signer after Slop rejected it.
const MULTISIG = "HuAc8gLWm6ZyKtVsW57DZf8vUVSGEPv5iSgUj4L5WEod";
const VAULT = "9Mcf62kqjs227D2NtdetAC9cBiHqUrnqP7TNssxWotHM";
const MEMBERS = {
  creatorMember: "J121yGRih9BrmJPv3GinqFVtdNHrAheaURFdA4GYyE4H",
  slopMember: "3xBt7k8cqCD8auiTxpmCcDhzusQ8csQtpewKV4HGy6ui",
  independentMember: "BxqnpgMtjHfSmNT1KAFa2VwgaM6iXXa2GsVe1Ucxe7CJ",
};
const FALLBACK_PROPOSAL = "BkPzJ2eAvD8ZrfJoUTUhBLFB9gt9e6NBApiCA1VJx4pV";
// Published SDK-compatible multisig and its vault 0, used as a creator seat.
const CREATOR_MULTISIG = "xmWqhNJwNL4z4BcDo1Yh7BbStLU7omVafZNmg91y2Vg";
const CREATOR_SEAT = "FTK6ckiPWbe1jAiRtcPCz9sCrvCV6Y6hAJhAU5b9S3nv";
const SEATED_MEMBERS = { ...MEMBERS, creatorMember: CREATOR_SEAT };
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const FOURTEEN_DAYS = 14 * 24 * 60 * 60;

type Listed = { blockTime: number; err: unknown; signature: string };
type Recorded =
  (typeof fixture.transactions)[keyof typeof fixture.transactions];
const signatures = fixture.signatures as Record<string, Listed[]>;
const transactions = fixture.transactions as Record<string, Recorded>;

function publicKeyBytes(value: string): number[] {
  let number = 0n;
  for (const character of value)
    number = number * 58n + BigInt(BASE58.indexOf(character));
  return Array.from({ length: 32 }, (_, index) =>
    Number((number >> BigInt(8 * (31 - index))) & 255n),
  );
}

function encodeBase58(bytes: readonly number[]): string {
  let number = 0n;
  for (const byte of bytes) number = (number << 8n) | BigInt(byte);
  let encoded = "";
  for (; number > 0n; number /= 58n)
    encoded = BASE58[Number(number % 58n)] + encoded;
  return encoded;
}

function multisigAccount(
  members: typeof MEMBERS = MEMBERS,
  overrides: { configAuthority?: string; owner?: string } = {},
) {
  const bytes = new Uint8Array(231);
  bytes.set([224, 116, 121, 186, 68, 161, 79, 236]);
  if (overrides.configAuthority)
    bytes.set(publicKeyBytes(overrides.configAuthority), 40);
  const view = new DataView(bytes.buffer);
  view.setUint16(72, 2, true);
  view.setUint32(74, 8, true);
  view.setUint32(96, 3, true);
  [
    [members.creatorMember, 7],
    [members.slopMember, 2],
    [members.independentMember, 6],
  ].forEach(([member, mask], index) => {
    bytes.set(publicKeyBytes(member as string), 100 + 33 * index);
    bytes[132 + 33 * index] = mask as number;
  });
  return {
    executable: false,
    owner: overrides.owner ?? SQUADS_V4_PROGRAM_ID,
    data: [btoa(String.fromCharCode(...bytes)), "base64"],
  };
}

interface Authority {
  account?: (address: string) => unknown;
  listed?: (address: string) => Listed[];
  recorded?: (signature: string) => unknown;
  refuse?: number;
}

function authorities(byHost: Record<string, Authority> = {}) {
  const refused = new Map<string, number>();
  const requests: string[] = [];
  const fetchImpl = async (url: URL, init?: RequestInit) => {
    const authority = byHost[url.hostname] ?? {};
    const request = JSON.parse(String(init?.body));
    requests.push(`${url.hostname} ${request.method}`);
    if ((refused.get(url.hostname) ?? 0) < (authority.refuse ?? 0)) {
      refused.set(url.hostname, (refused.get(url.hostname) ?? 0) + 1);
      return new Response("", { status: 429 });
    }
    const result =
      request.method === "getMultipleAccounts"
        ? {
            context: { slot: 600 },
            value: (request.params[0] as string[]).map(
              (address) => authority.account?.(address) ?? multisigAccount(),
            ),
          }
        : request.method === "getSignaturesForAddress"
          ? (authority.listed?.(request.params[0]) ??
            signatures[request.params[0]])
          : (authority.recorded?.(request.params[0]) ??
            transactions[request.params[0]]);
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: request.id, result }),
    );
  };
  return { fetchImpl, requests };
}

const vault = { ...MEMBERS, multisig: MULTISIG, vault: VAULT, vaultIndex: 0 };
const fallbackWait = (
  transactionIndex: number,
  fallbackWaitSeconds: number,
  byHost?: Record<string, Authority>,
) =>
  verifyProjectVaultRules({
    ...vault,
    mode: "fallback-wait",
    transactionIndex,
    fallbackWaitSeconds,
    retryDelayMs: 0,
    fetchImpl: authorities(byHost).fetchImpl,
  });

/** The recorded fallback votes, moved so the last lands `seconds` after opening. */
function votesDelayedBy(seconds: number): Authority {
  const opened = signatures[FALLBACK_PROPOSAL].at(-1) as Listed;
  return {
    recorded: (signature) => {
      const recorded = transactions[signature];
      const vote = recorded.transaction.message.instructions.some(
        (instruction) =>
          "accounts" in instruction &&
          instruction.accounts?.[1] !== MEMBERS.creatorMember &&
          instruction.accounts?.[2] === FALLBACK_PROPOSAL,
      );
      return vote
        ? { ...recorded, blockTime: opened.blockTime + seconds }
        : recorded;
    },
  };
}

describe("project vault fallback wait", () => {
  it("reports a creator release without applying the fallback wait", async () => {
    await expect(fallbackWait(1, FOURTEEN_DAYS)).resolves.toMatchObject({
      state: "verified-on-chain",
      releasePath: "creator",
      fallbackWait: null,
      openedForVotes: { role: "creator", at: 1790708891 },
      approved: { at: 1790708897, by: ["slop", "creator"] },
      executions: [{ role: "creator" }],
      timeLockSeconds: 8,
      verifier: { version: "project-vault-rules-v1", reason: null },
    });
  });

  it("counts a rejection that the other two signers overrode as a creator release", async () => {
    await expect(fallbackWait(3, FOURTEEN_DAYS)).resolves.toMatchObject({
      state: "verified-on-chain",
      releasePath: "creator",
      approved: { by: ["creator", "independent"] },
    });
  });

  it("fails a fallback release whose votes came before the wait had passed", async () => {
    await expect(fallbackWait(2, FOURTEEN_DAYS)).resolves.toMatchObject({
      state: "rule-not-met",
      releasePath: "fallback",
      proposal: FALLBACK_PROPOSAL,
      approved: { by: ["slop", "independent"] },
      fallbackWait: {
        requiredSeconds: FOURTEEN_DAYS,
        shortestObservedSeconds: 1,
        satisfied: false,
      },
      executions: [{ role: "independent" }],
      verifier: {
        reason: "a fallback approval came before the fallback wait had passed",
      },
    });
  });

  it("accepts the same fallback release once both votes follow the wait", async () => {
    const late = votesDelayedBy(FOURTEEN_DAYS);
    const early = votesDelayedBy(FOURTEEN_DAYS - 1);
    const everywhere = (authority: Authority) => ({
      "api.mainnet-beta.solana.com": authority,
      "solana-rpc.publicnode.com": authority,
      "solana.drpc.org": authority,
    });
    await expect(
      fallbackWait(2, FOURTEEN_DAYS, everywhere(late)),
    ).resolves.toMatchObject({
      state: "verified-on-chain",
      releasePath: "fallback",
      fallbackWait: { shortestObservedSeconds: FOURTEEN_DAYS, satisfied: true },
    });
    await expect(
      fallbackWait(2, FOURTEEN_DAYS, everywhere(early)),
    ).resolves.toMatchObject({
      state: "rule-not-met",
      fallbackWait: { shortestObservedSeconds: FOURTEEN_DAYS - 1 },
    });
  });

  it("fails closed when authorities disagree on when a vote was cast", async () => {
    await expect(
      fallbackWait(2, FOURTEEN_DAYS, {
        "api.mainnet-beta.solana.com": votesDelayedBy(FOURTEEN_DAYS),
        "solana-rpc.publicnode.com": votesDelayedBy(FOURTEEN_DAYS - 1),
        "solana.drpc.org": { recorded: () => null },
      }),
    ).rejects.toThrow(/did not reach commitment quorum/u);
  });

  it("retries only a rate limit refusal and reaches quorum without the third authority", async () => {
    const { fetchImpl, requests } = authorities({
      "api.mainnet-beta.solana.com": { refuse: 2 },
      "solana.drpc.org": { refuse: 100 },
    });
    await expect(
      verifyProjectVaultRules({
        ...vault,
        mode: "fallback-wait",
        transactionIndex: 1,
        fallbackWaitSeconds: 0,
        retryDelayMs: 0,
        fetchImpl,
      }),
    ).resolves.toMatchObject({
      authorities: [
        { authority: "https://api.mainnet-beta.solana.com/" },
        { authority: "https://solana-rpc.publicnode.com/" },
      ],
    });
    expect(
      requests.filter((request) => request.startsWith("solana.drpc.org")),
    ).toHaveLength(6);
  });
});

function history(): SquadsHistoryEntry[] {
  return signatures[MULTISIG]
    .filter(({ err }) => err === null)
    .map(({ signature }) =>
      assertSquadsHistoryEntry(transactions[signature], signature),
    );
}

/** One extra successful transaction, newest first like the RPC listing. */
function withInstruction(
  entries: SquadsHistoryEntry[],
  name: SquadsHistoryEntry["instructions"][number]["name"],
  accounts: string[],
  data: number[] = [],
): SquadsHistoryEntry[] {
  return [
    {
      blockTime: entries[0].blockTime + 1,
      instructions: [{ accounts, data: Uint8Array.from(data), name }],
      signature: encodeBase58(Array.from({ length: 64 }, () => entries.length)),
      slot: entries[0].slot + 1,
    },
    ...entries,
  ];
}

const CONFIG_TRANSACTION = MEMBERS.slopMember;
const addSpendingLimit = [
  ...[155, 236, 87, 228, 137, 75, 81, 39],
  ...[2, 0, 0, 0],
  // Set the time lock first, so the limit is not the first action.
  ...[3, 0, 0, 0, 0],
  4,
  ...publicKeyBytes(MEMBERS.slopMember),
  0,
  ...publicKeyBytes(VAULT),
  ...[1, 0, 0, 0, 0, 0, 0, 0],
  0,
  ...[1, 0, 0, 0],
  ...publicKeyBytes(MEMBERS.independentMember),
  ...[0, 0, 0, 0],
  0,
];

describe("project vault spending limits", () => {
  it("passes the recorded vault, whose history reaches its creation", async () => {
    await expect(
      verifyProjectVaultRules({
        ...vault,
        mode: "spending-limits",
        retryDelayMs: 0,
        fetchImpl: authorities().fetchImpl,
      }),
    ).resolves.toMatchObject({
      state: "verified-on-chain",
      rule: "no-spending-limits",
      satisfied: true,
      transactionCount: 39,
      created: [],
      proposed: [],
      used: [],
    });
  });

  it("fails closed on a history that does not reach the multisig creation", async () => {
    await expect(
      verifyProjectVaultRules({
        ...vault,
        mode: "spending-limits",
        retryDelayMs: 0,
        fetchImpl: authorities({
          "api.mainnet-beta.solana.com": {
            listed: (address) => signatures[address].slice(0, -1),
          },
          "solana-rpc.publicnode.com": {
            listed: (address) => signatures[address].slice(0, -1),
          },
        }).fetchImpl,
      }),
    ).rejects.toThrow(/did not reach commitment quorum/u);
    expect(() =>
      assertNoSpendingLimitHistory(history().slice(0, -1), MULTISIG),
    ).toThrow(/does not reach the creation of the multisig/u);
  });

  it("reports a proposed limit and fails only once it is created", () => {
    const proposed = withInstruction(
      history(),
      "config_transaction_create",
      [MULTISIG, CONFIG_TRANSACTION, MEMBERS.creatorMember],
      addSpendingLimit,
    );
    expect(assertNoSpendingLimitHistory(proposed, MULTISIG)).toMatchObject({
      satisfied: true,
      proposed: [proposed[0].signature],
      created: [],
    });
    const created = withInstruction(proposed, "config_transaction_execute", [
      MULTISIG,
      MEMBERS.creatorMember,
      MEMBERS.independentMember,
      CONFIG_TRANSACTION,
    ]);
    expect(assertNoSpendingLimitHistory(created, MULTISIG)).toMatchObject({
      satisfied: false,
      created: [created[0].signature],
    });
  });

  it("fails on a limit added by an authority or used by a single key", () => {
    const added = withInstruction(history(), "multisig_add_spending_limit", [
      MULTISIG,
      MEMBERS.creatorMember,
    ]);
    expect(assertNoSpendingLimitHistory(added, MULTISIG)).toMatchObject({
      satisfied: false,
      created: [added[0].signature],
    });
    const used = withInstruction(history(), "spending_limit_use", [
      MULTISIG,
      MEMBERS.independentMember,
    ]);
    expect(assertNoSpendingLimitHistory(used, MULTISIG)).toMatchObject({
      satisfied: false,
      used: [used[0].signature],
    });
  });

  it("fails closed on truncated actions and on an execution with no recorded proposal", () => {
    expect(() =>
      assertNoSpendingLimitHistory(
        withInstruction(
          history(),
          "config_transaction_create",
          [MULTISIG, CONFIG_TRANSACTION],
          addSpendingLimit.slice(0, -40),
        ),
        MULTISIG,
      ),
    ).toThrow(/actions are not canonical/u);
    expect(() =>
      assertNoSpendingLimitHistory(
        withInstruction(history(), "config_transaction_execute", [
          MULTISIG,
          MEMBERS.creatorMember,
          MEMBERS.independentMember,
          CONFIG_TRANSACTION,
        ]),
        MULTISIG,
      ),
    ).toThrow(/missing an executed config transaction/u);
  });
});

describe("project vault creator seat", () => {
  const seated = (account: (address: string) => unknown) => {
    const authority = { account };
    return verifyProjectVaultRules({
      ...vault,
      ...SEATED_MEMBERS,
      mode: "creator-seat",
      creatorMultisig: CREATOR_MULTISIG,
      retryDelayMs: 0,
      fetchImpl: authorities({
        "api.mainnet-beta.solana.com": authority,
        "solana-rpc.publicnode.com": authority,
        "solana.drpc.org": authority,
      }).fetchImpl,
    });
  };
  const creatorMultisig =
    (overrides = {}) =>
    (address: string) =>
      address === CREATOR_MULTISIG
        ? multisigAccount(MEMBERS, overrides)
        : multisigAccount(SEATED_MEMBERS);

  it("verifies a creator seat that is the vault of the creator's own multisig", async () => {
    await expect(seated(creatorMultisig())).resolves.toMatchObject({
      state: "verified-on-chain",
      rule: "creator-seat",
      creatorMember: CREATOR_SEAT,
      creatorSeat: {
        creatorMultisig: CREATOR_MULTISIG,
        creatorVaultIndex: 0,
        threshold: 2,
        memberCount: 3,
        timeLockSeconds: 8,
        configAuthority: false,
      },
      verifier: {
        reason: null,
        evidenceUrl: `https://solscan.io/account/${CREATOR_MULTISIG}`,
      },
    });
  });

  it("reports a creator multisig that keeps a config authority without judging it", async () => {
    await expect(
      seated(creatorMultisig({ configAuthority: MEMBERS.slopMember })),
    ).resolves.toMatchObject({
      state: "verified-on-chain",
      creatorSeat: { configAuthority: true },
    });
  });

  it("fails closed when the seat is a plain key or the multisig is not Squads", async () => {
    await expect(
      verifyProjectVaultRules({
        ...vault,
        mode: "creator-seat",
        creatorMultisig: CREATOR_MULTISIG,
        retryDelayMs: 0,
        fetchImpl: authorities().fetchImpl,
      }),
    ).rejects.toThrow(/did not reach commitment quorum/u);
    await expect(
      seated(creatorMultisig({ owner: SPL_TOKEN_PROGRAM_ID })),
    ).rejects.toThrow(/did not reach commitment quorum/u);
    await expect(
      assertSquadsCreatorSeat(
        multisigAccount(MEMBERS, { owner: SPL_TOKEN_PROGRAM_ID }),
        CREATOR_MULTISIG,
        CREATOR_SEAT,
        0,
      ),
    ).rejects.toThrow(/not owned by the Squads v4 program/u);
    await expect(
      assertSquadsCreatorSeat(
        multisigAccount(),
        CREATOR_MULTISIG,
        MEMBERS.creatorMember,
        0,
      ),
    ).rejects.toThrow(/not the canonical vault of the creator multisig/u);
    await expect(
      assertSquadsCreatorSeat(
        multisigAccount(),
        CREATOR_MULTISIG,
        CREATOR_SEAT,
        1,
      ),
    ).rejects.toThrow(/not the canonical vault of the creator multisig/u);
  });
});

describe("project vault rule arguments", () => {
  const shared = [
    ...["--multisig", MULTISIG, "--vault", VAULT, "--vault-index", "0"],
    ...["--creator-member", MEMBERS.creatorMember],
    ...["--slop-member", MEMBERS.slopMember],
    ...["--independent-member", MEMBERS.independentMember],
  ];
  it("requires the payout fields in fallback-wait mode and refuses them otherwise", () => {
    expect(
      parseProjectVaultRulesArguments([
        ...["--mode", "fallback-wait", ...shared],
        ...["--transaction-index", "2"],
        ...["--fallback-wait-seconds", "1209600"],
      ]),
    ).toMatchObject({ transactionIndex: 2, fallbackWaitSeconds: 1209600 });
    expect(
      parseProjectVaultRulesArguments([
        ...["--mode", "creator-seat", ...shared],
        ...[
          "--creator-multisig",
          CREATOR_MULTISIG,
          "--creator-vault-index",
          "3",
        ],
      ]),
    ).toMatchObject({
      creatorMultisig: CREATOR_MULTISIG,
      creatorVaultIndex: 3,
    });
    for (const argv of [
      ["--mode", "fallback-wait", ...shared, "--transaction-index", "2"],
      ["--mode", "spending-limits", ...shared, "--transaction-index", "2"],
      ["--mode", "creator-seat", ...shared],
      [
        "--mode",
        "spending-limits",
        ...shared,
        "--creator-multisig",
        CREATOR_MULTISIG,
      ],
      [
        "--mode",
        "fallback-wait",
        ...shared,
        "--transaction-index",
        "2",
        "--fallback-wait-seconds",
        "1",
        "--creator-vault-index",
        "0",
      ],
      [
        ...["--mode", "fallback-wait", ...shared],
        ...["--transaction-index", "2", "--fallback-wait-seconds", "1e6"],
      ],
    ])
      expect(() => parseProjectVaultRulesArguments(argv)).toThrow(/Usage/u);
  });
});
