// spec/frontend/walletAttempt.md, "A late wallet reply changes only the slot that still holds its own attempt"; spec/settlement/ownerTransactions.md, "The pending request is saved before the wallet call and recovered without resubmission"
import { vectors } from "../../kernels/vectors.ts";
import { slotOfText, type SlotRead } from "./flowSlots.ts";

const attemptId = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const wallet = "0x1111111111111111111111111111111111111111";
const hash = `0x${"a".repeat(64)}`;
const evmPlan = `{"kind":"evmSetting","from":"${wallet}","cap":"250000000","enabled":true}`;
const evmBase = { version: 1, attemptId, wallet, cap: "250000000", enabled: true, decimals: 18, hash };
const evmOwned = (attempt: { identity: string; bytesId: string; hash: string; candidate: string }): SlotRead =>
  ({ kind: "owned", slot: { account: 0, plan: evmPlan, attempt } }) as SlotRead;

export const legacyEvmSettingsKeepTheirWalletHashWithoutHashSource = vectors<string, SlotRead>([
  [JSON.stringify(evmBase), evmOwned({ identity: attemptId, bytesId: "prepared", hash, candidate: "" })],
  [JSON.stringify({ ...evmBase, hashSource: "wallet" }), evmOwned({ identity: attemptId, bytesId: "prepared", hash, candidate: "" })],
  [JSON.stringify({ ...evmBase, hashSource: "recovery" }), evmOwned({ identity: attemptId, bytesId: "prepared", hash: "", candidate: hash })],
], slotOfText);

export const legacySolanaSettingsKeepTheirWalletHashWithoutHashSource = vectors<string, SlotRead>([
  [JSON.stringify({ ...evmBase, solanaBlockhash: "11111111111111111111111111111111" }),
    { kind: "owned", slot: { account: 0, plan: `{"kind":"solanaSetting","cap":"250000000","enabled":true,"blockhash":"11111111111111111111111111111111"}`, attempt: { identity: attemptId, bytesId: "prepared", hash, candidate: "" } } }],
], slotOfText);
