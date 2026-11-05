import { expect, test } from "bun:test";
import {
  Keypair,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import type {
  AssetEvidence,
  ScenarioEvidence,
} from "../../../scripts/escrow-acceptance/shared";
import { registryProjectDigest } from "../../../src/lib/vault-setup";
import { solanaBase58 } from "../adapter";
import {
  assertCanonicalAssetEvidence,
  assertCanonicalScenarioEvidence,
  canonicalInitializationInstructions,
  escrow,
  reconcileScenarioProjectEvidence,
  SolanaChain,
} from "./acceptance";

const programId = Keypair.generate().publicKey;
const ownerKey = Keypair.generate();
const owner = ownerKey.publicKey;
const mint = Keypair.generate().publicKey;
const identity = Keypair.generate().publicKey;
const fees = Keypair.generate().publicKey;
const program = escrow(programId);
const runId = "resume-run";
const assetInitialization = {
  networkDomain: Buffer.alloc(32, 7).toString("hex"),
  identityAuthority: identity,
  feeRecipient: fees,
  bindingDelay: 0n,
  rotationDelay: 0n,
};
const scenarioInitialization = {
  networkDomain: assetInitialization.networkDomain,
  identityAuthority: identity,
  feeRecipient: fees,
  bindingDelay: (_name: string) => 0n,
  rotationDelay: 0n,
};

function initializationReceipt(input: {
  projectId: string;
  asset?: typeof mint;
  purpose?: number;
  feePayer?: Keypair;
  identity?: typeof identity;
  fees?: typeof fees;
  bindingDelay?: bigint;
  rotationDelay?: bigint;
}) {
  const asset = input.asset ?? mint;
  const digest = registryProjectDigest(input.projectId);
  const project = program.project(
    owner,
    Buffer.from(digest, "hex"),
    input.purpose,
  );
  const vault = program.vault(project);
  const feePayer = input.feePayer ?? ownerKey;
  const transaction = new Transaction({
    feePayer: feePayer.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
  }).add(
    ...canonicalInitializationInstructions(programId, {
      owner,
      project,
      mint: asset,
      vault,
      projectId: Buffer.from(digest, "hex"),
      network: Buffer.alloc(32, 7),
      identity: input.identity ?? identity,
      fees: input.fees ?? fees,
      bindingDelay: input.bindingDelay ?? 0n,
      rotationDelay: input.rotationDelay ?? 0n,
      purpose: input.purpose,
    }),
  );
  transaction.sign(ownerKey, feePayer);
  const signature = transaction.signature;
  if (!signature) throw new Error("fixture transaction lacks signature");
  return {
    project,
    vault,
    step: {
      transactionId: solanaBase58(signature),
      raw: transaction.serialize().toString("base64"),
      from: owner.toBase58(),
      status: "success" as const,
    },
  };
}

function resign(
  evidence: AssetEvidence,
  mutate: (transaction: Transaction) => void,
  ...signers: Keypair[]
) {
  const step = evidence.steps["initialize-project"];
  const transaction = Transaction.from(Buffer.from(step.raw ?? "", "base64"));
  mutate(transaction);
  transaction.sign(ownerKey, ...signers);
  const signature = transaction.signature;
  if (!signature) throw new Error("mutated transaction lacks signature");
  step.raw = transaction.serialize().toString("base64");
  step.transactionId = solanaBase58(signature);
  evidence.deployment.deploymentTransaction = step.transactionId;
}

function assetEvidence(): AssetEvidence {
  const projectId = `acceptance-${runId.slice(0, 8)}-0`;
  const receipt = initializationReceipt({ projectId });
  const onchainProjectId = registryProjectDigest(projectId);
  return {
    address: mint.toBase58(),
    decimals: 6,
    referenceStablecoin: false,
    amounts: {},
    projectId,
    onchainProjectId,
    vault: receipt.vault.toBase58(),
    deployment: {
      network: "solana-devnet",
      programId: programId.toBase58(),
      owner: owner.toBase58(),
      asset: mint.toBase58(),
      projectPda: receipt.project.toBase58(),
      vault: receipt.vault.toBase58(),
      networkDomain: Buffer.alloc(32, 7).toString("hex"),
      identityAuthority: identity.toBase58(),
      feeRecipient: fees.toBase58(),
      bindingDelaySeconds: "0",
      rotationDelaySeconds: "0",
      deploymentTransaction: receipt.step.transactionId,
    },
    steps: { "initialize-project": receipt.step },
    checks: {},
    status: "passed",
  };
}

test("section-21 resume accepts canonical passed evidence", () => {
  expect(() =>
    assertCanonicalAssetEvidence(
      assetEvidence(),
      programId,
      owner,
      runId,
      0,
      assetInitialization,
    ),
  ).not.toThrow();
});

test("section-21 resume accepts signed initialization before broadcast metadata", () => {
  const evidence = assetEvidence();
  delete evidence.steps["initialize-project"].status;
  evidence.vault = null;
  evidence.deployment.deploymentTransaction = null;
  evidence.status = "pending";
  expect(() =>
    assertCanonicalAssetEvidence(
      evidence,
      programId,
      owner,
      runId,
      0,
      assetInitialization,
    ),
  ).not.toThrow();
});

test("section-21 resume accepts confirmed initialization before binding metadata", () => {
  const evidence = assetEvidence();
  evidence.vault = null;
  evidence.deployment.deploymentTransaction = null;
  evidence.status = "pending";
  expect(() =>
    assertCanonicalAssetEvidence(
      evidence,
      programId,
      owner,
      runId,
      0,
      assetInitialization,
    ),
  ).not.toThrow();
});

test("section-21 pending initialization rejects partial metadata binding", () => {
  const evidence = assetEvidence();
  evidence.vault = null;
  evidence.status = "pending";
  expect(() =>
    assertCanonicalAssetEvidence(
      evidence,
      programId,
      owner,
      runId,
      0,
      assetInitialization,
    ),
  ).toThrow(/wholly unbound or canonically bound/u);
});

test("Solana send resumes the exact signed initialization after persistence crashes", async () => {
  const steps: AssetEvidence["steps"] = {};
  const instruction = SystemProgram.transfer({
    fromPubkey: owner,
    toPubkey: Keypair.generate().publicKey,
    lamports: 1,
  });
  let broadcasts = 0;
  const interrupted = new SolanaChain("http://127.0.0.1:8899", async () => {
    throw new Error("crash after durable signed persistence");
  });
  Object.assign(interrupted.connection, {
    getLatestBlockhash: async () => ({
      blockhash: Keypair.generate().publicKey.toBase58(),
      lastValidBlockHeight: 100,
    }),
    sendRawTransaction: async () => {
      broadcasts++;
      return "unexpected";
    },
  });
  await expect(
    interrupted.send(steps, "initialize", [ownerKey], [instruction]),
  ).rejects.toThrow(/crash after durable signed persistence/u);
  expect(steps.initialize.raw).toBeTruthy();
  expect(broadcasts).toBe(0);

  let persisted = 0;
  const resumed = new SolanaChain("http://127.0.0.1:8899", async () => {
    persisted++;
  });
  Object.assign(resumed.connection, {
    getSignatureStatuses: async () => ({
      value: [
        {
          slot: 42,
          confirmations: 1,
          err: null,
          confirmationStatus: "confirmed",
        },
      ],
    }),
    sendRawTransaction: async () => {
      broadcasts++;
      return steps.initialize.transactionId;
    },
  });
  const result = await resumed.send(
    steps,
    "initialize",
    [ownerKey],
    [instruction],
  );
  expect(result.status).toBe("success");
  expect(result.transactionId).toBe(steps.initialize.transactionId);
  expect(broadcasts).toBe(0);
  expect(persisted).toBe(1);
});

test("Solana resume rejects signed bytes for another immutable step", async () => {
  const receipt = initializationReceipt({
    projectId: `acceptance-${runId.slice(0, 8)}-0`,
  });
  const chain = new SolanaChain("http://127.0.0.1:8899", async () => {});
  const unrelated = SystemProgram.transfer({
    fromPubkey: owner,
    toPubkey: Keypair.generate().publicKey,
    lamports: 1,
  });
  await expect(
    chain.send(
      { initialize: receipt.step },
      "initialize",
      [ownerKey],
      [unrelated],
    ),
  ).rejects.toThrow(/does not match the immutable step/u);
});

test("section-21 resume rejects tampered passed project identity", () => {
  const evidence = assetEvidence();
  evidence.onchainProjectId = registryProjectDigest("legacy-split-project");
  expect(() =>
    assertCanonicalAssetEvidence(
      evidence,
      programId,
      owner,
      runId,
      0,
      assetInitialization,
    ),
  ).toThrow(/canonical registry project digest/u);
});

test("section-21 resume rejects coherent identity substitution", () => {
  const evidence = assetEvidence();
  const substituted = "acceptance-attacker-0";
  const digest = registryProjectDigest(substituted);
  const project = program.project(owner, Buffer.from(digest, "hex"));
  const vault = program.vault(project).toBase58();
  evidence.projectId = substituted;
  evidence.onchainProjectId = digest;
  evidence.vault = vault;
  Object.assign(evidence.deployment, { projectPda: project.toBase58(), vault });
  expect(() =>
    assertCanonicalAssetEvidence(
      evidence,
      programId,
      owner,
      runId,
      0,
      assetInitialization,
    ),
  ).toThrow(/immutable run context/u);
});

test("section-21 passed evidence requires a canonical non-null vault", () => {
  const evidence = assetEvidence();
  evidence.vault = null;
  expect(() =>
    assertCanonicalAssetEvidence(
      evidence,
      programId,
      owner,
      runId,
      0,
      assetInitialization,
    ),
  ).toThrow(/non-null canonical vault/u);
});

test("section-21 resume rejects an unrelated initialization transaction", () => {
  const evidence = assetEvidence();
  const unrelated = initializationReceipt({
    projectId: `acceptance-${runId.slice(0, 8)}-1`,
  });
  evidence.steps["initialize-project"] = unrelated.step;
  evidence.deployment.deploymentTransaction = unrelated.step.transactionId;
  expect(() =>
    assertCanonicalAssetEvidence(
      evidence,
      programId,
      owner,
      runId,
      0,
      assetInitialization,
    ),
  ).toThrow(/initialization receipt/u);
});

test("section-21 resume rejects noncanonical retained initialization messages", () => {
  const cases: Array<[string, (evidence: AssetEvidence) => void]> = [
    [
      "foreign fee payer",
      (evidence) => {
        const payer = Keypair.generate();
        resign(
          evidence,
          (transaction) => {
            transaction.feePayer = payer.publicKey;
          },
          payer,
        );
      },
    ],
    [
      "extra transfer",
      (evidence) =>
        resign(evidence, (transaction) => {
          transaction.add(
            SystemProgram.transfer({
              fromPubkey: owner,
              toPubkey: Keypair.generate().publicKey,
              lamports: 1,
            }),
          );
        }),
    ],
    [
      "altered account flags",
      (evidence) =>
        resign(evidence, (transaction) => {
          const instruction = transaction.instructions[0];
          transaction.instructions[0] = new TransactionInstruction({
            programId: instruction.programId,
            keys: instruction.keys.map((key, index) =>
              index === 2 ? { ...key, isWritable: true } : key,
            ),
            data: instruction.data,
          });
        }),
    ],
    [
      "attacker identity",
      (evidence) => {
        const receipt = initializationReceipt({
          projectId: evidence.projectId,
          identity: Keypair.generate().publicKey,
        });
        evidence.steps["initialize-project"] = receipt.step;
        evidence.deployment.deploymentTransaction = receipt.step.transactionId;
      },
    ],
    [
      "attacker fee recipient",
      (evidence) => {
        const receipt = initializationReceipt({
          projectId: evidence.projectId,
          fees: Keypair.generate().publicKey,
        });
        evidence.steps["initialize-project"] = receipt.step;
        evidence.deployment.deploymentTransaction = receipt.step.transactionId;
      },
    ],
    [
      "changed binding delay",
      (evidence) => {
        const receipt = initializationReceipt({
          projectId: evidence.projectId,
          bindingDelay: 1n,
        });
        evidence.steps["initialize-project"] = receipt.step;
        evidence.deployment.deploymentTransaction = receipt.step.transactionId;
      },
    ],
    [
      "changed rotation delay",
      (evidence) => {
        const receipt = initializationReceipt({
          projectId: evidence.projectId,
          rotationDelay: 1n,
        });
        evidence.steps["initialize-project"] = receipt.step;
        evidence.deployment.deploymentTransaction = receipt.step.transactionId;
      },
    ],
  ];
  for (const [name, mutate] of cases) {
    const evidence = assetEvidence();
    mutate(evidence);
    expect(() =>
      assertCanonicalAssetEvidence(
        evidence,
        programId,
        owner,
        runId,
        0,
        assetInitialization,
      ),
    ).toThrow(/initialization receipt/u);
    expect(name).toBeTruthy();
  }
});

function scenarioEvidence(): ScenarioEvidence {
  const projectId = `acceptance-${runId.slice(0, 8)}-bounty`;
  const receipt = initializationReceipt({ projectId, purpose: 1 });
  const vault = receipt.vault.toBase58();
  const deployment = {
    network: "solana-devnet",
    programId: programId.toBase58(),
    owner: owner.toBase58(),
    asset: mint.toBase58(),
    projectPda: receipt.project.toBase58(),
    vault,
    networkDomain: Buffer.alloc(32, 7).toString("hex"),
    identityAuthority: identity.toBase58(),
    feeRecipient: fees.toBase58(),
    bindingDelaySeconds: "0",
    rotationDelaySeconds: "0",
    deploymentTransaction: receipt.step.transactionId,
  };
  return {
    status: "passed",
    assets: [mint.toBase58()],
    vaults: { bounty: vault },
    steps: { "bounty:initialize": receipt.step },
    checks: { complete: true },
    projects: {
      bounty: {
        projectId,
        onchainProjectId: registryProjectDigest(projectId),
        projectPda: receipt.project.toBase58(),
        vault,
        asset: mint.toBase58(),
        purpose: 1,
        deployment,
      },
    },
  };
}

test("extended resume accepts canonical completed scenario evidence", () => {
  expect(() =>
    assertCanonicalScenarioEvidence(
      scenarioEvidence(),
      programId,
      owner,
      runId,
      scenarioInitialization,
    ),
  ).not.toThrow();
});

test("extended resume retains canonical signed bytes until confirmation binds metadata", () => {
  const evidence = scenarioEvidence();
  const projects = evidence.projects;
  if (!projects) throw new Error("fixture lacks projects");
  const recorded = projects.bounty;
  const transactionId = recorded.deployment.deploymentTransaction;
  recorded.deployment.deploymentTransaction = null;
  delete evidence.steps["bounty:initialize"].status;
  delete evidence.vaults.bounty;
  evidence.assets = [];
  evidence.status = "pending";

  const expected = structuredClone(recorded);
  expected.deployment.deploymentTransaction = transactionId;
  expect(reconcileScenarioProjectEvidence("bounty", recorded, expected)).toBe(
    recorded,
  );
  expect(recorded.deployment.deploymentTransaction).toBeNull();
  recorded.deployment.deploymentTransaction = transactionId;
  expect(recorded.deployment.deploymentTransaction).toBe(transactionId);
});

test("extended resume rejects substitution of a retained initialization txid", () => {
  const evidence = scenarioEvidence();
  const projects = evidence.projects;
  if (!projects) throw new Error("fixture lacks projects");
  const recorded = projects.bounty;
  const expected = structuredClone(recorded);
  recorded.deployment.deploymentTransaction =
    Keypair.generate().publicKey.toBase58();
  expect(() =>
    reconcileScenarioProjectEvidence("bounty", recorded, expected),
  ).toThrow(/initialization transaction changed/u);
});

test("extended resume rejects tampered completed scenario evidence", () => {
  const evidence = scenarioEvidence();
  const projects = evidence.projects;
  if (!projects) throw new Error("fixture lacks projects");
  projects.bounty.projectPda = Keypair.generate().publicKey.toBase58();
  expect(() =>
    assertCanonicalScenarioEvidence(
      evidence,
      programId,
      owner,
      runId,
      scenarioInitialization,
    ),
  ).toThrow(/canonical project PDA/u);
});

test("extended resume fails closed on legacy completed evidence", () => {
  const evidence = scenarioEvidence();
  delete evidence.projects;
  expect(() =>
    assertCanonicalScenarioEvidence(
      evidence,
      programId,
      owner,
      runId,
      scenarioInitialization,
    ),
  ).toThrow(/lacks canonical project identity/u);
});

test("extended resume rejects coherent scenario identity substitution", () => {
  const evidence = scenarioEvidence();
  const projects = evidence.projects;
  if (!projects) throw new Error("fixture lacks projects");
  const substituted = "acceptance-attacker-bounty";
  const digest = registryProjectDigest(substituted);
  const project = program.project(owner, Buffer.from(digest, "hex"));
  const vault = program.vault(project).toBase58();
  Object.assign(projects.bounty, {
    projectId: substituted,
    onchainProjectId: digest,
    projectPda: project.toBase58(),
    vault,
  });
  Object.assign(projects.bounty.deployment, {
    projectPda: project.toBase58(),
    vault,
  });
  evidence.vaults.bounty = vault;
  expect(() =>
    assertCanonicalScenarioEvidence(
      evidence,
      programId,
      owner,
      runId,
      scenarioInitialization,
    ),
  ).toThrow(/immutable run context/u);
});

test("extended resume rejects an unrelated initialization transaction", () => {
  const evidence = scenarioEvidence();
  const unrelated = initializationReceipt({
    projectId: `acceptance-${runId.slice(0, 8)}-monthly`,
  });
  evidence.steps["bounty:initialize"] = unrelated.step;
  const projects = evidence.projects;
  if (!projects) throw new Error("fixture lacks projects");
  projects.bounty.deployment.deploymentTransaction =
    unrelated.step.transactionId;
  expect(() =>
    assertCanonicalScenarioEvidence(
      evidence,
      programId,
      owner,
      runId,
      scenarioInitialization,
    ),
  ).toThrow(/initialization receipt/u);
});

test("section-21 resume fails closed without retained initialization bytes", () => {
  const evidence = assetEvidence();
  delete evidence.steps["initialize-project"].raw;
  expect(() =>
    assertCanonicalAssetEvidence(
      evidence,
      programId,
      owner,
      runId,
      0,
      assetInitialization,
    ),
  ).toThrow(/initialization receipt/u);
});

test("extended resume fails closed without retained initialization bytes", () => {
  const evidence = scenarioEvidence();
  delete evidence.steps["bounty:initialize"].raw;
  expect(() =>
    assertCanonicalScenarioEvidence(
      evidence,
      programId,
      owner,
      runId,
      scenarioInitialization,
    ),
  ).toThrow(/initialization receipt/u);
});
