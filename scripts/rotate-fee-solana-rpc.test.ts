import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  initialSolanaProofRecord,
  SOLANA_PUBLIC_PAIR,
  validateRetainedSolanaProof,
} from "./qualify-solana-rpc-pair";
import {
  acquireRotationLeaseSql,
  renewRotationLeaseSql,
  verifyFeeSourceParity,
} from "./rotate-fee-solana-rpc";

function database() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE fee_converter_locks(network TEXT PRIMARY KEY,run_id TEXT,expires_at TEXT);
    CREATE TABLE fee_conversions(id TEXT,network TEXT,mode TEXT,state TEXT,kind TEXT,approval_tx_id TEXT,raw_tx TEXT,tx_id TEXT);
    CREATE TABLE fee_bridge_outcomes(bridge_id TEXT);
    CREATE TABLE fee_native_gas(network TEXT,state TEXT,actual_wei TEXT);`);
  return db;
}
const now = "2026-11-16T12:00:00.000Z";
const expiry = "2026-11-16T12:14:00.000Z";

test("a Solana rotation lease excludes cron and can renew only its own quiet lease", () => {
  const db = database();
  try {
    expect(
      db.query(acquireRotationLeaseSql).run("rotation", expiry, now).changes,
    ).toBe(1);
    expect(
      db.query(acquireRotationLeaseSql).run("cron", expiry, now).changes,
    ).toBe(0);
    expect(
      db.query(renewRotationLeaseSql).run(expiry, "rotation", now).changes,
    ).toBe(1);
    expect(
      db.query(renewRotationLeaseSql).run(expiry, "cron", now).changes,
    ).toBe(0);
    expect(
      db
        .query(renewRotationLeaseSql)
        .run(expiry, "rotation", "2026-11-16T12:15:00.000Z").changes,
    ).toBe(0);
  } finally {
    db.close();
  }
});

for (const state of ["quoted", "submitted", "unknown"])
  test(`pending ${state} fee work prevents acquiring and renewing the rotation lease`, () => {
    const db = database();
    try {
      db.query(
        "INSERT INTO fee_conversions(id,network,mode,state,kind) VALUES('one','solana','live',?,'claim')",
      ).run(state);
      expect(
        db.query(acquireRotationLeaseSql).run("rotation", expiry, now).changes,
      ).toBe(0);
      db.query(
        "INSERT INTO fee_converter_locks VALUES('solana','rotation',?)",
      ).run(expiry);
      expect(
        db.query(renewRotationLeaseSql).run(expiry, "rotation", now).changes,
      ).toBe(0);
    } finally {
      db.close();
    }
  });

for (const state of ["reserved", "signed"])
  test(`unsettled ${state} gas prevents rotation`, () => {
    const db = database();
    try {
      db.query("INSERT INTO fee_native_gas VALUES('solana',?,NULL)").run(state);
      expect(
        db.query(acquireRotationLeaseSql).run("rotation", expiry, now).changes,
      ).toBe(0);
    } finally {
      db.close();
    }
  });

test("completed Solana work and activity on another network preserve independent rotation", () => {
  const db = database();
  try {
    db.exec(
      "INSERT INTO fee_native_gas VALUES('solana','signed','5000'); INSERT INTO fee_conversions(id,network,mode,state,kind) VALUES('paid','solana','live','finalized','claim'),('other','base','live','submitted','claim')",
    );
    expect(
      db.query(acquireRotationLeaseSql).run("rotation", expiry, now).changes,
    ).toBe(1);
  } finally {
    db.close();
  }
});

test("the private candidate starts its own history and cannot inherit the public primary cursor", () => {
  const pair = [
    "https://mainnet.helius-rpc.com/?api-key=fixture",
    SOLANA_PUBLIC_PAIR[1],
  ];
  const fresh = initialSolanaProofRecord(pair);
  expect(fresh.coverage.map((value) => value.operator)).toEqual([
    "helius",
    "solana-vibe-station",
  ]);
  expect(validateRetainedSolanaProof(fresh, pair)).toEqual(fresh);
  expect(() =>
    validateRetainedSolanaProof(initialSolanaProofRecord(), pair),
  ).toThrow();
  expect(() => initialSolanaProofRecord([pair[0], pair[0]])).toThrow(
    "independent",
  );
});

test("the deployed fee source comparison retains the complete runtime dependency boundary", async () => {
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const files = await verifyFeeSourceParity(head, head);
  expect(files).toContain("workers/fee-converter/index.ts");
  expect(files).toContain("workers/fee-converter/solana.ts");
  expect(files).toContain("workers/fee-converter/wrangler.toml");
  expect(files).toContain("bun.lock");
});

for (const failure of [
  "upload",
  "deploy",
  "deploy-unresolved",
  "renew",
  "success",
  "source",
  "active",
  "bindings",
]) {
  test(`normal rotation preserves the safe phase and lease for ${failure}`, async () => {
    const { spawn } = await import("node:child_process");
    const fixture = new URL("./rotate-fee-solana-rpc.ts", import.meta.url).href;
    const shared = new URL("./release-robinhood-rpc.ts", import.meta.url).href;
    const qualifier = new URL("./qualify-solana-rpc-pair.ts", import.meta.url)
      .href;
    const candidateGuard = new URL("./probe-fee-solana-rpc.ts", import.meta.url)
      .href;
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    const script = `
      import { mock } from "bun:test";
      import { mkdtempSync,readFileSync,rmSync } from "node:fs";
      import { tmpdir } from "node:os";
      import { join } from "node:path";
      const root=mkdtempSync(join(tmpdir(),"rotation-normal-"));
      const failure=${JSON.stringify(failure)};
      const beforeId="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", afterId="bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
      const sha=${JSON.stringify(head)}, events=[]; let stateReads=0;
      const before={id:beforeId,number:1,annotations:{"workers/tag":failure==="source"?"b".repeat(40):sha},resources:{script:{etag:"same-code"},script_runtime:{compatibility_date:"2026-07-30"},bindings:[{name:"FEE_DB",type:"d1",database_id:"1b453124-2709-45af-8389-151a8105c461"},{name:"FEE_WALLET_KEY_SOLANA",type:"secret_text"},{name:"RPC_URL_SOLANA",type:"secret_text"},{name:"SOLANA_RECOVERY_RPC_URL",type:"secret_text"},{name:"RPC_URL_ROBINHOOD",type:"secret_text"},{name:"FEE_CONVERTER_MODE",type:"plain_text",text:"live"},{name:"BUYBACK_MODE",type:"plain_text",text:"live"}]}};
      process.env.GITHUB_SHA=sha; process.env.GITHUB_REF="refs/heads/main"; process.env.GITHUB_EVENT_NAME="workflow_dispatch";
      process.env.SLOP_SOLANA_RPC_EXPECTED_VERSION=beforeId; process.env.SLOP_SOLANA_RPC_EXPECTED_SOURCE=sha;
      process.env.CLOUDFLARE_ACCOUNT_ID="a".repeat(32); process.env.CLOUDFLARE_API_TOKEN="fixture";
      process.env.SLOP_SOLANA_RPC_CANDIDATE="https://fixture.helius-rpc.com"; process.env.SLOP_FEE_CONVERTER_RELEASE="enabled"; process.env.RUNNER_TEMP=root;
      mock.module("esbuild",()=>({build:async()=>({metafile:{inputs:{}}})}));
      mock.module(${JSON.stringify(candidateGuard)},()=>({requireSolanaProbeCandidate:x=>x}));
      const actualQualifier = await import(${JSON.stringify(qualifier)});
      mock.module(${JSON.stringify(qualifier)},()=>({...actualQualifier,SOLANA_PUBLIC_PAIR:["unused","https://public.rpc.solanavibestation.com"],qualifySolanaRpcPair:async(dir)=>{const fs=await import("node:fs");fs.writeFileSync(join(dir,"solana-rpc-public-pair-proof.json"),"{}");events.push("proof");}}));
      const actual = await import(${JSON.stringify(shared)});
      mock.module(${JSON.stringify(shared)},()=>({...actual,cloudflare:()=>()=>{},workerState:async()=>({active:{id:failure==="active"&&++stateReads>1?"changed":"deployment",versions:[{version_id:beforeId,percentage:100}]},latest:{id:beforeId}}),inspectVersion:async(_,id)=>id===beforeId?before:({...before,id,number:2,resources:failure==="bindings"?{...before.resources,script:{etag:"changed-code"}}:before.resources,annotations:{"workers/tag":sha,"workers/message":actual.rotationMessage(sha,before,"solana")}}),requireLiveMain:()=>{},requireRotationBase:(state,id)=>{if(state.active.id==="changed"||(failure==="deploy-unresolved"&&id===afterId))throw Error("Active changed");},runWrangler:args=>{events.push(args[1]);if(args[1]===failure||(failure==="deploy-unresolved"&&args[1]==="deploy"))throw Error("fixture failure");return "Worker Version ID: "+afterId;}}));
      globalThis.fetch=async(_,init)=>{const {sql}=JSON.parse(init.body);events.push(sql.startsWith("INSERT")?"acquire":sql.startsWith("DELETE")?"release":"renew");return Response.json({success:true,result:[{success:true,meta:{changes:failure==="renew"&&sql.startsWith("UPDATE")?0:1}}]});};
      try {
        const {rotateFeeSolanaRpc}=await import(${JSON.stringify(fixture)});
        try {await rotateFeeSolanaRpc();if(failure!=="success"&&failure!=="deploy")throw Error("Expected failure");}catch(error){if(error.message==="Expected failure"||failure==="success"||failure==="deploy")throw error; if(failure==="source"||failure==="active"){if(events.includes("acquire"))throw Error("Wrong source reached writes");process.exit(0);} if(!events.includes("acquire"))throw error;}
        const report=JSON.parse(readFileSync(join(root,"fee-solana-rpc-rotation.json"),"utf8"));
        if(!events.includes("proof")||!events.includes("acquire"))throw Error("Missing normal entry");
        if(failure==="success"||failure==="deploy") {if(report.phase!=="verified"||!events.includes("release")||!events.includes("deploy"))throw Error("Unverified success");}
        else if(failure==="deploy-unresolved") {if(events.includes("release")||report.phase!=="deploying"||report.candidateVersion!==afterId)throw Error("Uncertain activation lost");}
        else {if(events.includes("deploy")||!events.includes("release"))throw Error("Unactivated lease was not released");}
      }finally{rmSync(root,{recursive:true,force:true});}
    `;
    const child = spawn(process.execPath, ["-e", script], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let error = "";
    child.stderr.on("data", (chunk) => {
      error += String(chunk);
    });
    const [code] = await once(child, "exit");
    expect(error).toBe("");
    expect(code).toBe(0);
  }, 15000);
}

test("a shallow rotation checkout fetches only its exact deployed source before comparison", async () => {
  const root = mkdtempSync(join(tmpdir(), "fee-shallow-source-"));
  const entry = new URL("./rotate-fee-solana-rpc.ts", import.meta.url).href;
  const git = (args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  try {
    git(["init", "-q"]);
    git(["config", "user.email", "fixture@example.test"]);
    git(["config", "user.name", "fixture"]);
    mkdirSync(join(root, "workers/fee-converter"), { recursive: true });
    writeFileSync(
      join(root, "workers/fee-converter/index.ts"),
      "export default {};\n",
    );
    writeFileSync(
      join(root, "workers/fee-converter/wrangler.toml"),
      "name='fixture'\n",
    );
    writeFileSync(join(root, "package.json"), "{}");
    writeFileSync(join(root, "bun.lock"), "{}");
    git(["add", "."]);
    git(["commit", "-qm", "fixture"]);
    const head = git(["rev-parse", "HEAD"]),
      old = "b".repeat(40);
    const bin = join(root, "bin");
    mkdirSync(bin);
    const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
    const log = join(root, "git-calls");
    writeFileSync(
      join(bin, "git"),
      `#!/bin/sh\nif [ "$1" = "cat-file" ]; then exit 1; fi\nif [ "$1" = "fetch" ]; then printf '%s\\n' "$*" > '${log}'; exit 0; fi\nif [ "$1" = "diff" ]; then exit 0; fi\nexec '${realGit}' "$@"\n`,
      { mode: 0o700 },
    );
    const { spawn } = await import("node:child_process");
    const child = spawn(
      process.execPath,
      [
        "-e",
        `const {verifyFeeSourceParity}=await import(${JSON.stringify(entry)});await verifyFeeSourceParity(${JSON.stringify(old)},${JSON.stringify(head)});`,
      ],
      {
        cwd: root,
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let errors = "";
    child.stderr.on("data", (chunk) => {
      errors += String(chunk);
    });
    const [code] = await once(child, "exit");
    expect(errors).toBe("");
    expect(code).toBe(0);
    expect(readFileSync(log, "utf8").trim()).toBe(
      `fetch --no-tags --depth=1 https://github.com/SlopDotCash/slopdotcash.git ${old}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a prior pre-activation witness is digest-bound and must retain its exact complete operator histories", async () => {
  const { createHash } = await import("node:crypto");
  const { validatePriorRotationProof } = await import(
    "./rotate-fee-solana-rpc"
  );
  const pair = ["https://fixture.helius-rpc.com", SOLANA_PUBLIC_PAIR[1]];
  const bytes = new TextEncoder().encode(
    JSON.stringify(initialSolanaProofRecord(pair)),
  );
  const receipt = {
    schemaVersion: 1,
    phase: "qualification",
    checkout: "a".repeat(40),
    deployedSource: "b".repeat(40),
    previousVersion: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    proofSha256: createHash("sha256").update(bytes).digest("hex"),
  };
  expect(() =>
    validatePriorRotationProof(receipt, bytes, pair, receipt.checkout),
  ).toThrow("incomplete");
  expect(() =>
    validatePriorRotationProof(
      { ...receipt, runId: "already-started" },
      bytes,
      pair,
      receipt.checkout,
    ),
  ).toThrow("before activation");
  expect(() =>
    validatePriorRotationProof(
      { ...receipt, candidateVersion: receipt.previousVersion },
      bytes,
      pair,
      receipt.checkout,
    ),
  ).toThrow("before activation");
  expect(() =>
    validatePriorRotationProof(
      { ...receipt, proofSha256: "f".repeat(64) },
      bytes,
      pair,
      receipt.checkout,
    ),
  ).toThrow("digest");
  expect(() =>
    validatePriorRotationProof(
      receipt,
      bytes,
      SOLANA_PUBLIC_PAIR,
      receipt.checkout,
    ),
  ).toThrow("inconsistent");
});

test("deployment command diagnostics retain only fixed categories and numeric codes", async () => {
  const { safeRotationCommandError } = await import("./rotate-fee-solana-rpc");
  expect(
    safeRotationCommandError({
      status: 1,
      stderr: "private-url unauthorized [code: 10000]",
    }),
  ).toEqual({ category: "authentication", exitCode: 1, providerCode: 10000 });
  expect(
    safeRotationCommandError({
      status: 1,
      stderr: "private version not found [code: 100146]",
    }),
  ).toEqual({
    category: "version-unavailable",
    exitCode: 1,
    providerCode: 100146,
  });
  expect(
    JSON.stringify(
      safeRotationCommandError({ stderr: "https://secret.invalid token" }),
    ),
  ).not.toContain("secret");
});

test("activation readback tolerates stale observations but never redeploys", async () => {
  const { confirmSolanaRotation } = await import("./rotate-fee-solana-rpc");
  const previous = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    candidate = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    sha = "a".repeat(40);
  const bindings = [
    { name: "FEE_DB", type: "d1" },
    { name: "RPC_URL_ROBINHOOD", type: "secret_text" },
    { name: "RPC_URL_SOLANA", type: "secret_text" },
    { name: "SOLANA_RECOVERY_RPC_URL", type: "secret_text" },
    { name: "BUYBACK_MODE", type: "plain_text", text: "live" },
    { name: "FEE_CONVERTER_MODE", type: "plain_text", text: "live" },
  ];
  const before = {
    id: previous,
    number: 1,
    resources: {
      bindings,
      script: { etag: "same" },
      script_runtime: { compatibility_date: "2026-07-30" },
    },
  };
  let reads = 0;
  const get = async (path: string) => {
    if (path === "deployments")
      return {
        deployments: [
          {
            id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
            versions: [
              {
                version_id: ++reads < 3 ? previous : candidate,
                percentage: 100,
              },
            ],
          },
        ],
      };
    if (path === "versions") return { items: [{ id: candidate, number: 2 }] };
    return {
      ...before,
      id: candidate,
      number: 2,
      annotations: {
        "workers/tag": sha,
        "workers/message": `slop.cash release ${sha}; Solana RPC rotation from ${previous}`,
      },
    };
  };
  await confirmSolanaRotation(get, before, candidate, sha, async () => {});
  expect(reads).toBe(3);
  await expect(
    confirmSolanaRotation(
      async (path: string) =>
        path === "deployments"
          ? {
              deployments: [
                {
                  id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
                  versions: [{ version_id: previous, percentage: 100 }],
                },
              ],
            }
          : { items: [{ id: candidate, number: 2 }] },
      before,
      candidate,
      sha,
      async () => {},
    ),
  ).rejects.toThrow("pinned");
});
