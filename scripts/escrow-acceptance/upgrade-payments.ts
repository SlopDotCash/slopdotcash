/** Only exact payments of awards already present at the upgrade boundary may change its snapshot. */
import assert from "node:assert/strict";
import { encodeAbiParameters, keccak256, toEventSelector, toHex } from "viem";
import {
  type EvmEscrowConfig,
  verifyPayment,
} from "../../contracts/evm/adapter";
import type { EvmChain } from "./evm";
import type { Qualification, VaultRecord } from "./upgrade-verification";

const PAID = toEventSelector(
  "Paid(bytes32,uint64,address,uint64,uint128,uint128,uint128)",
);
const CREATED = toEventSelector(
  "VaultCreated(bytes32,address,address,address,uint8,uint8)",
);
const mask = (bits: bigint) => (1n << bits) - 1n;
const field = (value: string, offset: bigint, bits: bigint) =>
  (BigInt(value) >> offset) & mask(bits);
const address = (value: string) => toHex(field(value, 0n, 160n), { size: 20 });
const mapping = (key: string | bigint, slot: bigint, offset = 0n) =>
  toHex(
    BigInt(
      keccak256(
        encodeAbiParameters(
          [{ type: "uint256" }, { type: "uint256" }],
          [BigInt(key), slot],
        ),
      ),
    ) + offset,
    { size: 32 },
  );
const setField = (
  value: string,
  offset: bigint,
  bits: bigint,
  next: bigint,
) => {
  assert(
    next >= 0n && next <= mask(bits),
    "Later payment exceeds stored accounting range",
  );
  return toHex((BigInt(value) & ~(mask(bits) << offset)) | (next << offset), {
    size: 32,
  });
};

export function upgradeVaultConfig(
  run: Qualification,
  chain: EvmChain,
  record: VaultRecord,
): EvmEscrowConfig {
  const purpose = field(record.slots[2], 160n, 8n);
  assert(purpose === 0n || purpose === 1n, "Unrecognized vault purpose");
  assert.equal(
    address(record.slots[4]),
    run.factory.toLowerCase(),
    "Vault factory changed",
  );
  return {
    request: (method, params) => chain.rpc(method, params),
    chainId: BigInt(run.chainId),
    vault: record.vault,
    asset: address(record.slots[0]),
    owner: address(record.slots[2]),
    feeRecipient: address(record.slots[3]),
    identityAuthority: run.roles.identityAuthority,
    bindingDelaySeconds: field(record.slots[4], 160n, 64n).toString(),
    factory: run.factory,
    registrar: run.roles.registrar,
    codeSha256: record.codeSha256,
    factoryCodeSha256: run.before.factoryCodeSha256,
    ...(purpose === 1n ? { payoutPolicy: "security-bounty" as const } : {}),
    evmUpgrade: {
      authority: run.roles.upgradeAuthority,
      vaultImplementation: run.review.vaultImplementation,
      vaultImplementationCodeSha256: run.review.vaultImplementationCodeSha256,
      factoryImplementation: run.review.factoryImplementation,
      factoryImplementationCodeSha256:
        run.review.factoryImplementationCodeSha256,
    },
  };
}

interface Log {
  address: string;
  topics: string[];
  data: string;
  transactionHash: string;
  blockNumber: string;
  blockHash: string;
  logIndex: string;
  removed?: boolean;
}

