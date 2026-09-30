import { assertFreshCyclePaymentPolicy } from "./fresh-cycle-policy.mjs";
import { resolveRewardCapMinor } from "./reward-cap.mjs";

/**
 * Validates reviewed committed-funding instrument references. Each instrument
 * points at a third-party, immutable, audited on-chain contract that Slop
 * never controls: a Squads v4 multisig vault on Solana or a Sablier Lockup v4
 * stream on Base or Ethereum. In the 2-of-2 vault and the Sablier stream Slop
 * holds no key, admin, or fee position. In the 2-of-3 project vault (RFC #500)
 * Slop holds one vote-only key: it cannot write, execute, or block a transfer,
 * change a signer, or act alone. Slop holds no admin or fee position in any
 * instrument.
 */

import { isFundingAddress } from "./funding-address.mjs";

/** Sablier Lockup v4 deployments; the only accepted EVM stream contracts. */
export const SABLIER_LOCKUP_V4_CONTRACTS = Object.freeze({
  base: "0xc19a09a66887017f603e5df420ed3cb9a5c07c0a",
  ethereum: "0x93b37bd5b6b278373217333ac30d7e74c85fbdcb",
});

function commitmentTimestamp(value, field) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new TypeError(`${field} is invalid`);
  }
  return value;
}

function commitmentRecord(value, field) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value;
}

function exactCommitmentKeys(value, keys, field) {
  if (Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) {
    throw new TypeError(`${field} has unexpected or missing fields`);
  }
}

function commitmentWindow(candidate, field) {
  const effectiveAt = commitmentTimestamp(
    candidate.effectiveAt,
    `${field}.effectiveAt`,
  );
  const deadline = commitmentTimestamp(candidate.deadline, `${field}.deadline`);
  if (Date.parse(deadline) <= Date.parse(effectiveAt)) {
    throw new TypeError(`${field}.deadline must follow effectiveAt`);
  }
  const replacedAt =
    candidate.replacedAt === null
      ? null
      : commitmentTimestamp(candidate.replacedAt, `${field}.replacedAt`);
  if (
    replacedAt !== null &&
    Date.parse(replacedAt) <= Date.parse(effectiveAt)
  ) {
    throw new TypeError(`${field}.replacedAt must follow effectiveAt`);
  }
  return { deadline, effectiveAt, replacedAt };
}

function validateSquadsInstrument(candidate, field) {
  exactCommitmentKeys(
    candidate,
    [
      "asset",
      "deadline",
      "effectiveAt",
      "funderActorId",
      "funderMember",
      "kind",
      ...(Object.hasOwn(candidate, "monthlyCommitment")
        ? ["monthlyCommitment"]
        : []),
      "multisig",
      "network",
      "replacedAt",
      "stewardMember",
      ...(Object.hasOwn(candidate, "stewardGithub") ? ["stewardGithub"] : []),
      "vault",
      "vaultIndex",
    ],
    field,
  );
  if (candidate.network !== "solana" || candidate.asset !== "USDC") {
    throw new TypeError(`${field} network or asset is unsupported`);
  }
  if (!isFundingAddress("solana", candidate.multisig)) {
    throw new TypeError(`${field}.multisig is invalid`);
  }
  if (!isFundingAddress("solana", candidate.vault)) {
    throw new TypeError(`${field}.vault is invalid`);
  }
  if (candidate.multisig === candidate.vault) {
    throw new TypeError(`${field} multisig and vault must differ`);
  }
  if (
    !Number.isSafeInteger(candidate.vaultIndex) ||
    candidate.vaultIndex < 0 ||
    candidate.vaultIndex > 255
  ) {
    throw new TypeError(`${field}.vaultIndex must be an unsigned byte`);
  }
  if (
    typeof candidate.funderActorId !== "string" ||
    !/^[1-9]\d{0,19}$/u.test(candidate.funderActorId)
  ) {
    throw new TypeError(`${field}.funderActorId is invalid`);
  }
  if (
    !isFundingAddress("solana", candidate.funderMember) ||
    !isFundingAddress("solana", candidate.stewardMember) ||
    candidate.funderMember === candidate.stewardMember
  ) {
    throw new TypeError(`${field} members must be distinct Solana public keys`);
  }
  const window = commitmentWindow(candidate, field);
  return {
    kind: "squads-v4-vault",
    network: "solana",
    asset: "USDC",
    multisig: candidate.multisig,
    vault: candidate.vault,
    vaultIndex: candidate.vaultIndex,
    funderActorId: candidate.funderActorId,
    funderMember: candidate.funderMember,
    stewardMember: candidate.stewardMember,
    ...(Object.hasOwn(candidate, "stewardGithub")
      ? { stewardGithub: validateStewardGithub(candidate.stewardGithub, field) }
      : {}),
    ...monthlyCommitment(candidate, field),
    ...window,
  };
}

