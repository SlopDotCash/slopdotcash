import { createHash } from "node:crypto";
import { fixtureProject } from "./fixture-overlay.mjs";

/** Public synthetic identities only; never a live deployment or signing key. */
export function stagingPaymentProject(network, id = "eliza") {
  const project = fixtureProject(id);
  const chain = network.split("-")[0];
  const solana = chain === "solana";
  const hex = (n) => `0x${String(n).repeat(40)}`;
  const pubkey = (n) => {
    const bytes = createHash("sha256").update(`staging-payment-${n}`).digest();
    const alphabet =
      "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let value = BigInt(`0x${bytes.toString("hex")}`),
      text = "";
    while (value) {
      text = alphabet[Number(value % 58n)] + text;
      value /= 58n;
    }
    return text;
  };
  project.status = "active";
  project.reward.chain = chain;
  project.reward.currency = chain === "robinhood" ? "USDG" : "USDC";
  project.reward.feeBasisPoints = 200;
  delete project.rewardAsset;
  project.escrow = {
    schemaVersion: "1",
    effectiveCycle: "2026-11",
    chain,
    feeBasisPoints: 200,
    withdrawalFeeBasisPoints: 200,
    feeMode: "deduct-from-gross",
    deployments: [
      {
        network,
        vault: solana ? pubkey(1) : hex(1),
        asset: solana ? pubkey(2) : hex(2),
        owner: solana ? pubkey(3) : hex(3),
        identityAuthority: solana ? pubkey(4) : hex(4),
        feeRecipient: solana ? pubkey(5) : hex(5),
        ...(solana ? { rotationAuthority: pubkey(6) } : {}),
        registrar: solana ? null : hex(6),
        factory: solana ? null : hex(7),
        factoryCodeSha256: solana ? null : "a".repeat(64),
        codeSha256: "b".repeat(64),
        sourceCommit: "c".repeat(40),
        deploymentTransaction: solana
          ? pubkey(8) + pubkey(9)
          : `0x${"d".repeat(64)}`,
        bindingDelaySeconds: "0",
        rotationDelaySeconds: solana ? "0" : null,
        programId: solana ? pubkey(10) : null,
        projectPda: solana ? pubkey(11) : null,
        networkDomain: solana ? "e".repeat(64) : null,
        upgradeAuthority: null,
      },
    ],
  };
  return project;
}
