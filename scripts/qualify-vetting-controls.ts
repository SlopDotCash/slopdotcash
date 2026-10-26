/** Protected staging test only. Default invocation is an offline plan. */
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { unstable_splitSqlQuery as splitSqlQuery } from "wrangler";
import {
  qualificationMigrations,
  qualificationSchema,
} from "../workers/vetting-backup/qualification";

type Database = { uuid: string; name: string };
type Queue = { queue_id: string; queue_name: string };
type Bucket = { name: string; creation_date: string };
type Owned = {
  databases: Database[];
  queues: Queue[];
  buckets: Bucket[];
  worker: boolean;
};
const env = process.env;
const execute = process.argv.slice(2).join(" ") === "--execute";
if (process.argv.length > 2 && !execute)
  throw new Error(
    "Use no arguments for an offline plan, or --execute in the protected workflow",
  );
const sha = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const run = `slop-vet-q-${env.GITHUB_RUN_ID ?? "0"}-${env.GITHUB_RUN_ATTEMPT ?? "0"}`;
if (!/^slop-vet-q-[0-9]{1,20}-[0-9]{1,5}$/.test(run))
  throw new Error("Invalid qualification run identity");
const names = {
  worker: run,
  databases: [`${run}-source`, `${run}-restored`],
  buckets: [`${run}-source`, `${run}-backup`, `${run}-restored`],
  queues: [`${run}-work`, `${run}-failed`],
};
if (!execute) {
  console.log(
    JSON.stringify(
      {
        mode: "plan",
        source: sha,
        names,
        resources: { d1: 2, r2: 3, queues: 2, worker: 1 },
        publicRoutes: false,
        scans: false,
        cleanup: "only exact resources created by this workflow run",
      },
      null,
      2,
    ),
  );
} else {
  await main().catch(() => {
    console.error(
      "Scanner recovery qualification failed. Inspect safe result and owned-resource cleanup status; no private bytes or credentials are logged.",
    );
    process.exitCode = 1;
  });
}