/** Squads v4 caps a multisig time lock at 90 days. */
export const PROJECT_VAULT_MAX_TIME_LOCK_SECONDS = 90 * 24 * 60 * 60;
/** RFC #500 defaults. Each manifest declares its own values within the cap. */
export const PROJECT_VAULT_DEFAULT_TIME_LOCK_SECONDS = 72 * 60 * 60;
export const PROJECT_VAULT_DEFAULT_FALLBACK_WAIT_SECONDS = 14 * 24 * 60 * 60;

/**
 * The 2-of-3 project vault from RFC #500: creator (Initiate, Vote, Execute),
 * Slop (Vote only), independent signer (Vote, Execute), threshold 2, no
 * configuration authority. The manifest declares the reviewed members, the
 * creator's own multisig behind the creator seat, and the two waits. Masks,
 * threshold, PDA derivation, and the observed time lock are proven by the
 * read-only verifier, never assumed here. A project vault always carries a
 * monthly binding; it has no legacy unscoped form.
 */
function validateProjectVaultInstrument(candidate, field) {
  exactCommitmentKeys(
    candidate,
    [
      "asset",
      "creatorActorId",
      "creatorMember",
      "creatorMultisig",
      "creatorVaultIndex",
      "deadline",
      "effectiveAt",
      "fallbackWaitSeconds",
      "independentGithub",
      "independentMember",
      "kind",
      "monthlyCommitment",
      "multisig",
      "network",
      "replacedAt",
      "slopMember",
      "timeLockSeconds",
      "vault",
      "vaultIndex",
    ],
    field,
  );
  if (candidate.network !== "solana" || candidate.asset !== "USDC") {
    throw new TypeError(`${field} network or asset is unsupported`);
  }
  const addressKeys = [
    "multisig",
    "vault",
    "creatorMember",
    "creatorMultisig",
    "slopMember",
    "independentMember",
  ];
  for (const key of addressKeys) {
    if (!isFundingAddress("solana", candidate[key])) {
      throw new TypeError(`${field}.${key} is invalid`);
    }
  }
  if (new Set(addressKeys.map((key) => candidate[key])).size !== 6) {
    throw new TypeError(
      `${field} multisig, vault, creator multisig, and members must be distinct`,
    );
  }
  for (const key of ["vaultIndex", "creatorVaultIndex"]) {
    if (
      !Number.isSafeInteger(candidate[key]) ||
      candidate[key] < 0 ||
      candidate[key] > 255
    ) {
      throw new TypeError(`${field}.${key} must be an unsigned byte`);
    }
  }
  if (
    typeof candidate.creatorActorId !== "string" ||
    !/^[1-9]\d{0,19}$/u.test(candidate.creatorActorId)
  ) {
    throw new TypeError(`${field}.creatorActorId is invalid`);
  }
  const { timeLockSeconds, fallbackWaitSeconds } = candidate;
  if (
    !Number.isSafeInteger(timeLockSeconds) ||
    timeLockSeconds < 1 ||
    timeLockSeconds > PROJECT_VAULT_MAX_TIME_LOCK_SECONDS
  ) {
    throw new TypeError(
      `${field}.timeLockSeconds must be between 1 and ${PROJECT_VAULT_MAX_TIME_LOCK_SECONDS}`,
    );
  }
  if (
    !Number.isSafeInteger(fallbackWaitSeconds) ||
    fallbackWaitSeconds < timeLockSeconds ||
    fallbackWaitSeconds > PROJECT_VAULT_MAX_TIME_LOCK_SECONDS
  ) {
    throw new TypeError(
      `${field}.fallbackWaitSeconds must be at least the time lock and at most ${PROJECT_VAULT_MAX_TIME_LOCK_SECONDS}`,
    );
  }
  const window = commitmentWindow(candidate, field);
  return {
    kind: "squads-project-vault",
    network: "solana",
    asset: "USDC",
    multisig: candidate.multisig,
    vault: candidate.vault,
    vaultIndex: candidate.vaultIndex,
    creatorActorId: candidate.creatorActorId,
    creatorMember: candidate.creatorMember,
    creatorMultisig: candidate.creatorMultisig,
    creatorVaultIndex: candidate.creatorVaultIndex,
    slopMember: candidate.slopMember,
    independentMember: candidate.independentMember,
    independentGithub: validateGithubIdentity(
      candidate.independentGithub,
      `${field}.independentGithub`,
    ),
    timeLockSeconds,
    fallbackWaitSeconds,
    ...monthlyCommitment(candidate, field),
    ...window,
  };
}

