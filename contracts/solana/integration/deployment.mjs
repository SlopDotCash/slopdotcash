import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * Reviewed deployment identity that the end-to-end workflows verify.
 * The local validator loads the compiled program with no upgrade authority.
 * A public test deployment supplies the deployed ProgramData code digest and
 * upgrade authority printed by scripts/deploy-testnet.sh.
 */
export const expectedDeployment = {
  codeSha256:
    process.env.SLOP_E2E_CODE_SHA256 ??
    createHash("sha256")
      .update(readFileSync("target/deploy/slop_escrow.so"))
      .digest("hex"),
  upgradeAuthority:
    process.env.SLOP_E2E_UPGRADE_AUTHORITY ??
    "11111111111111111111111111111111",
};
