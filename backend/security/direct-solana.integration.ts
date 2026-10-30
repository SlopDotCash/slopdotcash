/** Real local-validator proof; creates only throwaway keys and synthetic funds.
 * Run after `npm ci --prefix contracts/solana --ignore-scripts`:
 *   bun backend/security/direct-solana.integration.ts
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { closeSync, mkdtempSync, openSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SOLANA_NATIVE_ASSET } from "../../src/lib/escrow-policy.mjs";
import {
  prepareSolanaDirect,
  type SolanaDirectInput,
  verifySolanaDirect,
} from "./direct-solana";

const require = createRequire(
  new URL("../../contracts/solana/package.json", import.meta.url),
);
const {
  Connection,
  Keypair,
  SystemProgram,
  Transaction,
} = require("@solana/web3.js");
const spl = require("@solana/spl-token");
const directory = mkdtempSync(join(tmpdir(), "slop-direct-solana-"));
const port = Number(process.env.SLOP_DIRECT_SOLANA_TEST_PORT ?? "29899");
const rpcUrl = `http://127.0.0.1:${port}`;
const log = openSync(join(directory, "validator.log"), "w");
const validator = spawn(
  "solana-test-validator",
  [
    "--reset",
    "--quiet",
    "--ledger",
    join(directory, "ledger"),
    "--rpc-port",
    String(port),
    "--faucet-port",
    String(port + 41),
    "--dynamic-port-range",
    `${port + 2}-${port + 31}`,
    "--bind-address",
    "127.0.0.1",
  ],
  { stdio: ["ignore", log, log] },
);
const connection = new Connection(rpcUrl, {
  commitment: "confirmed",
  confirmTransactionInitialTimeout: 180_000,
});
const sleep = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
const payer = Keypair.generate(),
  reporter = Keypair.generate(),
  fee = Keypair.generate();
const proofs: unknown[] = [];
async function confirmed(
  transaction: InstanceType<typeof Transaction>,
  signers = [payer],
) {
  const latest = await connection.getLatestBlockhash("confirmed");
  transaction.recentBlockhash = latest.blockhash;
  transaction.feePayer = payer.publicKey;
  transaction.sign(...signers);
  const signature = await connection.sendRawTransaction(
    transaction.serialize(),
  );
  const result = await connection.confirmTransaction(
    { signature, ...latest },
    "finalized",
  );
  assert.equal(result.value.err, null);
  return signature;
}
async function sendPrepared(transaction: string) {
  const decoded = Transaction.from(Buffer.from(transaction, "base64"));
  decoded.sign(payer);
  const signature = await connection.sendRawTransaction(decoded.serialize());
  const result = await connection.confirmTransaction(signature, "finalized");
  assert.equal(result.value.err, null);
  return signature;
}
try {
  let genesisHash = "";
  for (let attempt = 0; attempt < 100; attempt++) {
    if (validator.exitCode !== null)
      throw new Error(`Validator exited; see ${directory}`);
    try {
      genesisHash = await connection.getGenesisHash();
      break;
    } catch {
      await sleep(300);
    }
  }
  assert.ok(genesisHash, "validator must become ready");
  const airdrop = await connection.requestAirdrop(
    payer.publicKey,
    10_000_000_000,
  );
  await connection.confirmTransaction(airdrop, "finalized");
  const input: SolanaDirectInput = {
    rpcUrl,
    genesisHash,
    payer: payer.publicKey.toBase58(),
    asset: { address: SOLANA_NATIVE_ASSET, decimals: 9 },
    transfers: [
      { recipient: reporter.publicKey.toBase58(), amountBase: "30000000" },
      { recipient: fee.publicKey.toBase58(), amountBase: "10000000" },
    ],
  };
  const notBefore = new Date(Date.now() - 1000).toISOString();
  const prepared = await prepareSolanaDirect(input);
  const afterSlot = prepared.afterSlot;
  const signature = await sendPrepared(prepared.transaction);
  const nativeProof = await verifySolanaDirect({
    ...input,
    transactionId: signature,
    notBefore,
    afterSlot,
  });
  proofs.push({ kind: "SOL", ...nativeProof });
  await assert.rejects(
    verifySolanaDirect({
      ...input,
      transactionId: signature,
      notBefore,
      afterSlot: nativeProof.blockNumber,
    }),
    /intent slot/,
  );
  assert.equal(
    await connection.getBalance(reporter.publicKey, "finalized"),
    30_000_000,
  );
  assert.equal(
    await connection.getBalance(fee.publicKey, "finalized"),
    10_000_000,
  );
  for (const changed of [
    { ...input, genesisHash: "wrong-genesis" },
    { ...input, payer: reporter.publicKey.toBase58() },
    {
      ...input,
      transfers: [
        { ...input.transfers[0], amountBase: "30000001" },
        input.transfers[1],
      ],
    },
    {
      ...input,
      transfers: [
        {
          ...input.transfers[0],
          recipient: Keypair.generate().publicKey.toBase58(),
        },
        input.transfers[1],
      ],
    },
  ])
    await assert.rejects(
      verifySolanaDirect({
        ...changed,
        transactionId: signature,
        notBefore,
        afterSlot,
      }),
    );
  // A host clock ahead of chain time must not reject a newer chain slot.
  assert.equal(
    (
      await verifySolanaDirect({
        ...input,
        transactionId: signature,
        notBefore: new Date(Date.now() + 60_000).toISOString(),
        afterSlot,
      })
    ).transactionId,
    signature,
  );
  await assert.rejects(
    prepareSolanaDirect({
      ...input,
      transfers: [{ recipient: input.payer, amountBase: "4" }],
    }),
    /another wallet/,
  );
  const balance = await connection.getBalance(payer.publicKey, "finalized");
  await assert.rejects(
    prepareSolanaDirect({
      ...input,
      transfers: [
        {
          recipient: reporter.publicKey.toBase58(),
          amountBase: String(balance - 5_000),
        },
      ],
    }),
    /rent/,
  );
  const altered = Transaction.from(
    Buffer.from((await prepareSolanaDirect(input)).transaction, "base64"),
  );
  altered.add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: fee.publicKey,
      lamports: 1_000,
    }),
  );
  const extraSignature = await confirmed(altered);
  await assert.rejects(
    verifySolanaDirect({
      ...input,
      transactionId: extraSignature,
      notBefore,
      afterSlot,
    }),
    /differs/,
  );
  for (const tokenProgram of [
    spl.TOKEN_PROGRAM_ID,
    spl.TOKEN_2022_PROGRAM_ID,
  ]) {
    const mint = Keypair.generate();
    const source = spl.getAssociatedTokenAddressSync(
      mint.publicKey,
      payer.publicKey,
      false,
      tokenProgram,
    );
    await confirmed(
      new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: payer.publicKey,
          newAccountPubkey: mint.publicKey,
          lamports: await connection.getMinimumBalanceForRentExemption(
            spl.MINT_SIZE,
          ),
          space: spl.MINT_SIZE,
          programId: tokenProgram,
        }),
        spl.createInitializeMint2Instruction(
          mint.publicKey,
          6,
          payer.publicKey,
          null,
          tokenProgram,
        ),
        spl.createAssociatedTokenAccountIdempotentInstruction(
          payer.publicKey,
          source,
          payer.publicKey,
          mint.publicKey,
          tokenProgram,
        ),
        spl.createMintToInstruction(
          mint.publicKey,
          source,
          payer.publicKey,
          20_000_000,
          [],
          tokenProgram,
        ),
        spl.createSetAuthorityInstruction(
          mint.publicKey,
          payer.publicKey,
          spl.AuthorityType.MintTokens,
          null,
          [],
          tokenProgram,
        ),
      ),
      [payer, mint],
    );
    const tokenInput = {
      ...input,
      asset: { address: mint.publicKey.toBase58(), decimals: 6 },
      transfers: [
        { recipient: reporter.publicKey.toBase58(), amountBase: "3000000" },
        { recipient: fee.publicKey.toBase58(), amountBase: "1000000" },
      ],
    };
    const tokenPlan = await prepareSolanaDirect(tokenInput);
    const tokenSignature = await sendPrepared(tokenPlan.transaction);
    proofs.push({
      kind: tokenProgram.equals(spl.TOKEN_PROGRAM_ID) ? "SPL" : "Token-2022",
      ...(await verifySolanaDirect({
        ...tokenInput,
        transactionId: tokenSignature,
        notBefore,
        afterSlot: tokenPlan.afterSlot,
      })),
    });
    for (const [owner, expected] of [
      [reporter, 3_000_000n],
      [fee, 1_000_000n],
    ] as const) {
      const recipient = spl.getAssociatedTokenAddressSync(
        mint.publicKey,
        owner.publicKey,
        false,
        tokenProgram,
      );
      assert.equal(
        (await spl.getAccount(connection, recipient, "finalized", tokenProgram))
          .amount,
        expected,
      );
    }
    await assert.rejects(
      verifySolanaDirect({
        ...tokenInput,
        asset: { ...tokenInput.asset, decimals: 9 },
        transactionId: tokenSignature,
        notBefore,
        afterSlot: tokenPlan.afterSlot,
      }),
      /decimals/,
    );
    // The second payment exercises existing ATAs: no new rent may be charged.
    const repeated = await prepareSolanaDirect(tokenInput);
    const repeatedSignature = await sendPrepared(repeated.transaction);
    proofs.push({
      kind: "existing-ATA",
      ...(await verifySolanaDirect({
        ...tokenInput,
        transactionId: repeatedSignature,
        notBefore,
        afterSlot: repeated.afterSlot,
      })),
    });
  }
  console.log(
    JSON.stringify({
      passed: true,
      checks:
        "native and SPL/Token-2022 exact split, new/existing ATA rent, wrong payer/recipient/amount/cluster/decimals, pre-intent slot and extra-transfer rejection, host clock skew",
      proofs,
      validatorLog: join(directory, "validator.log"),
    }),
  );
} finally {
  connection._rpcWebSocket.close();
  validator.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => {
      if (validator.exitCode !== null) resolve(null);
      else validator.once("exit", resolve);
    }),
    sleep(5_000),
  ]);
  if (validator.exitCode === null) validator.kill("SIGKILL");
  closeSync(log);
}
