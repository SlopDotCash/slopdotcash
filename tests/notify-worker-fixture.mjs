/** Runs the shipped notification Worker locally. All identities and addresses are synthetic. */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { childEnvironment } from "../scripts/child-environment.mjs";

export const E2E_EMAIL_ACCOUNTS = Object.fromEntries(
  [
    [1440, "900000101"],
    [320, "900000104"],
  ].map(([width, githubId]) => [`email${width}`, githubId]),
);

export async function startNotifyWorkerFixture(
  root,
  persistTo,
  port,
  {
    securityGithubIds = [],
    securityVerifiedAt = "2026-01-01T00:00:00.000Z",
    generalEmail = false,
  } = {},
) {
  const folder = mkdtempSync(join(tmpdir(), "slop-notify-e2e-"));
  const name = `slop-notify-e2e-${port}`;
  const source = readFileSync(join(root, "wrangler.toml"), "utf8");
  const databaseId = source.match(/^database_id = "([a-f0-9-]+)"$/mu)?.[1];
  if (!databaseId) throw new Error("Missing registry database id");
  const ids = [...new Set(securityGithubIds)];
  if (
    (ids.length > 0 && ids.length < 2) ||
    ids.some((id) => typeof id !== "string" || !/^[1-9]\d{0,19}$/u.test(id))
  )
    throw new Error(
      "Security mail fixtures need at least two distinct actor IDs",
    );
  const securityRecipients = Object.fromEntries(
    ids.map((id, index) => [
      id,
      {
        email: `actor-${id}@example.com`,
        verifiedAt: securityVerifiedAt,
        evidenceReference: "synthetic-local-pilot-verification",
        backupGithubId: ids[(index + 1) % ids.length],
      },
    ]),
  );
  // This local-only adapter gives browser tests the same private service
  // request URL used by Pages, without adding a public production route.
  const main =
    ids.length || generalEmail
      ? join(folder, "entry.ts")
      : resolve(root, "workers/notify/index.ts");
  if (ids.length || generalEmail)
    writeFileSync(
      main,
      `import worker from ${JSON.stringify(resolve(root, "workers/notify/index.ts"))};
export default { fetch(request, env, context) {
  if (new URL(request.url).pathname === "/__fixture/security-dispatch")
    return worker.fetch(new Request("https://notify.internal/v1/security-notifications/dispatch", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), env, context);
  if (new URL(request.url).pathname.startsWith("/v1/email/"))
    return worker.fetch(new Request("https://notify.internal" + new URL(request.url).pathname, request), env, context);
  return worker.fetch(request, env, context);
}};\n`,
    );
  const config = join(folder, "wrangler.json");
  writeFileSync(
    config,
    JSON.stringify({
      name,
      main,
      compatibility_date: "2026-07-30",
      vars: {
        NOTIFY_FROM_ADDRESS: "notifications@slop.cash",
        NOTIFY_INBOX_URL: "https://staging.slop.cash/inbox",
        ...(generalEmail
          ? {
              NOTIFY_GENERAL_EMAIL_ENABLED: "true",
              NOTIFY_UNSUBSCRIBE_KEY: "ab".repeat(32),
            }
          : {}),
        ACTIVITY_MAIL_PILOT: JSON.stringify({
          inboxUrl: "https://staging.slop.cash/inbox",
          recipients: Object.fromEntries(
            ["900000002", ...Object.values(E2E_EMAIL_ACCOUNTS)].map(
              (githubId) => [
                githubId,
                {
                  email: "applicant@example.com",
                  verifiedAt: "2026-01-01T00:00:00.000Z",
                  evidenceReference: "synthetic-local-pilot-verification",
                },
              ],
            ),
          ),
        }),
        ...(ids.length
          ? {
              SECURITY_MAIL_PILOT: JSON.stringify({
                inboxUrl: "https://staging.slop.cash/inbox",
                recipients: securityRecipients,
              }),
            }
          : {}),
      },
      d1_databases: [
        {
          binding: "SLOP_DB",
          database_name: "slop-private",
          database_id: databaseId,
        },
      ],
      send_email: [
        {
          name: "ADMIN_EMAIL",
          ...(generalEmail
            ? {}
            : {
                allowed_destination_addresses: [
                  "applicant@example.com",
                  ...Object.values(securityRecipients).map(
                    (entry) => entry.email,
                  ),
                ],
              }),
        },
      ],
      observability: { enabled: false },
    }),
  );
  const emailCaptureUrl = `http://127.0.0.1:${port}/cdn-cgi/local/explorer/api/local/email/sending`;
  return {
    name,
    securityRecipients,
    emailCaptureUrl,
    async dispatchSecurityMail() {
      const response = await fetch(
        `http://127.0.0.1:${port}/__fixture/security-dispatch`,
        { method: "POST" },
      );
      if (response.status !== 204)
        throw new Error(`Local security dispatch returned ${response.status}`);
    },
    /** The real local send_email binding's captured MIME, never external mail. */
    async capturedEmails() {
      return capturedNotifyEmails(`http://127.0.0.1:${port}`, name);
    },
    close: await startLocalWorker(root, {
      config,
      port,
      label: "notify",
      extraArgs: ["--persist-to", persistTo],
      cleanup: () => rmSync(folder, { recursive: true, force: true }),
    }),
  };
}