export async function reconcileUpgradePayments(
  run: Qualification,
  chain: EvmChain,
  records: VaultRecord[],
  from: bigint,
  through: bigint,
  page: bigint,
) {
  const expected = new Map(
    records.map((record) => [record.vault, structuredClone(record)]),
  );
  const logs: Log[] = [];
  const targets = [run.factory, ...records.map((record) => record.vault)];
  for (const target of targets)
    for (let start = from + 1n; start <= through; start += page) {
      const end = start + page - 1n < through ? start + page - 1n : through;
      const batch = await chain.rpc("eth_getLogs", [
        { address: target, fromBlock: toHex(start), toBlock: toHex(end) },
      ]);
      assert(Array.isArray(batch), "Later activity history is unavailable");
      for (const value of batch) {
        const log = value as Log;
        assert(
          log &&
            log.address?.toLowerCase() === target.toLowerCase() &&
            !log.removed &&
            Array.isArray(log.topics) &&
            BigInt(log.blockNumber) >= start &&
            BigInt(log.blockNumber) <= end,
          "Invalid later activity log",
        );
        // New factory-created vaults are checked independently in the current inventory.
        if (target === run.factory && log.topics[0]?.toLowerCase() === CREATED)
          continue;
        assert(
          target !== run.factory && log.topics[0]?.toLowerCase() === PAID,
          "Later non-payment activity is unqualified; preserve the plan and review that event separately",
        );
        logs.push(log);
      }
    }
  logs.sort((a, b) =>
    BigInt(a.blockNumber) === BigInt(b.blockNumber)
      ? Number(BigInt(a.logIndex) - BigInt(b.logIndex))
      : BigInt(a.blockNumber) < BigInt(b.blockNumber)
        ? -1
        : 1,
  );
  const seen = new Set<string>();
  const payments = [];
  const balances = new Map<
    string,
    { asset: string; account: string; block: bigint; delta: bigint }
  >();
  const addBalance = (
    asset: string,
    account: string,
    block: bigint,
    delta: bigint,
  ) => {
    const key = `${asset}:${account}:${block}`;
    const entry = balances.get(key) ?? { asset, account, block, delta: 0n };
    entry.delta += delta;
    balances.set(key, entry);
  };
  for (const log of logs) {
    const tx = log.transactionHash.toLowerCase();
    const eventIndex = Number(BigInt(log.logIndex));
    const key = `${tx}:${eventIndex}`;
    assert(!seen.has(key), "Duplicate later payment event");
    seen.add(key);
    const record = expected.get(log.address.toLowerCase());
    assert(record, "Unknown later payment vault");
    const config = upgradeVaultConfig(run, chain, record);
    const payment = await verifyPayment(config, tx, eventIndex, log.topics[1]);
    assert(
      payment.bindingVersion && payment.destination,
      "Later payment has no binding identity",
    );
    assert.equal(
      payment.blockId.toLowerCase(),
      log.blockHash.toLowerCase(),
      "Later payment history and receipt differ",
    );
    const actor = BigInt(payment.githubUserId),
      gross = BigInt(payment.grossMicro),
      fee = BigInt(payment.feeMicro),
      net = BigInt(payment.netMicro);
    const award = mapping(payment.obligationId, 11n),
      awardFee = mapping(payment.obligationId, 11n, 1n),
      paid = mapping(payment.obligationId, 11n, 3n);
    const binding = mapping(actor, 13n),
      bindingState = mapping(actor, 13n, 2n);
    for (const slot of [
      award,
      awardFee,
      paid,
      binding,
      bindingState,
      mapping(actor, 14n),
      mapping(actor, 16n),
    ])
      assert(
        Object.hasOwn(record.mappings, slot),
        "Later payment does not belong to a frozen award and binding",
      );
    assert.equal(
      field(record.mappings[award], 0n, 64n),
      actor,
      "Later payment actor differs from the frozen award",
    );
    assert.equal(
      field(record.mappings[award], 64n, 128n),
      gross,
      "Later payment gross differs from the frozen award",
    );
    assert.equal(
      field(record.mappings[awardFee], 0n, 128n),
      fee,
      "Later payment fee differs from the stored historical fee",
    );
    assert.equal(
      field(record.mappings[paid], 64n, 8n),
      0n,
      "Later payment repeats a paid award",
    );
    assert.equal(
      field(record.mappings[bindingState], 64n, 8n),
      0n,
      "Later payment binding was cancelled",
    );
    assert.equal(
      address(record.mappings[binding]),
      payment.destination,
      "Later payment destination differs from the frozen binding",
    );
    assert.equal(
      field(record.mappings[binding], 160n, 64n).toString(),
      payment.bindingVersion,
      "Later payment binding version differs",
    );
    record.mappings[paid] = setField(record.mappings[paid], 64n, 8n, 1n);
    record.mappings[mapping(actor, 14n)] = toHex(
      BigInt(payment.bindingVersion),
      { size: 32 },
    );
    record.mappings[mapping(actor, 16n)] = toHex(0n, { size: 32 });
    for (const [slot, offset, delta] of [
      [5, 128n, -net],
      [6, 0n, -fee],
      [7, 0n, net],
      [7, 128n, fee],
      [9, 0n, fee],
    ] as const)
      record.slots[slot] = setField(
        record.slots[slot],
        offset,
        128n,
        field(record.slots[slot], offset, 128n) + delta,
      );
    const destination = payment.destination;
    addBalance(config.asset, record.vault, BigInt(log.blockNumber), -net);
    addBalance(config.asset, destination, BigInt(log.blockNumber), net);
    payments.push({
      ...payment,
      vault: record.vault,
      block: BigInt(log.blockNumber).toString(),
    });
  }
  // Exact balance movement is authoritative, including test ERC-20s without
  // Transfer logs. Reviewed pay() checks these same deltas within each call.
  for (const item of balances.values()) {
    const before = await chain.balance(
      item.asset,
      item.account,
      toHex(item.block - 1n),
    );
    const after = await chain.balance(
      item.asset,
      item.account,
      toHex(item.block),
    );
    assert.equal(
      after - before,
      item.delta,
      "Later payment token balance delta is unexplained",
    );
  }
  return { expected, payments };
}
