// Local-validator fixture. It creates real native fees with the compiled escrow;
// the converter must claim them itself before its journal permits conversion.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

const hash = (value) => createHash("sha256").update(value).digest();
const directory = new URL("../", import.meta.url);
const idl = JSON.parse(
  readFileSync(new URL("target/idl/slop_escrow.json", directory)),
);
const executable = readFileSync(
  new URL("target/deploy/slop_escrow.so", directory),
);
const programId = new PublicKey(idl.address);
const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const programData = PublicKey.findProgramAddressSync(
  [programId.toBuffer()],
  loader,
)[0];
const owner = (secret) => Keypair.fromSecretKey(Uint8Array.from(secret));

export function nativeFixtureGenesis(path, secret) {
  const pointer = Buffer.alloc(36);
  pointer.writeUInt32LE(2);
  programData.toBuffer().copy(pointer, 4);
  const header = Buffer.alloc(45);
  header.writeUInt32LE(3);
  header[12] = 1;
  owner(secret).publicKey.toBuffer().copy(header, 13);
  return [
    [programId, pointer, true, "native-program.json"],
    [
      programData,
      Buffer.concat([header, executable]),
      false,
      "native-program-data.json",
    ],
  ].flatMap(([key, data, executableAccount, filename]) => {
    const file = join(path, filename);
    writeFileSync(
      file,
      JSON.stringify({
        pubkey: key.toBase58(),
        account: {
          lamports: 100_000_000_000,
          data: [data.toString("base64"), "base64"],
          owner: loader.toBase58(),
          executable: executableAccount,
          rentEpoch: 0,
        },
      }),
    );
    return ["--account", key.toBase58(), file];
  });
}

export async function createNativeFeeFixture(
  rpcUrl,
  secret,
  recipient,
  feeAmount,
) {
  const signer = owner(secret),
    connection = new Connection(rpcUrl, "confirmed");
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(signer),
    {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    },
  );
  const program = new anchor.Program(idl, provider);
  const config = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    programId,
  )[0];
  const identity = Keypair.fromSeed(
    hash("native-fee-converter-identity"),
  ).publicKey;
  const rotation = Keypair.fromSeed(
    hash("native-fee-converter-rotation"),
  ).publicKey;
  const fees = new PublicKey(recipient);
  const sent = async (signature, finalize = false) => {
    const value = await signature;
    if (finalize) await connection.confirmTransaction(value, "finalized");
    return value;
  };
  await sent(
    program.methods
      .initializeConfig(identity, fees, rotation)
      .accountsStrict({
        authority: signer.publicKey,
        config,
        program: programId,
        programData,
        systemProgram: SystemProgram.programId,
      })
      .rpc(),
  );
  const projectKey = "native-fee-converter-project";
  const projectId = hash(projectKey);
  const networkDomain = hash("native-fee-converter-local-domain");
  const project = PublicKey.findProgramAddressSync(
    [
      Buffer.from("project"),
      signer.publicKey.toBuffer(),
      projectId,
      Buffer.from([0]),
    ],
    programId,
  )[0];
  const vault = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), project.toBuffer()],
    programId,
  )[0];
  await sent(
    program.methods
      .initializeNative(
        [...projectId],
        [...networkDomain],
        identity,
        fees,
        new anchor.BN(0),
        new anchor.BN(0),
        { ordinary: {} },
      )
      .accountsStrict({
        owner: signer.publicKey,
        project,
        vault,
        config,
        systemProgram: SystemProgram.programId,
      })
      .rpc(),
  );
  const gross = BigInt(feeAmount) * 50n;
  await sent(
    program.methods
      .depositNative(new anchor.BN(String(gross * 2n)))
      .accountsStrict({
        depositor: signer.publicKey,
        project,
        vault,
        systemProgram: SystemProgram.programId,
      })
      .rpc(),
  );
  await sent(
    program.methods
      .withdrawNative(new anchor.BN(String(gross)))
      .accountsStrict({
        owner: signer.publicKey,
        project,
        vault,
        destination: signer.publicKey,
      })
      .rpc(),
    true,
  );
  const state = await program.account.project.fetch(project, "finalized");
  const principal = (record) =>
    record.deposited
      .sub(record.paid)
      .sub(record.payoutFees)
      .sub(record.withdrawnGross)
      .sub(record.reserved)
      .toString();
  if (state.accruedFees.toString() !== String(feeAmount))
    throw new Error("Native fee accrual differs from fixture");
  return {
    projectId: projectKey,
    deployment: {
      network: "solana-mainnet",
      programId: programId.toBase58(),
      projectPda: project.toBase58(),
      vault: vault.toBase58(),
      asset: SystemProgram.programId.toBase58(),
      networkDomain: networkDomain.toString("hex"),
      owner: signer.publicKey.toBase58(),
      identityAuthority: identity.toBase58(),
      feeRecipient: recipient,
      rotationAuthority: rotation.toBase58(),
      codeSha256: hash(executable).toString("hex"),
      upgradeAuthority: signer.publicKey.toBase58(),
      bindingDelaySeconds: "0",
      rotationDelaySeconds: "0",
    },
    principal: principal(state),
    async assertPrincipal() {
      const after = await program.account.project.fetch(project, "finalized");
      if (
        principal(after) !== principal(state) ||
        after.accruedFees.toString() !== "0"
      )
        throw new Error(
          "Native fee conversion changed principal or left accrued fees",
        );
    },
  };
}
