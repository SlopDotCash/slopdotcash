/** Test transport only. Run native Workerd in Node while the existing chain fixture uses Bun. */
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export async function cloudflareKeeperRuntime(directory, privateKey, observer) {
  async function start() {
    const child = spawn("node", [fileURLToPath(import.meta.url), "--serve"], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      stdio: ["ignore", "pipe", "inherit"],
      // The abrupt-restart test kills only this fixture and its Workerd child.
      detached: true,
    });
    let output = "";
    const origin = await new Promise((resolve, reject) => {
      child.stdout.on("data", (chunk) => {
        output += chunk;
        const match = output.match(
          /KEEPER_FIXTURE=(http:\/\/127\.0\.0\.1:\d+)/,
        );
        if (match) resolve(match[1]);
      });
      child.once("error", reject);
      child.once("exit", (code) =>
        reject(new Error(`Workerd fixture exited ${code}`)),
      );
    });
    return { child, origin };
  }
  let runtime = await start();
  let latest;
  async function request(path, body) {
    const response = await fetch(`${runtime.origin}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const result = response.status === 204 ? {} : await response.json();
    if (!response.ok) throw new Error(result.error ?? "Workerd fixture failed");
    return result;
  }
  async function configure(config, mode, now, failAfterSign = false) {
    latest = {
      directory,
      bindings: {
        KEEPER_CONFIG: JSON.stringify(config),
        ...(mode ? { KEEPER_MODE: mode } : {}),
        KEEPER_EVM_PRIVATE_KEY: privateKey,
        TEST_NOW: now.toISOString(),
        TEST_OBSERVER: observer,
        TEST_FAIL_AFTER_SIGN: failAfterSign ? "yes" : "no",
      },
    };
    await request("/configure", latest);
  }
  return {
    configure,
    async tick(config, execute, now, options = {}) {
      await configure(
        config,
        execute ? "execute" : "dry_run",
        now,
        options.failAfterSign,
      );
      const result = await request(
        options.concurrent ? "/concurrent" : "/tick",
      );
      if (options.concurrent) return result.map((item) => item.results);
      return result.results;
    },
    async query(sql, ...values) {
      return request("/inspect", { sql, values });
    },
    async restart() {
      await request("/restart", latest);
    },
    async crashAndRestart() {
      const previousPid = runtime.child.pid;
      if (!previousPid) throw new Error("Fixture process is not running");
      const exited = once(runtime.child, "exit");
      process.kill(-previousPid, "SIGKILL");
      const [code, signal] = await exited;
      if (code !== null || signal !== "SIGKILL")
        throw new Error("Fixture did not terminate abruptly");
      runtime = await start();
      // Same compiled entrypoint, directory, bindings, namespace and signer.
      await request("/configure", latest);
      return { previousPid, currentPid: runtime.child.pid };
    },
    request,
    async close() {
      await request("/close").catch(() => {});
      if (runtime.child.exitCode === null) await once(runtime.child, "exit");
    },
  };
}

if (process.argv.includes("--serve")) {
  const { build } = await import("esbuild");
  const { Miniflare, convertV4MiniflareOptions } = await import("miniflare");
  const compiled = await build({
    entryPoints: [
      fileURLToPath(new URL("./cloudflare-keeper-worker.ts", import.meta.url)),
    ],
    bundle: true,
    platform: "browser",
    format: "esm",
    external: ["node:*"],
    loader: { ".sql": "text" },
    write: false,
    logLevel: "silent",
  });
  let mf;
  let current;
  async function configure(input, restart) {
    if (!restart && current === JSON.stringify(input)) return;
    const options = convertV4MiniflareOptions({
      modules: true,
      script: compiled.outputFiles[0].text,
      compatibilityDate: "2026-09-07",
      compatibilityFlags: ["nodejs_compat"],
      bindings: input.bindings,
      durableObjects: {
        KEEPER: { className: "FixtureKeeper", useSQLite: true },
      },
    });
    // Miniflare 5's V4 converter does not carry the old per-resource persist option.
    options.resourcePersistencePath = join(input.directory, "cloudflare");
    if (mf && !restart) await mf.setOptions(options);
    else {
      if (mf) await mf.dispose();
      mf = new Miniflare(options);
    }
    await mf.ready;
    current = JSON.stringify(input);
  }
  const server = createServer(async (request, response) => {
    try {
      let text = "";
      for await (const chunk of request) text += chunk;
      const body = JSON.parse(text || "{}");
      if (request.url === "/configure" || request.url === "/restart") {
        await configure(body, request.url === "/restart");
        response.end("{}");
      } else if (request.url === "/close") {
        await mf?.dispose();
        response.end("{}");
        server.close();
      } else {
        const result = await mf.dispatchFetch(
          `http://fixture.test${request.url}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        response.writeHead(result.status, {
          "content-type": "application/json",
        });
        response.end(result.status === 204 ? "{}" : await result.text());
      }
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: String(error.message) }));
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  console.log(`KEEPER_FIXTURE=http://127.0.0.1:${server.address().port}`);
}