async function main() {
  if (
    env.GITHUB_ACTIONS !== "true" ||
    env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    env.GITHUB_REF !== "refs/heads/development" ||
    env.GITHUB_REPOSITORY !== "SlopDotCash/slopdotcash" ||
    env.GITHUB_WORKFLOW_REF !==
      "SlopDotCash/slopdotcash/.github/workflows/vetting-recovery-qualification.yml@refs/heads/development" ||
    env.GITHUB_SHA !== sha ||
    env.VETTING_QUALIFICATION_MODE !== "execute" ||
    !/^[a-f0-9]{40}$/.test(sha) ||
    run.endsWith("-0") ||
    !/^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID ?? "") ||
    !env.CLOUDFLARE_API_TOKEN
  )
    throw new Error("Exact protected development qualification is required");
  const root = process.cwd(),
    directory = await mkdtemp(join(tmpdir(), `${run}-`));
  const reportDirectory = resolve(
    env.RUNNER_TEMP ?? directory,
    "vetting-recovery-report",
  );
  await mkdir(reportDirectory, { recursive: true });
  const owned: Owned = {
    databases: [],
    queues: [],
    buckets: [],
    worker: false,
  };
  const uncertainCreations = new Set<string>();
  let workerVersion: string | null = null;
  let consumerId: string | null = null;
  let deployed = false,
    bindingsVerified = false,
    success = false;
  const report: Record<string, unknown> = {
    source: sha,
    run,
    hosted: true,
    productionTouched: false,
    scans: false,
    policyAttested: false,
  };
  const account = env.CLOUDFLARE_ACCOUNT_ID;
  async function api<T>(
    path: string,
    method = "GET",
    body?: unknown,
    missing = false,
  ): Promise<T> {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${account}/${path}`,
      {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
        headers: {
          authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
          "content-type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    if (missing && response.status === 404) return null as T;
    if (!response.ok)
      throw new Error(
        `Qualification control request refused (${response.status})`,
      );
    const json = (await response.json()) as { success?: boolean; result: T };
    if (json.success !== true)
      throw new Error("Qualification control request failed");
    return json.result;
  }
  async function query(id: string, sql: string, params: unknown[] = []) {
    if (!owned.databases.some((d) => d.uuid === id))
      throw new Error("Database is not owned by this run");
    const results = await api<
      { success: boolean; results: Record<string, unknown>[] }[]
    >(`d1/database/${id}/query`, "POST", { sql, params });
    if (results.some((r) => !r.success))
      throw new Error("Qualification SQL failed");
    return results.flatMap((r) => r.results);
  }
  async function requireAbsent(path: string) {
    if ((await api(path, "GET", undefined, true)) !== null)
      throw new Error("Owned fixture still exists after deletion");
  }
  let deliveryNumber = 0;
  async function command(action: string) {
    if (!bindingsVerified)
      throw new Error("Qualification bindings are not verified");
    const delivery = `${action}-${++deliveryNumber}`;
    await api(`queues/${owned.queues[0].queue_id}/messages`, "POST", {
      content_type: "json",
      body: { qualification: run, action, delivery },
    });
    const deadline = Date.now() + 180_000;
    for (;;) {
      const rows = await query(
        owned.databases[0].uuid,
        "SELECT id FROM qualification_deliveries WHERE id=?",
        [`command:${delivery}`],
      );
      if (rows.length === 1) return;
      if (
        (
          await query(
            owned.databases[0].uuid,
            "SELECT phase FROM qualification_results WHERE phase=?",
            [`failed-${action}`],
          )
        ).length ||
        Date.now() > deadline
      )
        throw new Error("Qualification command was not completed");
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  async function waitFor(phase: string, timeout = 180_000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const rows = await query(
        owned.databases[0].uuid,
        "SELECT phase,result FROM qualification_results WHERE phase IN (?,?)",
        [phase, `failed-${phase}`],
      );
      if (rows.some((r) => r.phase === `failed-${phase}`))
        throw new Error("Qualification assertion failed");
      const row = rows.find((r) => r.phase === phase);
      if (row) return JSON.parse(String(row.result)) as Record<string, unknown>;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error("Qualification result did not complete");
  }
  async function assertBindings() {
    const result = await api<{ bindings: Record<string, unknown>[] }>(
      `workers/scripts/${run}/settings`,
    );
    const actual = result.bindings;
    const wanted = [
      ...owned.databases.map((d, i) => ({
        type: "d1",
        name: i ? "RESTORED_DB" : "EVIDENCE_DATABASE",
        id: d.uuid,
      })),
      ...owned.buckets.map((b, i) => ({
        type: "r2_bucket",
        name: ["EVIDENCE_SOURCE", "EVIDENCE_BACKUPS", "RESTORED"][i],
        bucket_name: b.name,
      })),
      {
        type: "queue",
        name: "EVIDENCE_BACKUP_QUEUE",
        queue_name: names.queues[0],
      },
      ...Object.entries({
        QUALIFICATION_RUN: run,
        EVIDENCE_BACKUP_MODE: "enabled",
        EVIDENCE_RETENTION_MODE: "off",
      }).map(([name, text]) => ({ type: "plain_text", name, text })),
    ];
    if (
      actual.length !== wanted.length ||
      wanted.some(
        (w) =>
          !actual.some((a) => Object.entries(w).every(([k, v]) => a[k] === v)),
      )
    )
      throw new Error("Qualification bindings differ");
    const urls = await api<{ enabled: boolean; previews_enabled: boolean }>(
      `workers/scripts/${run}/subdomain`,
    );
    if (urls.enabled !== false || urls.previews_enabled !== false)
      throw new Error("Qualification Worker has a public URL");
    const queue = await api<
      Queue & {
        consumers: {
          consumer_id: string;
          type: string;
          script?: string;
          script_name?: string;
          settings: { max_concurrency: number; batch_size: number };
        }[];
      }
    >(`queues/${owned.queues[0].queue_id}`);
    // Hosted queue reads use `script`; the API schema also permits
    // `script_name`. Every supplied identity must name this exact Worker.
    const scripts = [
      queue.consumers[0]?.script,
      queue.consumers[0]?.script_name,
    ].filter((script) => script !== undefined);
    if (
      queue.consumers.length !== 1 ||
      queue.consumers[0].type !== "worker" ||
      scripts.length === 0 ||
      scripts.some((script) => script !== run) ||
      queue.consumers[0].settings.max_concurrency !== 1 ||
      queue.consumers[0].settings.batch_size !== 1
    )
      throw new Error("Qualification queue consumer differs");
    consumerId = queue.consumers[0].consumer_id;
    if (!/^[a-f0-9]{32}$/.test(consumerId))
      throw new Error("Qualification consumer identity is missing");
    for (const bucket of owned.buckets) {
      const managed = await api<{ enabled: boolean }>(
        `r2/buckets/${bucket.name}/domains/managed`,
      );
      const custom = await api<{ domains: unknown[] }>(
        `r2/buckets/${bucket.name}/domains/custom`,
      );
      if (managed.enabled !== false || custom.domains.length !== 0)
        throw new Error("Qualification bucket has public access");
    }
    bindingsVerified = true;
  }
  function assertVersion(expected: string | null) {
    const read = (args: string[]) =>
      JSON.parse(
        execFileSync(join(root, "node_modules/.bin/wrangler"), args, {
          cwd: directory,
          encoding: "utf8",
          env: { ...env, WRANGLER_SEND_METRICS: "false" },
        }),
      );
    const deployment = read(["deployments", "status", "--name", run, "--json"]);
    const versions = read(["versions", "list", "--name", run, "--json"]);
    if (
      deployment.versions?.length !== 1 ||
      deployment.versions[0].percentage !== 100 ||
      !versions.some(
        (v: { id: string; annotations?: Record<string, string> }) =>
          v.id === deployment.versions[0].version_id &&
          v.annotations?.["workers/tag"] === sha,
      ) ||
      (expected !== null && deployment.versions[0].version_id !== expected)
    )
      throw new Error("Qualification deployment is not the reviewed source");
    return String(deployment.versions[0].version_id);
  }
  async function cleanup() {
    let errors = 0;
    // Empty only the dedicated buckets, through the already verified binding set.
    if (deployed && bindingsVerified) {
      try {
        if (workerVersion === null)
          throw new Error("Worker creation is unresolved");
        assertVersion(workerVersion);
        await assertBindings();
        await command("empty");
        await waitFor("empty");
      } catch {
        errors++;
      }
    }
    if (owned.worker) {
      try {
        if (workerVersion === null)
          throw new Error("Worker creation is unresolved");
        assertVersion(workerVersion);
        await assertBindings();
        await api(
          `queues/${owned.queues[0].queue_id}/consumers/${consumerId}`,
          "DELETE",
        );
        await api(`workers/scripts/${run}`, "DELETE");
        await requireAbsent(`workers/scripts/${run}/settings`);
        owned.worker = false;
      } catch {
        errors++;
      }
    }
    for (const queue of owned.queues.toReversed())
      try {
        const current = await api<Queue>(`queues/${queue.queue_id}`);
        if (
          current.queue_name !== queue.queue_name ||
          !names.queues.includes(current.queue_name)
        )
          throw new Error("Queue ownership changed");
        await api(`queues/${queue.queue_id}`, "DELETE");
        await requireAbsent(`queues/${queue.queue_id}`);
      } catch {
        errors++;
      }
    for (const database of owned.databases)
      try {
        const current = await api<Database>(`d1/database/${database.uuid}`);
        if (
          current.uuid !== database.uuid ||
          current.name !== database.name ||
          !names.databases.includes(current.name)
        )
          throw new Error("Database ownership changed");
        await api(`d1/database/${database.uuid}`, "DELETE");
        await requireAbsent(`d1/database/${database.uuid}`);
      } catch {
        errors++;
      }
    for (const bucket of owned.buckets)
      try {
        const current = await api<Bucket>(`r2/buckets/${bucket.name}`);
        if (
          current.name !== bucket.name ||
          current.creation_date !== bucket.creation_date ||
          !names.buckets.includes(current.name)
        )
          throw new Error("Bucket ownership changed");
        // Cloudflare refuses a nonempty bucket. Never force removal.
        await api(`r2/buckets/${bucket.name}`, "DELETE");
        await requireAbsent(`r2/buckets/${bucket.name}`);
      } catch {
        errors++;
      }
    report.fixtureResources = owned;
    report.workerVersion = workerVersion;
    report.cleanup = {
      complete: errors === 0 && uncertainCreations.size === 0,
      failedOperations: errors,
      unresolvedCreations: [...uncertainCreations],
    };
    if (errors || uncertainCreations.size)
      throw new Error("Owned-resource cleanup is incomplete");
  }
  try {
    // Never overwrite/adopt an existing Worker or data resource.
    if (await api(`workers/scripts/${run}/settings`, "GET", undefined, true))
      throw new Error("Qualification Worker already exists");
    for (const name of names.databases) {
      if ((await api<Database[]>(`d1/database?name=${name}`)).length)
        throw new Error("Qualification database already exists");
      uncertainCreations.add(name);
      const created = await api<Database>("d1/database", "POST", { name });
      if (created.name !== name || !/^[a-f0-9-]{36}$/.test(created.uuid))
        throw new Error("Unexpected database identity");
      owned.databases.push({ uuid: created.uuid, name: created.name });
      uncertainCreations.delete(name);
    }
    for (const name of names.buckets) {
      if (await api(`r2/buckets/${name}`, "GET", undefined, true))
        throw new Error("Qualification bucket already exists");
      uncertainCreations.add(name);
      const created = await api<Bucket>("r2/buckets", "POST", { name });
      if (created.name !== name || !created.creation_date)
        throw new Error("Unexpected bucket identity");
      owned.buckets.push({
        name: created.name,
        creation_date: created.creation_date,
      });
      uncertainCreations.delete(name);
    }
    for (const name of names.queues) {
      if (
        (await api<Queue[]>(`queues?name=${name}`)).some(
          (q) => q.queue_name === name,
        )
      )
        throw new Error("Qualification queue already exists");
      uncertainCreations.add(name);
      const created = await api<Queue>("queues", "POST", { queue_name: name });
      if (
        created.queue_name !== name ||
        !/^[a-f0-9]{32}$/.test(created.queue_id)
      )
        throw new Error("Unexpected queue identity");
      owned.queues.push({
        queue_id: created.queue_id,
        queue_name: created.queue_name,
      });
      uncertainCreations.delete(name);
    }
    const statements = [...splitSqlQuery(qualificationSchema)];
    for (const migration of qualificationMigrations)
      statements.push(
        ...splitSqlQuery(
          await readFile(join(root, "migrations", migration), "utf8"),
        ),
      );
    for (const db of owned.databases)
      for (const sql of statements) await query(db.uuid, sql);
    const config = {
      name: run,
      main: join(root, "workers/vetting-backup/qualification-entry.ts"),
      compatibility_date: "2026-07-30",
      workers_dev: false,
      preview_urls: false,
      account_id: account,
      vars: {
        QUALIFICATION_RUN: run,
        EVIDENCE_BACKUP_MODE: "enabled",
        EVIDENCE_RETENTION_MODE: "off",
      },
      d1_databases: owned.databases.map((d, i) => ({
        binding: i ? "RESTORED_DB" : "EVIDENCE_DATABASE",
        database_name: d.name,
        database_id: d.uuid,
      })),
      r2_buckets: owned.buckets.map((b, i) => ({
        binding: ["EVIDENCE_SOURCE", "EVIDENCE_BACKUPS", "RESTORED"][i],
        bucket_name: b.name,
      })),
      queues: {
        producers: [
          { binding: "EVIDENCE_BACKUP_QUEUE", queue: names.queues[0] },
        ],
        consumers: [
          {
            queue: names.queues[0],
            max_batch_size: 1,
            max_batch_timeout: 0,
            max_retries: 2,
            retry_delay: 1,
            dead_letter_queue: names.queues[1],
            max_concurrency: 1,
          },
        ],
      },
      observability: { enabled: false },
      limits: { cpu_ms: 300000 },
    };
    const file = join(directory, "wrangler.json");
    await writeFile(file, JSON.stringify(config), { mode: 0o600 });
    uncertainCreations.add(run);
    execFileSync(
      join(root, "node_modules/.bin/wrangler"),
      [
        "deploy",
        "--config",
        file,
        "--tag",
        sha,
        "--message",
        `Disposable recovery qualification ${run}`,
      ],
      {
        cwd: directory,
        stdio: "pipe",
        timeout: 120_000,
        env: { ...env, WRANGLER_SEND_METRICS: "false" },
      },
    );
    owned.worker = true;
    deployed = true;
    workerVersion = assertVersion(null);
    uncertainCreations.delete(run);
    await assertBindings();
    await command("access");
    report.access = await waitFor("access");
    await command("seed");
    report.seed = await waitFor("seed");
    const until = Date.now() + 240_000;
    for (;;) {
      const rows = await query(
        owned.databases[0].uuid,
        "SELECT phase FROM vetting_storage_cycles",
      );
      const deliveries = await query(
        owned.databases[0].uuid,
        "SELECT count(*) n FROM qualification_deliveries WHERE action='backup-page-0'",
      );
      if (
        rows.length === 1 &&
        rows[0].phase === "complete" &&
        Number(deliveries[0]?.n) >= 2
      ) {
        report.acknowledgedFirstPageDeliveries = Number(deliveries[0].n);
        break;
      }
      if (Date.now() > until)
        throw new Error("Hosted queue snapshot did not finish");
      await new Promise((r) => setTimeout(r, 1000));
    }
    await command("verify");
    report.verify = await waitFor("verify");
    await command("verify"); // Command replay uses permanent phase results.
    report.replayedVerify = await waitFor("verify");
    const verifiedDeliveries = await query(
      owned.databases[0].uuid,
      "SELECT count(*) n FROM qualification_deliveries WHERE action='verify'",
    );
    if (Number(verifiedDeliveries[0]?.n) !== 2)
      throw new Error("Repeated verification was not delivered");
    report.acknowledgedVerifyCommands = 2;
    await command("corrupt");
    report.corrupt = await waitFor("corrupt");
    await command("retention");
    report.retention = await waitFor("retention");
    await command("retention");
    report.replayedRetention = await waitFor("retention");
    const retentionDeliveries = await query(
      owned.databases[0].uuid,
      "SELECT count(*) n FROM qualification_deliveries WHERE action='retention'",
    );
    if (Number(retentionDeliveries[0]?.n) !== 2)
      throw new Error("Repeated retention verification was not delivered");
    report.acknowledgedRetentionCommands = 2;
    success = true;
  } finally {
    try {
      await cleanup();
    } finally {
      report.success =
        success &&
        (report.cleanup as { complete?: boolean })?.complete === true;
      await writeFile(
        join(reportDirectory, "result.json"),
        `${JSON.stringify(report, null, 2)}\n`,
      );
      await rm(directory, { recursive: true, force: true });
    }
  }
  console.log(
    "Hosted harmless recovery qualification passed; safe result recorded. No operational policy is attested.",
  );
}