function validateSablierInstrument(candidate, field) {
  exactCommitmentKeys(
    candidate,
    [
      "asset",
      "contract",
      "deadline",
      "effectiveAt",
      "kind",
      ...(Object.hasOwn(candidate, "monthlyCommitment")
        ? ["monthlyCommitment"]
        : []),
      "network",
      "recipient",
      "replacedAt",
      "streamId",
    ],
    field,
  );
  if (
    (candidate.network !== "base" && candidate.network !== "ethereum") ||
    candidate.asset !== "USDC"
  ) {
    throw new TypeError(`${field} network or asset is unsupported`);
  }
  if (candidate.contract !== SABLIER_LOCKUP_V4_CONTRACTS[candidate.network]) {
    throw new TypeError(
      `${field}.contract is not the reviewed Sablier Lockup v4 deployment`,
    );
  }
  if (!isFundingAddress(candidate.network, candidate.recipient)) {
    throw new TypeError(`${field}.recipient is invalid`);
  }
  if (
    typeof candidate.streamId !== "string" ||
    candidate.streamId.length > 78 ||
    !/^[1-9]\d*$/u.test(candidate.streamId)
  ) {
    throw new TypeError(`${field}.streamId is invalid`);
  }
  const window = commitmentWindow(candidate, field);
  return {
    kind: "sablier-lockup-v4",
    network: candidate.network,
    asset: "USDC",
    contract: candidate.contract,
    recipient: candidate.recipient,
    streamId: candidate.streamId,
    ...monthlyCommitment(candidate, field),
    ...window,
  };
}

function validateStewardGithub(value, field) {
  return validateGithubIdentity(value, `${field}.stewardGithub`);
}

function validateGithubIdentity(value, field) {
  const identity = commitmentRecord(value, field);
  exactCommitmentKeys(identity, ["actorId", "nodeId", "login"], field);
  if (
    typeof identity.actorId !== "string" ||
    !/^[1-9]\d{0,19}$/u.test(identity.actorId) ||
    typeof identity.nodeId !== "string" ||
    !/^[A-Za-z0-9_=-]{1,100}$/u.test(identity.nodeId) ||
    typeof identity.login !== "string" ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u.test(identity.login)
  )
    throw new TypeError(`${field} is invalid`);
  return {
    actorId: identity.actorId,
    nodeId: identity.nodeId,
    login: identity.login,
  };
}

/** Legacy references stay parseable, but cannot activate a current commitment. */
function monthlyCommitment(candidate, field) {
  if (!Object.hasOwn(candidate, "monthlyCommitment")) return {};
  const monthly = commitmentRecord(
    candidate.monthlyCommitment,
    `${field}.monthlyCommitment`,
  );
  exactCommitmentKeys(
    monthly,
    ["cycleId", "amountMinor", "accessibility"],
    `${field}.monthlyCommitment`,
  );
  if (
    typeof monthly.cycleId !== "string" ||
    !/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(monthly.cycleId)
  ) {
    throw new TypeError(`${field}.monthlyCommitment.cycleId is invalid`);
  }
  if (
    typeof monthly.amountMinor !== "string" ||
    !/^[1-9]\d{0,39}$/u.test(monthly.amountMinor)
  ) {
    throw new TypeError(
      `${field}.monthlyCommitment.amountMinor must be positive integer minor units`,
    );
  }
  if (monthly.accessibility !== "unknown") {
    throw new TypeError(
      `${field} accessibility must remain unknown until an authenticated evidence protocol is reviewed`,
    );
  }
  const start = `${monthly.cycleId}-01T00:00:00.000Z`;
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  if (
    candidate.effectiveAt !== start ||
    candidate.deadline !== end.toISOString()
  ) {
    throw new TypeError(
      `${field} instrument period must match exactly one calendar month`,
    );
  }
  return {
    monthlyCommitment: {
      cycleId: monthly.cycleId,
      amountMinor: monthly.amountMinor,
      accessibility: "unknown",
    },
  };
}

