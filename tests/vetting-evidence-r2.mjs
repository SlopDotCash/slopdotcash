// Run Miniflare in its supported Node runtime; the tests still use real R2.
import { convertV4MiniflareOptions, Miniflare } from "miniflare";

const runtime = new Miniflare(
  convertV4MiniflareOptions({
    name: "evidence",
    modules: true,
    host: "127.0.0.1",
    port: 0,
    compatibilityDate: "2026-07-30",
    r2Buckets: ["E"],
    script: `export default { async fetch(request, env) {
        const key = decodeURIComponent(new URL(request.url).pathname.slice(1));
        if (request.method === "PUT") {
          const options = JSON.parse(request.headers.get("x-r2-options"));
          const value = await env.E.put(key, await request.arrayBuffer(), options);
          return Response.json({ stored: value !== null });
        }
        if (request.method === "DELETE") {
          await env.E.delete(key);
          return new Response(null, { status: 204 });
        }
        const value = request.method === "HEAD"
          ? await env.E.head(key) : await env.E.get(key);
        if (!value) return new Response(null, { status: 404 });
        return new Response(request.method === "HEAD" ? null : value.body, {
          headers: {
            "x-r2-size": String(value.size),
            "x-r2-etag": value.etag,
            "x-r2-metadata": JSON.stringify(value.customMetadata ?? {}),
          },
        });
      }} `,
  }),
);
try {
  const url = await runtime.ready;
  process.stdout.write(`${url.href}\n`);
  process.stdin.resume();
  await new Promise((resolve) => process.stdin.once("end", resolve));
} finally {
  await runtime.dispose();
}
