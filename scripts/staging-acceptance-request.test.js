import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { stagingAcceptanceRequest } from "./staging-acceptance-request.mjs";

async function server(handler, run) {
  const http = createServer(handler);
  await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
  try {
    await run(`http://127.0.0.1:${http.address().port}`);
  } finally {
    await new Promise((resolve, reject) => {
      http.close((error) => (error ? reject(error) : resolve()));
      http.closeAllConnections();
    });
  }
}
const fast = { retryDelayMs: 0 };

test("a reset and transient HTTP failure recover without following redirects or changing a synthetic probe", async () => {
  const bodies = [];
  let calls = 0;
  await server(
    async (request, response) => {
      let body = "";
      for await (const part of request) body += part;
      bodies.push({
        method: request.method,
        origin: request.headers.origin,
        body,
      });
      calls++;
      if (calls === 1) return request.socket.destroy();
      response.writeHead(calls === 2 ? 503 : 302, {
        Location: "/must-not-follow",
      });
      response.end();
    },
    async (origin) => {
      const code = `
        import { stagingAcceptanceRequest } from ${JSON.stringify(new URL("./staging-acceptance-request.mjs", import.meta.url).href)};
        const result = await stagingAcceptanceRequest(${JSON.stringify(`${origin}/oauth-start`)}, {
          method: "POST", headers: { Origin: "https://staging.slop.cash" },
          body: '{"audience":"slop-points-web"}'
        }, { retryDelayMs: 0 });
        if (result.status !== 302) process.exit(2);
      `;
      const child = spawn("node", ["--input-type=module", "-e", code]);
      let diagnostics = "";
      child.stderr.on("data", (chunk) => {
        diagnostics += chunk;
      });
      const exit = await new Promise((resolve, reject) => {
        child.on("error", reject);
        child.on("close", resolve);
      });
      expect(exit, diagnostics).toBe(0);
      expect(bodies).toHaveLength(3);
      expect(
        bodies.every(
          (body) => JSON.stringify(body) === JSON.stringify(bodies[0]),
        ),
      ).toBe(true);
    },
  );
});

for (const status of [200, 401, 403, 404]) {
  test(`HTTP ${status} reaches the semantic assertion without retry`, async () => {
    let calls = 0;
    await server(
      (_request, response) => {
        calls++;
        response.writeHead(status, { "Content-Type": "application/json" });
        response.end('{"status":"unexpected"}');
      },
      async (origin) => {
        const result = await stagingAcceptanceRequest(origin, {}, fast);
        expect(result.status).toBe(status);
        expect(await result.json()).toEqual({ status: "unexpected" });
        expect(calls).toBe(1);
      },
    );
  });
}

test("persistent service failures exhaust three attempts rather than pass", async () => {
  let calls = 0;
  await server(
    (_request, response) => {
      calls++;
      response.writeHead(503);
      response.end();
    },
    async (origin) => {
      await expect(stagingAcceptanceRequest(origin, {}, fast)).rejects.toThrow(
        "retry bound",
      );
      expect(calls).toBe(3);
    },
  );
});

test("a stalled service is bounded across all attempts", async () => {
  await server(
    () => {},
    async (origin) => {
      const started = Date.now();
      await expect(
        stagingAcceptanceRequest(
          origin,
          {},
          {
            timeoutMs: 150,
            attemptTimeoutMs: 60,
            retryDelayMs: 0,
          },
        ),
      ).rejects.toThrow("retry bound");
      expect(Date.now() - started).toBeLessThan(1500);
    },
  );
});
