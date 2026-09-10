/** Unsigned, exact-byte external operation handoff. No signer or broadcaster. */
import { assertRewardAllocationManifest } from "./rewards";
import { assertSettlementExecutionPlan } from "./settlement-plan";
import {
  bytesBase64,
  compileSquadsBatchChild,
  exactUsdcDecimal,
  joinBytes,
  littleEndian,
  SQUADS_SYSTEM_PROGRAM,
  solanaKeyBytes,
} from "./squads-batch-message";
import {
  assertSquadsExecutionBinding,
  executionSha256,
  parseExecutionJson,
  type SquadsBatchExecutionBinding,
  validateSquadsExecutionContext,
} from "./squads-execution";
import {
  squadsBatchChildAddress,
  squadsExecutionAddress,
} from "./squads-execution-verifier";
import {
  deriveSquadsVaultAddress,
  SQUADS_V4_PROGRAM_ID,
} from "./squads-funding";
import { isSolanaAddress } from "./wallets";

export interface ExternalAccountMeta {
  address: string;
  isSigner: boolean;
  isWritable: boolean;
}
export interface ExternalInstruction {
  programId: string;
  accounts: ExternalAccountMeta[];
  dataBase64: string;
}
const meta = (
  address: string,
  isWritable = false,
  isSigner = false,
): ExternalAccountMeta => ({ address, isWritable, isSigner });
const COMPUTE = "ComputeBudget111111111111111111111111111111";
function short(n: number): Uint8Array {
  const out = [];
  do {
    const b = n & 127;
    n >>>= 7;
    out.push(b | (n ? 128 : 0));
  } while (n);
  return new Uint8Array(out);
}
/** Exact legacy packet serialization with one empty signature and zero blockhash.
 * The operator replaces blockhash/signature externally; encoded lengths stay fixed.
 */