/**
 * Current manifest policy, not a claim of independent control or key access.
 * Identity/key control still requires human review; inequalities only reject
 * contradictions already visible in the manifest. No accessibility evidence
 * permits only an explicit fresh-cycle policy; runtime readiness stays mandatory.
 */
export function assertMonthlyCommitmentPolicy(project) {
  const instruments = assertFundingCommitments(
    project.funding.commitments ?? [],
  );
  const attributed = new Set(
    project.funding.addresses.map(({ address }) => address),
  );
  for (const instrument of instruments) {
    if (instrument.kind === "squads-v4-vault") {
      attributed.add(instrument.funderMember);
      attributed.add(instrument.multisig);
      attributed.add(instrument.vault);
    } else if (instrument.kind === "squads-project-vault") {
      attributed.add(instrument.creatorMember);
      attributed.add(instrument.creatorMultisig);
      attributed.add(instrument.multisig);
      attributed.add(instrument.vault);
    }
  }
  const cycles = new Set();
  for (const instrument of instruments) {
    const monthly = instrument.monthlyCommitment;
    if (!monthly) {
      if (instrument.replacedAt !== null) continue;
      throw new TypeError(
        "active commitment requires a monthly instrument binding",
      );
    }
    if (cycles.has(monthly.cycleId))
      throw new TypeError(
        "only one instrument may back each monthly commitment across all networks",
      );
    cycles.add(monthly.cycleId);
    // Do not reinterpret immutable historical authority or caps under today's policy.
    if (instrument.replacedAt !== null) continue;
    const cap =
      BigInt(resolveRewardCapMinor(project, monthly.cycleId)) +
      BigInt(project.reward.reviewBudget?.monthlyCapMinor ?? "0");
    if (BigInt(monthly.amountMinor) > cap)
      throw new TypeError(
        "monthly instrument amount exceeds the monthly reward caps",
      );
    if (instrument.kind === "squads-v4-vault") {
      const identity = instrument.stewardGithub;
      if (!identity)
        throw new TypeError(
          "monthly Squads commitment requires a named independent steward GitHub identity",
        );
      if (
        identity.actorId === instrument.funderActorId ||
        identity.actorId === project.steward.github.actorId ||
        identity.nodeId === project.steward.github.nodeId ||
        identity.login.toLowerCase() ===
          project.steward.github.login.toLowerCase()
      ) {
        throw new TypeError(
          "Squads steward identity must differ from the project steward and funder",
        );
      }
      if (attributed.has(instrument.stewardMember))
        throw new TypeError(
          "Squads steward member must differ from every manifest-attributed project or funder address",
        );
    }
    if (instrument.kind === "squads-project-vault") {
      const identity = instrument.independentGithub;
      if (
        identity.actorId === instrument.creatorActorId ||
        identity.actorId === project.steward.github.actorId ||
        identity.nodeId === project.steward.github.nodeId ||
        identity.login.toLowerCase() ===
          project.steward.github.login.toLowerCase()
      ) {
        throw new TypeError(
          "project vault independent signer identity must differ from the project steward and creator",
        );
      }
      if (
        attributed.has(instrument.slopMember) ||
        attributed.has(instrument.independentMember)
      )
        throw new TypeError(
          "project vault Slop and independent members must differ from every manifest-attributed project or creator address",
        );
    }
  }
  if (
    project.reward.paymentMode === "enabled" ||
    project.reward.reviewBudget?.paymentMode === "enabled"
  ) {
    if (!project.funding.freshCyclePaymentPolicy)
      throw new TypeError(
        "funding accessibility is unknown; payment activation requires a reviewed authenticated evidence protocol",
      );
    const policy = assertFreshCyclePaymentPolicy(
      project.funding.freshCyclePaymentPolicy,
    );
    const active = instruments.filter((v) => v.replacedAt === null);
    // Either reviewed Squads shape may activate: the 2-of-2 commitment vault,
    // or the 2-of-3 project vault (RFC #500) whose readiness, reservation,
    // signer-capability, and approval-binding rules cover three members.
    if (
      project.reward.kind !== "monthly-pool" ||
      project.reward.reviewBudget ||
      policy.projectId !== project.id ||
      active.length !== 1 ||
      (active[0].kind !== "squads-v4-vault" &&
        active[0].kind !== "squads-project-vault") ||
      active[0].monthlyCommitment?.cycleId !== policy.cycleId
    )
      throw new TypeError(
        "Fresh-cycle payment activation requires one matching reviewed Squads instrument without a review budget",
      );
  }
  const claimed =
    BigInt(project.reward.committedMinor) +
    BigInt(project.reward.reviewBudget?.committedMinor ?? "0");
  if (claimed > 0n) {
    const active = instruments.filter(
      (instrument) => instrument.replacedAt === null,
    );
    if (
      active.length !== 1 ||
      BigInt(active[0].monthlyCommitment?.amountMinor ?? "0") !== claimed
    ) {
      throw new TypeError(
        "committed amounts must bind exactly one active monthly instrument amount",
      );
    }
  }
}

