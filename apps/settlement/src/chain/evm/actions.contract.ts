// spec/settlement/escrow.md, "Events apply once, in canonical block and event order"; spec/settlement/bindingAuthority.md, "Only the current authority binds, for the current version and before expiry, with the wallet's own signature"
import { Arbitrary } from "effect";
import { contract } from "vibestack/testing";
import { type Bytes32, type EvmAddress, awardId } from "./abi.ts";
import { claimFeesCalldata, commitAwardCalldata, depositCalldata, payCalldata, setMonthlyCommitmentCalldata, withdrawCalldata } from "./actions.ts";
import { adapterVectors } from "./adapterVectors.ts";
import { type VaultCreation, createVaultCalldata, vaultKey } from "./factories.ts";
import { cancelBindingCalldata } from "./typedData.ts";

const vault = adapterVectors.vault as EvmAddress;
const owner = adapterVectors.vaultKeys[0].owner as EvmAddress;

const creationOf = (recorded: (typeof adapterVectors.calldata.create)[number]): VaultCreation =>
  recorded.purpose === "BountyPurpose"
    ? { owner, projectId: recorded.projectId as Bytes32, asset: recorded.asset as EvmAddress, purpose: "BountyPurpose" }
    : { owner, projectId: recorded.projectId as Bytes32, asset: recorded.asset as EvmAddress, purpose: "OrdinaryPurpose", monthlyCap: BigInt(recorded.cap), monthlyEnabled: recorded.enabled };

export const callBytesMatchTheDeployedAdapter = contract({
  input: Arbitrary.Constant(adapterVectors),
  run: ({ calldata: c, awardIds, vaultKeys }) => ({
    pay: payCalldata(c.pay.id as Bytes32, BigInt(c.pay.version)),
    commitAward: commitAwardCalldata({ purpose: "OrdinaryPurpose", id: c.commitAward.id as Bytes32, actor: BigInt(c.commitAward.actor), gross: BigInt(c.commitAward.gross), sourceDigest: c.commitAward.sourceDigest as Bytes32 }),
    commitBountyAward: commitAwardCalldata({ purpose: "BountyPurpose", id: c.commitBountyAward.id as Bytes32, actor: BigInt(c.commitBountyAward.actor), gross: BigInt(c.commitBountyAward.gross), sourceDigest: c.commitBountyAward.sourceDigest as Bytes32 }),
    cancelBinding: cancelBindingCalldata(BigInt(c.cancelBinding.actor), BigInt(c.cancelBinding.version)),
    claimFees: claimFeesCalldata(),
    deposit: depositCalldata(BigInt(c.deposit.gross)),
    withdraw: withdrawCalldata(BigInt(c.withdraw.gross)),
    setMonthly: c.setMonthly.map((recorded) => setMonthlyCommitmentCalldata(BigInt(recorded.cap), recorded.enabled)),
    create: c.create.map((recorded) => createVaultCalldata(creationOf(recorded))),
    awardIds: awardIds.map((recorded) => awardId(BigInt(recorded.chainId), vault, recorded.source as Bytes32)),
    vaultKeys: vaultKeys.map((recorded) => vaultKey({ owner: recorded.owner as EvmAddress, projectId: recorded.projectId as Bytes32, asset: recorded.asset as EvmAddress, purpose: recorded.purpose === "BountyPurpose" ? "BountyPurpose" : "OrdinaryPurpose" })),
  }),
  invariant: ({ calldata: c, awardIds, vaultKeys }, bytes) =>
    JSON.stringify(bytes) === JSON.stringify({
      pay: c.pay.data,
      commitAward: c.commitAward.data,
      commitBountyAward: c.commitBountyAward.data,
      cancelBinding: c.cancelBinding.data,
      claimFees: c.claimFees.data,
      deposit: c.deposit.data,
      withdraw: c.withdraw.data,
      setMonthly: c.setMonthly.map((recorded) => recorded.data),
      create: c.create.map((recorded) => recorded.data),
      awardIds: awardIds.map((recorded) => recorded.id),
      vaultKeys: vaultKeys.map((recorded) => recorded.key),
    }),
});