export function measureExternalOperation(
  member: string,
  instructions: ExternalInstruction[],
) {
  const accounts = new Map<string, ExternalAccountMeta>([
    [member, meta(member, true, true)],
  ]);
  for (const ix of instructions)
    for (const m of [...ix.accounts, meta(ix.programId)]) {
      const previous = accounts.get(m.address);
      accounts.set(m.address, {
        ...m,
        isSigner: m.isSigner || !!previous?.isSigner,
        isWritable: m.isWritable || !!previous?.isWritable,
      });
    }
  const keys = [...accounts.values()].sort(
    (a, b) =>
      Number(b.isSigner) * 2 +
      Number(b.isWritable) -
      Number(a.isSigner) * 2 -
      Number(a.isWritable),
  );
  // Payer is the sole external signer. All vault signatures occur via Squads CPI.
  if (keys[0].address !== member || keys.filter((k) => k.isSigner).length !== 1)
    throw new TypeError("External operation requires the declared member only");
  const keyIndex = (address: string) => {
    const index = keys.findIndex((k) => k.address === address);
    if (index < 0) throw new TypeError("Missing operation account");
    return index;
  };
  const encoded = joinBytes([
    short(1),
    new Uint8Array(64),
    new Uint8Array([
      1,
      0,
      keys.filter((k) => !k.isSigner && !k.isWritable).length,
    ]),
    short(keys.length),
    ...keys.map((k) => solanaKeyBytes(k.address)),
    new Uint8Array(32),
    short(instructions.length),
    ...instructions.map((ix) => {
      const data = Uint8Array.from(atob(ix.dataBase64), (c) => c.charCodeAt(0));
      return joinBytes([
        new Uint8Array([keyIndex(ix.programId)]),
        short(ix.accounts.length),
        new Uint8Array(ix.accounts.map((k) => keyIndex(k.address))),
        short(data.length),
        data,
      ]);
    }),
  ]);
  if (encoded.length > 1232 || keys.length > 64)
    throw new TypeError(
      "External operation exceeds current packet/account limits",
    );
  return {
    wireBytes: encoded.length,
    accountCount: keys.length,
    signatureCount: 1,
    templateBase64: bytesBase64(encoded),
    simulation: "not-run" as const,
  };
}
async function instruction(
  name: string,
  accounts: ExternalAccountMeta[],
  args: Uint8Array = new Uint8Array(),
): Promise<ExternalInstruction> {
  const hash = await executionSha256(
    new TextEncoder().encode(`global:${name}`),
  );
  const discriminator = Uint8Array.from(
    hash.slice(0, 16).match(/../gu) ?? [],
    (v) => Number.parseInt(v, 16),
  );
  return {
    programId: SQUADS_V4_PROGRAM_ID,
    accounts,
    dataBase64: bytesBase64(joinBytes([discriminator, args])),
  };
}
export async function prepareSquadsBatchHandoff(input: {
  allocationBytes: Uint8Array;
  planBytes: Uint8Array;
  multisig: string;
  vaultIndex: number;
  transactionIndex: string;
  member: string;
}) {
  input = {
    ...input,
    allocationBytes: new Uint8Array(input.allocationBytes),
    planBytes: new Uint8Array(input.planBytes),
  };
  if (!isSolanaAddress(input.member))
    throw new TypeError("Expected external member public key only");
  const allocation = assertRewardAllocationManifest(
    parseExecutionJson(input.allocationBytes),
  );
  const plan = assertSettlementExecutionPlan(
    parseExecutionJson(input.planBytes),
    allocation,
  );
  const vault = await deriveSquadsVaultAddress(
    input.multisig,
    input.vaultIndex,
  );
  // Validate decimal index before PDA bigint serialization can truncate it.
  if (
    !/^[1-9][0-9]{0,19}$/u.test(input.transactionIndex) ||
    BigInt(input.transactionIndex) > (1n << 64n) - 1n
  )
    throw new TypeError("Invalid external Batch index");
  const batchAccount = (
    await squadsExecutionAddress(input.multisig, input.transactionIndex, false)
  ).address;
  const proposalAccount = (
    await squadsExecutionAddress(input.multisig, input.transactionIndex, true)
  ).address;
  const children = [];
  for (let start = 0; start < plan.transfers.length; start += 5) {
    const transferIndexes = Array.from(
      { length: Math.min(5, plan.transfers.length - start) },
      (_, i) => start + i,
    );
    const message = await compileSquadsBatchChild(plan, transferIndexes);
    const transactionIndex: number = children.length + 1;
    children.push({
      binding: {
        transactionIndex,
        transactionAccount: (
          await squadsBatchChildAddress(
            input.multisig,
            input.transactionIndex,
            transactionIndex,
          )
        ).address,
        messageSha256: await executionSha256(message.storedBytes),
        transferIndexes,
      },
      message,
    });
  }
  const binding = assertSquadsExecutionBinding({
    schemaVersion: "2",
    kind: "squads-batch-execution-binding",
    projectId: plan.projectId,
    cycleId: plan.cycleId,
    planSha256: await executionSha256(input.planBytes),
    multisig: input.multisig,
    vault,
    vaultIndex: input.vaultIndex,
    transactionIndex: input.transactionIndex,
    proposalAccount,
    batchAccount,
    children: children.map((c) => c.binding),
  }) as SquadsBatchExecutionBinding;
  await validateSquadsExecutionContext({
    projectId: plan.projectId,
    allocationBytes: input.allocationBytes,
    planBytes: input.planBytes,
    baseLedger: [],
    ledger: [binding],
  });
  const m = meta(input.member, true, true),
    multisig = meta(input.multisig),
    batch = meta(batchAccount, true),
    proposal = meta(proposalAccount, true),
    system = meta(SQUADS_SYSTEM_PROGRAM);
  const budget: ExternalInstruction = {
    programId: COMPUTE,
    accounts: [],
    dataBase64: bytesBase64(
      joinBytes([new Uint8Array([2]), littleEndian(400000, 4)]),
    ),
  };
  const operation = (action: string, ix: ExternalInstruction) => {
    const measurement = measureExternalOperation(input.member, [budget, ix]);
    return {
      action,
      instructions: [budget, ix],
      measurement,
      // Read-only RPC request for the operator's current on-chain stage.
      // A template or a returned request is never a successful simulation.
      simulationRequest: {
        jsonrpc: "2.0",
        id: action,
        method: "simulateTransaction",
        params: [
          measurement.templateBase64,
          {
            encoding: "base64",
            sigVerify: false,
            replaceRecentBlockhash: true,
            commitment: "confirmed",
          },
        ],
      },
    };
  };
  const setup = [
    operation(
      "batch-create",
      await instruction(
        "batch_create",
        [meta(input.multisig, true), batch, m, m, system],
        new Uint8Array([input.vaultIndex, 0]),
      ),
    ),
    operation(
      "proposal-create-draft",
      await instruction(
        "proposal_create",
        [multisig, proposal, m, m, system],
        joinBytes([
          littleEndian(BigInt(input.transactionIndex), 8),
          new Uint8Array([1]),
        ]),
      ),
    ),
    ...(await Promise.all(
      children.map(async (c) =>
        operation(
          `batch-add-child-${c.binding.transactionIndex}`,
          await instruction(
            "batch_add_transaction",
            [
              multisig,
              meta(proposalAccount),
              batch,
              meta(c.binding.transactionAccount, true),
              m,
              m,
              system,
            ],
            joinBytes([
              new Uint8Array([0]),
              littleEndian(c.message.inputBytes.length, 4),
              c.message.inputBytes,
            ]),
          ),
        ),
      ),
    )),
  ];
  const execute = await Promise.all(
    children.map(async (c) =>
      operation(
        `execute-child-${c.binding.transactionIndex}`,
        await instruction("batch_execute_transaction", [
          multisig,
          m,
          proposal,
          batch,
          meta(c.binding.transactionAccount),
          ...c.message.keys.map((key, i) =>
            meta(key, i < c.message.writableCount),
          ),
        ]),
      ),
    ),
  );
  return {
    schemaVersion: 1,
    kind: "squads-batch-external-handoff",
    binding,
    member: input.member,
    paymentAuthorized: false,
    paymentVerified: false,
    simulation: "not-run",
    importFormat: "external-instruction-manifest-not-squads-ui-json",
    setup,
    activate: operation(
      "activate-after-binding-review",
      await instruction("proposal_activate", [multisig, m, proposal]),
    ),
    execute,
    children: children.map((c) => ({
      transactionIndex: c.binding.transactionIndex,
      messageSha256: c.binding.messageSha256,
      storedMessageBytes: c.message.storedBytes.length,
      inputMessageBytes: c.message.inputBytes.length,
      inputMessageBase64: bytesBase64(c.message.inputBytes),
      accountCount: c.message.keys.length,
      instructionCount: c.message.instructions.length,
      transfers: c.binding.transferIndexes.map((i) => ({
        ...plan.transfers[i],
        transferIndex: i,
        amountUsdc: exactUsdcDecimal(plan.transfers[i].amountMinor),
      })),
    })),
    csv: `${[
      "child_index,transfer_index,payment_id,token_address,receiver,amount_minor,amount_usdc",
      ...children.flatMap((c) =>
        c.binding.transferIndexes.map((i) => {
          const t = plan.transfers[i];
          return [
            c.binding.transactionIndex,
            i,
            t.paymentId,
            plan.token.mint,
            t.recipientOwner,
            t.amountMinor,
            exactUsdcDecimal(t.amountMinor),
          ].join(",");
        }),
      ),
    ].join("\n")}\n`,
  };
}
