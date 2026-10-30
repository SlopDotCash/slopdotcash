// Local R2 in Node, the supported runtime for Miniflare. No credentials inherit.
import { timingSafeEqual } from "node:crypto";
import { once } from "node:events";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";

process.umask(0o077);
let runtime;
let server;
try {
  const lines = createInterface({ input: process.stdin });
  const [line] = await once(lines, "line");
  const { directory, token } = JSON.parse(line);
  if (typeof directory !== "string" || !/^[a-f0-9]{64}$/u.test(token))
    throw new Error("Invalid storage configuration");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  runtime = new Miniflare({
    ...convertV4MiniflareOptions({
      name: "slop-local-private-storage",
      modules: true,
      host: "127.0.0.1",
      port: 0,
      compatibilityDate: "2026-07-30",
      script:
        "export default { fetch() { return new Response(null, { status: 404 }); } };",
      r2Buckets: { PRIVATE: "slop-dev-private" },
    }),
    resourcePersistencePath: directory,
  });
  const bucket = await runtime.getR2Bucket("PRIVATE");
  const expected = Buffer.from(`Bearer ${token}`);
  server = createServer(async (request, response) => {
    try {
      const supplied = Buffer.from(request.headers.authorization ?? "");
      if (
        supplied.length !== expected.length ||
        !timingSafeEqual(supplied, expected)
      ) {
        response.writeHead(404).end();
        return;
      }
      const url = new URL(request.url, "http://127.0.0.1");
      const key = decodeURIComponent(url.pathname.slice(1));
      if (
        !key ||
        key.length > 1024 ||
        !["PUT", "GET", "HEAD"].includes(request.method)
      ) {
        response.writeHead(400).end();
        return;
      }
      if (request.method === "PUT") {
        const chunks = [];
        let size = 0;
        for await (const chunk of request) {
          size += chunk.length;
          if (size > 64 * 1024 * 1024) {
            response.writeHead(413).end();
            return;
          }
          chunks.push(chunk);
        }
        const options = JSON.parse(request.headers["x-r2-options"] ?? "{}");
        const stored = await bucket.put(key, Buffer.concat(chunks), options);
        response
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ stored: stored !== null }));
        return;
      }
      const object =
        request.method === "HEAD"
          ? await bucket.head(key)
          : await bucket.get(key);
      if (!object) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        "content-type": "application/octet-stream",
        "x-r2-size": String(object.size),
        "x-r2-metadata": Buffer.from(
          JSON.stringify(object.customMetadata ?? {}),
        ).toString("base64"),
        "cache-control": "no-store",
      });
      if (request.method === "HEAD") response.end();
      else Readable.fromWeb(object.body).pipe(response);
    } catch {
      if (!response.headersSent) response.writeHead(503);
      response.end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  process.stdout.write(`http://127.0.0.1:${server.address().port}\n`);
  await Promise.race([
    once(lines, "close"),
    once(process, "SIGTERM"),
    once(process, "SIGINT"),
  ]);
} catch {
  process.stderr.write("Local private storage failed.\n");
  process.exitCode = 1;
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  await runtime?.dispose();
}
