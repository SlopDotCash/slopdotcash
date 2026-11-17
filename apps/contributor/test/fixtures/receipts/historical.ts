import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import type { ReceiptPolicyProject, ReceiptRegistry } from "../../../src/client/receipts/receipt.ts";
import { signingPayload } from "../../../src/client/receipts/receipt.ts";
import type { ProjectRunReceipt } from "../../../src/client/receipts/receipt.schema.ts";

export interface Retained {
  readonly sourceId: string;
  readonly run: { readonly skillRevision: string } & Record<string, unknown>;
}

export interface Manifest {
  readonly registry: ReceiptRegistry;
  readonly policy: ReceiptPolicyProject;
}

const history: { readonly attributions: ReadonlyArray<Retained> } = JSON.parse(
  readFileSync(new URL("../../../../../data/accepted-review-history.json", import.meta.url), "utf8"),
);

export const retained: ReadonlyArray<Retained> = history.attributions.map(({ sourceId, run }) => ({ sourceId, run }));

const elizaAtContributeToEliza: Manifest = {
  registry: [{ id: "eliza", repositories: ["elizaOS/eliza"], skillSourcePath: "skills/contribute-to-eliza" }],
  policy: {
    id: "eliza",
    terms: {
      revision: "2026-08-18.1",
      receiptPolicy: {
        state: "active",
        activatedAt: "2026-08-18T20:45:06.000Z",
        bindings: [{
          policyRevision: "2026-08-18.1",
          activatedAt: "2026-08-18T20:45:06.000Z",
          licenseSha256: "d0590837a439c742e89c8226137dd4e902fa1e0df486347dbfc9b8ba68b5826d",
          inboundTermsSha256: "15fdc92698fd2fdffef86bfd629f65bc588f02983fb9535bba0a5172d4569469",
          prizeRulesSha256: null,
        }],
      },
      repositoryLicense: { fileSha256: "d0590837a439c742e89c8226137dd4e902fa1e0df486347dbfc9b8ba68b5826d" },
      inbound: { fileSha256: "15fdc92698fd2fdffef86bfd629f65bc588f02983fb9535bba0a5172d4569469" },
      externalPrize: null,
    },
  },
};

export const manifestsBySkillCommit: Readonly<Record<string, Manifest>> = {
  "92d692518c3d832ac9b203076ef691a54e61a9fa": elizaAtContributeToEliza,
  "2744eb9bd27513b5c5081b61cf5d17494a583061": elizaAtContributeToEliza,
};

/** @throws {never} */
export function manifestOf(receipt: Retained["run"]): Manifest | undefined {
  return manifestsBySkillCommit[receipt.skillRevision.split("@")[1]?.split(":")[0] ?? ""];
}

/** @throws {never} */
export function signedByFreshDevice(unsigned: Omit<ProjectRunReceipt, "devicePublicKey" | "deviceKeyId" | "deviceSignature">): ProjectRunReceipt {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const der = publicKey.export({ format: "der", type: "spki" });
  const receipt: ProjectRunReceipt = {
    ...unsigned,
    devicePublicKey: der.toString("base64url"),
    deviceKeyId: createHash("sha256").update(der).digest("hex"),
    deviceSignature: "pending",
  };
  return { ...receipt, deviceSignature: sign(null, Buffer.from(signingPayload(receipt), "utf8"), privateKey).toString("base64url") };
}

/** @throws {never} */
export function bytesOf(value: unknown): string {
  return JSON.stringify(value);
}

/** @throws {never} */
export function reparsed(text: string): unknown {
  return JSON.parse(text);
}