/** Reads only Miniflare's local email capture; never a provider inbox. */
export async function capturedNotifyEmails(origin, workerName) {
  const query = new URL(
    "/cdn-cgi/local/explorer/api/local/email/sending",
    origin,
  );
  if (workerName) query.searchParams.set("worker", workerName);
  query.searchParams.set("per_page", "100");
  const listed = await fetch(query);
  if (!listed.ok)
    throw new Error(`Local email capture returned ${listed.status}`);
  const page = await listed.json();
  if (!Array.isArray(page.result) || page.result_info?.has_more)
    throw new Error("Local email capture was malformed or incomplete");
  return Promise.all(
    page.result.map(async (entry) => {
      const detail = new URL(query);
      detail.searchParams.delete("per_page");
      detail.searchParams.set("email_id", entry.messageId);
      const response = await fetch(detail);
      if (!response.ok)
        throw new Error(`Local email detail returned ${response.status}`);
      const captured = (await response.json()).result;
      const raw =
        captured.raw ??
        (typeof captured.rawBase64 === "string"
          ? Buffer.from(captured.rawBase64, "base64").toString("utf8")
          : undefined);
      if (typeof raw !== "string")
        throw new Error("Local email capture has no MIME body");
      const boundary = /\r?\n\r?\n/u.exec(raw);
      if (!boundary)
        throw new Error("Local email capture has no body separator");
      const headers = raw.slice(0, boundary.index);
      if (
        !/^Content-Type: text\/plain;/imu.test(headers) ||
        !/^Content-Transfer-Encoding: quoted-printable\r?$/imu.test(headers)
      )
        throw new Error(
          "Local notification capture is not plain quoted-printable MIME",
        );
      const encoded = raw.slice(boundary.index + boundary[0].length);
      const decoded = encoded
        .replace(/=\r?\n/gu, "")
        .replace(/=([A-Fa-f0-9]{2})/gu, (_, hex) =>
          String.fromCharCode(Number.parseInt(hex, 16)),
        );
      return {
        ...captured,
        raw,
        text: Buffer.from(decoded, "binary").toString("utf8"),
      };
    }),
  );
}

/**
 * Starts `wrangler dev` for one local fixture Worker and waits until it
 * answers. Returns the function that stops it, waits for it to exit and
 * then runs `cleanup`.
 */
export async function startLocalWorker(
  root,
  { config, port, label, extraArgs = [], cleanup },
) {
  const worker = spawn(
    "node",
    [
      join(root, "node_modules/wrangler/bin/wrangler.js"),
      "dev",
      "--config",
      config,
      "--port",
      String(port),
      "--ip",
      "127.0.0.1",
      "--inspector-port",
      "0",
      ...extraArgs,
      "--log-level",
      "error",
      "--show-interactive-dev-session=false",
    ],
    { cwd: root, env: childEnvironment(), stdio: ["ignore", "pipe", "pipe"] },
  );
  let diagnostic = "";
  for (const stream of [worker.stdout, worker.stderr])
    stream.on("data", (chunk) => {
      diagnostic += String(chunk);
    });
  const exited = new Promise((resolve) => worker.once("exit", resolve));
  // A running Worker keeps its --persist-to files open. Windows refuses to
  // delete an open file, so callers remove those files only after close().
  const close = async () => {
    worker.kill("SIGTERM");
    const force = setTimeout(() => worker.kill("SIGKILL"), 10_000);
    await exited;
    clearTimeout(force);
    cleanup();
  };
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (worker.exitCode !== null) {
      await close();
      throw new Error(`Local ${label} Worker failed: ${diagnostic}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, {
        signal: AbortSignal.timeout(500),
      });
      if (response.status === 404) return close;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await close();
  throw new Error(`Local ${label} Worker did not start: ${diagnostic}`);
}
