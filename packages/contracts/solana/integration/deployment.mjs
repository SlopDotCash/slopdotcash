import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

const sha256 = (value) => createHash("sha256").update(value).digest();
const BPF_UPGRADEABLE_LOADER = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);
// test-e2e.sh loads the program with the local payer as its upgrade authority,
// so ProgramData exists and the payer can sign initialize_config.
const localUpgradeAuthority = () =>
  Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(
        readFileSync(process.env.ANCHOR_WALLET ?? ".local/payer.json", "utf8"),
      ),
    ),
  ).publicKey.toBase58();

/**
 * Reviewed deployment identity that the end-to-end workflows verify.
 * The local validator loads the compiled program as upgradeable, with the
 * local payer as upgrade authority. A public test deployment supplies the
 * deployed ProgramData code digest and upgrade authority printed by
 * scripts/deploy-testnet.sh.
 */
export const configRotation = Keypair.fromSeed(
  sha256("slop-e2e-config-rotation-authority"),
);

export const expectedDeployment = {
  rotationAuthority: configRotation.publicKey.toBase58(),
  codeSha256:
    process.env.SLOP_E2E_CODE_SHA256 ??
    createHash("sha256")
      .update(readFileSync("target/deploy/slop_escrow.so"))
      .digest("hex"),
  upgradeAuthority:
    process.env.SLOP_E2E_UPGRADE_AUTHORITY ?? localUpgradeAuthority(),
};

/**
 * Fixture keys for the deployment-wide Config. Every project in the suite must
 * use this identity authority and fee recipient. Derived from public seeds:
 * they have no value outside a local or public test validator.
 */
export const configIdentity = Keypair.fromSeed(
  sha256("slop-e2e-config-identity-authority"),
);
export const configFees = Keypair.fromSeed(
  sha256("slop-e2e-config-fee-recipient"),
);
export const configAddress = (programId) =>
  PublicKey.findProgramAddressSync([Buffer.from("config")], programId)[0];
export const programDataAddress = (programId) =>
  PublicKey.findProgramAddressSync(
    [programId.toBuffer()],
    BPF_UPGRADEABLE_LOADER,
  )[0];

/** initialize_config, signed by `authority` (the provider wallet by default). */
export function initializeConfig(
  program,
  {
    authority,
    identity = configIdentity.publicKey,
    fees = configFees.publicKey,
    rotation = configRotation.publicKey,
  } = {},
) {
  const signer = authority?.publicKey ?? program.provider.wallet.publicKey;
  const call = program.methods
    .initializeConfig(identity, fees, rotation)
    .accountsStrict({
      authority: signer,
      config: configAddress(program.programId),
      program: program.programId,
      programData: programDataAddress(program.programId),
      systemProgram: SystemProgram.programId,
    });
  return (authority ? call.signers([authority]) : call).rpc();
}

/** Creates the Config with the fixture keys once per validator, then checks it. */
export async function ensureConfig(program) {
  const address = configAddress(program.programId);
  if (!(await program.account.config.fetchNullable(address))) {
    const signature = await initializeConfig(program);
    await program.provider.connection.confirmTransaction(
      signature,
      "finalized",
    );
  }
  const config = await program.account.config.fetch(address);
  if (
    !config.identityAuthority.equals(configIdentity.publicKey) ||
    !config.feeRecipient.equals(configFees.publicKey) ||
    !config.rotationAuthority.equals(configRotation.publicKey)
  )
    throw new Error("Deployment Config does not use the fixture keys");
  return address;
}