function instrumentIdentity(instrument) {
  switch (instrument.kind) {
    case "squads-v4-vault":
    case "squads-project-vault":
      return `${instrument.network}:${instrument.asset}:${instrument.multisig}:${instrument.vaultIndex}:${instrument.vault}`;
    case "sablier-lockup-v4":
      return `${instrument.network}:${instrument.asset}:${instrument.contract}:${instrument.streamId}`;
    default:
      throw new TypeError("funding instrument kind is unsupported");
  }
}

/**
 * Validates the complete commitment-instrument history. The trusted manifest
 * reader bounds input bytes; a lifetime entry cap would eventually require
 * deleting append-only monthly evidence. Replaced
 * instruments stay listed so historical commitment records remain
 * independently verifiable. Windows cannot overlap within one monthly bucket
 * or between monthly instruments and retired unscoped history.
 */
export function assertFundingCommitments(
  value,
  field = "project funding commitments",
) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${field} must be an array of instruments`);
  }
  const seenIdentities = new Set();
  const histories = new Map();
  const instruments = value.map((candidate, index) => {
    const instrumentField = `${field}[${index}]`;
    const instrument = commitmentRecord(candidate, instrumentField);
    let result;
    if (instrument.kind === "squads-v4-vault") {
      result = validateSquadsInstrument(instrument, instrumentField);
    } else if (instrument.kind === "squads-project-vault") {
      result = validateProjectVaultInstrument(instrument, instrumentField);
    } else if (instrument.kind === "sablier-lockup-v4") {
      result = validateSablierInstrument(instrument, instrumentField);
    } else {
      throw new TypeError(`${instrumentField}.kind is unsupported`);
    }
    const identity = instrumentIdentity(result);
    if (seenIdentities.has(identity)) {
      throw new TypeError(`${field} contain a duplicate instrument`);
    }
    seenIdentities.add(identity);
    // Monthly buckets describe contribution windows, not the later review or
    // replacement event. Distinct exact months cannot spend one another's cap.
    const historyKey = `${result.network}:${result.asset}:${result.monthlyCommitment?.cycleId ?? "unscoped"}`;
    const history = histories.get(historyKey) ?? [];
    history.push(result);
    histories.set(historyKey, history);
    return result;
  });
  for (const instrument of instruments) {
    if (instrument.monthlyCommitment) continue;
    for (const monthly of instruments) {
      if (
        monthly.network !== instrument.network ||
        monthly.asset !== instrument.asset ||
        !monthly.monthlyCommitment
      )
        continue;
      // Preserve retired legacy evidence without allowing its active interval
      // to overlap any monthly instrument or back a current monthly claim.
      if (
        instrument.replacedAt === null ||
        !(
          instrument.replacedAt <= monthly.effectiveAt ||
          (monthly.replacedAt !== null &&
            monthly.replacedAt <= instrument.effectiveAt)
        )
      )
        throw new TypeError(
          `${field} require retired nonoverlapping unscoped history alongside monthly instruments`,
        );
    }
  }
  for (const history of histories.values()) {
    history.sort((left, right) =>
      left.effectiveAt.localeCompare(right.effectiveAt),
    );
    for (let index = 1; index < history.length; index += 1) {
      const prior = history[index - 1];
      const current = history[index];
      if (prior.replacedAt === null || prior.replacedAt > current.effectiveAt) {
        throw new TypeError(`${field} contain overlapping active instruments`);
      }
    }
  }
  return instruments;
}

/** Returns true only when at least one unreplaced instrument is declared. */
export function hasActiveFundingCommitment(value) {
  return (
    Array.isArray(value) &&
    value.some((instrument) => instrument?.replacedAt === null)
  );
}
